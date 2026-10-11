import type { TranspileVariable } from '../types'

/**
 * What IEC 61131-3 puts on a VAR block's header rather than on a declaration —
 * the qualifier (CONSTANT / RETAIN / NON_RETAIN, 6.5.6) and a function block
 * `VAR` section's access specifier (PUBLIC / PROTECTED / PRIVATE, 6.6.5.3) — so
 * variables differing in either are emitted in separate blocks.
 */
export function varBlockQualifier(flag: TranspileVariable['flag'], access: TranspileVariable['access']): string {
  const flagText =
    flag === 'constant' ? ' CONSTANT' : flag === 'retain' ? ' RETAIN' : flag === 'non-retain' ? ' NON_RETAIN' : ''
  return access === undefined ? flagText : `${flagText} ${access.toUpperCase()}`
}

/** The bucketing key for a variable's block: keyword × flag × access. */
export function varBlockBucketKey(keyword: string, variable: TranspileVariable): string {
  return `${keyword}\u0000${variable.flag ?? ''}\u0000${variable.access ?? ''}`
}

/** ` R_EDGE` / ` F_EDGE` after a BOOL input's type (6.6.3.2 item 13); empty otherwise. */
export function edgeSuffix(variable: TranspileVariable): string {
  return variable.edge === 'rising' ? ' R_EDGE' : variable.edge === 'falling' ? ' F_EDGE' : ''
}
