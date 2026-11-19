/**
 * Walking a `getVariablesList` reply — the one implementation.
 *
 * The runtime answers a batched read with raw type-sized values packed in
 * REQUEST order and nothing else: no indexes, no lengths, no delimiters. The
 * association between bytes and variables is therefore purely positional, and
 * three details decide whether you read the right value or a plausible wrong
 * one:
 *
 *   - `lastIndex` is how far the runtime actually got. Positions past it were
 *     never read, and decoding them from whatever bytes follow yields numbers
 *     that look fine.
 *   - a position whose type is unknown to the caller still CONSUMED a slot at
 *     the runtime (it does not know our index→type map), so it must be counted
 *     as processed even though its bytes are forfeit.
 *   - running out of buffer mid-position must stop WITHOUT counting that
 *     position, so a round-robin caller retries the same slot next cycle rather
 *     than stranding the tail of its active set.
 *
 * Every one of those is a silent-corruption bug rather than an error, which is
 * why the walk lives here instead of being restated per caller. `useDebugPolling`
 * drives it for the GUI watch panel; the headless CLI's debug session drives it
 * for `read`/`watch`. They cannot disagree about what a reply means.
 */

import type { TargetEndian } from './endian'
import { applySwapToVariableBytes } from './endian'
import { getTypeSizeByName, parseValueByTypeName } from './variable-sizes'

/**
 * What the caller resolved for one index: the IEC type, plus whatever the caller
 * needed to look up in order to know it.
 *
 * `meta` is the caller's own — the GUI carries the leaves sharing that address,
 * the CLI carries its resolved variable — and the walker only ferries it from
 * `typeOf` to `emit`/`onError`. It exists because `typeOf` used to return the
 * type NAME alone: the caller resolved the metadata, threw it away, and looked
 * the same index up again in `emit`, and again in `onError`. Three map lookups
 * per decoded position where one will do — and worse, the second and third
 * lookups could not fail, so both callers guarded them with `if (!meta) return`
 * branches marked `istanbul ignore if`, four dead branches in total whose only
 * purpose was to satisfy the type checker about something the walk had already
 * proved.
 */
export interface ResolvedDebugType<TMeta> {
  /** Canonical IEC type name, as the compiler emitted it. */
  type: string
  meta: TMeta
}

export interface DebugResponseWalkOptions<TMeta> {
  /** Requested indexes, in the exact order the request packed them. */
  requested: readonly number[]
  /** The value bytes from `parseGetListResponse`. Mutated in place when the target is BE. */
  payload: Uint8Array
  /** Last position the runtime processed; `undefined` means "assume all of them". */
  lastIndex: number | undefined
  endian: TargetEndian
  /**
   * The type and metadata for a requested index, or undefined when the caller
   * has none for it. Undefined consumes the position without decoding.
   */
  typeOf: (index: number, position: number) => ResolvedDebugType<TMeta> | undefined
  /** Called once per successfully decoded position. */
  emit: (decoded: {
    index: number
    position: number
    type: string
    value: string
    meta: TMeta
    /** A STRING / WSTRING that filled the 126-unit window: the value may be longer. */
    windowFull?: true
  }) => void
  /**
   * Called when the codec throws for a position. The walk still advances by the
   * type's size and counts the position consumed: the runtime wrote those bytes
   * whether or not we could read them, so skipping the advance would misalign
   * every position after it.
   */
  onError?: (failed: { index: number; position: number; type: string; meta: TMeta }) => void
}

export interface DebugResponseWalkResult {
  /**
   * How many positions the runtime is known to have processed. A round-robin
   * caller advances its offset by THIS, not by `lastIndex + 1`.
   */
  positionsConsumed: number
  /** False when the walk stopped early (short buffer, or a truncated reply). */
  reachedEnd: boolean
}

export function walkDebugResponse<TMeta>(options: DebugResponseWalkOptions<TMeta>): DebugResponseWalkResult {
  const { requested, payload, lastIndex, endian, typeOf, emit, onError } = options
  let offset = 0
  let positionsConsumed = 0
  let reachedEnd = true

  for (let position = 0; position < requested.length; position += 1) {
    if (lastIndex !== undefined && position > lastIndex) {
      // The runtime processed fewer positions than we asked for; the rest are
      // valid slots it simply never read.
      reachedEnd = false
      break
    }

    const index = requested[position]
    const resolved = typeOf(index, position)
    if (resolved === undefined) {
      // No metadata, but the runtime still consumed the slot.
      positionsConsumed = position + 1
      continue
    }

    const { type, meta } = resolved
    const size = getTypeSizeByName(type)
    if (offset + size > payload.length) {
      // Do NOT count this position: the caller must retry it.
      reachedEnd = false
      break
    }

    // Wire bytes arrive in the target's native order; the codec is LE-only.
    // A no-op on the common LE target.
    applySwapToVariableBytes(payload, offset, size, type, endian)

    try {
      const { value, bytesRead, windowFull } = parseValueByTypeName(payload, offset, type)
      emit({ index, position, type, value, meta, ...(windowFull ? { windowFull } : {}) })
      offset += bytesRead
    } catch {
      onError?.({ index, position, type, meta })
      offset += size
    }
    positionsConsumed = position + 1
  }

  return { positionsConsumed, reachedEnd }
}

/** How far one reply moves a round-robin poll through its batch. */
export interface DebugPollProgress {
  /** Positions of the batch the reply settled; the next poll starts after them. */
  consumed: number
  /**
   * A position whose value can never be read: the reply had no room for it in an
   * otherwise empty frame (a STRING is 127 bytes; a small AVR's frame holds 115).
   * It is passed over, so the poll reaches the variables after it.
   */
  unreadable?: number
}

/** What the watch shows for a value that can never be read. */
export const DEBUG_VALUE_TOO_LARGE = 'ERR: too large for the debug reply'

/**
 * The positions one reply settled, from its walk.
 *
 * When the walk covered the whole batch, the runtime's `lastIndex + 1` counts:
 * positions the runtime skipped (size 0) still advance the poll. Otherwise only
 * what the walk consumed does, so positions the reply had no room for are asked
 * for again next time. A reply that settled nothing had no room for the first
 * position even in an empty frame, so asking again can never succeed: it is
 * passed over as `unreadable`.
 */
export function debugPollProgress(
  walk: DebugResponseWalkResult,
  lastIndex: number | undefined,
  batchLength: number,
): DebugPollProgress {
  const consumed = walk.reachedEnd
    ? lastIndex !== undefined
      ? Math.min(lastIndex + 1, batchLength)
      : batchLength
    : walk.positionsConsumed
  if (consumed === 0 && batchLength > 0) return { consumed: 1, unreadable: 0 }
  return { consumed }
}
