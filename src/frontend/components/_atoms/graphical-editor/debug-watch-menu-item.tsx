import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'

type DebugWatchMenuItemProps = {
  /** What the element reads online; nothing is offered without one. */
  compositeKey: string | undefined
  /** Close the menu after the click. */
  onDone: () => void
  /** The item is the first in its menu (no force items above it). */
  first?: boolean
}

/**
 * "Watch" / "Unwatch" in an element's online menu (contact, coil, variable): adds exactly what the element
 * reads to the project's watch list (`debugger/watch.json`), which the debugger's watch table shows.
 */
const DebugWatchMenuItem = ({ compositeKey, onDone, first = false }: DebugWatchMenuItemProps) => {
  const watched = useOpenPLCStore((state) =>
    compositeKey === undefined ? false : state.workspace.debugWatchList.includes(compositeKey),
  )
  const addDebugWatch = useOpenPLCStore((state) => state.workspaceActions.addDebugWatch)
  const removeDebugWatch = useOpenPLCStore((state) => state.workspaceActions.removeDebugWatch)
  if (compositeKey === undefined) return null
  return (
    <div
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900',
        first ? 'rounded-lg' : 'rounded-b-lg border-t border-neutral-200 dark:border-neutral-800',
      )}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (watched) removeDebugWatch(compositeKey)
        else addDebugWatch(compositeKey)
        onDone()
      }}
    >
      <p>{watched ? 'Unwatch' : 'Watch'}</p>
    </div>
  )
}

export { DebugWatchMenuItem }
