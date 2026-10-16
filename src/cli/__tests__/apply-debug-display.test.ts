/**
 * `device.debugDisplay` sets how the debugger shows values (Configuration > General > Debugger), saved in
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

describe('device.debugDisplay', () => {
  it('replaces the setting, and {} restores the defaults', async () => {
    const set = await apply({ debugDisplay: { decimals: 2, hideSecrets: false } })
    expect(store.getState().deviceDefinitions.configuration.debugDisplay).toEqual({ decimals: 2, hideSecrets: false })
    expect(set.changes).toContainEqual({
      kind: 'device',
      action: 'update',
      name: 'debugDisplay = {"decimals":2,"hideSecrets":false}',
    })

    await apply({ debugDisplay: {} })
    expect(store.getState().deviceDefinitions.configuration.debugDisplay).toBeUndefined()
  })

  it('refuses decimals outside 0..6 and unknown keys', () => {
    const spec = (value: unknown) => applySpecSchema.safeParse({ specVersion: 1, device: { debugDisplay: value } })
    expect(spec({ decimals: 7 }).success).toBe(false)
    expect(spec({ colour: 'red' }).success).toBe(false)
    expect(spec({ decimals: 0, blockInputs: false }).success).toBe(true)
  })
})
