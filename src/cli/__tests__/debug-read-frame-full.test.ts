/**
 * `debug read` answers every name asked for when the values do not all fit one
 * reply frame.
 *
 * A bare-metal board (Node UIO, serial) answers FC 0x44 in a 272-byte frame: 11
 * header bytes, 259 for values, and a STRING takes 127 whatever its declared
 * length, so two strings fill it. The firmware then answers with the values
 * that fit and `lastIndex` = the last position included. A session that took
 * the next batch instead of asking again from there dropped the rest of each
 * batch without an error: 40 names gave 14 values.
 *
 * The channel below answers as `debugGetTraceList` in
 * resources/sources/Baremetal/modbus_debug.cpp does (checked against the real
 * handler on the host by the board's debug-list harness).
 */
import type { DebugTransportResult } from '../../backend/shared/debug/types'
import type { DebugVariableIndex, ResolvedVariable } from '../debug/variables'
import type { PlcControl } from '../session/session-core'
import { SessionCore } from '../session/session-core'

/** Wire size of each type on FC 0x44 (STRING: length byte + 126-character window). */
const WIRE: Record<string, number> = { STRING: 127, UINT: 2, USINT: 1, REAL: 4, BOOL: 1, TIME: 8, DINT: 4 }

/** The FD settings read: struct members of every kind, then a struct-array element's BOOL/TIME members. */
const TYPES = [
  'UINT',
  'USINT',
  'REAL',
  'BOOL',
  'STRING',
  'STRING',
  'DINT',
  'STRING',
  'TIME',
  'UINT',
  'STRING',
  'STRING',
  'BOOL',
  'STRING',
  'REAL',
  'STRING',
  'USINT',
  'STRING',
  'DINT',
  'STRING',
  'STRING',
  'UINT',
  'STRING',
  'TIME',
  'STRING',
  'BOOL',
  'STRING',
  'STRING',
  'DINT',
  'STRING',
  'BOOL',
  'TIME',
  'BOOL',
  'TIME',
  'BOOL',
  'TIME',
  'BOOL',
  'TIME',
  'BOOL',
  'TIME',
]

const variables: ResolvedVariable[] = TYPES.map((type, i) => ({
  name: `settings.v${i}`,
  index: i,
  arr: 0,
  elem: i,
  type,
  size: WIRE[type],
  ...(type === 'STRING' ? { cap: [64, 32, 8][i % 3] } : {}),
}))

/** Value i of the program: distinct per variable, so a shifted decode shows. */
function valueOf(i: number): string | number | boolean {
  switch (TYPES[i]) {
    case 'STRING':
      return `text ${i}`
    case 'BOOL':
      return i % 2 === 0
    case 'REAL':
      return i + 0.5
    case 'TIME':
      return i
    default:
      return 100 + i
  }
}

function encode(i: number): Uint8Array {
  const out = new Uint8Array(WIRE[TYPES[i]])
  const dv = new DataView(out.buffer)
  const value = valueOf(i)
  switch (TYPES[i]) {
    case 'STRING': {
      const text = value as string
      out[0] = text.length
      for (let c = 0; c < text.length; c++) out[1 + c] = text.charCodeAt(c)
      break
    }
    case 'BOOL':
      out[0] = value ? 1 : 0
      break
    case 'REAL':
      dv.setFloat32(0, value as number, true)
      break
    case 'TIME':
      dv.setBigInt64(0, BigInt(value as number) * 1_000_000n, true)
      break
    case 'DINT':
      dv.setInt32(0, value as number, true)
      break
    case 'UINT':
      dv.setUint16(0, value as number, true)
      break
    default:
      out[0] = value as number
  }
  return out
}

/**
 * FC 0x44 as the bare-metal firmware answers it: at most `maxNames` per request
 * (20 on serial), values in request order while they fit `frame - 2` (CRC) after
 * the 11-byte header, `lastIndex` = the last position included (0 when none).
 */
function bareMetalGetList(frame: number, maxNames = 20) {
  const requests: number[][] = []
  const getVariablesList = (indexes: number[]): Promise<DebugTransportResult> => {
    requests.push(indexes)
    if (indexes.length > maxNames) return Promise.resolve({ success: false, error: 'ERROR_OUT_OF_MEMORY' })
    const capacity = frame - 2
    let used = 11
    let lastIndex = 0
    const parts: Uint8Array[] = []
    for (let position = 0; position < indexes.length; position++) {
      const bytes = encode(indexes[position])
      if (used + bytes.length > capacity) break
      parts.push(bytes)
      used += bytes.length
      lastIndex = position
    }
    const data = new Uint8Array(used - 11)
    let at = 0
    for (const part of parts) {
      data.set(part, at)
      at += part.length
    }
    return Promise.resolve({ success: true, tick: 1, lastIndex, data })
  }
  return { requests, getVariablesList }
}

const index: DebugVariableIndex = {
  md5: 'abc',
  warnings: [],
  all: variables,
  byName: new Map(variables.map((variable) => [variable.name.toUpperCase(), variable])),
  byIndex: new Map(variables.map((variable) => [variable.index, variable])),
}

const plc: PlcControl = {
  start: () => Promise.resolve({ success: true }),
  stop: () => Promise.resolve({ success: true }),
  coldRestart: () => Promise.resolve({ success: true }),
  state: () => Promise.resolve('running' as const),
}

function core(target: ReturnType<typeof bareMetalGetList>) {
  const channel = {
    connect: () => Promise.resolve(),
    disconnect: () => undefined,
    getVariablesList: target.getVariablesList,
    setVariable: () => Promise.resolve({ success: true }),
    getMd5Hash: () => Promise.resolve({ success: true, md5: 'abc', targetEndian: 'le' as const }),
    getVersion: () => Promise.resolve({ success: true, version: '4.2.8' }),
  }
  return new SessionCore({
    sessionId: 't',
    projectPath: '/tmp/p',
    target: 'ModBee Node UIO',
    transport: 'rtu',
    descriptor: '/dev/null',
    channel,
    index,
    plc,
    programMd5: 'abc',
    endian: 'le',
    batchSize: 19,
  })
}

describe('debug read when the values outrun the reply frame', () => {
  it('answers all 40 names, in order, with their own values (272-byte frame)', async () => {
    const target = bareMetalGetList(272)
    const names = variables.map((variable) => variable.name)
    const reply = await core(target).handle({ id: 1, kind: 'read', names })

    expect(reply.ok).toBe(true)
    const values = (reply as { data: { values: Array<{ name: string; value: unknown }> } }).data.values
    expect(values.map((value) => value.name)).toEqual(names)
    values.forEach((value, i) => {
      if (TYPES[i] !== 'TIME') expect(value.value).toEqual(valueOf(i))
    })
    // Each request starts where the previous reply stopped.
    const asked = target.requests.flat()
    expect(new Set(asked).size).toBe(40)
    expect(target.requests.length).toBeGreaterThan(3)
    expect(target.requests.every((request) => request.length <= 19)).toBe(true)
  })

  it('fails the read, naming the variable, when one value can never fit', async () => {
    // 128-byte frame (small AVR): 115 bytes for values, a STRING is 127.
    const target = bareMetalGetList(128)
    const reply = await core(target).handle({ id: 1, kind: 'read', names: ['settings.v0', 'settings.v4'] })

    expect(reply.ok).toBe(false)
    expect(JSON.stringify(reply)).toContain('settings.v4')
    expect(target.requests).toEqual([[0, 4], [4]])
  })
})
