/**
 * A structure variable written `derived` (the kind for a block instance) with
 * an initial value: apply reads it as the structure it is, rather than refusing
 * the value as the init list of a block that does not exist.
 */
import { createTestStore } from '@root/frontend/store/testing'

jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const INT = { definition: 'base-type' as const, value: 'INT' }

describe('a structure-typed variable with an initial value', () => {
  it('is accepted, and stored as a user data type, whether its type is new or already there', async () => {
    const store = createTestStore()
    const settings = { derivation: 'structure', name: 'ST_Settings', variables: [{ name: 'nBaud', type: INT }] }
    const pou = (name: string, type: string) => ({
      name,
      kind: 'program',
      language: 'st',
      variables: [{ name: 'cfg', type: { definition: 'derived', value: type }, initialValue: '(nBaud := 9600)' }],
      body: { text: 'cfg.nBaud := cfg.nBaud;' },
    })
    const first = await applySpec(
      store,
      { specVersion: 1, dataTypes: [settings], pous: [pou('P1', 'ST_Settings')] } as ApplySpec,
      { prune: false, projectPath: '/x' },
    )
    expect(first.errors).toEqual([])
    const second = await applySpec(store, { specVersion: 1, pous: [pou('P2', 'st_settings')] } as ApplySpec, {
      prune: false,
      projectPath: '/x',
    })
    expect(second.errors).toEqual([])
    for (const name of ['P1', 'P2']) {
      const cfg = store
        .getState()
        .project.data.pous.find((entry) => entry.name === name)
        ?.interface?.variables.find((variable) => variable.name === 'cfg')
      expect(cfg?.type.definition).toBe('user-data-type')
      expect(cfg?.initialValue).toBe('(nBaud := 9600)')
    }
  })

  it('still checks a real block instance', async () => {
    const store = createTestStore()
    const result = await applySpec(
      store,
      {
        specVersion: 1,
        pous: [
          {
            name: 'P',
            kind: 'program',
            language: 'st',
            variables: [
              { name: 'x', type: { definition: 'derived', value: 'NO_SUCH_THING' }, initialValue: '(a := 1)' },
            ],
            body: { text: '' },
          },
        ],
      } as ApplySpec,
      { prune: false, projectPath: '/x' },
    )
    expect(result.errors.join('\n')).toMatch(/no function block NO_SUCH_THING/)
  })
})
