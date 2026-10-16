import type { RungLadderState } from '@root/frontend/store/slices'

import { computeRungDebugStates, type LadderDebugContext } from '../ladder-utils/debug-power-flow'

// A block's BOOL pins show their state as the colour of their wire, inputs as outputs: the wire into an
// input is energized by the element feeding it (its variable, TRUE / FALSE written out, or for an empty
// pin or a constant the value the block holds at that pin), and ENO, which STruC++ makes mirror EN at every
// call and keeps no debug value for, follows EN.

type Nodes = RungLadderState['nodes']
type Edges = RungLadderState['edges']

const rail = (id: string, variant: 'left' | 'right') =>
  ({ id, type: 'powerRail', position: { x: 0, y: 0 }, data: { variant } }) as unknown as Nodes[number]
const contact = (id: string, name: string) =>
  ({ id, type: 'contact', position: { x: 0, y: 0 }, data: { variant: 'open', variable: { name } } }) as unknown as Nodes[number]
const motor = { id: 'B', type: 'block', position: { x: 0, y: 0 }, data: { variant: { name: 'UT_MOTOR', type: 'function-block' }, variable: { name: 'motor' } } } as unknown as Nodes[number]
const box = (id: string, name: string, handleId: string) =>
  ({ id, type: 'variable', position: { x: 0, y: 0 }, data: { variant: 'input', variable: { name }, block: { id: 'B', handleId } } }) as unknown as Nodes[number]
const edge = (id: string, source: string, target: string, sourceHandle: string, targetHandle: string) =>
  ({ id, source, target, sourceHandle, targetHandle }) as unknown as Edges[number]

const states = (bools: Record<string, string>, gate: string) => {
  const ctx: LadderDebugContext = {
    isFunctionBlockPou: false,
    hasProgramInstance: true,
    getCompositeKey: (name) => `main:${name}`,
    boolValues: new Map(Object.entries({ 'main:gate': gate, ...bools })),
  }
  const nodes: Nodes = [
    rail('L', 'left'),
    contact('C', 'gate'),
    motor,
    box('V1', 'resetAll', 'Reset'),
    box('V2', '', 'Interlock'),
    box('V3', 'TRUE', 'Permissive'),
    rail('R', 'right'),
  ]
  const edges: Edges = [
    edge('rail-c', 'L', 'C', 'output', 'input'),
    edge('c-en', 'C', 'B', 'output', 'EN'),
    edge('reset', 'V1', 'B', 'output', 'Reset'),
    edge('interlock', 'V2', 'B', 'output', 'Interlock'),
    edge('permissive', 'V3', 'B', 'output', 'Permissive'),
    edge('eno', 'B', 'R', 'ENO', 'input'),
  ]
  return computeRungDebugStates(nodes, edges, ctx).edgeStates
}

describe('block pins in the ladder power flow', () => {
  it('lights the wire into an input from its variable, a written TRUE, or the pin an empty element sits on', () => {
    const on = states({ 'main:resetAll': '1', 'main:motor.Interlock': 'TRUE' }, '1')
    expect([on.get('reset'), on.get('interlock'), on.get('permissive')]).toEqual([true, true, true])

    const off = states({ 'main:resetAll': '0', 'main:motor.Interlock': 'FALSE' }, '1')
    expect([off.get('reset'), off.get('interlock')]).toEqual([false, false])
  })

  it('energizes ENO exactly when EN is, whatever the inputs', () => {
    expect(states({ 'main:resetAll': '1' }, '1').get('eno')).toBe(true)
    expect(states({ 'main:resetAll': '1' }, '0').get('eno')).toBe(false)
  })
})
