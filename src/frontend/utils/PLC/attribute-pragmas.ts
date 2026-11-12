/**
 * CODESYS attribute pragmas, `{attribute 'name'}` and
 * `{attribute 'name' := 'value'}` (IEC 61131-3 6.2 leaves pragmas to the
 * implementer). STruC++ reads the same two forms; neither part may hold a `'`.
 */
import type { VariableAttribute } from '../../../middleware/shared/ports/types'

/** One pragma; group 1 the name, group 2 the value when there is one. */
export const ATTRIBUTE_PRAGMA = /\{\s*attribute\s+'([^']*)'(?:\s*:=\s*'([^']*)')?\s*\}/gi

/** The pragma as written into ST. */
export const renderAttributePragma = (attribute: VariableAttribute): string =>
  attribute.value !== undefined
    ? `{attribute '${attribute.name}' := '${attribute.value}'}`
    : `{attribute '${attribute.name}'}`

/** Every pragma in `text`, in order, spelled as written. */
export const parseAttributePragmas = (text: string): VariableAttribute[] =>
  Array.from(text.matchAll(new RegExp(ATTRIBUTE_PRAGMA.source, 'gi')), (match) => ({
    name: match[1],
    ...(match[2] !== undefined ? { value: match[2] } : {}),
  }))

/** Why an attribute cannot be written as a pragma, or undefined when it can. */
export const attributeProblem = (attribute: VariableAttribute): string | undefined => {
  if (!/^[A-Za-z_][\w.]*$/.test(attribute.name)) return `attribute name "${attribute.name}" is not a plain name`
  if (attribute.value !== undefined && /['}\r\n]/.test(attribute.value))
    return `attribute "${attribute.name}" has a value with a quote, a brace or a line break`
  return undefined
}

/** Same pragmas in the same order: names ignore case, values do not. */
export const sameAttributes = (a: readonly VariableAttribute[], b: readonly VariableAttribute[]): boolean =>
  a.length === b.length &&
  a.every(
    (attribute, index) =>
      attribute.name.toLowerCase() === b[index].name.toLowerCase() && attribute.value === b[index].value,
  )
