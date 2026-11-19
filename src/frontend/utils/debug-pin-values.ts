/**
 * Where a block pin's live value is kept, and how a value is written on a diagram.
 *
 * Shared by the block's own pin values, the element attached to a pin and the ladder's power flow, so a
 * pin is read under one name everywhere.
 */

import { DEBUG_STRING_CAP } from './variable-sizes'

type PinBlock = {
  variant?: { name: string; type: string }
  variable?: { name?: string }
  numericId?: string
}

/**
 * The name to read a pin's value under (hand it to the composite-key resolver), or undefined when the PLC
 * keeps no value for it:
 *  - a function block keeps every pin in its instance: `motor.Start`, `motor.Running`;
 *  - a function keeps its outputs in the compiler's temporaries, `_TMP_<NAME><id>_<pin>`, and no inputs.
 */
export function blockPinVariableName(block: PinBlock, pin: string, side: 'input' | 'output'): string | undefined {
  const type = block.variant?.type
  if (type === 'function-block') {
    const instance = block.variable?.name
    return instance ? `${instance}.${pin}` : undefined
  }
  // A method box's outputs are not the instance's: like a function's, each is the call's temporary.
  if ((type === 'function' || type === 'method') && side === 'output' && block.numericId && block.variant) {
    return `_TMP_${block.variant.name.toUpperCase()}${block.numericId}_${pin.toUpperCase()}`
  }
  return undefined
}

/** A polled BOOL's state: the poller reports 1 / 0 or TRUE / FALSE. */
export function isTrueValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  return value === '1' || value.toUpperCase() === 'TRUE'
}

const REAL_TYPES = new Set(['REAL', 'LREAL'])

/** Characters of a STRING / WSTRING a diagram or the watch shows before it is cut short: the debug window. */
export const SHOWN_TEXT_CHARS = DEBUG_STRING_CAP

/** UTF-8 bytes of one code point. */
const utf8Bytes = (codePoint: number): number =>
  codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4

/** Length of `text` in the runtime's units: UTF-8 bytes for a STRING, UTF-16 code units for a WSTRING. */
export function textUnits(text: string, wide: boolean): number {
  if (wide) return text.length
  let bytes = 0
  for (const ch of text) bytes += utf8Bytes(ch.codePointAt(0) ?? 0)
  return bytes
}

/** The longest start of `text` within `units` runtime units, as the 126-unit window holds it. */
export function textHead(text: string, wide: boolean, units: number): string {
  if (wide) return text.slice(0, units)
  let bytes = 0
  let end = 0
  for (const ch of text) {
    bytes += utf8Bytes(ch.codePointAt(0) ?? 0)
    if (bytes > units) break
    end += ch.length
  }
  return text.slice(0, end)
}

/**
 * A polled STRING / WSTRING value (`"…"`) longer than {@link SHOWN_TEXT_CHARS} runtime units: its text,
 * the start that is shown, and its length. `runtimeLength` is the length the runtime reported (FC 0x4F),
 * in its units; without it the length is counted from the text.
 */
export function longDebugText(
  value: string,
  type: string | undefined,
  runtimeLength?: number,
): { text: string; head: string; total: number } | null {
  if (!type || !/^W?STRING\b/i.test(type.trim())) return null
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return null
  const wide = /^WSTRING/i.test(type.trim())
  const text = value.slice(1, -1)
  const total = runtimeLength ?? textUnits(text, wide)
  return total > SHOWN_TEXT_CHARS ? { text, head: textHead(text, wide, SHOWN_TEXT_CHARS), total } : null
}

/**
 * A value as a diagram shows it: a REAL / LREAL rounded to `decimals` places (trailing zeros kept, so a
 * changing value does not jump in width); a string longer than {@link SHOWN_TEXT_CHARS} cut short with
 * an ellipsis; anything else as polled.
 */
export function formatDebugValue(value: string, type: string | undefined, decimals: number): string {
  const long = longDebugText(value, type)
  if (long) return `"${long.head}…"`
  if (!type || !REAL_TYPES.has(type.toUpperCase())) return value
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(decimals) : value
}

/** A variable named like a password, key, token or secret (`NETCFG.wifiPassword`, `wifi.PASSWORD`, `apiKey`). */
const SECRET_NAME = /(pass(word|wd)?|pwd|secret|token|api_?key|private_?key)$/i

/**
 * Whether a STRING value should be hidden: its variable, the last member of the key, is named like a secret.
 * The PLC still sends the value; the diagram does not show it.
 */
export function isSecretValue(compositeKey: string, type: string | undefined): boolean {
  if (!type || !/^W?STRING/i.test(type)) return false
  const member = compositeKey.split(/[.:]/).pop() ?? ''
  return SECRET_NAME.test(member.replace(/\[.*\]$/, ''))
}

export const HIDDEN_VALUE = '••••'
