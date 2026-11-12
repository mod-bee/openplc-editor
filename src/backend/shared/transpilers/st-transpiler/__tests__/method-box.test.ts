import { generateGraphicalPou } from '@root/backend/shared/transpilers/st-transpiler/emit/pou-graphical'
import type { TranspilePou, TranspileProject } from '@root/backend/shared/transpilers/st-transpiler/types'
import type { RFEdge, RFNode } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

/**
 * A method box (IEC 61131-3 6.6.5.4; CODESYS draws it with the instance above
 * and the method in the box) calls `<instance>.<method>(...)`. Its result
 * leaves on OUT, like a function's; its outputs are not members of the
 * instance, so each is bound with `=>` in the call. A method that returns
 * nothing is a call statement.
 */

let edgeId = 0
const e = (s: string, t: string, sh: string | null, th: string | null): RFEdge => ({
  id: `e${edgeId++}`,
  source: s,
  target: t,
  sourceHandle: sh,
  targetHandle: th,
})
const inVar = (id: string, name: string, y: number): RFNode => ({
  id,
  type: 'variable',
  position: { x: 20, y },
  data: { variant: 'input', variable: { name }, executionOrder: 0, numericId: id },
})
const outVar = (id: string, name: string, y: number): RFNode => ({
  id,
  type: 'variable',
  position: { x: 320, y },
  data: { variant: 'output', variable: { name }, executionOrder: 0, numericId: id },
})
const pin = (name: string, cls: 'input' | 'output' | 'inOut', type: string) => ({
  name,
  class: cls,
  type: { definition: type === 'ANY' ? 'generic-type' : 'base-type', value: type },
})
const methodBox = (
  id: string,
  method: string,
  owner: string,
  instance: string,
  pins: ReturnType<typeof pin>[],
  executionControl = false,
): RFNode => ({
  id,
  type: 'block',
  position: { x: 150, y: 30 },
  data: {
    numericId: '42',
    executionOrder: 0,
    executionControl,
    variable: { name: instance },
    variant: { name: method, type: 'method', owner, extensible: false, variables: pins },
  },
})

const local = (name: string, type: string) => ({
  name,
  class: 'local',
  type: { definition: type === 'FB_NODE' ? 'derived' : 'base-type', value: type },
})

function pou(language: 'ld' | 'fbd', nodes: RFNode[], edges: RFEdge[], variables: unknown[]): TranspilePou {
  const rung = { reactFlowViewport: [800, 300], nodes, edges }
  return {
    name: 'Main',
    pouType: 'program',
    interface: { variables },
    body: { language, value: language === 'ld' ? { rungs: [rung] } : { rung } },
  } as unknown as TranspilePou
}

const text = (p: TranspilePou): string =>
  generateGraphicalPou(p, {
    dataTypes: [],
    pous: [p],
    configuration: { tasks: [], instances: [], globalVariables: [] },
  } as unknown as TranspileProject)
    .map(([chunk]) => chunk)
    .join('')

const VARS = [
  local('sp', 'FB_NODE'),
  local('data', 'INT'),
  local('result', 'INT'),
  local('bad', 'INT'),
  local('go', 'BOOL'),
  local('done', 'BOOL'),
]

describe.each(['ld', 'fbd'] as const)('a method box on %s', (language) => {
  it('calls the method of its instance, the result to OUT and each output bound with =>', () => {
    const st = text(
      pou(
        language,
        [
          inVar('v1', 'data', 30),
          methodBox('M', 'Record', 'FB_NODE', 'sp', [
            pin('anyData', 'input', 'ANY'),
            pin('sPrefix', 'input', 'STRING'),
            pin('nBadClause', 'output', 'INT'),
            pin('OUT', 'output', 'INT'),
          ]),
          outVar('o1', 'result', 30),
          outVar('o2', 'bad', 60),
        ],
        [e('v1', 'M', null, 'anyData'), e('M', 'o1', 'OUT', null), e('M', 'o2', 'nBadClause', null)],
        VARS,
      ),
    )
    expect(st).toContain('_TMP_Record42_OUT := sp.Record(anyData := data, nBadClause => _TMP_Record42_nBadClause);')
    expect(st).toContain('result := _TMP_Record42_OUT;')
    expect(st).toContain('bad := _TMP_Record42_nBadClause;')
    // Not as a function of its own name, and not as a call of the instance.
    expect(st).not.toMatch(/:= Record\(/)
    expect(st).not.toMatch(/\bsp\(/)
  })

  it('gates the call on EN and continues from ENO', () => {
    const st = text(
      pou(
        language,
        [
          inVar('v0', 'go', 0),
          inVar('v1', 'data', 30),
          methodBox(
            'M',
            'Record',
            'FB_NODE',
            'sp',
            [
              pin('EN', 'input', 'BOOL'),
              pin('anyData', 'input', 'ANY'),
              pin('ENO', 'output', 'BOOL'),
              pin('OUT', 'output', 'INT'),
            ],
            true,
          ),
          outVar('o1', 'done', 30),
          outVar('o2', 'result', 60),
        ],
        [e('v0', 'M', null, 'EN'), e('v1', 'M', null, 'anyData'), e('M', 'o1', 'ENO', null), e('M', 'o2', 'OUT', null)],
        VARS,
      ),
    )
    expect(st).toContain('_TMP_Record42_OUT := sp.Record(EN := go, anyData := data, ENO => _TMP_Record42_ENO);')
    expect(st).toContain('done := _TMP_Record42_ENO;')
  })

  it('calls a method that returns nothing as a statement', () => {
    const st = text(
      pou(
        language,
        [inVar('v1', 'data', 30), methodBox('M', 'Reset', 'FB_NODE', 'sp', [pin('nWhy', 'input', 'INT')])],
        [e('v1', 'M', null, 'nWhy')],
        VARS,
      ),
    )
    expect(st).toMatch(/^\s*sp\.Reset\(nWhy := data\);$/m)
  })
})
