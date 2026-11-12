/**
 * Build the `variant` a placed block carries, from a `type/library/pou` block
 * reference.
 *
 * `node.data.variant` is the only durable record of a block's signature — the
 * transpiler and the PLCopen exporter both read it off the placed node rather
 * than re-resolving the library, so whatever this produces is what the project
 * compiles against forever.
 *
 * Lives in `utils/` because three layers need it: the two graphical editors
 * (`components`), and the CLI, which may not import `components` at all. It was
 * previously ~70 lines duplicated near-verbatim between `ladder/rung/body.tsx`
 * and `fbd/index.tsx`.
 *
 * Pure: state arrives as arguments rather than being read from the store, so
 * the same call works in a renderer, a test and a headless process.
 */

// From `ports`, not the store's re-export: `utils` may not import `store`.
import type { SystemLibrary, UserLibrary } from '../../../middleware/shared/ports/library-types'
import type { PLCPou } from '../../../middleware/shared/ports/types'
import { isCallableMethod, pouMethods } from './pou-methods'
import { getVariableRestrictionType } from './validate-variable-type'

/**
 * One pin on a placed block.
 *
 * Structural and permissive on purpose. The two sources disagree: a system
 * library pin carries a narrow class enum, while a user POU's variable may have
 * no class at all, and a synthesised function return can be `derived` — which
 * the strict `blockVariantVariableSchema` union does not admit. Both editors
 * accept this through a generic parameter today; widening here keeps that
 * behaviour rather than forcing a cast at three call sites.
 */
export interface BlockVariantVariable {
  id?: string
  name: string
  class?: string
  type: { definition: string; value: string }
  /** `R_EDGE` / `F_EDGE` on a BOOL input (IEC 61131-3 6.6.3.2). */
  edge?: 'R_EDGE' | 'F_EDGE'
}

/** The curated signature a placed block keeps. Deliberately not the library entry. */
export interface BlockVariantShape {
  name: string
  type: string
  variables: BlockVariantVariable[]
  documentation?: string
  extensible: boolean
  /** EN / ENO always shown — see `SystemLibraryPou.executionControl`. */
  executionControl?: true
  /** `method` only: the function block type that declares the method; the box's instance is of it. */
  owner?: string
}

export type BuildBlockVariantResult =
  | { ok: true; variant: BlockVariantShape }
  | {
      ok: false
      /** `abstract`: an ABSTRACT block, never instantiated (IEC 61131-3 6.6.5.8.2). */
      reason: 'unknown-library' | 'unknown-pou' | 'malformed-ref' | 'abstract' | 'unknown-method' | 'not-callable'
      /**
       * Which half of the reference failed. The two editors report a failed
       * `system` lookup with a toast but drop a failed `user` lookup silently,
       * so a caller has to be able to tell them apart.
       */
      libraryType: 'system' | 'user' | 'unknown'
      blockRef: string
    }

export interface BuildBlockVariantInput {
  /**
   * `system/<library>/<pou>` or `user/<pou>` — the form the editors split on.
   * A method of a function block is `<pou>.<method>` in either form: the box
   * calls that method of an instance of the block (IEC 61131-3 6.6.5.4).
   */
  blockRef: string
  systemLibraries: readonly SystemLibrary[]
  userLibraries: readonly UserLibrary[]
  pous: readonly PLCPou[]
}

/** The `OUT` pin a value-returning call's result leaves on, as a function's does. */
const returnPin = (returnType: string): BlockVariantVariable => {
  const restriction = getVariableRestrictionType(returnType)
  return {
    id: 'OUT',
    name: 'OUT',
    class: 'output',
    type: { definition: restriction.definition ?? 'derived', value: returnType.toUpperCase() },
  }
}

/**
 * A method box (IEC 61131-3 6.6.5.4; CODESYS draws it as `instance.Method`):
 * the method's inputs and in-outs on the left, its outputs and its result
 * (`OUT`) on the right. EN / ENO are always shown: the rung gates the call.
 */
