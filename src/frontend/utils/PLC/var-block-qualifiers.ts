import type { PLCVariable } from '../../../middleware/shared/ports/types'

/**
 * What IEC 61131-3 puts on a VAR block's header rather than on a declaration:
 * the retention / constant qualifier (6.5.6) and, on a function block's `VAR`,
 * the access specifier (6.6.5.3) — so two variables differing in either cannot
 * share a block. One key and one header writer for every place that groups
 * variables into blocks, so they cannot drift.
 */

/** Plain first, then the qualified ones: stable output whatever the input order. */
export const ORDERED_FLAGS: ReadonlyArray<PLCVariable['flag']> = [undefined, 'constant', 'retain', 'non-retain']
export const ORDERED_ACCESS: ReadonlyArray<PLCVariable['access']> = [undefined, 'public', 'protected', 'private']

/** The block a variable belongs in, keyed by class × flag × access. */
export const varBlockKey = (
  variable: Pick<PLCVariable, 'class' | 'flag' | 'access'>,
  fallbackClass = 'global',
): string =>
  `${(variable.class ?? fallbackClass).toLowerCase()}\u0000${variable.flag ?? ''}\u0000${variable.access ?? ''}`

/** ` RETAIN`, ` CONSTANT PROTECTED`, … — the header's text after the block keyword. */
export const varBlockQualifier = (flag: PLCVariable['flag'], access: PLCVariable['access']): string => {
  const flagText =
    flag === 'constant' ? ' CONSTANT' : flag === 'retain' ? ' RETAIN' : flag === 'non-retain' ? ' NON_RETAIN' : ''
  const accessText = access === undefined ? '' : ` ${access.toUpperCase()}`
  return `${flagText}${accessText}`
}

/** ` R_EDGE` / ` F_EDGE` after a BOOL input's type (6.6.3.2 item 13); empty otherwise. */
export const edgeQualifier = (edge: PLCVariable['edge']): string =>
  edge === 'rising' ? ' R_EDGE' : edge === 'falling' ? ' F_EDGE' : ''
