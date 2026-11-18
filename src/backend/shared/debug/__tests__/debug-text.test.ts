// FC 0x4F DEBUG_GET_TEXT: the PDU, chunk reassembly and the fallback to the
// 126-character window on a target that predates it (E4).
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util'

if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as { TextEncoder: typeof TextEncoder }).TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = NodeTextDecoder as unknown as typeof TextDecoder
}

import {
  DEBUG_TEXT_PROBE_TIMEOUT_MS,
  type DebugTextChannel,
  firmwareSupportsDebugText,
  readDebugText,
  readDebugTextFromChannel,
} from '../debug-text'
import { buildGetTextRequest, getTextPduLength, parseGetTextResponse } from '../modbus-pdu'
import type { DebugTextChunkRequest, DebugTextChunkResult } from '../types'

/** A 0x4F reply PDU, as interface 2 lays it out. */
function reply(f: {
  status?: number
  tag?: number
  forced?: boolean
  cap: number
  len: number
  offset: number
  units: number[]
  wide?: boolean
  tick?: number
}): Uint8Array {
  const width = f.wide ? 2 : 1
  const out = new Uint8Array(16 + f.units.length * width)
  const dv = new DataView(out.buffer)
  out[0] = 0x4f
  out[1] = f.status ?? 0x7e
  out[2] = f.tag ?? 17
  out[3] = f.forced ? 1 : 0
  dv.setUint16(4, f.cap)
  dv.setUint16(6, f.len)
  dv.setUint16(8, f.offset)
  dv.setUint16(10, f.units.length)
  dv.setUint32(12, f.tick ?? 7)
  f.units.forEach((u, i) => {
    if (f.wide) dv.setUint16(16 + i * 2, u, true)
    else out[16 + i] = u
  })
  return out
}

const codes = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))

/** A target holding `value`, answering at most `frame` units per chunk. */
function target(value: () => string, cap: number, frame: number, wide = false) {
  const requests: Array<{ offset: number; max: number }> = []
  const fetch = (offset: number, max: number): Promise<DebugTextChunkResult> => {
    requests.push({ offset, max })
    const text = value()
    const units = codes(text).slice(offset, offset + Math.min(max, frame))
    return Promise.resolve(parseGetTextResponse(reply({ cap, len: text.length, offset, units, wide })))
  }
  return { fetch, requests }
}

