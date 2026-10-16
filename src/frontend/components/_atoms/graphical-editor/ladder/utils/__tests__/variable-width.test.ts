import { nodeGap } from '../../../../../_molecules/graphical-editor/ladder/rung/ladder-utils/nodes'
import { DEFAULT_VARIABLE_WIDTH } from '../constants'
import { variableElementText, variableElementWidth } from '../variable-width'

describe('ladder variable element width', () => {
  it('keeps the default for a short name and grows for a long one, never wrapping', () => {
    expect(variableElementWidth('resetAll')).toBe(DEFAULT_VARIABLE_WIDTH)
    expect(variableElementWidth('IO.din[FN_PUMP_RUN_FB].q')).toBe(24 * 7 + 8)
  })

  it("sizes an empty element by the pin's type placeholder", () => {
    expect(variableElementText('', 'UT_I_MEAS')).toBe('(*UT_I_MEAS*)')
    expect(variableElementText(' motor ', 'UT_MOTOR')).toBe('motor')
  })
})

describe('nodeGap — the room a block keeps for its elements', () => {
  const block = (inputName: string) =>
    ({
      id: 'B',
      type: 'block',
      position: { x: 0, y: 0 },
      data: {
        variant: { name: 'UT_MOTOR', type: 'function-block', variables: [{ name: 'Feedback', class: 'input', type: { definition: 'base-type', value: 'BOOL' } }] },
        inputHandles: [{ id: 'EN' }, { id: 'Feedback' }],
        outputHandles: [{ id: 'ENO' }],
        connectedVariables: [{ type: 'input', handleId: 'Feedback', variable: { name: inputName } }],
      },
    }) as never

  it('is the usual 120 for short names, and grows on the side of a long one', () => {
    expect(nodeGap(block('fb'), 'before')).toBe(120)
    expect(nodeGap(block('IO.din[FN_PUMP_RUN_FB].q'), 'before')).toBe(24 * 7 + 8 + 30 + 10)
    expect(nodeGap(block('IO.din[FN_PUMP_RUN_FB].q'), 'after')).toBe(120)
  })
})
