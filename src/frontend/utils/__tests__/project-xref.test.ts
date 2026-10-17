/**
 * Cross references: every use of a variable, member-aware, with its owner (a global through VAR_EXTERNAL in
 * any program, or the POU that declares it), its place and its access.
 */
import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { XrefProject } from '../project-xref'
import {
  buildProjectXref,
  findXrefUses,
  GLOBAL_OWNER,
  nameChainAt,
  resolveXrefTarget,
  scanStChains,
} from '../project-xref'

const v = (name: string, cls: PLCVariable['class'] = 'local'): PLCVariable =>
  ({ name, class: cls, type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' }) as PLCVariable

const pou = (name: string, language: string, variables: PLCVariable[], value: unknown = ''): PLCPou =>
  ({ name, pouType: 'program', interface: { variables }, body: { language, value } }) as unknown as PLCPou

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, data })

const project: XrefProject = {
  pous: [
    pou('PUMP', 'ld', [v('levelLimit', 'external'), v('dryRun'), v('motor', 'external')]),
    pou('ALARMS', 'ld', [v('levelLimit', 'external')]),
    pou(
      'LEVEL',
      'st',
      [v('levelLimit', 'external'), v('n')],
      [
        '(* levelLimit.Trip in a comment is not a use *)',
        "levelLimit(In := sensor.value, Reset := FALSE);",
        "msg := 'levelLimit.Trip';",
        'IF levelLimit.Trip THEN n := n + 1; END_IF;',
        'tmr(IN := levelLimit.LoLo, Q => dryRunOut);',
        'x := T#5s; y := UT_STATE#UT_STATE_OFF;',
      ].join('\n'),
    ),
  ],
  ladderFlows: [
    {
      name: 'PUMP',
      rungs: [
        {
          id: 'r0',
          nodes: [
            node('c1', 'contact', { variable: { name: 'levelLimit.LoLo' }, variant: 'default' }),
            node('o1', 'coil', { variable: { name: 'dryRun' }, variant: 'set' }),
          ],
        },
        {
          id: 'r1',
          nodes: [
            node('b1', 'block', { variable: { name: 'motor' }, variant: { name: 'UT_MOTOR' } }),
            node('v1', 'variable', {
              variable: { name: 'dryRun' },
              variant: 'input',
              block: { id: 'b1', variableType: { name: 'Interlock', class: 'input' } },
            }),
            node('v2', 'variable', {
              variable: { name: 'IO.din[FN_RUN].q' },
              variant: 'input',
              block: { id: 'b1', variableType: { name: 'Feedback', class: 'input' } },
            }),
          ],
        },
      ],
    },
    {
      name: 'ALARMS',
      rungs: [{ id: 'a0', nodes: [node('c2', 'contact', { variable: { name: 'LEVELLIMIT.Trip' }, variant: 'negated' })] }],
    },
  ],
  fbdFlows: [],
  globalVariables: [{ name: 'levelLimit' }, { name: 'motor' }, { name: 'IO' }, { name: 'FN_RUN' }, { name: 'sensor' }],
}

const uses = buildProjectXref(project)
const describe_ = (list: typeof uses) =>
  list.map((u) => `${u.pou ?? '-'}:${u.rungIndex ?? u.line ?? ''} ${u.expression} ${u.access}`).sort()