function buildMethodVariant(input: BuildBlockVariantInput): BuildBlockVariantResult {
  const libraryType = input.blockRef.startsWith('system/') ? 'system' : 'user'
  const fail = (reason: 'unknown-library' | 'unknown-pou' | 'malformed-ref' | 'unknown-method' | 'not-callable') =>
    ({ ok: false, reason, libraryType, blockRef: input.blockRef }) as const
  const segments = input.blockRef.split('/')
  const qualified = segments[segments.length - 1] ?? ''
  const dot = qualified.indexOf('.')
  const owner = qualified.slice(0, dot)
  const methodName = qualified.slice(dot + 1)
  if (owner === '' || methodName === '' || methodName.includes('.')) return fail('malformed-ref')
  const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

  if (libraryType === 'system') {
    if (segments.length !== 3) return fail('malformed-ref')
    const library = input.systemLibraries.find((entry) => entry.name === segments[1])
    if (!library) return fail('unknown-library')
    const block = library.pous.find((pou) => pou.type === 'function-block' && same(pou.name, owner))
    if (!block) return fail('unknown-pou')
    // A library lists only its PUBLIC methods (own and inherited).
    const method = block.methods?.find((entry) => same(entry.name, methodName))
    if (!method) return fail('unknown-method')
    return {
      ok: true,
      variant: {
        name: method.name,
        type: 'method',
        owner: block.name,
        variables: [...method.variables, ...(method.returnType !== undefined ? [returnPin(method.returnType)] : [])],
        documentation: '',
        extensible: false,
        executionControl: true,
      },
    }
  }

  if (segments.length !== 2) return fail('malformed-ref')
  const methods = pouMethods(input.pous, owner)
  if (methods === undefined) return fail('unknown-pou')
  const method = methods.find((entry) => same(entry.name, methodName))
  if (!method) return fail('unknown-method')
  // PROTECTED and PRIVATE methods are the block's own (IEC 61131-3 6.6.5.4).
  if (!isCallableMethod(method)) return fail('not-callable')
  const block = input.pous.find((pou) => same(pou.name, owner))
  const variables: BlockVariantVariable[] = method.variables.map((variable) => ({
    name: variable.name,
    class: variable.class,
    type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
  }))
  return {
    ok: true,
    variant: {
      name: method.name,
      type: 'method',
      owner: block?.name ?? owner,
      variables: [...variables, ...(method.returnType !== undefined ? [returnPin(method.returnType)] : [])],
      documentation: '',
      extensible: false,
      executionControl: true,
    },
  }
}

export function buildBlockVariant(input: BuildBlockVariantInput): BuildBlockVariantResult {
  if (/^(system\/[^/]+|user)\/[^/.]+\.[^/]+$/.test(input.blockRef)) return buildMethodVariant(input)
  const segments = input.blockRef.split('/')
  const [blockLibraryType, blockLibrary, pouName] = segments

  // Destructuring ignores anything past the third segment, so `system/lib/TON/x`
  // would resolve as `system/lib/TON`. The two shapes have exact lengths.
  if (blockLibraryType === 'system' && segments.length !== 3) {
    return { ok: false, reason: 'malformed-ref', libraryType: 'system', blockRef: input.blockRef }
  }
  if (blockLibraryType === 'user' && segments.length !== 2) {
    return { ok: false, reason: 'malformed-ref', libraryType: 'user', blockRef: input.blockRef }
  }

  if (blockLibraryType === 'system') {
    if (!blockLibrary || !pouName)
      return { ok: false, reason: 'malformed-ref', libraryType: 'system', blockRef: input.blockRef }
    // IEC names ignore case (6.1.2): FB_MqttClient is FB_MQTTCLIENT.
    const libraryPou = input.systemLibraries
      .find((library) => library.name === blockLibrary)
      ?.pous.find((pou) => pou.name.toUpperCase() === pouName.toUpperCase())
    if (!libraryPou) return { ok: false, reason: 'unknown-pou', libraryType: 'system', blockRef: input.blockRef }
    if (libraryPou.isAbstract === true) {
      return { ok: false, reason: 'abstract', libraryType: 'system', blockRef: input.blockRef }
    }

    // Copy the signature, not the library entry. That entry also carries `body`
    // (the authored source, which for a native C/C++ or Python block is the
    // entire file) and `language`, and passing the object straight through froze
    // a copy of the library's source into every project that placed the block.
    // Nothing ever reads either field back off a placed variant, and the
    // embedded VAR ... END_VAR broke the POU parser badly enough that the
    // project would not open (DOPE-592).
    return {
      ok: true,
      variant: {
        name: libraryPou.name,
        type: libraryPou.type,
        variables: libraryPou.variables,
        documentation: libraryPou.documentation,
        extensible: libraryPou.extensible ?? false,
        ...(libraryPou.executionControl === true ? { executionControl: true as const } : {}),
      },
    }
  }

  if (blockLibraryType === 'user') {
    if (!blockLibrary) return { ok: false, reason: 'malformed-ref', libraryType: 'user', blockRef: input.blockRef }
    const library = input.userLibraries.find((entry) => entry.name.toUpperCase() === blockLibrary.toUpperCase())
    if (!library) return { ok: false, reason: 'unknown-library', libraryType: 'user', blockRef: input.blockRef }
    const pou = input.pous.find((entry) => entry.name === library.name)
    if (!pou) return { ok: false, reason: 'unknown-pou', libraryType: 'user', blockRef: input.blockRef }
    if (pou.interface?.isAbstract === true) {
      return { ok: false, reason: 'abstract', libraryType: 'user', blockRef: input.blockRef }
    }

    const variables: BlockVariantVariable[] = (pou.interface?.variables ?? []).map((variable) => ({
      id: variable.id,
      name: variable.name,
      class: variable.class,
      type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
      // Drawn with the edge marker on the pin, as a library block's is.
      ...(variable.edge !== undefined ? { edge: variable.edge === 'rising' ? 'R_EDGE' : 'F_EDGE' } : {}),
    }))

    // A function's return value is a pin on the diagram but not a declared
    // variable, so it is synthesised here. System library POUs already declare
    // their outputs, which is why that branch never does this.
    if (pou.pouType === 'function') {
      const restriction = getVariableRestrictionType(pou.interface?.returnType ?? '')
      variables.push({
        id: 'OUT',
        name: 'OUT',
        class: 'output',
        type: {
          definition: restriction.definition ?? 'derived',
          value: (pou.interface?.returnType ?? '').toUpperCase(),
        },
      })
    }

    return {
      ok: true,
      variant: {
        name: pou.name,
        type: pou.pouType,
        variables,
        documentation: pou.documentation,
        extensible: false,
      },
    }
  }

  return { ok: false, reason: 'malformed-ref', libraryType: 'unknown', blockRef: input.blockRef }
}

