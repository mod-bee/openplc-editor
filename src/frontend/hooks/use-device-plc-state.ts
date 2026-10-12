/**
 * useDevicePlcState — mirrors a baremetal target's run/stop state into the store.
 *
 * There is no timer here. The main process already polls the held device link to
 * keep it honest, and that liveness read is the status frame (FC 0x46), which
 * carries the run/stop state and the mode-switch position. This hook only
 * subscribes to what that tick already pushes, so the Start/Stop button tracks
 * the device — including a switch flipped by hand at the panel — without any
 * extra traffic, a second timer, or a transient connection.
 *
 * Writes the SAME `runtimeConnection.plcStatus` the Runtime v4 poll writes, so
 * every consumer (the button icon, its tooltip, the debugger's "PLC is stopped"
 * prompt) works unchanged regardless of target type.
 *
 * Mount once at the workspace level, next to `useRuntimePolling`.
 */
import { useEffect } from 'react'

import { describeFault, describeRetain, type FaultSummary } from '../../backend/shared/debug/health'
import { PlcRuntimeState, PlcSwitchPosition } from '../../backend/shared/simulator/types'
import type { PlcStatus } from '../../middleware/shared/ports/types'
import { useDevice } from '../../middleware/shared/providers'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../store'

/** Map the wire value to the store's PlcStatus union. */
function toPlcStatus(state: number | undefined): PlcStatus | null {
  switch (state) {
    case PlcRuntimeState.RUNNING:
      return 'RUNNING'
    case PlcRuntimeState.STOPPED:
      return 'STOPPED'
    case PlcRuntimeState.ERROR:
      return 'ERROR'
    default:
      // Firmware predating the run/stop state machine omits the field. Leave the
      // status untouched rather than inventing one — the button then behaves as
      // it did before, and the Start path reports `unsupported` if used.
      return null
  }
}

export const useDevicePlcState = (): void => {
  const device = useDevice()
  const setPlcRuntimeStatus = useOpenPLCStore((state) => state.deviceActions.setPlcRuntimeStatus)
  const setPlcSwitchPosition = useOpenPLCStore((state) => state.deviceActions.setPlcSwitchPosition)
  const setPlcHealth = useOpenPLCStore((state) => state.deviceActions.setPlcHealth)
  const store = useOpenPLCStoreApi()

  useEffect(() => {
    // Optional on the port: the web platform has no held serial link.
    if (!device.onPlcState) return
    // What was last reported, so the console gets one line per change, not one per poll.
    let lastFault = ''
    let lastRetain = ''
    return device.onPlcState(({ plcState, switchPosition, fault, retain }) => {
      const status = toPlcStatus(plcState)
      if (status !== null) setPlcRuntimeStatus(status)

      // Absent on older firmware, which means "no switch gating" — null rather
      // than a guessed 'run', so the pre-check can tell "no switch" from
      // "switch says RUN".
      setPlcSwitchPosition(
        switchPosition === PlcSwitchPosition.STOP ? 'stop' : switchPosition === PlcSwitchPosition.RUN ? 'run' : null,
      )

      // A stall or the reason for ERROR, and whether retained values are kept.
      // Task names come from the project: the board numbers its tasks in the
      // configuration's order.
      const tasks = store.getState().project.data.configurations.resource.tasks
      const faultSummary: FaultSummary | null =
        fault && fault.code !== 0
          ? describeFault(
              fault,
              tasks.map((task) => task.name),
            )
          : null
      const retainSummary = retain ? describeRetain(retain) : null
      setPlcHealth(faultSummary, retainSummary)

      const { consoleActions } = store.getState()
      const faultLine = faultSummary ? `PLC fault: ${faultSummary.text}` : ''
      if (faultLine !== lastFault) {
        if (faultLine) consoleActions.addLog({ level: 'error', message: faultLine })
        lastFault = faultLine
      }
      const retainLine = retainSummary?.text.startsWith('NOT KEPT') ? `Retained values ${retainSummary.text}` : ''
      if (retainLine !== lastRetain) {
        if (retainLine) consoleActions.addLog({ level: 'error', message: retainLine })
        lastRetain = retainLine
      }
    })
  }, [device, setPlcRuntimeStatus, setPlcSwitchPosition, setPlcHealth, store])
}
