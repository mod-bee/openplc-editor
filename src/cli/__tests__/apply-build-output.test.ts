/**
 * `device.buildOutput` sets the project's "Keep build output", the setting the build reads from
 * devices/configuration.json.
 */

import { createTestStore } from '@root/frontend/store/testing'

// The FBD body applier reaches the FBD component modules, which do not load
// under jest. Nothing here applies an FBD body.
jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import { applySpecSchema, type ApplySpec } from '../apply/schema'

const store = createTestStore()

const apply = (device: ApplySpec['device']) =>
  applySpec(store, { specVersion: 1, device }, { prune: false, projectPath: '/does/not/matter' })

const buildOutput = () => store.getState().deviceDefinitions.configuration.buildOutput

describe('device.buildOutput', () => {
  it('turns keeping on and off, and says so', async () => {
    const on = await apply({ buildOutput: { keep: true, count: 4 } })
    expect(buildOutput()).toEqual({ keep: true, count: 4 })
    expect(on.changes).toContainEqual({ kind: 'device', action: 'update', name: 'buildOutput = keep 4' })

    const off = await apply({ buildOutput: { keep: false } })
    expect(buildOutput()).toBeUndefined()
    expect(off.changes).toContainEqual({ kind: 'device', action: 'update', name: 'buildOutput = off' })
  })

  it('refuses a count outside 1..100 and unknown keys', () => {
    const spec = (value: unknown) => applySpecSchema.safeParse({ specVersion: 1, device: { buildOutput: value } })
    expect(spec({ keep: true, count: 0 }).success).toBe(false)
    expect(spec({ keep: true, count: 101 }).success).toBe(false)
    expect(spec({ keep: true, folder: 'x' }).success).toBe(false)
    expect(spec({ keep: true }).success).toBe(true)
  })
})
