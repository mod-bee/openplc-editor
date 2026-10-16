import { useDebugCompositeKey } from '../../../hooks/use-debug-composite-key'
import { useDebugDisplayOptions } from '../../../hooks/use-debug-display-options'
import { useIsDebuggerVisible } from '../../../hooks/use-debug-value'
import { blockPinVariableName } from '../../../utils/debug-pin-values'
import { blockInputVariables, blockOutputVariables } from '../../../utils/graphical/in-out-pin-rules'
import { useIsGraphicalEditorActive } from '../../_features/[workspace]/editor/graphical/active-context'
import { DebugValueBadge } from './debug-value-badge'

type PinVariable = { name: string; class: string; type: { definition: string; value: string } }
type PinHandle = { id?: string; relPosition?: { y: number } }

type BlockPinDebugBadgesProps = {
  blockType: string
  blockName: string
  blockVariableName: string
  numericId: string
  /** The block's parameters (`variant.variables`), both sides. */
  variables: PinVariable[]
  /** The drawn pins, to place a badge where its pin is (see the labels in the block nodes). */
  inputHandles?: PinHandle[]
  outputHandles?: PinHandle[]
  connectorStartY: number
  connectorOffsetY: number
  blockWidth: number
  /** Pins that have an element attached, which shows the value itself. */
  connectedOutputNames?: Set<string>
  connectedInputNames?: Set<string>
  /**
   * For an input wired straight from another block's output: the name that output is read under
   * (blockPinVariableName). A function keeps no inputs, so this is where its input's value comes from.
   */
  inputSources?: Map<string, string>
}

/** EN / ENO are execution control, not values the block keeps. */
const EXECUTION_CONTROL = new Set(['EN', 'ENO'])

/**
 * The live value at each pin of a block that has no element of its own to show it, shared by FBD and LD.
 *
 * Outputs: a function block's from its instance (`motor.Running`), a function's from the compiler's
 * `_TMP_<NAME><id>_<pin>` temporary. Inputs: a function block's from its instance, which keeps the value it
 * was last called with (`motor.Start`); a function's from the output wired into it. A VAR_IN_OUT is a
 * reference, shown at the variable wired to it. A pin with an element attached is skipped: the element
 * shows the value. BOOL pins show no value: their wire carries the colour. The value sits above the wire,
 * outside the block, so it covers neither the pin label nor the wire's element.
 */
const BlockPinDebugBadges = ({
  blockType,
  blockName,
  blockVariableName,
  numericId,
  variables,
  inputHandles,
  outputHandles,
  connectorStartY,
  connectorOffsetY,
  blockWidth,
  connectedOutputNames,
  connectedInputNames,
  inputSources,
}: BlockPinDebugBadgesProps) => {
  const isDebuggerVisible = useIsDebuggerVisible()
  const isActive = useIsGraphicalEditorActive()
  const getCompositeKey = useDebugCompositeKey()
  const { blockInputs, functionInputs } = useDebugDisplayOptions()

  if (!isActive || !isDebuggerVisible || blockType === 'generic') {
    return null
  }

  /** The height of a pin's wire: the badge sits just above it. */
  const pinTop = (handles: PinHandle[] | undefined, name: string, index: number) =>
    handles?.find((handle) => handle.id === name)?.relPosition?.y ?? connectorStartY + index * connectorOffsetY

  const block = { variant: { name: blockName, type: blockType }, variable: { name: blockVariableName }, numericId }
  const outputs = blockOutputVariables(variables)
  // The input side lists in-outs too (their pin sits there); only plain inputs hold a value.
  const inputSide = blockInputVariables(variables)

  return (
    <>
      {outputs.map((pin, index) => {
        if (EXECUTION_CONTROL.has(pin.name.toUpperCase()) || connectedOutputNames?.has(pin.name)) return null
        const name = blockPinVariableName(block, pin.name, 'output')
        if (name === undefined) return null
        return (
          <div
            key={`out:${pin.name}`}
            className='pointer-events-none absolute'
            style={{ top: pinTop(outputHandles, pin.name, index), left: blockWidth }}
          >
            <DebugValueBadge
              compositeKey={getCompositeKey(name)}
              variableType={pin.type.value}
              position='above-right'
            />
          </div>
        )
      })}
      {inputSide.map((pin, index) => {
        if (pin.class !== 'input' || EXECUTION_CONTROL.has(pin.name.toUpperCase())) return null
        if (connectedInputNames?.has(pin.name)) return null
        // Each kind as the project's debugger settings ask (Configuration > General > Debugger).
        const name =
          blockType === 'function-block'
            ? blockInputs
              ? blockPinVariableName(block, pin.name, 'input')
              : undefined
            : functionInputs
              ? inputSources?.get(pin.name)
              : undefined
        if (name === undefined) return null
        return (
          <div
            key={`in:${pin.name}`}
            className='pointer-events-none absolute'
            style={{ top: pinTop(inputHandles, pin.name, index), left: 0 }}
          >
            <DebugValueBadge compositeKey={getCompositeKey(name)} variableType={pin.type.value} position='above-left' />
          </div>
        )
      })}
    </>
  )
}

export { BlockPinDebugBadges }
