/**
 * The Go to highlight: the element a search hit or a cross reference went to, and the block pin it is on,
 * marked until the next click in the diagram. It pulses for its first moments so the eye finds it.
 */
import { useCallback, useEffect, useState } from 'react'

import { useOpenPLCStore } from '../store'

/** Amber, unlike the selection's blue and every debug colour. */
export const REVEAL_HIGHLIGHT = 'rounded-sm bg-amber-300/70 ring-2 ring-amber-500 dark:bg-amber-500/40'

const PULSE_MS = 2400

/** Whether this element is where the last Go to went, and whether it is still pulsing. */
export function useRevealHighlight(nodeId: string | undefined): { revealed: boolean; pulsing: boolean } {
  const seq = useOpenPLCStore(
    useCallback(
      (s) => (nodeId && s.revealTarget?.kind === 'pou' && s.revealTarget.nodeId === nodeId ? s.revealTarget.seq : 0),
      [nodeId],
    ),
  )
  return { revealed: seq > 0, pulsing: usePulse(seq) }
}

/** The pin (upper case) of this block that the last Go to went to, if any. */
export function useRevealedPin(blockId: string | undefined): { pin: string | undefined; pulsing: boolean } {
  const target = useOpenPLCStore(
    useCallback(
      (s) =>
        blockId && s.revealTarget?.kind === 'pou' && s.revealTarget.blockId === blockId && s.revealTarget.pin
          ? `${s.revealTarget.seq}:${s.revealTarget.pin.toUpperCase()}`
          : '',
      [blockId],
    ),
  )
  const [seq, pin] = target ? [Number(target.slice(0, target.indexOf(':'))), target.slice(target.indexOf(':') + 1)] : [0, undefined]
  return { pin, pulsing: usePulse(seq) }
}

function usePulse(seq: number): boolean {
  const [pulsing, setPulsing] = useState(false)
  useEffect(() => {
    if (!seq) {
      setPulsing(false)
      return
    }
    setPulsing(true)
    const timer = window.setTimeout(() => setPulsing(false), PULSE_MS)
    return () => window.clearTimeout(timer)
  }, [seq])
  return pulsing
}
