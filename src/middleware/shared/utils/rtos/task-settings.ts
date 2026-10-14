import type { RtosBackend, RtosTargetProfile, TaskThreadsProfile } from './types'

/**
 * The per-task "Stop PLC if stuck" and "Stack" settings.
 *
 * A task stuck in one scan (still running after 10 of its periods, or a first
 * scan past 10 s) stops the PLC, as it always has. With "Stop PLC if stuck" set
 * to No, the runtime still detects it and reports it (the status, the task
 * statistics, the overruns), but the PLC and the other tasks keep running: for a
 * communications task whose block can wait seconds on a network connect.
 *
 * "Stack" sizes the task's thread, in bytes; Default is the target's own size.
 *
 * Both reach the compiler as an IEC 61131-3 §6.2 pragma after the task's
 * parameter list, with the Core setting: `TASK COMMS(...) {CORE := 0,
 * STOP_ON_STUCK := FALSE, STACK := 16384};`. A task on the defaults is written
 * exactly as before. Both runtimes use the default for what they cannot give.
 */

/**
 * The stack range for a task on an RTOS backend (plc_rtos.h's
 * OPENPLC_RTOS_TASK_STACK_MIN/MAX are the firmware's own bounds, 2048..65536).
 * An ESP32 task runs Arduino and IDF calls that need more than 2 KB.
 */
export function taskThreadsForRtos(backend: RtosBackend): TaskThreadsProfile {
  return backend === 'freertos-esp32' ? { stackMin: 4096, stackMax: 65536 } : { stackMin: 2048, stackMax: 65536 }
}

export interface TaskSettingsTarget {
  /** Present on a firmware board with an RTOS backend. */
  rtos?: RtosTargetProfile
  /** `TargetCapabilities.taskThreads`. */
  taskThreads?: TaskThreadsProfile
}

/**
 * Whether the settings apply on this target now, and the stack range: undefined
 * where every task stops the PLC when stuck and has the default stack (the
 * single loop: a firmware board with RTOS mode off, or a target with no task
 * threads).
 */
export function taskThreadsFor(target: TaskSettingsTarget, rtosEnabled: boolean): TaskThreadsProfile | undefined {
  if (target.rtos && !rtosEnabled) return undefined
  return target.taskThreads
}

export interface TaskWithSettings {
  name: string
  stopOnStuck?: boolean
  stack?: number
}

const hasSettings = (task: TaskWithSettings): boolean => task.stopOnStuck === false || task.stack !== undefined

const settingsText = (task: TaskWithSettings): string =>
  [
    ...(task.stopOnStuck === false ? ['Stop PLC if stuck: No'] : []),
    ...(task.stack !== undefined ? [`Stack: ${task.stack} bytes`] : []),
  ].join(', ')

/** Why the build refuses these task settings on this target, or undefined when it can give them. */
export function taskSettingsProblem(
  tasks: readonly TaskWithSettings[],
  target: TaskSettingsTarget,
  rtosEnabled: boolean,
): string | undefined {
  const set = tasks.filter(hasSettings)
  if (set.length === 0) return undefined
  const named = set.map((task) => `${task.name} (${settingsText(task)})`).join('; ')
  if (target.rtos && !rtosEnabled) {
    return (
      `"Stop PLC if stuck" and "Stack" need RTOS mode, which is off for this board: ${named}. ` +
      `Set them back to Yes and Default, or switch RTOS mode on in Board Settings.`
    )
  }
  const threads = target.taskThreads
  if (!threads) {
    return `This target runs every task in one loop, so "Stop PLC if stuck" stays Yes and "Stack" Default: ${named}.`
  }
  const outside = set.filter(
    (task) => task.stack !== undefined && (task.stack < threads.stackMin || task.stack > threads.stackMax),
  )
  if (outside.length === 0) return undefined
  const list = outside.map((task) => `${task.name} is set to a ${task.stack} byte stack`).join('; ')
  return `${list}, and this board takes ${threads.stackMin} to ${threads.stackMax} bytes. Choose one of those, or Default.`
}

/**
 * The task's settings as the IEC §6.2 pragma after its parameter list, in a
 * fixed order (CORE, STOP_ON_STUCK, STACK). Empty for a task on the defaults,
 * so its TASK line is the one it always was.
 */
export function taskPragmaEntries(task: {
  core?: number
  stopOnStuck?: boolean
  stack?: number
}): Array<{ key: 'core' | 'stopOnStuck' | 'stack'; label: string; value: string }> {
  return [
    ...(task.core !== undefined ? [{ key: 'core' as const, label: 'CORE := ', value: `${task.core}` }] : []),
    ...(task.stopOnStuck === false
      ? [{ key: 'stopOnStuck' as const, label: 'STOP_ON_STUCK := ', value: 'FALSE' }]
      : []),
    ...(task.stack !== undefined ? [{ key: 'stack' as const, label: 'STACK := ', value: `${task.stack}` }] : []),
  ]
}

/** `taskPragmaEntries` as text: '' or ` {CORE := 0, STOP_ON_STUCK := FALSE, STACK := 16384}`. */
export function taskPragmaText(task: { core?: number; stopOnStuck?: boolean; stack?: number }): string {
  const entries = taskPragmaEntries(task)
  return entries.length === 0 ? '' : ` {${entries.map((entry) => `${entry.label}${entry.value}`).join(', ')}}`
}

/** The stack sizes the task table offers, within the target's range. */
const STACK_CHOICES = [
  2048, 4096, 6144, 8192, 12288, 16384, 24576, 32768, 49152, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304,
  8388608, 16777216, 33554432, 67108864,
]

/** The task table's stack choices for this range, with a size set elsewhere (the CLI) kept as it is. */
export function taskStackChoices(threads: TaskThreadsProfile | undefined, current: number | undefined): number[] {
  const choices = threads ? STACK_CHOICES.filter((n) => n >= threads.stackMin && n <= threads.stackMax) : []
  if (current !== undefined && !choices.includes(current)) choices.push(current)
  return choices.sort((a, b) => a - b)
}

/** A stack size in plain words: "Default", "8 KB", "1 MB", or bytes when it is not whole. */
export function taskStackLabel(bytes: number | undefined): string {
  if (bytes === undefined) return 'Default'
  if (bytes % 1048576 === 0) return `${bytes / 1048576} MB`
  if (bytes % 1024 === 0) return `${bytes / 1024} KB`
  return `${bytes} bytes`
}
