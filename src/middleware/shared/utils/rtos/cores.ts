import type { RtosBackend, RtosTargetProfile } from './types'

/**
 * The per-task Core setting. A task with no core is on Auto: the runtime places
 * it (on firmware, the core setup() runs on, with the dispatcher; on a Linux
 * runtime, wherever the kernel puts it). A core pins the task's thread there.
 * The build carries it to the compiler as an IEC 61131-3 §6.2 pragma
 * (`TASK NET(...) {CORE := 0};`), and both runtimes place a core the target
 * lacks on Auto, so a check here is for the user, not for safety.
 */

/** ESP32 chips with a single core, as they appear in an FQBN's board id. */
const SINGLE_CORE_ESP32 = /esp32-?(s2|c2|c3|c5|c61|c6|h2)/i

/**
 * The cores an RTOS backend can pin a task to on this board (plc_os.cpp's
 * plc_os_core_count): both cores of a dual-core ESP32 (read from the chip in the
 * FQBN; a board id that names no chip is taken for a dual-core one, and the
 * firmware places a core it lacks on Auto), both of every RP2040 / RP2350, one
 * on every other backend.
 */
export function cpuCoresForRtos(backend: RtosBackend, fqbn: string | undefined): number {
  if (backend === 'freertos-rp2040') return 2
  if (backend !== 'freertos-esp32') return 1
  const board = fqbn?.split(':')[2] ?? ''
  return SINGLE_CORE_ESP32.test(board) ? 1 : 2
}

export interface TaskCoreTarget {
  /** Present on a firmware board with an RTOS backend. */
  rtos?: RtosTargetProfile
  /** The target's cores (`TargetCapabilities.cpuCores`). */
  cpuCores?: number
}

/**
 * How many cores a task can be put on: 1 means Auto only. A firmware board
 * places tasks only in RTOS mode (the single loop has no tasks of its own); a
 * Linux runtime threads its tasks always.
 */
export function taskCoreCount(target: TaskCoreTarget, rtosEnabled: boolean): number {
  if (target.rtos && !rtosEnabled) return 1
  return Math.max(1, target.cpuCores ?? 1)
}

export interface TaskWithCore {
  name: string
  core?: number
}

/** Why the build refuses these task cores on this target, or undefined when it can place them. */
export function taskCoreProblem(
  tasks: readonly TaskWithCore[],
  target: TaskCoreTarget,
  rtosEnabled: boolean,
): string | undefined {
  const pinned = tasks.filter((task) => task.core !== undefined)
  if (pinned.length === 0) return undefined
  if (target.rtos && !rtosEnabled) {
    const named = pinned.map((task) => `${task.name} (core ${task.core})`).join(', ')
    return (
      `A task core needs RTOS mode, which is off for this board: ${named}. ` +
      `Set the task to Auto, or switch RTOS mode on in Board Settings.`
    )
  }
  const cores = taskCoreCount(target, rtosEnabled)
  const outside = pinned.filter((task) => (task.core ?? 0) >= cores)
  if (outside.length === 0) return undefined
  const named = outside.map((task) => `${task.name} is set to core ${task.core}`).join('; ')
  const has = cores === 1 ? 'this board has one core (0)' : `this board has cores 0-${cores - 1}`
  return `${named}, and ${has}. Choose one of those, or Auto.`
}
