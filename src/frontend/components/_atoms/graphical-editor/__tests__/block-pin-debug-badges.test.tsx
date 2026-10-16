/**
 * BlockPinDebugBadges — the live value at each pin of a block that has no element of its own to show it:
 * outputs, a function block's inputs (kept in its instance), a function's inputs from the output wired in.
 * BOOL pins show no value: their wire carries the colour.
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
jest.mock('../../../../hooks/use-debug-display-options', () => ({
  useDebugDisplayOptions: () => ({ decimals: 3, blockInputs: true, functionInputs: true, hideSecrets: true }),
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
  it("shows a function block's non-BOOL inputs and outputs, and no BOOL", () => {
    renderBadges()
    // REAL values at the default 3 decimals.
    expect(screen.getByText('42.500')).toBeTruthy()
    expect(screen.getByText('41.900')).toBeTruthy()
    // BOOL pins (Start, Running, EN, ENO) are their wire's colour; an in-out is shown at its variable.
    expect(screen.queryByText('TRUE')).toBeNull()
    expect(screen.queryByText('1')).toBeNull()
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText('3')).toBeNull()
  })

  it('leaves out pins with a named element attached, which shows the value itself', () => {
    renderBadges({ connectedInputNames: new Set(['Setpoint']), connectedOutputNames: new Set(['Speed']) })
    expect(screen.queryByText('42.500')).toBeNull()
    expect(screen.queryByText('41.900')).toBeNull()
  })

  it("shows a function's outputs from its temporaries, and an input from the output wired into it", () => {
    values.set('Main:_TMP_ADD7_OUT', '12')
    values.set('Main:other.Speed', '7')
    renderBadges({
      blockType: 'function',
      blockName: 'ADD',
      blockVariableName: '',
      variables: [pin('IN1', 'input', 'INT'), pin('IN2', 'input', 'INT'), pin('OUT', 'output', 'INT')],
      inputSources: new Map([['IN1', 'other.Speed']]),
    })
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.queryByText('42.500')).toBeNull()
  })

  it('places a badge at its drawn pin', () => {
    const { container } = renderBadges({ inputHandles: [{ id: 'Setpoint', relPosition: { y: 100 } }] })
    const badge = screen.getByText('42.500').parentElement as HTMLElement
    // At the wire's height; the badge itself sits just above it.
    expect(badge.style.top).toBe('100px')
    expect(container).toBeTruthy()
  })
})
