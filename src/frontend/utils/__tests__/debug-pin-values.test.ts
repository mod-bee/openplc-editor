import { blockPinVariableName, formatDebugValue, isSecretValue, isTrueValue } from '../debug-pin-values'

describe('blockPinVariableName', () => {
  const fb = { variant: { name: 'UT_MOTOR', type: 'function-block' }, variable: { name: 'motor' } }
  const fn = { variant: { name: 'add', type: 'function' }, numericId: '7' }

  it("reads a function block's pins, both sides, in its instance", () => {
    expect(blockPinVariableName(fb, 'Start', 'input')).toBe('motor.Start')
    expect(blockPinVariableName(fb, 'Running', 'output')).toBe('motor.Running')
  })

  it("reads a function's outputs from its temporary, and keeps no inputs", () => {
    expect(blockPinVariableName(fn, 'out', 'output')).toBe('_TMP_ADD7_OUT')
    expect(blockPinVariableName(fn, 'IN1', 'input')).toBeUndefined()
  })
})

describe('formatDebugValue', () => {
  it('rounds a REAL to the decimals asked, keeping trailing zeros; leaves the rest as polled', () => {
    expect(formatDebugValue('0.0323504', 'REAL', 3)).toBe('0.032')
    expect(formatDebugValue('42.5', 'LREAL', 2)).toBe('42.50')
    expect(formatDebugValue('53', 'INT', 3)).toBe('53')
    expect(formatDebugValue('NaN', 'REAL', 3)).toBe('NaN')
  })
})

describe('isSecretValue', () => {
  it('hides a STRING named like a password, key or secret, whatever the case', () => {
    expect(isSecretValue('Config0:NETCFG.wifiPassword', 'STRING(64)')).toBe(true)
    expect(isSecretValue('COMMS_REMOTE:wifi.PASSWORD', 'STRING')).toBe(true)
    expect(isSecretValue('Main:apiKey', 'STRING')).toBe(true)
    expect(isSecretValue('Config0:NETCFG.wifiSsid', 'STRING(32)')).toBe(false)
    // Only a STRING: a number named like one is a count, not a secret.
    expect(isSecretValue('Main:passCount', 'INT')).toBe(false)
  })
})

describe('isTrueValue', () => {
  it('reads both ways the poller writes a BOOL', () => {
    expect([isTrueValue('1'), isTrueValue('TRUE'), isTrueValue('0'), isTrueValue(undefined)]).toEqual([
      true,
      true,
      false,
      undefined,
    ])
  })
})
