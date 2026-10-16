import { useDebugCompositeKey } from '../../../hooks/use-debug-composite-key'
import { useIsDebuggerVisible } from '../../../hooks/use-debug-value'
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
  /** Pins that have a named variable element attached, which shows the value itself. */
  connectedOutputNames?: Set<string>
  connectedInputNames?: Set<string>
}

/** EN / ENO are execution control, not values the block keeps. */
const EXECUTION_CONTROL = new Set(['EN', 'ENO'])

/**
 * The live value at each pin of a block, shared by FBD and LD.
 *
 * Outputs: a function block's from its instance (`motor.Running`), a function's from the compiler's
 * `_TMP_<NAME><id>_<pin>` temporary. Inputs: a function block's from its instance, which keeps the value it
 * was last called with (`motor.Start`); a function keeps none, and a VAR_IN_OUT is a reference, so those
 * show their value at the variable wired to them. BOOL pins show TRUE / FALSE too: a block pin has no
 * colour of its own. A pin with a named variable attached is skipped, as that element shows the value.
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
}: BlockPinDebugBadgesProps) => {
  const isDebuggerVisible = useIsDebuggerVisible()
  const isActive = useIsGraphicalEditorActive()
  const getCompositeKey = useDebugCompositeKey()

  if (!isActive || !isDebuggerVisible || blockType === 'generic') {
    return null
  }

  const pinTop = (handles: PinHandle[] | undefined, name: string, index: number) =>
    (handles?.find((handle) => handle.id === name)?.relPosition?.y ?? connectorStartY + index * connectorOffsetY) - 10

  const isFunctionBlock = blockType === 'function-block'
  const outputs = blockOutputVariables(variables)
  // The input side lists in-outs too (their pin sits there); only plain inputs hold a value.
  const inputSide = blockInputVariables(variables)

  return (
    <>
      {outputs.map((pin, index) => {
        if (EXECUTION_CONTROL.has(pin.name.toUpperCase()) || connectedOutputNames?.has(pin.name)) return null
        const compositeKey = isFunctionBlock
          ? getCompositeKey(`${blockVariableName}.${pin.name}`)
          : getCompositeKey(`_TMP_${blockName.toUpperCase()}${numericId}_${pin.name}`)
        return (
          <div
            key={`out:${pin.name}`}
            className='pointer-events-none absolute'
            style={{ top: pinTop(outputHandles, pin.name, index), left: blockWidth }}
          >
            <DebugValueBadge compositeKey={compositeKey} variableType={pin.type.value} position='right' showBool />
          </div>
        )
      })}
      {isFunctionBlock &&
        blockVariableName !== '' &&
        inputSide.map((pin, index) => {
          if (pin.class !== 'input' || EXECUTION_CONTROL.has(pin.name.toUpperCase())) return null
          if (connectedInputNames?.has(pin.name)) return null
          return (
            <div
              key={`in:${pin.name}`}
              className='pointer-events-none absolute'
              style={{ top: pinTop(inputHandles, pin.name, index), left: 0 }}
            >
              <DebugValueBadge
                compositeKey={getCompositeKey(`${blockVariableName}.${pin.name}`)}
                variableType={pin.type.value}
                position='left'
                showBool
              />
            </div>
          )
        })}
    </>
  )
}

export { BlockPinDebugBadges }
