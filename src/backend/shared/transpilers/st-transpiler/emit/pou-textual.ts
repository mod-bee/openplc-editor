/**
 * IR-native textual-POU emitter — ST / IL / Python / C++.
 *
 * Skips the DOM round-trip entirely: walks `TranspilePou` directly
 * and emits the same chunk shape `pou_assembly.generateProgram`
 * produces for textual bodies.  Byte-identical with the XML-fed
 * transpiler (verified by the comparison helper).
 *
 * Graphical POUs (LD / FBD / SFC) still go through the DOM-based
 * walker in `src/PLCGenerator/pou_assembly.ts` — see `index.ts`'s
 * dispatch.
 */

import { PLC_BASE_TYPES } from '../helpers/base-types'
import type { ProgramChunk } from '../helpers/program'
import { reIndentText } from '../helpers/text-helpers'
import { computePouName } from '../helpers/text-helpers'
import { varTypeNames } from '../helpers/type-text'
import { edgeSuffix, varBlockBucketKey, varBlockQualifier } from '../helpers/var-block'
import type { TranspilePou, TranspileProject, TranspileVariable, TranspileVariableClass } from '../types'
import { declaredTypeName, getTypeAsText } from './type-text'
import { computeValue } from './value'

/**
 * Mirror python's `<returnType>` rendering rule: elementary IEC
 * types come out uppercased (`BOOL`, `INT`, …), user-defined
 * derived types keep their declared case (`Irrigation_State`).
 * `interface.computeReturnType` in the XML-fed transpiler does the
 * equivalent by branching on the `<derived>` local tag.
 */
function formatReturnType(returnType: string | undefined): string {
  if (returnType === undefined || returnType === '') return 'BOOL'
  return PLC_BASE_TYPES.has(returnType.toUpperCase()) ? returnType.toUpperCase() : returnType
}

interface InterfaceEntry {
  keyword: string
  located: boolean
  /** Block qualifier for this group; absent = plain `VAR`. */
  flag?: TranspileVariable['flag']
  /** Access specifier of the group's `VAR` section; absent = none. */
  access?: TranspileVariable['access']
  vars: TranspileVariable[]
}

/* ─────────────────────────── public entry ───────────────────────────────── */

/**
 * Emit a complete textual-body POU (signature → VAR sections → body
 * text → closing keyword).  Mirrors
 * `PouProgramGenerator.GenerateProgram` (PLCGenerator.py:2414) for the
 * textual body path.
 *
 * An empty POU is emitted, not refused.  This used to throw on a POU
 * with no variables and again on one with no body — guards inherited
 * from matiec/xml2st, where they were real.  STruC++ accepts every
 * empty shape (`PROGRAM p END_PROGRAM`, an empty FUNCTION_BLOCK, an
 * empty FUNCTION) and emits `// Empty program body` for it, so the
 * guards only blocked a build the compiler would have taken — and did
 * it on a project whose POUs the user had merely not filled in yet
 * (DOPE-650).  Throws only on a body language this emitter cannot
 * handle, which is an internal dispatch error.
 */
export function generateTextualPou(pou: TranspilePou, project: TranspileProject, indent = 2): ProgramChunk[] {
  const tagName = computePouName(pou.name)
  const kindKeyword = (
    {
      program: 'PROGRAM',
      function: 'FUNCTION',
      'function-block': 'FUNCTION_BLOCK',
      interface: 'INTERFACE',
    } as Record<string, string>
  )[pou.pouType]

  const program: ProgramChunk[] = []
  program.push([`${kindKeyword} `, []])
  // ABSTRACT / FINAL sit between the keyword and the name (IEC 61131-3 Annex A).
  const modifier = pouModifier(pou)
  if (modifier) program.push([modifier, [tagName, 'modifier']])
  program.push([pou.name, [tagName, 'name']])

  if (pou.pouType === 'function') {
    program.push([' : ', []])
    program.push([formatReturnType(pou.interface.returnType), [tagName, 'return']])
  }
  // Dropped here, a derived block reaches strucpp with no base clause, so it
  // is emitted with no base class, no inherited pins and no dynamic binding.
  // Likewise IMPLEMENTS: without it no instance is assignable to the interface.
  pushOopClauses(program, pou, tagName)
  program.push(['\n', []])

  // An INTERFACE holds method prototypes only (6.6.6.1): no VAR sections of its
  // own, its prototypes are its body.
  if (pou.pouType === 'interface') {
    const prototypes = pou.body.language === 'st' ? pou.body.value : ''
    if (prototypes.length > 0) program.push([reIndentText(prototypes, indent), [tagName, 'body', indent]])
    program.push([`END_${kindKeyword}\n\n`, []])
    return program
  }

  const iface = computeInterface(pou.interface.variables)

  let varNumber = 0
  for (const entry of iface) {
    const variableType = locationCategory(entry.keyword)
    program.push([`  ${entry.keyword}${varBlockQualifier(entry.flag, entry.access)}`, []])
    program.push(['\n', []])

    for (const v of entry.vars) {
      program.push(['    ', []])
      program.push([v.name, [tagName, variableType, varNumber, 'name']])
      program.push([' ', []])

      if (v.location) {
        program.push(['AT ', []])
        program.push([v.location, [tagName, variableType, varNumber, 'location']])
        program.push([' ', []])
      }

      const typeText = getTypeAsText(v)
      program.push([': ', []])
      program.push([typeText, [tagName, variableType, varNumber, 'type']])
      const edge = edgeSuffix(v)
      if (edge) program.push([edge, [tagName, variableType, varNumber, 'edge']])

      if (v.initialValue !== undefined && v.initialValue !== '') {
        const declared = declaredTypeName(v)
        program.push([' := ', []])
        program.push([
          computeValue(project, v.initialValue, declared),
          [tagName, variableType, varNumber, 'initial value'],
        ])
      }
      program.push([';\n', []])
      varNumber++
    }
    program.push(['  END_VAR\n', []])
  }

  program.push(['\n', []])

  // Body: raw textual source, re-indented to `indent` spaces.  For ST
  // / IL / Python / C++ the IR's `value` is already a string.
  if (
    pou.body.language !== 'st' &&
    pou.body.language !== 'il' &&
    pou.body.language !== 'python' &&
    pou.body.language !== 'cpp'
  ) {
    throw new Error(`generateTextualPou called with non-textual body "${pou.body.language}"`)
  }
  const bodyText = pou.body.value
  if (bodyText.length > 0) {
    program.push([reIndentText(bodyText, indent), [tagName, 'body', indent]])
  }

  program.push([`END_${kindKeyword}\n\n`, []])
  return program
}

