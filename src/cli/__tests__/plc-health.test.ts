/**
 * What `debug status` says about a board's health: ERROR as its own state (never
 * "stopped"), a stalled task by name (IEC 61131-3 6.8.2: a missed deadline is
 * an error), and whether retained values are kept.
 */
import type { DebugStatusResult, DeviceDebugChannel } from '../../backend/shared/debug/types'
import { PlcRuntimeState } from '../../backend/shared/simulator/types'
import { channelPlcControl, describeFault, describeRetain, plcStateOf } from '../session/session-core'

function board(status: DebugStatusResult) {
  const channel = { getStatus: () => Promise.resolve(status) } as unknown as DeviceDebugChannel
  return { channel }
}

describe('PLC state', () => {
  it('ERROR is reported as error, not stopped', async () => {
    const b = board({ success: true, running: false, plcState: PlcRuntimeState.ERROR })
    expect(await channelPlcControl(b.channel).state()).toBe('error')
  })

  it('maps every wire state, and an unknown byte to unknown', () => {
    expect(plcStateOf(PlcRuntimeState.RUNNING, true)).toBe('running')
    expect(plcStateOf(PlcRuntimeState.STOPPED, false)).toBe('stopped')
    expect(plcStateOf(PlcRuntimeState.ERROR, false)).toBe('error')
    expect(plcStateOf(9, false)).toBe('unknown')
    expect(plcStateOf(undefined, true)).toBe('running')
    expect(plcStateOf(undefined, undefined)).toBe('unknown')
  })
})

describe('faults (runtime v4 kinds, the same on a board)', () => {
  it("a stuck task is named from the project's tasks; the PLC was stopped", async () => {
    const b = board({
      success: true,
      running: false,
      plcState: PlcRuntimeState.ERROR,
      fault: { code: 0x10, kind: 'task-stuck', task: 1, safeMode: false, count: 1, detail: 1234 },
    })
    const report = await channelPlcControl(b.channel, ['MAIN', 'NET']).report!()
    expect(report.state).toBe('error')
    expect(report.fault).toMatchObject({ kind: 'task-stuck', task: 1, taskName: 'NET', safeMode: false, detail: 1234 })
    expect(report.fault?.text).toBe('task NET stuck in one scan for 10 periods (1234 ms): PLC stopped, ERROR')
  })

  it('a task ended by a runtime error says why, and that the others keep running', () => {
    const fault = describeFault({ code: 0x14, kind: 'task-ended', task: 0, safeMode: false, count: 3, detail: 1 }, [
      'MAIN',
    ])
    expect(fault.text).toBe(
      'task MAIN ended by an array index out of range; the other tasks keep running (3 faults since start)',
    )
  })

  it('a safe-mode restart says so and how to leave it', () => {
    const fault = describeFault({ code: 0x11, kind: 'dispatcher-stalled', safeMode: true, count: 1, detail: 1500 }, [])
    expect(fault.text).toBe(
      'the dispatcher stalled (no frame for 1500 ms): restarted in safe mode Safe mode: no program runs; start the PLC to restart it normally.',
    )
  })

  it('no fault reports none', async () => {
    const b = board({
      success: true,
      running: true,
      plcState: PlcRuntimeState.RUNNING,
      fault: { code: 0, kind: 'none', safeMode: false, count: 0, detail: 0 },
    })
    const report = await channelPlcControl(b.channel, ['MAIN']).report!()
    expect(report.fault).toBeUndefined()
  })

  it('ERROR says what could not be created', () => {
    expect(
      describeFault({ code: 2, kind: 'task-create', task: 2, safeMode: false, count: 1, detail: 0 }, []).text,
    ).toBe('task #2 could not be created (not enough memory)')
    expect(
      describeFault({ code: 0x13, kind: 'stop-timeout', task: 0, safeMode: true, count: 1, detail: 3100 }, ['MAIN'])
        .text,
    ).toMatch(/^task MAIN did not finish its scan on the stop \(3100 ms\): restarted in safe mode/)
  })
})

describe('retain', () => {
  it('says plainly when retained values are not kept', () => {
    expect(describeRetain({ code: 1, kind: 'ok', bytes: 21756 }).text).toBe('kept (21756 bytes)')
    expect(describeRetain({ code: 3, kind: 'too-large', bytes: 70000 }).text).toMatch(/^NOT KEPT: .*70000 bytes/)
    expect(describeRetain({ code: 4, kind: 'io-error', bytes: 100 }).text).toMatch(/^NOT KEPT: the store failed/)
    expect(describeRetain({ code: 2, kind: 'no-store', bytes: 100 }).text).toMatch(/^NOT KEPT: this board stores/)
    expect(describeRetain({ code: 0, kind: 'none', bytes: 0 }).text).toBe('nothing retained')
  })
})

describe('describeFault — a stuck task kept running', () => {
  it('says the PLC and the other tasks keep running', () => {
    const fault = describeFault(
      { code: 0x16, kind: 'task-stuck-running', task: 1, safeMode: false, count: 1, detail: 3200 },
      ['LOGIC', 'COMMS'],
    )
    expect(fault.text).toMatch(/COMMS stuck in one scan \(3200 ms\).*keep running/)
  })
})
