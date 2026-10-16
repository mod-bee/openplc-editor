/**
 * Find in project: diagrams included, plain text taken literally, every hit with its place.
 */
import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { SearchInput } from '../project-search'
import { makeMatcher, searchProject } from '../project-search'

const v = (name: string, cls: PLCVariable['class'] = 'local'): PLCVariable =>
  ({ name, class: cls, type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' }) as PLCVariable

const pou = (name: string, language: string, variables: PLCVariable[], value: unknown = ''): PLCPou =>
  ({ name, pouType: 'program', interface: { variables }, body: { language, value } }) as unknown as PLCPou

const input: SearchInput = {
  pous: [
    pou('ALARMS', 'ld', [v('levelLimit', 'external')]),
    pou('LEVEL', 'st', [v('n')], 'n := 0;\nIF levelLimit.Trip THEN\n  n := 1;\nEND_IF;'),
    pou('MIX', 'fbd', []),
  ],
  ladderFlows: [
    {
      name: 'ALARMS',
      rungs: [
        { id: 'r0', comment: 'Fault lamp', nodes: [] } as never,
        {
          id: 'r1',
          comment: '',
          nodes: [
            { id: 'c1', type: 'contact', data: { variable: { name: 'levelLimit.Trip' } } },
            { id: 'b1', type: 'block', data: { variable: { name: 'lim' }, variant: { name: 'UT_LIMIT' } } },
          ],
        } as never,
      ],
    },
  ],
  fbdFlows: [
    {
      name: 'MIX',
      rung: { nodes: [{ id: 'f1', type: 'input-variable', data: { variable: { name: 'levelLimitX' } } }] },
    },
  ],
  globalVariables: [{ name: 'levelLimit' }],
  globalVariableLists: [{ name: 'GVL_IO', variables: [v('levelLimitAux')] }],
  dataTypes: [{ name: 'UT_LIMIT_SET', derivation: 'structure' }],
  tasks: [{ name: 'Task0' }],
  instances: [{ name: 'INST_ALARMS' }],
}

describe('Find in project', () => {
  it('finds a Ladder contact by its full name, at its rung and element', () => {
    const { functions } = searchProject(input, 'levelLimit.Trip', { caseSensitive: false, regex: false })
    const alarms = functions.pous.program!.find((p) => p.name === 'ALARMS')!
    expect(alarms.hits).toEqual([
      {
        text: 'levelLimit.Trip',
        where: 'rung 2 · contact',
        target: { kind: 'pou', pou: 'ALARMS', rungId: 'r1', nodeId: 'c1' },
        count: 1,
      },
    ])
    const level = functions.pous.program!.find((p) => p.name === 'LEVEL')!
    expect(level.hits).toEqual([
      {
        text: 'IF levelLimit.Trip THEN',
        where: 'line 2',
        target: { kind: 'pou', pou: 'LEVEL', line: 2, column: 1 },
        count: 1,
      },
    ])
  })

  it('takes plain text literally: a dot is a dot', () => {
    const { count } = searchProject(input, 'levelLimit.Tr', { caseSensitive: false, regex: false })
    expect(count).toBe(2)
    expect(searchProject(input, 'levelLimitXTr', { caseSensitive: false, regex: false }).count).toBe(0)
  })

  it('finds FBD elements, block types, rung comments, declarations, globals and lists', () => {
    const { functions } = searchProject(input, 'limit', { caseSensitive: false, regex: false })
    const hits = Object.values(functions.pous)
      .flat()
      .flatMap((p) => p!.hits.map((h) => `${p!.name}: ${h.text} (${h.where})`))
    expect(hits).toEqual(
      expect.arrayContaining([
        'ALARMS: levelLimit (VAR_EXTERNAL)',
        'ALARMS: UT_LIMIT (rung 2 · block type)',
        'MIX: levelLimitX (input variable)',
      ]),
    )
    expect(functions.globals.map((g) => g.where)).toEqual(['VAR_GLOBAL', 'VAR_GLOBAL (GVL_IO)'])
    expect(functions.dataTypes).toEqual([{ name: 'UT_LIMIT_SET', type: 'structure' }])
    expect(searchProject(input, 'fault lamp', { caseSensitive: false, regex: false }).functions.pous.program![0].hits[0])
      .toMatchObject({ where: 'rung 1 · comment', target: { rungId: 'r0' } })
  })

  it('respects case and the filters', () => {
    expect(searchProject(input, 'LEVELLIMIT.TRIP', { caseSensitive: true, regex: false }).count).toBe(0)
    const onlyConfig = searchProject(input, 'limit', { caseSensitive: false, regex: false }, ['configuration'])
    expect(onlyConfig.functions.pous).toEqual({})
    expect(onlyConfig.functions.globals).toHaveLength(2)
  })

  it('uses a regular expression only when asked, and reports a bad one', () => {
    expect(searchProject(input, 'level.*Trip', { caseSensitive: false, regex: true }).count).toBe(2)
    expect(() => makeMatcher('[', { caseSensitive: false, regex: true })).toThrow(SyntaxError)
    expect(makeMatcher('[', { caseSensitive: false, regex: false })('a[1]')).toBe(1)
  })
})
