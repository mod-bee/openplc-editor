/**
 * The per-task Core setting: which cores a board offers a task, and when the
 * build refuses one.
 *
 * What these pin: a board offers the cores its RTOS backend can pin a task to
 * (ESP32 by chip, the Pico's both cores, every other backend one); RTOS mode off
 * on a firmware board means no task core at all; a Linux runtime offers the
 * cores its board declares; Auto (no core) is always fine.
 */

import { cpuCoresForRtos, taskCoreCount, taskCoreProblem } from '../cores'
import { resolveRtosProfile } from '../support'

const esp32 = resolveRtosProfile('esp32:esp32', undefined)!
const pico = resolveRtosProfile('rp2040:rp2040', undefined)!

describe('cpuCoresForRtos', () => {
  it('counts both cores of a dual-core ESP32, whoever made the board', () => {
    expect(cpuCoresForRtos('freertos-esp32', 'esp32:esp32:esp32s3:PSRAM=enabled')).toBe(2)
    expect(cpuCoresForRtos('freertos-esp32', 'esp32:esp32:esp32')).toBe(2)
    expect(cpuCoresForRtos('freertos-esp32', 'esp32:esp32:adafruit_feather_esp32s3')).toBe(2)
    expect(cpuCoresForRtos('freertos-esp32', undefined)).toBe(2)
  })

  it('counts one core on the single-core ESP32 chips', () => {
    for (const chip of ['esp32s2', 'esp32c2', 'esp32c3', 'esp32c5', 'esp32c6', 'esp32c61', 'esp32h2']) {
      expect(cpuCoresForRtos('freertos-esp32', `esp32:esp32:${chip}`)).toBe(1)
    }
    expect(cpuCoresForRtos('freertos-esp32', 'esp32:esp32:XIAO_ESP32C3')).toBe(1)
  })

  it('counts both cores of every RP2040 / RP2350, one on every other backend', () => {
    expect(cpuCoresForRtos('freertos-rp2040', 'rp2040:rp2040:rpipico')).toBe(2)
    for (const backend of ['freertos-stm32', 'freertos-renesas', 'freertos-samd', 'mbed-rtx', 'zephyr'] as const) {
      expect(cpuCoresForRtos(backend, undefined)).toBe(1)
    }
  })
})

describe('taskCoreCount', () => {
  it('is the board cores in RTOS mode, one with it off', () => {
    expect(taskCoreCount({ rtos: esp32, cpuCores: 2 }, true)).toBe(2)
    expect(taskCoreCount({ rtos: esp32, cpuCores: 2 }, false)).toBe(1)
  })

  it('is what a Linux runtime declares, which threads its tasks always', () => {
    expect(taskCoreCount({ cpuCores: 4 }, false)).toBe(4)
  })

  it('is one where nothing is declared', () => {
    expect(taskCoreCount({}, true)).toBe(1)
  })
})

describe('taskCoreProblem', () => {
  const tasks = [
    { name: 'MAIN' },
    { name: 'NET', core: 0 },
  ]

  it('accepts Auto everywhere', () => {
    const auto = [{ name: 'MAIN' }]
    expect(taskCoreProblem(auto, {}, false)).toBeUndefined()
    expect(taskCoreProblem(auto, { rtos: esp32, cpuCores: 2 }, false)).toBeUndefined()
  })

  it('accepts a core the board has', () => {
    expect(taskCoreProblem(tasks, { rtos: esp32, cpuCores: 2 }, true)).toBeUndefined()
    expect(taskCoreProblem([{ name: 'NET', core: 1 }], { rtos: pico, cpuCores: 2 }, true)).toBeUndefined()
    expect(taskCoreProblem([{ name: 'NET', core: 3 }], { cpuCores: 4 }, false)).toBeUndefined()
  })

  it('refuses a core the board lacks, naming the task and the cores there are', () => {
    const problem = taskCoreProblem([{ name: 'NET', core: 2 }], { rtos: esp32, cpuCores: 2 }, true)
    expect(problem).toMatch(/NET/)
    expect(problem).toMatch(/core 2/)
    expect(problem).toMatch(/0-1/)
  })

  it('refuses any core on a firmware board with RTOS mode off, and says how to fix it', () => {
    const problem = taskCoreProblem(tasks, { rtos: esp32, cpuCores: 2 }, false)
    expect(problem).toMatch(/NET/)
    expect(problem).toMatch(/RTOS mode/)
    expect(problem).toMatch(/Auto/)
  })

  it('refuses a second core on a single-core board', () => {
    expect(taskCoreProblem([{ name: 'NET', core: 1 }], { rtos: esp32, cpuCores: 1 }, true)).toMatch(
      /one core/,
    )
  })
})
