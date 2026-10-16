import { useDebugDisplayOptions } from '../../../hooks/use-debug-display-options'
import { useDebugVariableValue, useIsVariableForced } from '../../../hooks/use-debug-value'
import { cn } from '../../../utils/cn'
import { formatDebugValue, HIDDEN_VALUE, isSecretValue } from '../../../utils/debug-pin-values'
import { useIsGraphicalEditorActive } from '../../_features/[workspace]/editor/graphical/active-context'
import { ForcedMarker } from '../forced-marker'

type DebugValueBadgeProps = {
  compositeKey: string
  variableType: string | undefined
  /** Beside the anchor, below it, or above a wire leaving it to the right / left (block pins). */
  position?: 'right' | 'left' | 'below' | 'above-right' | 'above-left'
}

/**
 * Displays a real-time debug value badge next to graphical editor nodes.
 * Shows the current polled value for non-BOOL variables when the debugger is active.
 * BOOL variables are skipped since they already have dedicated color indicators.
 *
 * Designed to be used by both FBD and LD variable/block nodes.
 */
const DebugValueBadge = ({ compositeKey, variableType, position = 'right' }: DebugValueBadgeProps) => {
  // Multi-mount: badges render only on the visible POU.  Inactive
  // editors stay alive in the DOM (display: none) so debug-state
  // subscriptions across N tabs would otherwise multiply polling work
  // and re-render churn during a debug session.
  const isActive = useIsGraphicalEditorActive()
  const value = useDebugVariableValue(compositeKey)
  const isForced = useIsVariableForced(compositeKey)
  const { decimals, hideSecrets } = useDebugDisplayOptions()

  if (!isActive) {
    return null
  }
  // A BOOL's value is its wire's colour; it still shows when it is forced.
  const showValue = value !== undefined && !!variableType && variableType.toUpperCase() !== 'BOOL'
  if (!showValue && !isForced) {
    return null
  }

  const positionClasses: Record<string, string> = {
    right: 'left-full ml-1 top-1/2 -translate-y-1/2',
    left: 'right-full mr-1 top-1/2 -translate-y-1/2',
    below: 'top-full mt-0.5 left-1/2 -translate-x-1/2',
    // Above a pin's wire, against the block edge: clear of the pin label inside the block and of the
    // wire's element further out.
    'above-right': 'left-1 bottom-0.5',
    'above-left': 'right-1 bottom-0.5',
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute z-20 flex items-center gap-1 whitespace-nowrap',
        positionClasses[position],
      )}
    >
      {isForced && <ForcedMarker />}
      {showValue && (
        <span className='rounded bg-[#2E7D32] px-1 py-px text-[10px] font-semibold leading-tight text-white dark:bg-[#388E3C]'>
          {hideSecrets && isSecretValue(compositeKey, variableType)
            ? HIDDEN_VALUE
            : formatDebugValue(value, variableType, decimals)}
        </span>
      )}
    </div>
  )
}

export { DebugValueBadge }
export type { DebugValueBadgeProps }
