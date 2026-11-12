/**
 * The methods a project's function block offers a caller (IEC 61131-3
 * 6.6.5.4), read from its source: what a method box in Ladder or FBD is built
 * from, as a library block's methods come from its manifest.
 *
 * A C/C++ block declares its methods ahead of its C++ (`splitCppMethods`); an
 * ST block keeps them, with their bodies, at the head of its body text. A block
 * that EXTENDS another also offers the base's methods, its own replacing a
 * base method of the same name (OVERRIDE).
 */
import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { splitCppMethods } from '../cpp/cpp-methods'
import { parseIecStringToVariables } from '../generate-iec-string-to-variables'

export type PouMethodAccess = 'PUBLIC' | 'PRIVATE' | 'PROTECTED' | 'INTERNAL'

export type PouMethod = {
  /** As declared. */
  name: string
  /** Absent when the declaration names none, which IEC 61131-3 reads as PROTECTED. */
  access?: PouMethodAccess
  /** Absent for a method that returns nothing. */
  returnType?: string
  /** VAR_INPUT, VAR_IN_OUT and VAR_OUTPUT parameters, in declaration order. */
  variables: PLCVariable[]
}

const ACCESS = ['PUBLIC', 'PRIVATE', 'PROTECTED', 'INTERNAL'] as const

/** `text` with comments and string literals blanked, offsets kept. */
const blankCommentsAndStrings = (text: string): string => {
  let out = ''
  let i = 0
  while (i < text.length) {
    const two = text.slice(i, i + 2)
    const close = two === '(*' ? '*)' : two === '//' ? '\n' : null
    const quote = text[i] === "'" || text[i] === '"' ? text[i] : null
    if (close === null && quote === null) {
      out += text[i]
      i++
      continue
    }
    const end = close !== null ? text.indexOf(close, i + 2) : text.indexOf(quote as string, i + 1)
    const stop = end === -1 ? text.length : end + (close !== null ? close.length : 1)
    out += text.slice(i, stop).replace(/[^\n]/g, ' ')
    i = stop
  }
  return out
}

/** The methods declared in an ST function block's body text. */
export const stMethodSignatures = (body: string): PouMethod[] => {
  const blank = blankCommentsAndStrings(body)
  const methods: PouMethod[] = []
  const start = /\bMETHOD\b/gi
  let match: RegExpExecArray | null
  while ((match = start.exec(blank)) !== null) {
    const end = /\bEND_METHOD\b/i.exec(blank.slice(match.index))
    if (end === null) break
    const text = blank.slice(match.index, match.index + end.index)
    start.lastIndex = match.index + end.index + 'END_METHOD'.length
    const firstVar = /\bVAR\w*\b/i.exec(text)
    const headerText = (firstVar === null ? text.split('\n')[0] : text.slice(0, firstVar.index)).trim()
    const header = /^METHOD\s+((?:\w+\s+)*?)(\w+)\s*(?::\s*([^;\n]+?))?\s*;?\s*$/i.exec(
      headerText.split('\n')[0].trim(),
    )
    if (header === null) continue
    const words = header[1].trim() === '' ? [] : header[1].trim().toUpperCase().split(/\s+/)
    const access = words.find((word): word is PouMethodAccess => (ACCESS as readonly string[]).includes(word))
    const variables: PLCVariable[] = []
    const section = /\b(VAR_INPUT|VAR_IN_OUT|VAR_OUTPUT)\b[\s\S]*?\bEND_VAR\b/gi
    let sectionMatch: RegExpExecArray | null
    while ((sectionMatch = section.exec(text)) !== null) {
      // The original text, not the blanked copy: initial values keep their literals.
      const from = match.index + sectionMatch.index
      const source = body.slice(from, from + sectionMatch[0].length)
      try {
        variables.push(...parseIecStringToVariables(source))
      } catch {
        // A section that does not parse leaves its parameters out; the compile reports it.
      }
    }
    methods.push({
      name: header[2],
      ...(access !== undefined ? { access } : {}),
      ...(header[3] !== undefined && header[3].trim() !== '' ? { returnType: header[3].trim() } : {}),
      variables,
    })
  }
  return methods
}

/** The methods a function block declares itself, from its source. */
const ownMethods = (pou: PLCPou): PouMethod[] => {
  if (pou.pouType !== 'function-block' || typeof pou.body.value !== 'string') return []
  if (pou.body.language === 'cpp') {
    return splitCppMethods(pou.body.value).methods.map((method) => ({
      name: method.name,
      ...(method.access !== undefined ? { access: method.access } : {}),
      ...(method.returnType !== undefined ? { returnType: method.returnType } : {}),
      variables: method.variables,
    }))
  }
  if (pou.body.language === 'st') return stMethodSignatures(pou.body.value)
  return []
}

/**
 * Every method of a project function block, its own and inherited, in
 * declaration order with the base's first. Undefined when `name` is not a
 * function block of `pous`.
 */
export const pouMethods = (pous: readonly PLCPou[], name: string): PouMethod[] | undefined => {
  const byName = (wanted: string) =>
    pous.find((pou) => pou.pouType === 'function-block' && pou.name.toUpperCase() === wanted.toUpperCase())
  const pou = byName(name)
  if (pou === undefined) return undefined
  const chain: PLCPou[] = []
  for (let at: PLCPou | undefined = pou; at !== undefined && !chain.includes(at); ) {
    chain.unshift(at)
    at = at.interface?.extends !== undefined ? byName(at.interface.extends) : undefined
  }
  const methods: PouMethod[] = []
  for (const block of chain) {
    for (const method of ownMethods(block)) {
      const index = methods.findIndex((known) => known.name.toUpperCase() === method.name.toUpperCase())
      if (index === -1) methods.push(method)
      else methods[index] = method
    }
  }
  return methods
}

/** Whether a caller outside the block may call it: PUBLIC, or INTERNAL in the same project. */
export const isCallableMethod = (method: PouMethod): boolean =>
  method.access === 'PUBLIC' || method.access === 'INTERNAL'
