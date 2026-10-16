import { ComponentPropsWithoutRef } from 'react'

import type { DebugTreeNode } from '../../../../middleware/shared/ports/types'
import { ArrowIcon } from '../../../assets/icons/interface/Arrow'
import ViewIcon from '../../../assets/icons/interface/View'
import { useDebugDisplayOptions } from '../../../hooks/use-debug-display-options'
import { cn } from '../../../utils/cn'
import { formatDebugValue, HIDDEN_VALUE, isSecretValue } from '../../../utils/debug-pin-values'
import { describeInOutLeaf } from '../../../utils/inout-force'

type TreeNodeProps = ComponentPropsWithoutRef<'div'> & {
  node: DebugTreeNode
  onToggleExpand: (compositeKey: string) => void
  onViewToggle?: (compositeKey: string) => void
  isViewing?: (compositeKey: string) => boolean
  getValue?: (compositeKey: string) => string | undefined
  isForced?: (compositeKey: string) => boolean
  getForcedValue?: (compositeKey: string) => boolean | undefined
  canForce?: (node: DebugTreeNode) => boolean
  onRowClick?: (node: DebugTreeNode, position: { x: number; y: number }) => void
  level?: number
}

const TreeNode = ({
  node,
  onToggleExpand,
  onViewToggle,
  isViewing,
  getValue,
  isForced,
  getForcedValue,
  canForce,
  onRowClick,
  level = 0,
  ...rest
}: TreeNodeProps) => {
  const indentWidth = level * 16
  const isCurrentNodeViewing = isViewing ? isViewing(node.compositeKey) : false
  const isCurrentNodeForced = isForced ? isForced(node.compositeKey) : false
  const forcedValue = getForcedValue ? getForcedValue(node.compositeKey) : undefined
  const canForceNode = canForce ? canForce(node) : false

  // For root-level nodes, derive a more informative label from compositeKey
  // This shows full path for nested FB instances (e.g., "main.IRRIGATION_MAIN_CONTROLLER0.TON0")
  // while keeping short names for children (e.g., "Q", "ET", "ENO")
  const isRoot = level === 0
  // A function-block in-out: a read-only view of the variable bound to it.
  const inOutNote = describeInOutLeaf(node.debugIndex)
  let displayLabel = node.name
  if (isRoot) {
    const [pouName, path] = node.compositeKey.split(':')
    if (pouName && path) {
      displayLabel = `${pouName}.${path}`
    }
  }

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.isComplex) {
      onToggleExpand(node.compositeKey)
    }
  }

  const handleViewToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onViewToggle && !node.isComplex) {
      onViewToggle(node.compositeKey)
    }
  }

  const handleRowBodyClick = (e: React.MouseEvent) => {
    if (canForceNode && onRowClick) {
      onRowClick(node, { x: e.clientX, y: e.clientY })
    }
  }

  const textColor = isCurrentNodeForced ? (forcedValue ? '#80C000' : '#4080FF') : undefined

  // As the diagrams write it: REAL decimals and hidden passwords per the project's Debugger settings.
  const { decimals, hideSecrets } = useDebugDisplayOptions()
  const shownValue = (): string => {
    const value = getValue?.(node.compositeKey)
    if (value === undefined) return '-'
    if (hideSecrets && isSecretValue(node.compositeKey, node.type)) return HIDDEN_VALUE
    return formatDebugValue(value, node.type, decimals)
  }

  return (
    <div {...rest}>
      <div className='flex h-auto w-full items-center gap-2'>
        <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
          {node.isComplex ? (
            <button
              onClick={handleToggleExpand}
              className='flex h-4 w-4 items-center justify-center'
              aria-label={node.isExpanded ? 'Collapse' : 'Expand'}
            >
              <ArrowIcon
                direction='right'
                className={cn(
                  'h-4 w-4 stroke-brand-light transition-all',
                  node.isExpanded && 'rotate-270 stroke-brand',
                )}
              />
            </button>
          ) : onViewToggle ? (
            <button
              onClick={handleViewToggle}
              className='flex h-4 w-4 items-center justify-center'
              aria-label='Toggle graph visibility'
            >
              <ViewIcon className='h-4 w-4 cursor-pointer' stroke={isCurrentNodeViewing ? '#7C3AED' : '#B4D0FE'} />
            </button>
          ) : null}
        </div>

        <div
          className={cn(
            // In a narrow panel the type gives way first (cut short, in full on hover); the name keeps its
            // room and the value is always shown whole.
            'grid min-w-0 flex-1 grid-cols-[minmax(5rem,1fr)_minmax(0,auto)_auto] items-center gap-2 py-1',
            canForceNode && 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-850',
          )}
          style={{ paddingLeft: `${indentWidth}px` }}
          onClick={handleRowBodyClick}
        >
          <div className='flex min-w-0 items-center gap-2'>
            <p
              className='truncate text-neutral-1000 dark:text-white'
              style={{
                color: textColor,
                fontWeight: isCurrentNodeForced ? 600 : undefined,
              }}
            >
              {displayLabel}
            </p>
            {inOutNote !== undefined && (
              <span className='shrink-0 text-neutral-400 dark:text-neutral-600' title={inOutNote}>
                in-out
              </span>
            )}
          </div>
          <p className='truncate uppercase text-neutral-400 dark:text-neutral-700' title={node.type}>
            {node.type}
          </p>
          <p
            className='whitespace-nowrap text-neutral-1000 dark:text-white'
            style={{
              color: textColor,
              fontWeight: isCurrentNodeForced ? 600 : undefined,
            }}
            // A leaf the PLC keeps no value for: an interface reference names another block, not a value.
            // Otherwise the full value, for one cut short.
            title={
              node.isComplex
                ? undefined
                : node.debugIndex === undefined
                  ? 'No value to show: a reference to another block (an interface), or not compiled for debugging'
                  : shownValue()
            }
          >
            {node.isComplex && !node.isExpanded ? '...' : node.isComplex ? '' : shownValue()}
          </p>
        </div>
      </div>

      {node.isComplex && node.isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.compositeKey}
              node={child}
              onToggleExpand={onToggleExpand}
              onViewToggle={onViewToggle}
              isViewing={isViewing}
              getValue={getValue}
              isForced={isForced}
              getForcedValue={getForcedValue}
              canForce={canForce}
              onRowClick={onRowClick}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export { TreeNode }