/**
 * Why `instance` cannot be the instance of a method box, or undefined when it
 * can: it is declared, and of the method's block type or one that EXTENDS it.
 * A name this POU does not declare plainly — a global list's member
 * (`NET.node`), an array element (`zones[1]`) — is left to the compiler.
 */
export function methodInstanceError(
  instance: string | undefined,
  variant: BlockVariantShape,
  declared: readonly { name: string; type: { definition: string; value: string } }[],
  pous: readonly PLCPou[],
): string | undefined {
  const owner = variant.owner ?? ''
  if (instance === undefined || instance.trim() === '') {
    return `a method box needs "instance": the ${owner} instance whose method ${variant.name} it calls`
  }
  if (!/^[A-Za-z_]\w*$/.test(instance)) return undefined
  const variable = declared.find((entry) => entry.name.toUpperCase() === instance.toUpperCase())
  if (variable === undefined) return `"${instance}" is not declared; declare it as ${owner}`
  // The block types up from the instance's own, through EXTENDS.
  const seen = new Set<string>()
  for (let type: string | undefined = variable.type.value; type !== undefined && !seen.has(type.toUpperCase()); ) {
    if (type.toUpperCase() === owner.toUpperCase()) return undefined
    seen.add(type.toUpperCase())
    const typeName: string = type
    type = pous.find((pou) => pou.name.toUpperCase() === typeName.toUpperCase())?.interface?.extends
  }
  return `"${instance}" is ${variable.type.value}, not ${owner}: ${variant.name} is a method of ${owner}`
}

/**
 * A method box named as CODESYS names it: `<instance>.<method>` (an instance
 * the POU declares) or `<block>.<method>`. Undefined when `text` is not of that
 * form or names no method; `instance` is set when the text named one.
 */
export function resolveMethodBox(
  text: string,
  input: Omit<BuildBlockVariantInput, 'blockRef'> & {
    /** The POU's variables, where an instance is looked up. */
    variables: readonly { name: string; type: { definition: string; value: string } }[]
  },
): { variant: BlockVariantShape; instance?: string; blockRef: string } | undefined {
  const dot = text.lastIndexOf('.')
  if (dot <= 0 || dot === text.length - 1) return undefined
  const left = text.slice(0, dot).trim()
  const methodName = text.slice(dot + 1).trim()
  const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()
  const instance = input.variables.find((variable) => same(variable.name, left))
  const owner = instance !== undefined ? instance.type.value : left
  const userBlock = input.pous.find((pou) => pou.pouType === 'function-block' && same(pou.name, owner))
  const library = userBlock
    ? undefined
    : input.systemLibraries.find((entry) =>
        entry.pous.some((pou) => pou.type === 'function-block' && same(pou.name, owner)),
      )
  const ownerName = userBlock?.name ?? library?.pous.find((pou) => same(pou.name, owner))?.name
  if (ownerName === undefined) return undefined
  const blockRef = userBlock ? `user/${ownerName}.${methodName}` : `system/${library!.name}/${ownerName}.${methodName}`
  const built = buildBlockVariant({ ...input, blockRef })
  if (!built.ok) return undefined
  return { variant: built.variant, blockRef, ...(instance !== undefined ? { instance: instance.name } : {}) }
}
