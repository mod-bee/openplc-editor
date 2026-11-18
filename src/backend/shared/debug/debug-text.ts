/**
 * Whole STRING / WSTRING values over FC 0x4F DEBUG_GET_TEXT, read in chunks the
 * target sizes to its frame. A target without the code (runtime v4 before it,
 * bare-metal firmware before {@link DEBUG_TEXT_MIN_FIRMWARE}) is detected once per
 * debug channel; the caller then keeps the 126-unit window of FC 0x43/0x44.
 */
import { isVersionAtLeast } from '../../../frontend/utils/semver'
import type { DebugTextChunkRequest, DebugTextChunkResult, DebugTextResult, DebugVersionResult } from './types'

/** First bare-metal firmware (FC 0x47 version) that answers FC 0x4F. */
export const DEBUG_TEXT_MIN_FIRMWARE = '4.2.8'

/** Wait for the first FC 0x4F on a target with no version read (runtime v4); an older one answers ERROR_PROCESSING or nothing. */
export const DEBUG_TEXT_PROBE_TIMEOUT_MS = 1500

/** Times a read starts again because the value's length changed under it. */
const READ_ATTEMPTS = 3

/** Largest `max` a request can carry; the target clamps it to its frame. */
const MAX_UNITS = 0xffff

export function firmwareSupportsDebugText(version: string): boolean {
  return isVersionAtLeast(version, DEBUG_TEXT_MIN_FIRMWARE)
}

/** Code units on the wire as text: STRING bytes as UTF-8 (as FC 0x44 is read), WSTRING little-endian units. */
export function decodeTextUnits(data: Uint8Array, wide: boolean): string {
  if (!wide) return new TextDecoder('utf-8').decode(data)
  let text = ''
  for (let i = 0; i + 1 < data.length; i += 2) text += String.fromCharCode(data[i] | (data[i + 1] << 8))
  return text
}

/**
 * Read one whole value through `fetch(offset, max)`, one FC 0x4F request each.
 * When `len` or `cap` changes between chunks the read starts again, so the text
 * never joins two values of different length.
 */
export async function readDebugText(
  fetch: (offset: number, max: number) => Promise<DebugTextChunkResult>,
  wide: boolean,
): Promise<DebugTextResult> {
  const width = wide ? 2 : 1
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    const first = await fetch(0, MAX_UNITS)
    if (!first.success) return { success: false, error: first.error }
    const { cap, len } = first.chunk
    const bytes = new Uint8Array(len * width)
    let got = 0
    let last = first.chunk
    let settled = true
    for (;;) {
      if (last.offset !== got) return { success: false, error: 'The target answered a different part of the value' }
      const count = Math.min(last.count, len - got)
      if (last.data.length < count * width) return { success: false, error: 'Incomplete text data' }
      bytes.set(last.data.subarray(0, count * width), got * width)
      got += count
      if (got >= len) break
      if (count === 0) return { success: false, error: 'The target sent no part of the value' }
      const next = await fetch(got, len - got)
      if (!next.success) return { success: false, error: next.error }
      if (next.chunk.len !== len || next.chunk.cap !== cap) {
        settled = false
        break
      }
      last = next.chunk
    }
    if (settled) {
      return { success: true, text: decodeTextUnits(bytes, wide), len, cap, forced: last.forced, tick: last.tick }
    }
  }
  return { success: false, error: 'The value kept changing length while it was read' }
}

/** What {@link readDebugTextFromChannel} needs of a debug channel. */
export interface DebugTextChannel {
  getTextChunk?(request: DebugTextChunkRequest): Promise<DebugTextChunkResult>
  getVersion?(): Promise<DebugVersionResult>
}

const UNSUPPORTED_ERROR = 'The target does not support reading long strings (FC 0x4F)'
const UNSUPPORTED: DebugTextResult = { success: false, error: UNSUPPORTED_ERROR, unsupported: true }

/** Per channel, so per debug session: whether the target answers FC 0x4F, once known. */
const supportByChannel = new WeakMap<DebugTextChannel, boolean>()

/**
 * Read a whole STRING / WSTRING value at `index` (packed DebugAddr), or report
 * `unsupported` so the caller keeps the 126-unit window. Bare-metal decides by
 * firmware version; a channel without a version read (runtime v4) by whether the
 * first request, with a short wait, is answered.
 */
export async function readDebugTextFromChannel(
  channel: DebugTextChannel,
  index: number,
  wide: boolean,
): Promise<DebugTextResult> {
  const getTextChunk = channel.getTextChunk?.bind(channel)
  if (!getTextChunk) return UNSUPPORTED

  let known = supportByChannel.get(channel)
  if (known === undefined && channel.getVersion) {
    const version = await channel.getVersion()
    if (!version.success || version.version === undefined) {
      return { success: false, error: version.error ?? 'The firmware version could not be read' }
    }
    known = firmwareSupportsDebugText(version.version)
    supportByChannel.set(channel, known)
  }
  if (known === false) return UNSUPPORTED

  let probing = known === undefined
  const result = await readDebugText(async (offset, max) => {
    const chunk = await getTextChunk({
      index,
      offset,
      max,
      wide,
      ...(probing ? { timeoutMs: DEBUG_TEXT_PROBE_TIMEOUT_MS } : {}),
    })
    if (probing) {
      // Any reply in the 0x4F format proves the code; silence or an exception disproves it.
      const answered = chunk.success || chunk.status !== undefined
      supportByChannel.set(channel, answered)
      probing = false
      if (!answered) return { success: false, error: UNSUPPORTED_ERROR, unsupported: true }
    }
    return chunk
  }, wide)
  if (!result.success && supportByChannel.get(channel) === false) return UNSUPPORTED
  return result
}
