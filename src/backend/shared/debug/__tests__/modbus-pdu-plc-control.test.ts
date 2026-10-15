/**
 * Run/stop wire-protocol codec tests (FC 0x4b command, FC 0x46 read).
 *
 * These bytes are the contract between the editor and the baremetal runtime's
 * `plcSetState()` / `debugGetStatus()` handlers in modbus_debug.cpp, so the
 * layouts are asserted
 * byte-for-byte rather than round-tripped through the builder.
 */

import { buildPlcSetStateRequest, parseGetStatusResponse, parsePlcSetStateResponse } from '../modbus-pdu'
import { ModbusDebugResponse, ModbusFunctionCode, PlcRuntimeState, PlcSwitchPosition } from '../../simulator/types'

describe('run/stop command builder (FC 0x4b)', () => {
  it('builds RUN as [FC][0x01]', () => {
    expect(Array.from(buildPlcSetStateRequest(PlcRuntimeState.RUNNING))).toEqual([0x4b, 0x01])
  })

  it('builds STOP as [FC][0x00]', () => {
    expect(Array.from(buildPlcSetStateRequest(PlcRuntimeState.STOPPED))).toEqual([0x4b, 0x00])
  })

  it('claims 0x4b, clear of every other debug function code', () => {
    expect(ModbusFunctionCode.PLC_SET_STATE).toBe(0x4b)
    const others = Object.values(ModbusFunctionCode).filter(
      (value): value is number => typeof value === 'number' && value !== ModbusFunctionCode.PLC_SET_STATE,
    )
    expect(others).not.toContain(ModbusFunctionCode.PLC_SET_STATE)
  })

  it('claims 0x86 for REFUSED_BY_SWITCH, clear of every other status code', () => {
    expect(ModbusDebugResponse.REFUSED_BY_SWITCH).toBe(0x86)
    const others = Object.values(ModbusDebugResponse).filter(
      (value): value is number => typeof value === 'number' && value !== ModbusDebugResponse.REFUSED_BY_SWITCH,
    )
    expect(others).not.toContain(ModbusDebugResponse.REFUSED_BY_SWITCH)
  })
})

describe('parsePlcSetStateResponse', () => {
  const frame = (status: number, state: number, position: number) =>
    new Uint8Array([ModbusFunctionCode.PLC_SET_STATE, status, state, position])

  it('parses a running device with the switch in RUN', () => {
    const result = parsePlcSetStateResponse(
      frame(ModbusDebugResponse.SUCCESS, PlcRuntimeState.RUNNING, PlcSwitchPosition.RUN),
    )
    expect(result).toEqual({
      success: true,
      state: PlcRuntimeState.RUNNING,
      switchPosition: PlcSwitchPosition.RUN,
    })
  })

  it('parses a stopped device with the switch in STOP', () => {
    const result = parsePlcSetStateResponse(
      frame(ModbusDebugResponse.SUCCESS, PlcRuntimeState.STOPPED, PlcSwitchPosition.STOP),
    )
    expect(result.success).toBe(true)
    expect(result.state).toBe(PlcRuntimeState.STOPPED)
    expect(result.switchPosition).toBe(PlcSwitchPosition.STOP)
    expect(result.refusedBySwitch).toBeUndefined()
  })

  it('flags a RUN refused by the hardware switch', () => {
    const result = parsePlcSetStateResponse(
      frame(ModbusDebugResponse.REFUSED_BY_SWITCH, PlcRuntimeState.STOPPED, PlcSwitchPosition.STOP),
    )
    // Not a success, and specifically identified so the editor shows the
    // "flip the switch to RUN" warning rather than a generic failure.
    expect(result.success).toBe(false)
    expect(result.refusedBySwitch).toBe(true)
    expect(result.state).toBe(PlcRuntimeState.STOPPED)
    expect(result.switchPosition).toBe(PlcSwitchPosition.STOP)
  })

  it('reports ERROR state', () => {
    const result = parsePlcSetStateResponse(
      frame(ModbusDebugResponse.SUCCESS, PlcRuntimeState.ERROR, PlcSwitchPosition.RUN),
    )
    expect(result.state).toBe(PlcRuntimeState.ERROR)
  })

  it('describes any other failure status rather than failing silently', () => {
    // Neither SUCCESS nor REFUSED_BY_SWITCH — e.g. the runtime ran out of memory
    // servicing the request. Without the error text the editor would report
    // "Failed to start PLC: Unknown error" and give the user nothing to act on.
    const result = parsePlcSetStateResponse(
      frame(ModbusDebugResponse.ERROR_OUT_OF_MEMORY, PlcRuntimeState.STOPPED, PlcSwitchPosition.RUN),
    )
    expect(result.success).toBe(false)
    expect(result.refusedBySwitch).toBeUndefined()
    expect(result.unsupported).toBeUndefined()
    expect(result.error).toBeTruthy()
  })

  it('detects old firmware via the Modbus exception form', () => {
    // A runtime built before the state machine answers (FC | 0x80). The editor turns this
    // into "rebuild and upload", never an error, so field devices don't look
    // broken after an editor upgrade.
    const result = parsePlcSetStateResponse(new Uint8Array([0x4b + 0x80, 0x01]))
    expect(result.unsupported).toBe(true)
    expect(result.success).toBe(false)
  })

  it('rejects a mismatched function code', () => {
    const result = parsePlcSetStateResponse(new Uint8Array([0x44, 0x7e, 0x01, 0x01]))
    expect(result.success).toBe(false)
    expect(result.unsupported).toBeUndefined()
    expect(result.error).toMatch(/mismatch/i)
  })

  it('rejects a truncated response', () => {
    expect(parsePlcSetStateResponse(new Uint8Array([])).success).toBe(false)
    expect(parsePlcSetStateResponse(new Uint8Array([0x4b, 0x7e])).success).toBe(false)
  })
})

