/**
 * A spec applied with --prune is the whole declaration, order included:
 *
 * - a renamed pin, local or structure member keeps its place, where it used to
 *   be added at the end of its section with the old name pruned;
 * - a spec that moves a variable or member moves it;
 * - a C++ method parameter is checked against the block's variables as the
 *   spec declares them, so it may take a name a renamed pin gave up.
 */

import { createTestStore } from '@root/frontend/store/testing'

jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const BOOL = { definition: 'base-type' as const, value: 'BOOL' }
const DINT = { definition: 'base-type' as const, value: 'DINT' }
const STRING = { definition: 'base-type' as const, value: 'STRING' }

type Store = ReturnType<typeof createTestStore>
type SpecVar = { name: string; class: 'input' | 'output' | 'local'; type: typeof BOOL }

const apply = (store: Store, spec: Partial<ApplySpec>, prune = true) =>
  applySpec(store, { specVersion: 1, ...spec } as ApplySpec, { prune, projectPath: '/does/not/matter' })

const block = (variables: SpecVar[], text = '') => ({
  pous: [{ name: 'FB_ORDER', kind: 'function-block' as const, language: 'st' as const, variables, body: { text } }],
})

const names = (store: Store) =>
  (store.getState().project.data.pous.find((pou) => pou.name === 'FB_ORDER')?.interface?.variables ?? []).map(
    (variable) => variable.name,
  )

const VARIABLES: SpecVar[] = [
  { name: 'xEnable', class: 'input', type: BOOL },
  { name: 'iCount', class: 'input', type: DINT },
  { name: 'xStart', class: 'input', type: BOOL },
  { name: 'xDone', class: 'output', type: BOOL },
  { name: 'iTotal', class: 'output', type: DINT },
  { name: 'iStep', class: 'local', type: DINT },
  { name: 'xLatch', class: 'local', type: BOOL },
]

const renamed = (from: string, to: string) =>
  VARIABLES.map((variable) => (variable.name === from ? { ...variable, name: to } : variable))

describe('a renamed variable keeps its place', () => {
  it.each([
    ['an input pin', 'iCount', 'iCountMax'],
    ['an output pin', 'xDone', 'xFinished'],
    ['a local', 'iStep', 'iStepNo'],
  ])('%s', async (_what, from, to) => {
    const store = createTestStore()
    expect((await apply(store, block(VARIABLES))).errors).toEqual([])

    const spec = renamed(from, to)
    expect((await apply(store, block(spec))).errors).toEqual([])
    expect(names(store)).toEqual(spec.map((variable) => variable.name))
  })

  it('also in the declaration text', async () => {
    const store = createTestStore()
    await apply(store, block(VARIABLES))
    await apply(store, block(renamed('iCount', 'iCountMax')))
    const text = store.getState().project.data.pous.find((pou) => pou.name === 'FB_ORDER')?.variablesText ?? ''
    expect(text).toContain('iCountMax')
    expect(text.indexOf('iCountMax')).toBeLessThan(text.indexOf('xStart'))
  })
})

describe('the spec order is applied', () => {
  it('moves variables the spec moves, within and across sections', async () => {
    const store = createTestStore()
    await apply(store, block(VARIABLES))

    const moved = [VARIABLES[6], VARIABLES[2], VARIABLES[0], VARIABLES[1], VARIABLES[4], VARIABLES[3], VARIABLES[5]]
    expect((await apply(store, block(moved))).errors).toEqual([])
    expect(names(store)).toEqual(moved.map((variable) => variable.name))
  })

  it('leaves the order alone without --prune', async () => {
    const store = createTestStore()
    await apply(store, block(VARIABLES))
    await apply(store, block([VARIABLES[2], VARIABLES[0]]), false)
    expect(names(store)).toEqual(VARIABLES.map((variable) => variable.name))
  })
})