/* ────────────────────── helpers ─────────────────────────────────────────── */

/** `ABSTRACT ` / `FINAL ` for a function block (6.6.5.8), else empty. */
export function pouModifier(pou: TranspilePou): string {
  if (pou.pouType !== 'function-block') return ''
  return pou.interface.isAbstract ? 'ABSTRACT ' : pou.interface.isFinal ? 'FINAL ' : ''
}

/** ` EXTENDS …` and ` IMPLEMENTS …` after the POU name (6.6.5.5, 6.6.6.4, 6.6.6.6). */
export function pushOopClauses(program: ProgramChunk[], pou: TranspilePou, tagName: string): void {
  if (pou.interface.extends) {
    program.push([` EXTENDS ${pou.interface.extends}`, [tagName, 'extends']])
  }
  if (pou.pouType === 'function-block' && pou.interface.implements && pou.interface.implements.length > 0) {
    program.push([` IMPLEMENTS ${pou.interface.implements.join(', ')}`, [tagName, 'implements']])
  }
}

function computeInterface(variables: TranspileVariable[]): InterfaceEntry[] {
  // Bucket variables by class, mirroring the order Python's varlist
  // iteration produces.  `classToKeyword` is keyed on IR class names
  // (which match the PLCOpen `<localVars>`/`<inputVars>`/… local
  // tags after lower-casing the leading section); look those up
  // through `varTypeNames` so the keyword strings stay identical to
  // the DOM emitter.
  const classToKeyword: Record<TranspileVariableClass, string> = {
    input: varTypeNames.inputVars,
    output: varTypeNames.outputVars,
    inOut: varTypeNames.inOutVars,
    external: varTypeNames.externalVars,
    local: varTypeNames.localVars,
    temp: varTypeNames.tempVars,
  }

  // Keyed by class × flag: IEC puts the qualifier on the var BLOCK, not on the
  // declaration, so two variables of the same class with different flags cannot
  // share a block — `VAR CONSTANT` and `VAR` are separate `…END_VAR` pairs.
  // The key keeps `keyword` first so a Map iteration still yields the class
  // order the DOM emitter produced.
  const grouped = new Map<
    string,
    {
      keyword: string
      flag?: TranspileVariable['flag']
      access?: TranspileVariable['access']
      located: TranspileVariable[]
      unlocated: TranspileVariable[]
    }
  >()
  // Maintain insertion order matching the IR's variable order.
  for (const v of variables) {
    const keyword = classToKeyword[v.class ?? 'local'] ?? varTypeNames.localVars
    const key = varBlockBucketKey(keyword, v)
    let bucket = grouped.get(key)
    if (!bucket) {
      bucket = {
        keyword,
        ...(v.flag !== undefined ? { flag: v.flag } : {}),
        ...(v.access !== undefined ? { access: v.access } : {}),
        located: [],
        unlocated: [],
      }
      grouped.set(key, bucket)
    }
    if (v.location) bucket.located.push(v)
    else bucket.unlocated.push(v)
  }

  const out: InterfaceEntry[] = []
  for (const bucket of grouped.values()) {
    const flagPart = {
      ...(bucket.flag !== undefined ? { flag: bucket.flag } : {}),
      ...(bucket.access !== undefined ? { access: bucket.access } : {}),
    }
    if (bucket.unlocated.length > 0) {
      out.push({ keyword: bucket.keyword, located: false, ...flagPart, vars: bucket.unlocated })
    }
    if (bucket.located.length > 0) {
      out.push({ keyword: bucket.keyword, located: true, ...flagPart, vars: bucket.located })
    }
  }
  return out
}

const ERROR_VAR_TYPES: Record<string, string> = {
  VAR_INPUT: 'var_input',
  VAR_OUTPUT: 'var_output',
  VAR_INOUT: 'var_inout',
}

function locationCategory(keyword: string): string {
  return ERROR_VAR_TYPES[keyword] ?? 'var_local'
}
