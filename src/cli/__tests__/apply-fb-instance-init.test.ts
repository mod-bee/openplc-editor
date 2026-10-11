/**
 * A function block instance with an initialisation list (IEC 61131-3 Ed.3
 * 6.6.3.3, Table 41 feature 2): `t : TON := (PT := T#5s);`.
 *
 * `apply` used to refuse every initial value on a `derived` variable, and the
 * store's update path dropped one on every re-apply. The list may name the
 * block's inputs, outputs or PUBLIC variables, and nothing else.
 */

import { createTestStore } from '@root/frontend/store/testing'
import { isFbInitList, parseFbInitList } from '@root/frontend/utils/PLC/fb-instance-init'
import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'
import { transpileToSt } from '@root/backend/shared/transpilers/st-transpiler/index'

// The FBD body applier reaches the FBD component modules, which do not load
// under jest. Nothing here applies an FBD body.
jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const store = createTestStore()

const pin = (name: string, cls: 'input' | 'output' | 'inOut', value = 'TIME') => ({
  name,
  class: cls,
  type: { definition: 'base-type', value },
})

const STD: SystemLibrary = {
  name: 'iec-standard-fb',
  version: '1.0.0',
  pous: [
    {
      name: 'TON',
      type: 'function-block',
      language: 'st',
      body: '',
      documentation: '',
      variables: [pin('IN', 'input', 'BOOL'), pin('PT', 'input'), pin('Q', 'output', 'BOOL'), pin('ET', 'output')],
    },
    {
      name: 'HOLDER',
      type: 'function-block',
      language: 'st',
      body: '',
      documentation: '',
      variables: [pin('REF', 'inOut', 'INT')],
    },
  ],
} as unknown as SystemLibrary

store.setState({ libraries: { system: [STD], user: [] } } as never)

const REAL = { definition: 'base-type' as const, value: 'REAL' }

const apply = (spec: Partial<ApplySpec>) =>
  applySpec(store, { specVersion: 1, ...spec } as ApplySpec, { prune: false, projectPath: '/does/not/matter' })

/** A project FB with an input, an output, a public and a protected variable. */
const STUB = {
  name: 'MEAS_STUB',
  kind: 'function-block' as const,
  language: 'st' as const,
  variables: [
    { name: 'V', class: 'input' as const, type: REAL },
    { name: 'Y', class: 'output' as const, type: REAL },
    { name: 'Gain', class: 'local' as const, type: REAL, access: 'public' as const },
    { name: 'Hidden', class: 'local' as const, type: REAL },
  ],
  body: { text: 'Y := V * Gain;\n' },
}

const withInstance = (type: string, initialValue: string | undefined) =>
  ({
    pous: [
      STUB,
      {
        name: 'Main',
        kind: 'program' as const,
        language: 'st' as const,
        variables: [
          {
            name: 'inst',
            class: 'local' as const,
            type: { definition: 'derived' as const, value: type },
            ...(initialValue !== undefined ? { initialValue } : {}),
          },
        ],
        body: { text: '' },
      },
    ],
  }) as Partial<ApplySpec>

const instance = () =>
  store
    .getState()
    .project.data.pous.find((pou) => pou.name === 'Main')
    ?.interface?.variables.find((variable) => variable.name === 'inst')

describe('the initialisation list itself', () => {
  it('splits at top-level commas only', () => {
    expect(parseFbInitList("(Name := 'a,b', Pts := [1, 2], S := (x := 1, y := 2))")).toEqual({
      elements: [
        { name: 'Name', value: "'a,b'" },
        { name: 'Pts', value: '[1, 2]' },
        { name: 'S', value: '(x := 1, y := 2)' },
      ],
    })
  })

  it('is one group spanning the whole value', () => {
    expect(isFbInitList('(PT := T#5s)')).toBe(true)
    expect(isFbInitList('(a := 1) + (b := 2)')).toBe(false)
    expect(isFbInitList('T#5s')).toBe(false)
  })

  it('refuses an element without a name', () => {
    expect(parseFbInitList('(T#5s)')).toHaveProperty('error')
    expect(parseFbInitList('()')).toHaveProperty('error')
  })
})

