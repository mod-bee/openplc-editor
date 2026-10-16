import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { DebugTreeNode } from '../../../../middleware/shared/ports/types'
import ViewIcon from '../../../assets/icons/interface/View'
import ZapIcon from '../../../assets/icons/interface/Zap'
import { cn } from '../../../utils/cn'
import { canForceDebugLeaf, forcedStateOf } from '../../../utils/inout-force'
import { isForcedValueHigh } from '../../../utils/variable-sizes'
import { TreeNode } from '../../_atoms/debug-tree-node'
import { XrefMenuItems,xrefOfDebugKey } from '../../_atoms/graphical-editor/xref-menu-items'
import { ForceValueDialog } from '../force-value-dialog'

type Variable = {
  name: string
  type: string
  value?: string
  compositeKey: string
}

type VariablePanelProps = {
  /** The project's watch list (`debugger/watch.json`): its items are root rows with a remove button. */
  watchList?: string[]
  onWatch?: (compositeKey: string) => void
  onUnwatch?: (compositeKey: string) => void
  onClearWatch?: () => void
  variables?: Variable[]
  variableTree?: Map<string, DebugTreeNode>
  graphList?: string[]
  setGraphList: React.Dispatch<React.SetStateAction<string[]>>
  debugBoolValues?: Map<string, string>
  debugNonBoolValues?: Map<string, string>
  debugVariableIndexes?: Map<string, number>
  debugForcedVariables?: Map<string, boolean>
  debugExpandedNodes?: Map<string, boolean>
  onToggleExpandedNode?: (compositeKey: string) => void
  isDebuggerVisible?: boolean
  onForceVariable?: (
    compositeKey: string,
    variableType: string,
    value?: boolean,
    valueBuffer?: Uint8Array,
    lookupKey?: string,
  ) => Promise<void>
}

/**
 * Simple portal-based context menu that positions at click coordinates
 * and dismisses on outside click. Replaces Radix Popover which doesn't
 * work reliably without a Trigger element in browser environments.
 */
const ContextMenu = ({
  position,
  onClose,
  children,
}: {
  position: { x: number; y: number }
  onClose: () => void
  children: React.ReactNode
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Defer listener so the opening click doesn't immediately dismiss
    const frame = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handlePointerDown)
    })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        'box z-[100] flex h-fit w-fit min-w-32 flex-col rounded-lg text-xs',
        'bg-white text-neutral-1000 dark:bg-neutral-950 dark:text-neutral-300',
      )}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

