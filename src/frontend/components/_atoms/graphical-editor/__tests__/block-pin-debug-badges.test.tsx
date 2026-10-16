/**
 * BlockPinDebugBadges — the live value at each pin of a block: outputs, and a function block's inputs
 * (kept in its instance), BOOLs as TRUE / FALSE since a block pin has no colour of its own.
 */
import { render, screen } from '@testing-library/react'

import { BlockPinDebugBadges } from '../block-pin-debug-badges'

const values = new Map<string, string>()

jest.mock('../../../../hooks/use-debug-composite-key', () => ({
  useDebugCompositeKey: () => (name: string) => `Main:${name}`,
}))
jest.mock('../../../../hooks/use-debug-value', () => ({
  useIsDebuggerVisible: () => true,
  useDebugVariableValue: (key: string) => values.get(key),
}))
jest.mock('../../../_features/[workspace]/editor/graphical/active-context', () => ({
  useIsGraphicalEditorActive: () => true,
}))

const pin = (name: string, cls: string, type: string) => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: type },
})
const variables = [
  pin('EN', 'input', 'BOOL'),
  pin('Start', 'input', 'BOOL'),
  pin('Setpoint', 'input', 'REAL'),
  pin('Cmd', 'inOut', 'INT'),
  pin('ENO', 'output', 'BOOL'),
  pin('Running', 'output', 'BOOL'),
  pin('Speed', 'output', 'REAL'),
]

const renderBadges = (props: Partial<Parameters<typeof BlockPinDebugBadges>[0]> = {}) =>
  render(
    <BlockPinDebugBadges
      blockType='function-block'
      blockName='UT_MOTOR'
      blockVariableName='motor'
      numericId='7'
      variables={variables}
      connectorStartY={36}
      connectorOffsetY={40}
      blockWidth={200}
      {...props}
    />,
  )

beforeEach(() => {
  values.clear()
  values.set('Main:motor.Start', '1')
  values.set('Main:motor.Setpoint', '42.5')
  values.set('Main:motor.Cmd', '3')
  values.set('Main:motor.EN', '1')
  values.set('Main:motor.ENO', '1')
  values.set('Main:motor.Running', '0')
  values.set('Main:motor.Speed', '41.9')
})

describe('BlockPinDebugBadges', () => {
  it("shows a function block's inputs and outputs, BOOLs as TRUE / FALSE", () => {
    renderBadges()
    expect(screen.getByText('42.5')).toBeTruthy()
    expect(screen.getByText('41.9')).toBeTruthy()
    expect(screen.getByText('TRUE')).toBeTruthy() // Start
    expect(screen.getByText('FALSE')).toBeTruthy() // Running
    // EN / ENO are execution control; an in-out is a reference, shown at its variable.
    expect(screen.getAllByText('TRUE')).toHaveLength(1)
    expect(screen.queryByText('3')).toBeNull()
  })

  it('leaves out pins with a named element attached, which shows the value itself', () => {
    renderBadges({ connectedInputNames: new Set(['Setpoint']), connectedOutputNames: new Set(['Speed']) })
    expect(screen.queryByText('42.5')).toBeNull()
    expect(screen.queryByText('41.9')).toBeNull()
  })

  it("shows a function's outputs from its temporaries, and no inputs (a function keeps none)", () => {
    values.set('Main:_TMP_ADD7_OUT', '12')
    renderBadges({
      blockType: 'function',
      blockName: 'ADD',
      blockVariableName: '',
      variables: [pin('IN1', 'input', 'INT'), pin('IN2', 'input', 'INT'), pin('OUT', 'output', 'INT')],
    })
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.queryByText('42.5')).toBeNull()
  })

  it('places a badge at its drawn pin', () => {
    const { container } = renderBadges({ inputHandles: [{ id: 'Setpoint', relPosition: { y: 100 } }] })
    const badge = screen.getByText('42.5').parentElement as HTMLElement
    expect(badge.style.top).toBe('90px')
    expect(container).toBeTruthy()
  })
})