describe('apply: an instance with an initialisation list', () => {
  it('accepts inputs of a library block and stores the list', async () => {
    const result = await apply(withInstance('TON', '(PT := T#5s, IN := FALSE)'))
    expect(result.errors).toEqual([])
    expect(instance()?.initialValue).toBe('(PT := T#5s, IN := FALSE)')
  })

  it('keeps the list when the same spec is applied again (the update path)', async () => {
    await apply(withInstance('TON', '(PT := T#5s)'))
    const again = await apply(withInstance('TON', '(PT := T#5s)'))
    expect(again.errors).toEqual([])
    expect(instance()?.initialValue).toBe('(PT := T#5s)')
  })

  it('drops the list when a re-apply leaves it out', async () => {
    await apply(withInstance('TON', '(PT := T#5s)'))
    await apply(withInstance('TON', undefined))
    expect(instance()?.initialValue ?? '').toBe('')
  })

  it("accepts a project block's input, output and PUBLIC variable", async () => {
    const result = await apply(withInstance('MEAS_STUB', '(V := 0.0, y := 1.0, Gain := 2.5)'))
    expect(result.errors).toEqual([])
    expect(instance()?.initialValue).toBe('(V := 0.0, y := 1.0, Gain := 2.5)')
  })

  it('refuses a variable that is not public', async () => {
    const result = await apply(withInstance('MEAS_STUB', '(Hidden := 1.0)'))
    expect(result.errors.join(' ')).toContain('"Hidden" in its initial value is an internal variable of MEAS_STUB')
  })

  it('refuses a name the block does not declare, listing what it can name', async () => {
    const result = await apply(withInstance('TON', '(PRESET := T#5s)'))
    expect(result.errors.join(' ')).toContain('"PRESET" in its initial value is not a variable of TON')
    expect(result.errors.join(' ')).toContain('It can name: IN, PT, Q, ET.')
  })

  it('refuses a VAR_IN_OUT', async () => {
    const result = await apply(withInstance('HOLDER', '(REF := 1)'))
    expect(result.errors.join(' ')).toContain('is a VAR_IN_OUT of HOLDER')
  })

  it('refuses a name given twice', async () => {
    const result = await apply(withInstance('TON', '(PT := T#5s, pt := T#1s)'))
    expect(result.errors.join(' ')).toContain('names "pt" twice')
  })

  it('refuses a scalar, pointing at user-data-type', async () => {
    const result = await apply(withInstance('TON', 'T#5s'))
    expect(result.errors.join(' ')).toContain('must be a parenthesized list')
    expect(result.errors.join(' ')).toContain('user-data-type')
  })

  it('refuses a list on a block nobody declares', async () => {
    const result = await apply(withInstance('NO_SUCH_FB', '(A := 1)'))
    expect(result.errors.join(' ')).toContain('no function block NO_SUCH_FB is declared')
  })

  it('checks a global instance the same way', async () => {
    const good = await apply({
      globalVariables: [
        { name: 'gT', class: 'global', type: { definition: 'derived', value: 'TON' }, initialValue: '(PT := T#2s)' },
      ],
    } as Partial<ApplySpec>)
    expect(good.errors).toEqual([])

    const bad = await apply({
      globalVariables: [
        { name: 'gT', class: 'global', type: { definition: 'derived', value: 'TON' }, initialValue: '(XX := 1)' },
      ],
    } as Partial<ApplySpec>)
    expect(bad.errors.join(' ')).toContain('global variable "gT" is an instance of TON: "XX"')
  })
})

describe('the store: a type change to a function block', () => {
  it('drops a scalar initial value the previous type had', () => {
    const state = store.getState()
    const pou = state.project.data.pous.find((entry) => entry.name === 'Main')
    const rowId = pou?.interface?.variables.findIndex((variable) => variable.name === 'inst') ?? -1
    state.projectActions.updateVariable({
      scope: 'local',
      associatedPou: 'Main',
      rowId,
      data: { type: REAL, initialValue: '1.5' },
    })
    expect(instance()?.initialValue).toBe('1.5')

    store.getState().projectActions.updateVariable({
      scope: 'local',
      associatedPou: 'Main',
      rowId,
      data: { type: { definition: 'derived', value: 'TON' } },
    })
    expect(instance()?.initialValue).toBe('')
  })
})

describe('the emitted ST', () => {
  it('carries the list after the block type', () => {
    const result = transpileToSt({
      pous: [
        {
          name: 'Main',
          pouType: 'program',
          interface: {
            variables: [
              {
                name: 't',
                class: 'local',
                type: { definition: 'derived', value: 'TON' },
                location: '',
                initialValue: '(PT := T#5s)',
              },
            ],
          },
          body: { language: 'st', value: 't(IN := TRUE);' },
        },
      ],
      dataTypes: [],
      configuration: { tasks: [], instances: [], globalVariables: [] },
    })
    expect(result.errors).toEqual([])
    expect(result.programSt).toContain('t : TON := (PT := T#5s);')
  })
})
