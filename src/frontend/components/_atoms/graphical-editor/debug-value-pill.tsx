import { useDebugDisplayOptions } from '../../../hooks/use-debug-display-options'
import { useDebugVariableValue } from '../../../hooks/use-debug-value'
import { cn } from '../../../utils/cn'
import { formatDebugValue, HIDDEN_VALUE, isSecretValue } from '../../../utils/debug-pin-values'

type DebugValuePillProps = {
  /** The key the value is read under; undefined shows nothing. */
  compositeKey: string | undefined
  variableType: string | undefined
  className?: string
}

/**
 * A live value, inline in a diagram element's own layout so it never covers a name. A BOOL shows no pill:
 * its state is the colour of the element's wire.
 */
const DebugValuePill = ({ compositeKey, variableType, className }: DebugValuePillProps) => {
  const value = useDebugVariableValue(compositeKey ?? '')
  const { decimals, hideSecrets } = useDebugDisplayOptions()
  if (compositeKey === undefined || value === undefined) return null
  if (!variableType || variableType.toUpperCase() === 'BOOL') return null
  return (
    <span
      className={cn(
        'pointer-events-none shrink-0 whitespace-nowrap rounded px-1 py-px text-[10px] font-semibold leading-tight text-white',
        'bg-[#2E7D32] dark:bg-[#388E3C]',
        className,
      )}
    >
      {hideSecrets && isSecretValue(compositeKey, variableType)
        ? HIDDEN_VALUE
        : formatDebugValue(value, variableType, decimals)}
    </span>
  )
}

export { DebugValuePill }