const VariablesPanel = ({
  variables,
  variableTree,
  setGraphList,
  graphList,
  debugBoolValues,
  debugNonBoolValues,
  debugVariableIndexes,
  debugForcedVariables,
  debugExpandedNodes,
  onToggleExpandedNode,
  isDebuggerVisible,
  onForceVariable,
  watchList,
  onWatch,
  onUnwatch,
  onClearWatch,
}: VariablePanelProps) => {
  const expandedNodes = debugExpandedNodes ?? new Map<string, boolean>()
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean
    compositeKey: string
    lookupKey: string
    variableType: string
    enumValues?: string[]
    enumCodes?: number[]
    position: { x: number; y: number }
    /** The row can be forced (a leaf the runtime accepts a force for); watching is offered on every row. */
    canForce: boolean
  } | null>(null)
  const [forceValueModalOpen, setForceValueModalOpen] = useState<boolean>(false)
  const [pendingForceContext, setPendingForceContext] = useState<{
    compositeKey: string
    lookupKey: string
    variableType: string
    enumValues?: string[]
    enumCodes?: number[]
  } | null>(null)

  const getValue = (compositeKey: string): string | undefined => {
    return debugBoolValues?.get(compositeKey) ?? debugNonBoolValues?.get(compositeKey)
  }

  const toggleGraphVisibility = (variableName: string) => {
    setGraphList((prevGraphList) => {
      if (prevGraphList.includes(variableName)) {
        return prevGraphList.filter((name) => name !== variableName)
      } else {
        return [...prevGraphList, variableName]
      }
    })
  }

  const handleToggleExpand = (compositeKey: string) => {
    if (onToggleExpandedNode) {
      onToggleExpandedNode(compositeKey)
    }
  }

  const updateNodeExpansion = (node: DebugTreeNode): DebugTreeNode => {
    const isExpanded = expandedNodes.get(node.compositeKey) ?? false
    return {
      ...node,
      isExpanded,
      children: node.children?.map(updateNodeExpansion),
    }
  }

  const isViewingPredicate = useCallback(
    (compositeKey: string) => {
      return graphList?.includes(compositeKey) ?? false
    },
    [graphList],
  )

  // Under this name or another one at the same address (a global in each program, an in-out bound to it).
  const forcedState = useCallback(
    (compositeKey: string) =>
      forcedStateOf(debugForcedVariables ?? new Map(), debugVariableIndexes ?? new Map(), compositeKey),
    [debugForcedVariables, debugVariableIndexes],
  )

  const isForcedPredicate = useCallback((compositeKey: string) => forcedState(compositeKey).isForced, [forcedState])

  const getForcedValue = useCallback((compositeKey: string) => forcedState(compositeKey).forcedValue, [forcedState])

  const canForceVariable = useCallback(
    (node: DebugTreeNode) => {
      if (!isDebuggerVisible || node.isComplex) return false
      // A CONSTANT, an array element stored without a forcing wrapper (`raw`),
      // or a function-block in-out whose variable cannot be named, is watched
      // but never forced (inout-force.ts).
      const leafIndex =
        node.debugIndex ?? debugVariableIndexes?.get(node.fullPath) ?? debugVariableIndexes?.get(node.compositeKey)
      if (!canForceDebugLeaf(leafIndex)) return false
      if (node.debugIndex !== undefined) return true
      return (
        (debugVariableIndexes?.has(node.fullPath) ?? false) || (debugVariableIndexes?.has(node.compositeKey) ?? false)
      )
    },
    [isDebuggerVisible, debugVariableIndexes],
  )

  const handleRowClick = useCallback(
    (node: DebugTreeNode, position: { x: number; y: number }) => {
      const canForce = canForceVariable(node)
      if (!canForce && !onWatch && !onUnwatch) return

      const lookupKey = node.debugIndex !== undefined ? node.fullPath : node.compositeKey

      setContextMenuState({
        isOpen: true,
        compositeKey: node.compositeKey,
        lookupKey,
        variableType: node.type,
        enumValues: node.enumValues,
        enumCodes: node.enumCodes,
        position,
        canForce,
      })
    },
    [canForceVariable, onWatch, onUnwatch],
  )

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuState(null)
  }, [])

  const handleForceTrue = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (contextMenuState && onForceVariable) {
        void onForceVariable(contextMenuState.compositeKey, 'BOOL', true, undefined, contextMenuState.lookupKey)
      }
      handleCloseContextMenu()
    },
    [contextMenuState, onForceVariable, handleCloseContextMenu],
  )

  const handleForceFalse = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (contextMenuState && onForceVariable) {
        void onForceVariable(contextMenuState.compositeKey, 'BOOL', false, undefined, contextMenuState.lookupKey)
      }
      handleCloseContextMenu()
    },
    [contextMenuState, onForceVariable, handleCloseContextMenu],
  )

  const handleReleaseForce = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (contextMenuState && onForceVariable) {
        void onForceVariable(
          contextMenuState.compositeKey,
          contextMenuState.variableType,
          undefined,
          undefined,
          contextMenuState.lookupKey,
        )
      }
      handleCloseContextMenu()
    },
    [contextMenuState, onForceVariable, handleCloseContextMenu],
  )

  const handleForceValue = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (contextMenuState) {
        setPendingForceContext({
          compositeKey: contextMenuState.compositeKey,
          lookupKey: contextMenuState.lookupKey,
          variableType: contextMenuState.variableType,
          enumValues: contextMenuState.enumValues,
          enumCodes: contextMenuState.enumCodes,
        })
      }
      handleCloseContextMenu()
      setForceValueModalOpen(true)
    },
    [contextMenuState, handleCloseContextMenu],
  )




  const renderTreeView = () => {
    if (!variableTree || variableTree.size === 0) return null

    const rootNodes = Array.from(variableTree.values()).map(updateNodeExpansion)

    return (
      <div className='flex h-full flex-col overflow-auto whitespace-nowrap'>
        {rootNodes.map((node) => (
          <TreeNode
            key={node.compositeKey}
            node={node}
            onToggleExpand={handleToggleExpand}
            onViewToggle={toggleGraphVisibility}
            isViewing={isViewingPredicate}
            getValue={getValue}
            isForced={isForcedPredicate}
            getForcedValue={getForcedValue}
            canForce={canForceVariable}
            onRowClick={handleRowClick}
            onRemove={onUnwatch && watchList?.includes(node.compositeKey) ? onUnwatch : undefined}
          />
        ))}
      </div>
    )
  }

  const renderFlatView = () => {
    if (!variables || variables.length === 0) return null

    return (
      <div className='flex h-full flex-col gap-2 overflow-auto whitespace-nowrap'>
        {variables.map((variable) => {
          const isForced = isForcedPredicate(variable.compositeKey)
          const forcedVal = getForcedValue(variable.compositeKey)

          const nodeForFlat: DebugTreeNode = {
            name: variable.name,
            fullPath: variable.compositeKey,
            compositeKey: variable.compositeKey,
            type: variable.type,
            isComplex: false,
            debugIndex: debugVariableIndexes?.get(variable.compositeKey),
          }

          const canForce = canForceVariable(nodeForFlat)

          const textColor = isForced ? (forcedVal ? '#80C000' : '#4080FF') : undefined

          return (
            <div key={variable.compositeKey} className='flex h-auto w-full items-center gap-2'>
              <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                <ViewIcon
                  type='button'
                  className='h-4 w-4 cursor-pointer'
                  stroke={graphList?.includes(variable.compositeKey) ? '#7C3AED' : '#B4D0FE'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleGraphVisibility(variable.compositeKey)
                  }}
                />
              </div>
              <div
                className={`grid min-w-0 flex-1 grid-cols-[1fr_auto_auto] items-center gap-2 ${
                  canForce ? 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-850' : ''
                }`}
                onClick={(e) => {
                  if (canForce) {
                    handleRowClick(nodeForFlat, { x: e.clientX, y: e.clientY })
                  }
                }}
              >
                <div className='flex min-w-0 items-center gap-2'>
                  <p
                    className='truncate text-neutral-1000 dark:text-white'
                    style={{
                      color: textColor,
                      fontWeight: isForced ? 600 : undefined,
                    }}
                  >
                    {variable.name}
                  </p>
                </div>
                <p className='uppercase text-neutral-400 dark:text-neutral-700'>{variable.type}</p>
                <p
                  className='text-neutral-1000 dark:text-white'
                  style={{
                    color: textColor,
                    fontWeight: isForced ? 600 : undefined,
                  }}
                >
                  {variable.value || '0'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const isBoolVariable = contextMenuState?.variableType.toUpperCase() === 'BOOL'
  const isForced = contextMenuState ? isForcedPredicate(contextMenuState.compositeKey) : false

  return (
    <>
      <div className='flex h-full w-full min-w-52 flex-col gap-2 overflow-hidden rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-sm font-medium text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex h-7 w-[90px] select-none items-center gap-1 rounded-lg bg-neutral-100 p-1 text-cp-sm dark:bg-brand-dark'>
            <ZapIcon className='h-4 w-4' />
            <p>Variables</p>
          </div>
          {onClearWatch && (watchList?.length ?? 0) > 0 && (
            <button
              type='button'
              onClick={onClearWatch}
              className='h-7 rounded-md px-2 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-850 dark:text-neutral-400 dark:hover:bg-neutral-850 dark:hover:text-white'
              title='Remove every item from the watch list'
            >
              Clear watch list
            </button>
          )}
        </div>
        {variableTree && variableTree.size > 0 ? renderTreeView() : renderFlatView()}
      </div>

      {isDebuggerVisible && contextMenuState && (
        <ContextMenu position={contextMenuState.position} onClose={handleCloseContextMenu}>
          {!contextMenuState.canForce ? null : isBoolVariable ? (
            <>
              <div
                className='flex w-full cursor-pointer items-center gap-2 rounded-t-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                onClick={(e) => void handleForceTrue(e)}
              >
                <p>Force True</p>
              </div>
              <div
                className='flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                onClick={(e) => void handleForceFalse(e)}
              >
                <p>Force False</p>
              </div>
              {isForced && (
                <div
                  className='flex w-full cursor-pointer items-center gap-2 rounded-b-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  onClick={(e) => void handleReleaseForce(e)}
                >
                  <p>Release Force</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div
                className='flex w-full cursor-pointer items-center gap-2 rounded-t-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                onClick={(e) => void handleForceValue(e)}
              >
                <p>Force Value</p>
              </div>
              {isForced && (
                <div
                  className='flex w-full cursor-pointer items-center gap-2 rounded-b-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  onClick={(e) => void handleReleaseForce(e)}
                >
                  <p>Release Force</p>
                </div>
              )}
            </>
          )}
          {(() => {
            const watched = watchList?.includes(contextMenuState.compositeKey) ?? false
            const action = watched ? onUnwatch : onWatch
            if (!action) return null
            return (
              <div
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900',
                  contextMenuState.canForce
                    ? 'rounded-b-lg border-t border-neutral-200 dark:border-neutral-800'
                    : 'rounded-lg',
                )}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  action(contextMenuState.compositeKey)
                  handleCloseContextMenu()
                }}
              >
                <p>{watched ? 'Unwatch' : 'Watch'}</p>
              </div>
            )
          })()}
          <XrefMenuItems {...xrefOfDebugKey(contextMenuState.compositeKey)} onDone={handleCloseContextMenu} />
        </ContextMenu>
      )}

      <ForceValueDialog
        open={forceValueModalOpen && pendingForceContext !== null}
        onOpenChange={(open) => {
          setForceValueModalOpen(open)
          if (!open) setPendingForceContext(null)
        }}
        name={(pendingForceContext?.compositeKey ?? '').split(':').slice(1).join(':')}
        type={pendingForceContext?.variableType ?? ''}
        currentValue={pendingForceContext ? getValue(pendingForceContext.compositeKey) : undefined}
        enumValues={pendingForceContext?.enumValues}
        enumCodes={pendingForceContext?.enumCodes}
        onForce={async (value, text) => {
          if (!pendingForceContext || !onForceVariable) return
          await onForceVariable(
            pendingForceContext.compositeKey,
            pendingForceContext.variableType,
            isForcedValueHigh(text),
            value,
            pendingForceContext.lookupKey,
          )
        }}
      />
    </>
  )
}

export { VariablesPanel }