describe('structure members follow the spec order', () => {
  const MEMBERS = [
    { name: 'run', type: BOOL },
    { name: 'speed', type: DINT },
    { name: 'fault', type: BOOL },
  ]
  const struct = (variables: typeof MEMBERS) => ({
    dataTypes: [{ derivation: 'structure' as const, name: 'ST_ORDER', variables }],
  })
  const members = (store: Store) => {
    const type = store.getState().project.data.dataTypes.find((entry) => entry.name === 'ST_ORDER')
    return type && type.derivation === 'structure' ? type.variable.map((member) => member.name) : []
  }

  it('keeps a renamed member in place', async () => {
    const store = createTestStore()
    expect((await apply(store, struct(MEMBERS) as Partial<ApplySpec>)).errors).toEqual([])
    const spec = [MEMBERS[0], { ...MEMBERS[1], name: 'speedSet' }, MEMBERS[2]]
    expect((await apply(store, struct(spec) as Partial<ApplySpec>)).errors).toEqual([])
    expect(members(store)).toEqual(['run', 'speedSet', 'fault'])
  })

  it('moves a member the spec moves', async () => {
    const store = createTestStore()
    await apply(store, struct(MEMBERS) as Partial<ApplySpec>)
    await apply(store, struct([MEMBERS[2], MEMBERS[0], MEMBERS[1]]) as Partial<ApplySpec>)
    expect(members(store)).toEqual(['fault', 'run', 'speed'])
  })
})

describe('a C++ method parameter is checked against the spec variables', () => {
  const METHOD = (parameter: string) =>
    `METHOD PUBLIC Join : BOOL\n  VAR_INPUT ${parameter} : STRING; END_VAR\nEND_METHOD\n` +
    'void setup() {}\nvoid loop() {}\nbool Join() { return true; }\n'

  const cpp = (pin: string, parameter: string) => ({
    pous: [
      {
        name: 'FB_NODE_CPP',
        kind: 'function-block' as const,
        language: 'cpp' as const,
        variables: [
          { name: 'xEnable', class: 'input' as const, type: BOOL },
          { name: pin, class: 'input' as const, type: STRING },
          { name: 'xOnline', class: 'output' as const, type: BOOL },
        ],
        body: { text: METHOD(parameter) },
      },
    ],
  })

  it('lets a parameter take the name of a pin renamed in the same apply', async () => {
    const store = createTestStore()
    expect((await apply(store, cpp('sGroupId', 'sName') as Partial<ApplySpec>)).errors).toEqual([])

    const outcome = await apply(store, cpp('sNodeGroupId', 'sGroupId') as Partial<ApplySpec>)
    expect(outcome.errors).toEqual([])
    const pou = store.getState().project.data.pous.find((entry) => entry.name === 'FB_NODE_CPP')
    expect(pou?.interface?.variables.map((variable) => variable.name)).toEqual(['xEnable', 'sNodeGroupId', 'xOnline'])
    expect(String((pou?.body as { value?: unknown } | undefined)?.value)).toContain('sGroupId : STRING')
  })

  it('still refuses a parameter named like a pin of the spec', async () => {
    const store = createTestStore()
    await apply(store, cpp('sGroupId', 'sName') as Partial<ApplySpec>)

    const outcome = await apply(store, cpp('sNodeGroupId', 'sNodeGroupId') as Partial<ApplySpec>)
    expect(outcome.errors.join('\n')).toMatch(
      /"FB_NODE_CPP.Join": the parameter "sNodeGroupId" has the name of a variable of the block/,
    )
  })

  it('without --prune still refuses the name of a pin the block keeps', async () => {
    const store = createTestStore()
    await apply(store, cpp('sGroupId', 'sName') as Partial<ApplySpec>)

    const outcome = await apply(store, cpp('sNodeGroupId', 'sGroupId') as Partial<ApplySpec>, false)
    expect(outcome.errors.join('\n')).toMatch(
      /"FB_NODE_CPP.Join": the parameter "sGroupId" has the name of a variable of the block/,
    )
  })
})
