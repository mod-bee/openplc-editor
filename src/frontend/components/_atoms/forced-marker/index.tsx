import { cn } from '../../../utils/cn'

/**
 * An orange "F" beside a value that is forced: the program no longer decides it until the force is released.
 * Shown wherever the value is shown online (contacts, coils, variables, block pins, the watch table).
 */
const ForcedMarker = ({ className }: { className?: string }) => (
  <span
    role='status'
    title='Forced: the program cannot change this value until the force is released'
    aria-label='Forced'
    className={cn(
      'pointer-events-none inline-flex h-[14px] min-w-[14px] shrink-0 select-none items-center justify-center rounded-sm',
      'bg-orange-500 px-0.5 text-[10px] font-bold leading-none text-white',
      className,
    )}
  >
    F
  </span>
)

export { ForcedMarker }
