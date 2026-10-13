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
