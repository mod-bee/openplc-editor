/**
 * `debug read` returns a STRING longer than the 126-character watch window in
 * full, through FC 0x4F, and keeps the window on a target without it (E7).
 */
import { TextDecoder as NodeTextDecoder } from 'node:util'

if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = NodeTextDecoder as unknown as typeof TextDecoder
}

import { parseGetTextResponse } from '../../backend/shared/debug/modbus-pdu'
import type { DebugTextChunkRequest } from '../../backend/shared/debug/types'
import { buildLeafInfoMap, type DebugMap } from '../../frontend/utils/debug-parser'
import type { DebugVariableIndex, ResolvedVariable } from '../debug/variables'
import type { PlcControl } from '../session/session-core'
import { SessionCore } from '../session/session-core'

const VALUE = 'L'.repeat(200) + 'M'.repeat(100)

/** The 127-byte FC 0x44 window of VALUE: its first 126 characters. */
function windowBytes(): Uint8Array {
  const buf = new Uint8Array(127)
  buf[0] = 126
  for (let i = 0; i < 126; i++) buf[1 + i] = VALUE.charCodeAt(i)
  return buf
}

/** An FC 0x4F reply for VALUE, at most 250 characters a chunk. */
function textReply(request: DebugTextChunkRequest): Uint8Array {
  const units = Array.from(VALUE.slice(request.offset, request.offset + Math.min(request.max, 250)), (c) =>
    c.charCodeAt(0),
  )
  const out = new Uint8Array(16 + units.length)
  const dv = new DataView(out.buffer)
  out[0] = 0x4f
  out[1] = 0x7e
  dv.setUint16(4, 320)
  dv.setUint16(6, VALUE.length)
  dv.setUint16(8, request.offset)
  dv.setUint16(10, units.length)
  out.set(units, 16)
  return out
}

const variable: ResolvedVariable = { name: 'main:line', index: 0, arr: 0, elem: 0, type: 'STRING', size: 127, cap: 320 }

const index: DebugVariableIndex = {
  md5: 'abc',
  warnings: [],
  all: [variable],
  byName: new Map([['MAIN:LINE', variable]]),
  byIndex: new Map([[0, variable]]),
}

const plc: PlcControl = {
  start: () => Promise.resolve({ success: true }),
  stop: () => Promise.resolve({ success: true }),
  coldRestart: () => Promise.resolve({ success: true }),
  state: () => Promise.resolve('running' as const),
}

function core(withText: boolean) {
  const channel = {
    connect: () => Promise.resolve(),
    disconnect: () => undefined,
    getVariablesList: () => Promise.resolve({ success: true, tick: 1, lastIndex: 0, data: windowBytes() }),
    setVariable: () => Promise.resolve({ success: true }),
    getMd5Hash: () => Promise.resolve({ success: true, md5: 'abc', targetEndian: 'le' as const }),
    getVersion: () => Promise.resolve({ success: true, version: withText ? '4.2.8' : '4.2.7' }),
    getTextChunk: (request: DebugTextChunkRequest) => Promise.resolve(parseGetTextResponse(textReply(request))),
  }
  return new SessionCore({
    sessionId: 't',
    projectPath: '/tmp/p',
    target: 'Board',
    transport: 'rtu',
    descriptor: '/dev/null',
    channel,
    index,
    plc,
    programMd5: 'abc',
    endian: 'le',
    batchSize: 8,
  })
}

describe('debug read of a long STRING', () => {
  it('returns the whole value', async () => {
    const reply = await core(true).handle({ id: 1, kind: 'read', names: ['main:line'] })
    expect(reply).toMatchObject({ ok: true, data: { kind: 'read', values: [{ name: 'main:line', value: VALUE }] } })
  })

  it('keeps the 126-character window on firmware without FC 0x4F', async () => {
    const reply = await core(false).handle({ id: 1, kind: 'read', names: ['main:line'] })
    expect(reply).toMatchObject({ ok: true, data: { values: [{ value: VALUE.slice(0, 126) }] } })
  })

  it('takes the declared length from the debug map (interface 3)', () => {
    const map: DebugMap = {
      version: 2,
      md5: 'abc',
      typeTags: {},
      arrays: [{ index: 0, count: 1 }],
      leaves: [{ arrayIdx: 0, elemIdx: 0, path: 'MAIN.LINE', type: 'STRING', size: 127, cap: 320 }],
    }
    expect(buildLeafInfoMap(map).get('MAIN.LINE')?.cap).toBe(320)
  })
})
