import * as Popover from '@radix-ui/react-popover'

import { useRevealInProject } from '../../../hooks/use-reveal-in-project'
import type { RootState } from '../../../store'
import { useOpenPLCStoreApi } from '../../../store'
import type { RevealTarget } from '../../../store/slices/search/types'
import { cn } from '../../../utils/cn'
import { GLOBAL_CONFIG_NAME } from '../../../utils/debug-variable-finder'
import type { XrefProject } from '../../../utils/project-xref'
import { buildProjectXref, findXrefUses, GLOBAL_OWNER, resolveXrefTarget } from '../../../utils/project-xref'

export function xrefProjectOf(state: RootState): XrefProject {
  return {
    pous: state.project.data.pous,
    ladderFlows: state.ladderFlows,
    fbdFlows: state.fbdFlows,
    globalVariables: state.project.data.configurations.resource.globalVariables,
    globalVariableLists: state.project.data.globalVariableLists,
  }
}

/**
 * Where a name written in `pou` is declared: the global's row (configuration or global variable list) or
 * the declaring POU's variable table row. Undefined when the name is no variable.
 */
export function declarationTargetOf(state: RootState, pou: string | undefined, expression: string): RevealTarget | undefined {
  const project = xrefProjectOf(state)
  const target = resolveXrefTarget(project, pou, expression)
  if (!target) return undefined
  const declarations = findXrefUses(buildProjectXref(project), { ...target, path: target.root.toUpperCase() }).filter(
    (use) => use.access === 'declaration' && (target.owner === GLOBAL_OWNER ? use.pou === undefined : use.pou === target.owner),
  )
  const declaration = declarations[0]
  if (!declaration) return undefined
  return declaration.pou === undefined
    ? { kind: 'globals', variable: declaration.expression, list: declaration.list }
    : { kind: 'pou', pou: declaration.pou, variable: declaration.expression }
}

/**
 * The POU and name a debug composite key stands for: `Config0:levelLimit.Trip` is the global
 * `levelLimit.Trip`, `PUMP:dryRun` is `dryRun` in PUMP.
 */
export function xrefOfDebugKey(compositeKey: string): { pou: string | undefined; expression: string } {
  const colon = compositeKey.indexOf(':')
  const prefix = compositeKey.slice(0, colon)
  return { pou: prefix === GLOBAL_CONFIG_NAME ? undefined : prefix, expression: compositeKey.slice(colon + 1) }
}

type XrefMenuItemsProps = {
  /** The POU the name is written in; undefined for a global's name. */
  pou: string | undefined
  /** The name as the element writes it (`levelLimit.Trip`); nothing is offered without one. */
  expression: string | undefined
  /** Close the menu after the click. */
  onDone: () => void
  /** The items open the menu (nothing above them). */
  first?: boolean
}

const itemClass = 'flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'

/**
 * "Find references" and "Go to declaration" in an element's menu, offline and online: the Cross references
 * panel for what the element names, and the row that declares it.
 */
const XrefMenuItems = ({ pou, expression, onDone, first = false }: XrefMenuItemsProps) => {
  const store = useOpenPLCStoreApi()
  const reveal = useRevealInProject()
  if (!expression?.trim()) return null
  // A literal, a function's temporary, a name nothing declares: nothing to look for.
  if (!resolveXrefTarget(xrefProjectOf(store.getState()), pou, expression)) return null
  const declaration = declarationTargetOf(store.getState(), pou, expression)
  return (
    <>
      <div
        className={cn(itemClass, first ? 'rounded-t-lg' : 'border-t border-neutral-200 dark:border-neutral-800')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          store.getState().searchActions.showCrossReferences({ pou, expression: expression.trim() })
          onDone()
        }}
      >
        <p>Find references</p>
      </div>
      {declaration && (
        <div
          className={cn(itemClass, 'rounded-b-lg')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            reveal(declaration)
            onDone()
          }}
        >
          <p>Go to declaration</p>
        </div>
      )}
    </>
  )
}

/**
 * A right-click menu holding only Find references / Go to declaration, for elements without a menu of their
 * own (blocks: their instance).
 */
const XrefContextMenu = ({
  position,
  onClose,
  pou,
  expression,
}: {
  position: { x: number; y: number } | null
  onClose: () => void
  pou: string | undefined
  expression: string | undefined
}) => {
  if (!position) return null
  return (
    <Popover.Root open onOpenChange={(open) => !open && onClose()}>
      <Popover.Portal>
        <Popover.Content
          className={cn(
            'box z-[100] flex h-fit w-fit min-w-32 flex-col rounded-lg text-xs',
            'focus:outline-none focus-visible:outline-none',
            'bg-white text-neutral-1000 dark:bg-neutral-950 dark:text-neutral-300',
          )}
          style={{ position: 'fixed', left: `${position.x}px`, top: `${position.y}px` }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <XrefMenuItems pou={pou} expression={expression} onDone={onClose} first />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { XrefContextMenu, XrefMenuItems }
