/**
 * A task's Core setting reaches the compiler as an IEC 61131-3 §6.2 pragma
 * after the task's parameter list: `TASK NET(...) {CORE := 0};`. A task on
 * Auto (no core) is emitted exactly as before.
 */
import type { TranspileProject, TranspileTask } from '../types'
import { generateConfigurations } from '../emit/configuration'

const text = (tasks: TranspileTask[]): string =>
  generateConfigurations({
    pous: [],
    dataTypes: [],
    configuration: { tasks, instances: [], globalVariables: [] },
  } as TranspileProject)
    .map(([chunk]) => chunk)
    .join('')

describe('configuration — task core', () => {
  it('writes a task on Auto exactly as before', () => {
    expect(text([{ name: 'MAIN', triggering: 'Cyclic', interval: 'T#50ms', priority: 0 }])).toContain(
      'TASK MAIN(INTERVAL := T#50ms,PRIORITY := 0);\n',
    )
  })

  it('writes a core as a pragma after the parameter list', () => {
    expect(text([{ name: 'NET', triggering: 'Cyclic', interval: 'T#20ms', priority: 1, core: 0 }])).toContain(
      'TASK NET(INTERVAL := T#20ms,PRIORITY := 1) {CORE := 0};\n',
    )
  })
})

describe('configuration — Stop PLC if stuck and Stack', () => {
  it('writes a task on the defaults exactly as before', () => {
    expect(
      text([{ name: 'MAIN', triggering: 'Cyclic', interval: 'T#50ms', priority: 0, stopOnStuck: true }]),
    ).toContain('TASK MAIN(INTERVAL := T#50ms,PRIORITY := 0);\n')
  })

  it('writes them after the core in the one pragma', () => {
    expect(
      text([
        {
          name: 'COMMS',
          triggering: 'Cyclic',
          interval: 'T#100ms',
          priority: 5,
          core: 0,
          stopOnStuck: false,
          stack: 16384,
        },
      ]),
    ).toContain('TASK COMMS(INTERVAL := T#100ms,PRIORITY := 5) {CORE := 0, STOP_ON_STUCK := FALSE, STACK := 16384};\n')
    expect(text([{ name: 'LOGIC', triggering: 'Cyclic', interval: 'T#50ms', priority: 0, stack: 8192 }])).toContain(
      'TASK LOGIC(INTERVAL := T#50ms,PRIORITY := 0) {STACK := 8192};\n',
    )
  })
})
