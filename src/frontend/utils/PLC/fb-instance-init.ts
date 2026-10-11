/**
 * The initial value of a function block instance (IEC 61131-3 Ed.3 6.6.3.3,
 * Table 41 feature 2):
 *
 *   TempLoop : PID := (PropBand := 2.5, Integral := T#5s);
 *
 * "the initial values for the inputs, outputs or public variables of the
 * function block instance can be declared in a parenthesized list following the
 * assignment operator". Elements the list does not name keep the defaults the
 * block's own declaration gives them.
 *
 * Kept free of the store (a `utils` module may not import it): the block's
 * declarations are passed in.
 */

import type { SystemLibrary } from '../../../middleware/shared/ports/library-types'
import type { PLCPou } from '../../../middleware/shared/ports/types'

export interface FbInitElement {
  name: string
  value: string
}

/** What an instance may and may not name in its initialisation list. */
export interface FbInitMember {
  name: string
  /** `public` = an input, an output or a PUBLIC variable; the others say why not. */
  kind: 'public' | 'inOut' | 'hidden'
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Whether `text` has the SHAPE of an initialisation list: one parenthesized
 * group spanning the whole value. The store uses this to tell an instance's
 * own init list (kept) from a scalar left over from a type change (dropped).
 */
export const isFbInitList = (text: unknown): text is string => {
  if (typeof text !== 'string') return false
  const split = splitTopLevel(text)
  return split !== null
}

/**
 * The text between the outer parentheses, split at its top-level commas, or
 * `null` when the value is not one parenthesized group.
 *
 * Nested parentheses and brackets (a structure or array value, a call), string
 * literals (with their `$` escapes) and `(* … *)` comments are stepped over, so
 * `(Name := 'a,b', Pts := [1, 2])` is two elements.
 */
function splitTopLevel(raw: string): string[] | null {
  const text = raw.trim()
  if (!text.startsWith('(') || !text.endsWith(')')) return null

  const parts: string[] = []
  let depth = 0
  let start = 1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'" || ch === '"') {
      i++
      while (i < text.length && text[i] !== ch) i += text[i] === '$' ? 2 : 1
      if (i >= text.length) return null
      continue
    }
    if (ch === '(' && text[i + 1] === '*') {
      const close = text.indexOf('*)', i + 2)
      if (close === -1) return null
      i = close + 1
      continue
    }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') {
      depth--
      if (depth < 0) return null
      // The group that opened at 0 closed before the end: `(a := 1) + (b := 2)`.
      if (depth === 0 && i !== text.length - 1) return null
    } else if (ch === ',' && depth === 1) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  if (depth !== 0) return null
  parts.push(text.slice(start, text.length - 1))
  return parts
}

/** Parse an initialisation list into its named elements, or say why it is not one. */
export function parseFbInitList(text: string): { elements: FbInitElement[] } | { error: string } {
  const parts = splitTopLevel(text)
  if (parts === null) return { error: 'it is not one parenthesized list' }
  if (parts.length === 1 && parts[0].trim() === '') return { error: 'the list is empty' }

  const elements: FbInitElement[] = []
  for (const part of parts) {
    const at = part.indexOf(':=')
    const name = at === -1 ? '' : part.slice(0, at).trim()
    const value = at === -1 ? '' : part.slice(at + 2).trim()
    if (!IDENTIFIER.test(name) || value === '') {
      return { error: `"${part.trim()}" is not "Name := value"` }
    }
    elements.push({ name, value })
  }
  return { elements }
}

/**
 * The members of function block `typeName` as an initialisation list sees them,
 * or `null` when neither the project nor an installed library declares it.
 *
 * A project block is searched first (it shadows a library block of the same
 * name, as everywhere else), and its EXTENDS chain is walked: an inherited input
 * is the derived block's input too (6.6.5.5). A library block's pin list already
 * carries its base's pins.
 */
export function resolveFbInitMembers(
  typeName: string,
  pous: readonly PLCPou[],
  libraries: readonly SystemLibrary[],
): FbInitMember[] | null {
  const members: FbInitMember[] = []
  const seen = new Set<string>()
  let current: string | undefined = typeName
  let found = false

  while (current && !seen.has(current.toUpperCase())) {
    const wanted: string = current.toUpperCase()
    seen.add(wanted)

    const own: PLCPou | undefined = pous.find((pou) => pou.pouType === 'function-block' && pou.name.toUpperCase() === wanted)
    if (own) {
      found = true
      for (const variable of own.interface?.variables ?? []) {
        const kind: FbInitMember['kind'] =
          variable.class === 'input' || variable.class === 'output'
            ? 'public'
            : variable.class === 'inOut'
              ? 'inOut'
              : variable.class === 'local' && variable.access === 'public'
                ? 'public'
                : 'hidden'
        members.push({ name: variable.name, kind })
      }
      current = own.interface?.extends
      continue
    }

    const block = libraries
      .flatMap((library) => library.pous)
      .find((pou) => pou.type === 'function-block' && pou.name.toUpperCase() === wanted)
    if (block) {
      found = true
      for (const variable of block.variables) {
        const kind: FbInitMember['kind'] =
          variable.class === 'input' || variable.class === 'output'
            ? 'public'
            : variable.class === 'inOut'
              ? 'inOut'
              : 'hidden'
        members.push({ name: variable.name, kind })
      }
    }
    break
  }

  return found ? members : null
}

/**
 * Every problem with `text` as the initial value of an instance of `typeName`.
 * `where` opens each message (`variable "Main.t" is an instance of TON`).
 */
export function checkFbInitList(
  where: string,
  typeName: string,
  text: string,
  members: FbInitMember[] | null,
): string[] {
  const parsed = parseFbInitList(text)
  if ('error' in parsed) {
    return [
      `${where}, so its initial value must be a parenthesized list naming its inputs, outputs or ` +
        `public variables, like (PT := T#5s) (IEC 61131-3 6.6.3.3); "${text}" is not: ${parsed.error}. ` +
        `If ${typeName} is a structure or an enumeration, declare the variable "user-data-type" instead.`,
    ]
  }
  if (members === null) {
    return [
      `${where}, but no function block ${typeName} is declared in the project or an installed library, ` +
        `so its initial value cannot be checked.`,
    ]
  }

  const problems: string[] = []
  const named = new Set<string>()
  const publicNames = members.filter((member) => member.kind === 'public').map((member) => member.name)
  for (const element of parsed.elements) {
    const key = element.name.toUpperCase()
    if (named.has(key)) {
      problems.push(`${where}: its initial value names "${element.name}" twice.`)
      continue
    }
    named.add(key)

    const member = members.find((entry) => entry.name.toUpperCase() === key)
    if (member?.kind === 'public') continue
    const why =
      member?.kind === 'inOut'
        ? `is a VAR_IN_OUT of ${typeName}, which refers to a variable outside the block and takes no initial value`
        : member?.kind === 'hidden'
          ? `is an internal variable of ${typeName}; only its inputs, outputs and PUBLIC variables can be initialised`
          : `is not a variable of ${typeName}`
    problems.push(
      `${where}: "${element.name}" in its initial value ${why}. ` +
        `It can name: ${publicNames.length > 0 ? publicNames.join(', ') : '(nothing)'}.`,
    )
  }
  return problems
}