describe('FC 0x4F DEBUG_GET_TEXT', () => {
  describe('PDU', () => {
    it('builds [0x4F][arr][elem u16][offset u16][max u16], big-endian', () => {
      expect(Array.from(buildGetTextRequest((3 << 16) | 0x0102, 0x0304, 0x0506))).toEqual([0x4f, 3, 1, 2, 3, 4, 5, 6])
    })

    it('parses the header and the data', () => {
      const parsed = parseGetTextResponse(reply({ cap: 320, len: 300, offset: 0, units: [65, 66], forced: true }))
      expect(parsed).toEqual({
        success: true,
        chunk: {
          tag: 17,
          forced: true,
          cap: 320,
          len: 300,
          offset: 0,
          count: 2,
          tick: 7,
          data: new Uint8Array([65, 66]),
        },
      })
    })

    it('reports a status refusal with its status', () => {
      const parsed = parseGetTextResponse(new Uint8Array([0x4f, 0x81]))
      expect(parsed).toMatchObject({ success: false, status: 0x81 })
    })

    it('reads a Modbus exception as a target that does not know the code', () => {
      expect(parseGetTextResponse(new Uint8Array([0xcf, 0x01]))).toMatchObject({ success: false, unsupported: true })
    })

    it('tells the RTU framer the PDU length once the header is in', () => {
      const pdu = reply({ cap: 320, len: 300, offset: 0, units: [1, 2, 3], wide: true })
      expect(getTextPduLength(pdu.subarray(0, 10), true)).toBeNull()
      expect(getTextPduLength(pdu, true)).toBe(16 + 6)
      expect(getTextPduLength(new Uint8Array([0x4f, 0x83]), false)).toBe(2)
      expect(getTextPduLength(new Uint8Array([0xcf, 0x01]), false)).toBe(2)
    })
  })

  describe('chunk reassembly', () => {
    it('reads a 300-character STRING(320) in frame-sized chunks', async () => {
      const text = 'x'.repeat(250) + 'y'.repeat(50)
      const t = target(() => text, 320, 128)
      const result = await readDebugText(t.fetch, false)
      expect(result).toEqual({ success: true, text, len: 300, cap: 320, forced: false, tick: 7 })
      expect(t.requests.map((r) => r.offset)).toEqual([0, 128, 256])
    })

    it('reads a WSTRING in little-endian code units', async () => {
      const text = 'Ωλ'.repeat(100)
      const t = target(() => text, 300, 64, true)
      const result = await readDebugText(t.fetch, true)
      expect(result).toMatchObject({ success: true, text, len: 200 })
    })

    it('starts again when the length changes between chunks', async () => {
      let reads = 0
      const t = target(
        () => {
          reads += 1
          return reads === 2 ? 'b'.repeat(150) : 'a'.repeat(200)
        },
        320,
        128,
      )
      const result = await readDebugText(t.fetch, false)
      expect(result).toMatchObject({ success: true, text: 'a'.repeat(200) })
      expect(t.requests.map((r) => r.offset)).toEqual([0, 128, 0, 128])
    })

    it('gives up on a value whose length never settles', async () => {
      let n = 0
      const t = target(() => 'c'.repeat(200 + (n++ % 2)), 320, 128)
      expect(await readDebugText(t.fetch, false)).toMatchObject({ success: false })
    })
  })

  describe('session fallback', () => {
    const chunkFor =
      (text: string, frame = 4096) =>
      (request: DebugTextChunkRequest): Promise<DebugTextChunkResult> =>
        Promise.resolve(
          parseGetTextResponse(
            reply({
              cap: 1000,
              len: text.length,
              offset: request.offset,
              units: codes(text).slice(request.offset, request.offset + Math.min(request.max, frame)),
            }),
          ),
        )

    it('runtime v4: a silent first try is remembered, and nothing more is sent', async () => {
      const getTextChunk = jest.fn((request: DebugTextChunkRequest) => {
        expect(request.timeoutMs).toBe(DEBUG_TEXT_PROBE_TIMEOUT_MS)
        return Promise.resolve<DebugTextChunkResult>({ success: false, error: 'Request timeout' })
      })
      const channel: DebugTextChannel = { getTextChunk }
      expect(await readDebugTextFromChannel(channel, 1, false)).toMatchObject({ success: false, unsupported: true })
      expect(await readDebugTextFromChannel(channel, 2, false)).toMatchObject({ success: false, unsupported: true })
      expect(getTextChunk).toHaveBeenCalledTimes(1)
    })

    it('runtime v4: once it answers, later reads use the normal timeout', async () => {
      const seen: Array<number | undefined> = []
      const channel: DebugTextChannel = {
        getTextChunk: (request) => {
          seen.push(request.timeoutMs)
          return chunkFor('z'.repeat(400))(request)
        },
      }
      expect(await readDebugTextFromChannel(channel, 1, false)).toMatchObject({ success: true, len: 400 })
      expect(await readDebugTextFromChannel(channel, 1, false)).toMatchObject({ success: true })
      expect(seen).toEqual([DEBUG_TEXT_PROBE_TIMEOUT_MS, undefined])
    })

    it('bare-metal: an older firmware version is never sent 0x4F', async () => {
      const getTextChunk = jest.fn(chunkFor('q'))
      const getVersion = jest.fn(() => Promise.resolve({ success: true, version: '4.2.7' }))
      const channel: DebugTextChannel = { getTextChunk, getVersion }
      expect(await readDebugTextFromChannel(channel, 1, false)).toMatchObject({ success: false, unsupported: true })
      expect(await readDebugTextFromChannel(channel, 1, false)).toMatchObject({ success: false, unsupported: true })
      expect(getVersion).toHaveBeenCalledTimes(1)
      expect(getTextChunk).not.toHaveBeenCalled()
    })

    it('bare-metal: a newer firmware is read in chunks', async () => {
      const channel: DebugTextChannel = {
        getTextChunk: chunkFor('k'.repeat(300), 250),
        getVersion: () => Promise.resolve({ success: true, version: '4.2.8' }),
      }
      expect(await readDebugTextFromChannel(channel, 1, false)).toMatchObject({ success: true, len: 300 })
    })

    it('a channel without the code falls back at once', async () => {
      expect(await readDebugTextFromChannel({}, 1, false)).toMatchObject({ success: false, unsupported: true })
    })

    it.each([
      ['4.2.7', false],
      ['4.2.8', true],
      ['4.3.0', true],
      ['5.0.0', true],
      ['garbage', false],
    ])('firmware %s supports 0x4F: %s', (version, expected) => {
      expect(firmwareSupportsDebugText(version)).toBe(expected)
    })
  })
})