describe('status read carries run/stop state (FC 0x46)', () => {
  /** [FC][status][running][tick:u32][uptime:u32][switch] */
  const statusFrame = (running: number, sw?: number) => {
    const bytes = [ModbusFunctionCode.DEBUG_GET_STATUS, ModbusDebugResponse.SUCCESS, running, 0, 0, 0, 7, 0, 0, 0, 9]
    if (sw !== undefined) bytes.push(sw)
    return new Uint8Array(bytes)
  }

  it('reports RUNNING plus the switch position', () => {
    const r = parseGetStatusResponse(statusFrame(PlcRuntimeState.RUNNING, PlcSwitchPosition.RUN))
    expect(r.success).toBe(true)
    expect(r.running).toBe(true)
    expect(r.plcState).toBe(PlcRuntimeState.RUNNING)
    expect(r.switchPosition).toBe(PlcSwitchPosition.RUN)
    expect(r.tick).toBe(7)
    expect(r.uptimeMs).toBe(9)
  })

  it('reports STOPPED with the switch in STOP', () => {
    const r = parseGetStatusResponse(statusFrame(PlcRuntimeState.STOPPED, PlcSwitchPosition.STOP))
    expect(r.running).toBe(false)
    expect(r.plcState).toBe(PlcRuntimeState.STOPPED)
    expect(r.switchPosition).toBe(PlcSwitchPosition.STOP)
  })

  it('reads ERROR as not running (it is its own state, never "running")', () => {
    const r = parseGetStatusResponse(statusFrame(PlcRuntimeState.ERROR, PlcSwitchPosition.RUN))
    expect(r.running).toBe(false)
    expect(r.plcState).toBe(PlcRuntimeState.ERROR)
  })

  it('reads the appended fault and retain fields', () => {
    const base = Array.from(statusFrame(PlcRuntimeState.RUNNING, PlcSwitchPosition.RUN))
    // fault: task-stuck, task 1, not safe mode, 2 faults, 1234 ms; retain: ok, 21756 bytes
    const frame = new Uint8Array([...base, 0x10, 1, 0, 2, 0, 0, 0x04, 0xd2, 1, 0, 0, 0x54, 0xfc])
    const r = parseGetStatusResponse(frame)
    expect(r.fault).toEqual({ code: 0x10, kind: 'task-stuck', task: 1, safeMode: false, count: 2, detail: 1234 })
    expect(r.retain).toEqual({ code: 1, kind: 'ok', bytes: 21756 })
  })

  it('reads the PLC data block appended by firmware built with one', () => {
    const base = Array.from(statusFrame(PlcRuntimeState.RUNNING, PlcSwitchPosition.RUN))
    const health = [0, 0xff, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0x54, 0xfc]
    // plc data: external RAM, 171,000 bytes
    const r = parseGetStatusResponse(new Uint8Array([...base, ...health, 2, 0, 0x02, 0x9b, 0xf8]))
    expect(r.plcData).toEqual({ code: 2, kind: 'external', bytes: 171000 })
    // Every other firmware stops at the retain field: the data is static.
    expect(parseGetStatusResponse(new Uint8Array([...base, ...health])).plcData).toBeUndefined()
  })

  it('a fault naming no task (0xff) and no fault at all', () => {
    const base = Array.from(statusFrame(PlcRuntimeState.ERROR, PlcSwitchPosition.RUN))
    const setup = parseGetStatusResponse(new Uint8Array([...base, 0x01, 0xff, 1, 1, 0, 0, 0, 0]))
    expect(setup.fault).toEqual({ code: 1, kind: 'setup', safeMode: true, count: 1, detail: 0 })
    expect(setup.retain).toBeUndefined()
    const none = parseGetStatusResponse(new Uint8Array([...base, 0, 0xff, 0, 0, 0, 0, 0, 0, 3, 0, 1, 0, 0]))
    expect(none.fault?.kind).toBe('none')
    expect(none.retain).toEqual({ code: 3, kind: 'too-large', bytes: 65536 })
  })

  it('omits switchPosition on firmware that predates the state machine', () => {
    // 11-byte frame: the field simply is not there, which callers read as
    // "no switch gating" rather than a guessed RUN.
    const r = parseGetStatusResponse(statusFrame(1))
    expect(r.success).toBe(true)
    expect(r.switchPosition).toBeUndefined()
  })
})