describe('project cross references', () => {
  it('finds a member used in Ladder in every program, and the whole-variable uses that reach it', () => {
    const target = resolveXrefTarget(project, 'ALARMS', 'levelLimit.Trip')!
    expect(target).toMatchObject({ owner: GLOBAL_OWNER, root: 'levelLimit' })
    expect(describe_(findXrefUses(uses, target).filter((u) => u.access !== 'declaration'))).toEqual(
      [
        'ALARMS:1 LEVELLIMIT.Trip read',
        'LEVEL:2 levelLimit call',
        'LEVEL:4 levelLimit.Trip read',
      ].sort(),
    )
  })

  it('lists every use of a whole variable, members included, with declarations', () => {
    const target = resolveXrefTarget(project, 'PUMP', 'levelLimit')!
    const found = findXrefUses(uses, target)
    expect(found.filter((u) => u.access === 'declaration').map((u) => u.detail).sort()).toEqual(
      ['VAR_EXTERNAL', 'VAR_EXTERNAL', 'VAR_EXTERNAL', 'VAR_GLOBAL'].sort(),
    )
    expect(describe_(found.filter((u) => u.access !== 'declaration'))).toEqual(
      [
        'ALARMS:1 LEVELLIMIT.Trip read',
        'LEVEL:2 levelLimit call',
        'LEVEL:4 levelLimit.Trip read',
        'LEVEL:5 levelLimit.LoLo read',
        'PUMP:1 levelLimit.LoLo read',
      ].sort(),
    )
  })

  it('knows Ladder access: coil writes, block pins by side, block instances are called', () => {
    const dryRun = findXrefUses(uses, resolveXrefTarget(project, 'PUMP', 'dryRun')!)
    expect(dryRun.find((u) => u.nodeId === 'o1')).toMatchObject({ access: 'write', detail: 'coil (set)', rungIndex: 1 })
    expect(dryRun.find((u) => u.nodeId === 'v1')).toMatchObject({ access: 'read', detail: 'input Interlock of motor' })
    const motor = findXrefUses(uses, resolveXrefTarget(project, 'PUMP', 'motor')!)
    expect(motor.find((u) => u.nodeId === 'b1')).toMatchObject({ access: 'call', detail: 'UT_MOTOR block' })
  })

  it('knows the block pin a Ladder variable sits on', () => {
    const dryRun = findXrefUses(uses, resolveXrefTarget(project, 'PUMP', 'dryRun')!)
    expect(dryRun.find((u) => u.nodeId === 'v1')).toMatchObject({ blockId: 'b1', pin: 'Interlock' })
  })

  it('knows the block pin an FBD variable is wired to', () => {
    const fbd = buildProjectXref({
      ...project,
      pous: [pou('MIX', 'fbd', [v('speed')])],
      fbdFlows: [
        {
          name: 'MIX',
          rung: {
            nodes: [
              node('in1', 'input-variable', { variable: { name: 'speed' } }),
              node('blk', 'block', { variable: { name: 'ramp' }, variant: { name: 'RAMP' } }),
            ],
            edges: [{ source: 'in1', target: 'blk', sourceHandle: null, targetHandle: 'Setpoint' }],
          },
        },
      ],
    })
    expect(fbd.find((u) => u.nodeId === 'in1')).toMatchObject({ blockId: 'blk', pin: 'Setpoint', access: 'read' })
  })

  it('counts a constant in a subscript as read where it is used', () => {
    const fn = findXrefUses(uses, resolveXrefTarget(project, 'PUMP', 'FN_RUN')!)
    expect(fn.find((u) => u.nodeId === 'v2')).toMatchObject({ access: 'read', detail: 'subscript in IO.din[FN_RUN].q' })
    const io = findXrefUses(uses, resolveXrefTarget(project, 'PUMP', 'IO')!)
    expect(io.find((u) => u.nodeId === 'v2')).toMatchObject({ access: 'read', expression: 'IO.din[FN_RUN].q' })
  })

  it("keeps a program's own variable apart from another program's", () => {
    const local = resolveXrefTarget(project, 'LEVEL', 'n')!
    expect(local.owner).toBe('LEVEL')
    expect(describe_(findXrefUses(uses, local).filter((u) => u.access !== 'declaration'))).toEqual(
      ['LEVEL:4 n read', 'LEVEL:4 n write'].sort(),
    )
    expect(resolveXrefTarget(project, 'LEVEL', 'TON')).toBeUndefined()
  })
})

describe('ST name chains', () => {
  it('reads assignments, outputs, calls and formal parameters', () => {
    const chains = scanStChains('a.b[i].c := x; f(IN := y, Q => z); inst(); arr[j+1] := k;')
    expect(chains.map((c) => `${c.expression}:${c.access}`)).toEqual([
      'a.b[i].c:write',
      'i:read',
      'x:read',
      'f:call',
      'y:read',
      'z:write',
      'inst:call',
      'arr[j+1]:write',
      'j:read',
      'k:read',
    ])
  })

  it('skips comments, strings and typed literals', () => {
    const chains = scanStChains("// a\n(* b *) /* c */ s := 'd' + \"e\"; t := T#1m30s; u := 16#FF; w := MODE#AUTO;")
    expect(chains.map((c) => c.expression)).toEqual(['s', 't', 'u', 'w'])
  })
})

describe('the name under the cursor', () => {
  const line = 'IF levelLimit.Trip AND IO.din[FN_RUN].q THEN'
  const at = (text: string, offset = 0) => line.indexOf(text) + 1 + offset

  it('runs to the end of the part the cursor is on', () => {
    expect(nameChainAt(line, at('levelLimit'))).toBe('levelLimit')
    expect(nameChainAt(line, at('Trip', 2))).toBe('levelLimit.Trip')
    expect(nameChainAt(line, at('q THEN'))).toBe('IO.din[FN_RUN].q')
  })

  it('takes the name inside a subscript, and nothing on a keyword gap', () => {
    expect(nameChainAt(line, at('FN_RUN', 3))).toBe('FN_RUN')
    expect(nameChainAt('x := 1;  (* note *)', 14)).toBeUndefined()
  })
})
