/**
 * `tasks[].stopOnStuck` and `tasks[].stack` in the apply spec. Omitted is the
 * default (a stuck task stops the PLC; the target's stack). The spec describes
 * a task in full, so applying it without them puts the task back on the
 * defaults, and a project on the defaults stores neither.
 */

import { createTestStore } from '@root/frontend/store/testing'

// The FBD body applier reaches the FBD component modules, which do not load
// under jest. Nothing here applies an FBD body.
jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import { type ApplySpec, applySpecSchema } from '../apply/schema'

const store = createTestStore()

const apply = (tasks: ApplySpec['tasks']) =>
  applySpec(store, { specVersion: 1, tasks }, { prune: false, projectPath: '/does/not/matter' })

const task = (name: string) => store.getState().project.data.configurations.resource.tasks.find((t) => t.name === name)
const stored = (name: string) => JSON.parse(JSON.stringify(task(name))) as Record<string, unknown>

const comms = { name: 'COMMS', triggering: 'Cyclic' as const, interval: 'T#100ms', priority: 5 }

describe('tasks[].stopOnStuck and tasks[].stack', () => {
  it('sets both on a new task, and reads them back', async () => {
    const outcome = await apply([{ ...comms, stopOnStuck: false, stack: 16384 }])
    expect(outcome.errors).toEqual([])
    expect(task('COMMS')?.stopOnStuck).toBe(false)
    expect(task('COMMS')?.stack).toBe(16384)
  })

  it('puts the task back on the defaults when the spec leaves them out', async () => {
    await apply([{ ...comms, stopOnStuck: false, stack: 8192 }])
    await apply([comms])
    expect(stored('COMMS')).not.toHaveProperty('stopOnStuck')
    expect(stored('COMMS')).not.toHaveProperty('stack')
  })

  it('stores stopOnStuck: true as no setting at all, new or updated', async () => {
    await apply([{ ...comms, name: 'LOGIC', stopOnStuck: true }])
    expect(stored('LOGIC')).not.toHaveProperty('stopOnStuck')
    await apply([{ ...comms, stopOnStuck: true }])
    expect(stored('COMMS')).not.toHaveProperty('stopOnStuck')
  })

  it('is refused by the schema unless a boolean and a whole stack from 1024 to 67108864 bytes', () => {
    const spec = (extra: Record<string, unknown>) => ({ specVersion: 1, tasks: [{ ...comms, ...extra }] })
    expect(applySpecSchema.safeParse(spec({ stopOnStuck: false })).success).toBe(true)
    expect(applySpecSchema.safeParse(spec({ stopOnStuck: 'no' })).success).toBe(false)
    expect(applySpecSchema.safeParse(spec({ stack: 1024 })).success).toBe(true)
    expect(applySpecSchema.safeParse(spec({ stack: 67108864 })).success).toBe(true)
    expect(applySpecSchema.safeParse(spec({ stack: 1023 })).success).toBe(false)
    expect(applySpecSchema.safeParse(spec({ stack: 8192.5 })).success).toBe(false)
    expect(applySpecSchema.safeParse(spec({ stack: 'default' })).success).toBe(false)
  })
})
