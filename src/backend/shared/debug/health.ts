/**
 * Fault and retention health a board reports in its status (FC 0x46), put into
 * words once for every surface: the CLI, the editor's console and tooltips.
 */
import { z } from 'zod'

import type { RetainHealth, RuntimeFault } from './types'

/** Runtime v4's `fault` in `/api/status` (plc_fault_json). */
export const RuntimeV4FaultSchema = z.object({
  code: z.number(),
  kind: z.string(),
  task: z.number().optional(),
  taskName: z.string().optional(),
  safeMode: z.boolean(),
  count: z.number(),
  detail: z.number(),
})

/** The v4 fault as the shared RuntimeFault: task -1 / an empty name mean none. */
export function faultFromRuntimeV4(raw: unknown): RuntimeFault | undefined {
  const parsed = RuntimeV4FaultSchema.safeParse(raw)
  if (!parsed.success || parsed.data.code === 0) return undefined
  const f = parsed.data
  return {
    code: f.code,
    kind: f.kind,
    ...(f.task !== undefined && f.task >= 0 ? { task: f.task } : {}),
    ...(f.taskName ? { taskName: f.taskName } : {}),
    safeMode: f.safeMode,
    count: f.count,
    detail: f.detail,
  }
}

export interface FaultSummary {
  kind: string
  code: number
  task?: number
  taskName?: string
  safeMode: boolean
  count: number
  detail: number
  text: string
}

export interface RetainSummary {
  kind: string
  bytes: number
  text: string
}

/** Why a runtime error ended a task (`task-ended` detail: strucpp IecFault, Runtime v4's signals, the catch-all). */
const TASK_ENDED_REASONS: Readonly<Record<number, string>> = {
  0: 'a NULL reference was used',
  1: 'an array index out of range',
  2: 'a bad located address',
  3: 'a memory access fault',
  4: 'an arithmetic fault',
  254: 'a runtime error',
}

/**
 * A fault as the status reports it, with one line for a person. The kinds and
 * their consequences are runtime v4's (docs/ARCHITECTURE.md, Watchdog System),
 * the same on a board.
 */
export function describeFault(fault: RuntimeFault, names: readonly string[]): FaultSummary {
  const taskName = fault.taskName || (fault.task !== undefined ? names[fault.task] : undefined)
  const task = taskName ?? (fault.task !== undefined ? `#${fault.task}` : '')
  const more = fault.count > 1 ? ` (${fault.count} faults since start)` : ''
  const safe = fault.safeMode ? ' Safe mode: no program runs; start the PLC to restart it normally.' : ''
  let text: string
  switch (fault.kind) {
    case 'task-stuck':
      text = `task ${task} stuck in one scan for 10 periods (${fault.detail} ms): PLC stopped, ERROR`
      break
    case 'task-stuck-running':
      text = `task ${task} stuck in one scan (${fault.detail} ms); set not to stop the PLC, so the PLC and the other tasks keep running`
      break
    case 'first-scan-stuck':
      text = `task ${task}: first scan still running after ${fault.detail} ms: PLC stopped, ERROR`
      break
    case 'dispatcher-stalled':
      text = `the dispatcher stalled (no frame for ${fault.detail} ms): restarted in safe mode`
      break
    case 'stop-timeout':
      text = `task ${task} did not finish its scan on the stop (${fault.detail} ms): restarted in safe mode`
      break
    case 'task-ended':
      text = `task ${task} ended by ${TASK_ENDED_REASONS[fault.detail] ?? 'a runtime error'}; the other tasks keep running`
      break
    case 'watchdog-exit':
      text = 'the runtime ended in a watchdog exit: restarted in safe mode'
      break
    case 'task-create':
      text = `task ${task} could not be created (not enough memory)`
      break
    case 'service-create':
      text = 'a service task (debugger, Modbus, protocols) could not be created (not enough memory)'
      break
    case 'dispatcher-create':
      text = 'the dispatcher task could not be created (not enough memory)'
      break
    case 'scheduler':
      text = 'the RTOS scheduler did not start (not enough memory)'
      break
    case 'setup':
      text = 'an RTOS lock could not be created (not enough memory)'
      break
    default:
      text = `fault ${fault.kind}`
  }
  return {
    kind: fault.kind,
    code: fault.code,
    ...(fault.task !== undefined ? { task: fault.task } : {}),
    ...(taskName !== undefined ? { taskName } : {}),
    safeMode: fault.safeMode,
    count: fault.count,
    detail: fault.detail,
    text: text + more + safe,
  }
}

/** Retention health with one line for a person. */
export function describeRetain(retain: RetainHealth): RetainSummary {
  const texts: Record<string, string> = {
    none: 'nothing retained',
    ok: `kept (${retain.bytes} bytes)`,
    pending: `not saved yet (${retain.bytes} bytes)`,
    'no-store': 'NOT KEPT: this board stores nothing (Persistent Storage off, or no store)',
    'too-large': `NOT KEPT: the retained values need ${retain.bytes} bytes, more than the store takes`,
    'io-error': 'NOT KEPT: the store failed to save them',
  }
  return { kind: retain.kind, bytes: retain.bytes, text: texts[retain.kind] ?? `unknown (${retain.kind})` }
}
