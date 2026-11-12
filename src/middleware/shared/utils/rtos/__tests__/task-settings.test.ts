import {
  restartChoices,
  restartLabel,
  taskPragmaText,
  taskSettingsProblem,
  taskStackChoices,
  taskStackLabel,
  taskThreadsFor,
  taskThreadsForRtos,
} from '../task-settings'
import type { RtosTargetProfile } from '../types'

const rtos = {
  backend: 'freertos-esp32',
  tickNs: 1_000_000,
  workLevels: 8,
  maxTasks: 8,
  threads: 'native',
} as RtosTargetProfile
const esp32 = { rtos, taskThreads: taskThreadsForRtos('freertos-esp32') }
const runtime = { taskThreads: { stackMin: 65536, stackMax: 67108864 } }

describe('task settings: Stop PLC if stuck, Stack', () => {
  it('gives ESP32 4-64 KB and the other RTOS backends 2-64 KB', () => {
    expect(taskThreadsForRtos('freertos-esp32')).toEqual({ stackMin: 4096, stackMax: 65536 })
    expect(taskThreadsForRtos('freertos-rp2040')).toEqual({ stackMin: 2048, stackMax: 65536 })
  })

  it('applies only where each task is a thread: RTOS mode on, or a runtime', () => {
    expect(taskThreadsFor(esp32, true)).toEqual({ stackMin: 4096, stackMax: 65536 })
    expect(taskThreadsFor(esp32, false)).toBeUndefined()
    expect(taskThreadsFor(runtime, false)).toEqual(runtime.taskThreads)
    expect(taskThreadsFor({}, true)).toBeUndefined()
  })

  it('accepts tasks on the defaults anywhere', () => {
    const tasks = [{ name: 'MAIN' }, { name: 'NET', stopOnStuck: true }]
    expect(taskSettingsProblem(tasks, esp32, false)).toBeUndefined()
    expect(taskSettingsProblem(tasks, {}, false)).toBeUndefined()
  })

  it('accepts the settings in RTOS mode, a stack within the range', () => {
    const tasks = [
      { name: 'LOGIC', stack: 8192 },
      { name: 'COMMS', stopOnStuck: false, stack: 16384 },
    ]
    expect(taskSettingsProblem(tasks, esp32, true)).toBeUndefined()
  })

  it('refuses them with RTOS mode off, naming the task', () => {
    expect(taskSettingsProblem([{ name: 'COMMS', stopOnStuck: false }], esp32, false)).toMatch(
      /need RTOS mode.*COMMS \(Stop PLC if stuck: No\)/,
    )
  })

  it('refuses them where every task runs in one loop', () => {
    expect(taskSettingsProblem([{ name: 'COMMS', stack: 8192 }], {}, true)).toMatch(
      /one loop.*COMMS \(Stack: 8192 bytes\)/,
    )
  })

  it('refuses a stack outside the board range, naming the task and the range', () => {
    expect(taskSettingsProblem([{ name: 'LOGIC', stack: 2048 }], esp32, true)).toBe(
      'LOGIC is set to a 2048 byte stack, and this board takes 4096 to 65536 bytes. Choose one of those, or Default.',
    )
    expect(taskSettingsProblem([{ name: 'LOGIC', stack: 32768 }], runtime, false)).toMatch(/65536 to 67108864/)
  })

  it('writes the pragma in a fixed order, and nothing on the defaults', () => {
    expect(taskPragmaText({})).toBe('')
    expect(taskPragmaText({ stopOnStuck: true })).toBe('')
    expect(taskPragmaText({ core: 1 })).toBe(' {CORE := 1}')
    expect(taskPragmaText({ stack: 8192, stopOnStuck: false, core: 0 })).toBe(
      ' {CORE := 0, STOP_ON_STUCK := FALSE, STACK := 8192}',
    )
  })

  it('offers the stack sizes within the range, keeping a size set elsewhere', () => {
    expect(taskStackChoices({ stackMin: 4096, stackMax: 65536 }, undefined)).toEqual([
      4096, 6144, 8192, 12288, 16384, 24576, 32768, 49152, 65536,
    ])
    expect(taskStackChoices({ stackMin: 4096, stackMax: 8192 }, 10000)).toEqual([4096, 6144, 8192, 10000])
    expect(taskStackChoices(undefined, undefined)).toEqual([])
  })

  it('names a stack size in plain words', () => {
    expect(taskStackLabel(undefined)).toBe('Default')
    expect(taskStackLabel(8192)).toBe('8 KB')
    expect(taskStackLabel(1048576)).toBe('1 MB')
    expect(taskStackLabel(10000)).toBe('10000 bytes')
  })
})

describe('On fault (RESTART_ON_FAULT)', () => {
  it('writes the delay after the other settings, and nothing on Stop', () => {
    expect(taskPragmaText({})).toBe('')
    expect(taskPragmaText({ restartOnFault: 30 })).toBe(' {RESTART_ON_FAULT := 30}')
    expect(taskPragmaText({ core: 1, stopOnStuck: false, stack: 16384, restartOnFault: 60 })).toBe(
      ' {CORE := 1, STOP_ON_STUCK := FALSE, STACK := 16384, RESTART_ON_FAULT := 60}',
    )
  })

  it('says the delay in words', () => {
    expect(restartLabel(undefined)).toBe('Stop')
    expect(restartLabel(10)).toBe('10 s')
    expect(restartLabel(60)).toBe('1 min')
    expect(restartLabel(90)).toBe('1 min 30 s')
    expect(restartLabel(3600)).toBe('1 h')
  })

  it('offers the usual delays, and keeps one set elsewhere', () => {
    expect(restartChoices(undefined)).toEqual([10, 30, 60, 120, 300, 600])
    expect(restartChoices(45)).toEqual([10, 30, 45, 60, 120, 300, 600])
  })

  it('needs a target whose tasks are threads, like the other settings', () => {
    const task = { name: 'logic', restartOnFault: 30 }
    expect(taskSettingsProblem([task], { taskThreads: undefined }, true)).toMatch(/"On fault" Stop/)
  })
})
