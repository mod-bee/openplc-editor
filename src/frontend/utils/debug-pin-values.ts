/**
 * Where a block pin's live value is kept, and how a value is written on a diagram.
 *
 * Shared by the block's own pin values, the element attached to a pin and the ladder's power flow, so a
 * pin is read under one name everywhere.
 */

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
  if (type === 'function' && side === 'output' && block.numericId && block.variant) {
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

/**
 * A value as a diagram shows it: a REAL / LREAL rounded to `decimals` places (trailing zeros kept, so a
 * changing value does not jump in width); anything else as polled.
 */
export function formatDebugValue(value: string, type: string | undefined, decimals: number): string {
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

