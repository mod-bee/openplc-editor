/**
 * `tasks[].core`: the task's CPU core in the apply spec. A whole number from 0;
 * omitted is Auto (the runtime's own placement). The spec describes a task in
 * full, so applying it without `core` puts a pinned task back on Auto.
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

describe('tasks[].core', () => {
  it('sets a core, and reads it back', async () => {
    const outcome = await apply([{ name: 'NET', triggering: 'Cyclic', interval: 'T#20ms', priority: 1, core: 0 }])
    expect(outcome.errors).toEqual([])
    expect(task('NET')?.core).toBe(0)
  })

  it('puts the task back on Auto when the spec leaves core out', async () => {
    await apply([{ name: 'NET', triggering: 'Cyclic', interval: 'T#20ms', priority: 1, core: 1 }])
    expect(task('NET')?.core).toBe(1)
    await apply([{ name: 'NET', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }])
    expect(task('NET')?.core).toBeUndefined()
    expect(JSON.parse(JSON.stringify(task('NET')))).not.toHaveProperty('core')
  })

  it('is refused by the schema unless a whole number from 0 to 63', () => {
    const spec = (core: unknown) => ({
      specVersion: 1,
      tasks: [{ name: 'NET', triggering: 'Cyclic', interval: 'T#20ms', priority: 1, core }],
    })
    expect(applySpecSchema.safeParse(spec(0)).success).toBe(true)
    expect(applySpecSchema.safeParse(spec(63)).success).toBe(true)
    expect(applySpecSchema.safeParse(spec(-1)).success).toBe(false)
    expect(applySpecSchema.safeParse(spec(1.5)).success).toBe(false)
    expect(applySpecSchema.safeParse(spec(64)).success).toBe(false)
    expect(applySpecSchema.safeParse(spec('auto')).success).toBe(false)
  })
})
