import * as Popover from '@radix-ui/react-popover'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { PLCVariable } from '../../../../../middleware/shared/ports'
import { useDebugger } from '../../../../../middleware/shared/providers'
import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import { useDebugDisplayOptions } from '../../../../hooks/use-debug-display-options'
import { useDebugValue, useDebugVariableType, useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { REVEAL_HIGHLIGHT, useRevealHighlight } from '../../../../hooks/use-reveal-highlight'
import { forceDebugVariable, releaseDebugVariable } from '../../../../services/debug-force-variable'
import { resolveScopeExpressionType } from '../../../../services/graphical-scope'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../../store'
import { RungLadderState } from '../../../../store/slices/ladder'
import { cn } from '../../../../utils/cn'
import { blockPinVariableName } from '../../../../utils/debug-pin-values'
import { canForceDebugLeaf } from '../../../../utils/inout-force'
import { getLiteralType } from '../../../../utils/keywords'
import { isForcedValueHigh } from '../../../../utils/variable-sizes'
import { useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { ForceValueDialog } from '../../../_molecules/force-value-dialog'
import { DebugInOutNote } from '../../debug-inout-note'
import { ForcedMarker } from '../../forced-marker'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { DebugValuePill } from '../debug-value-pill'
import { DebugWatchMenuItem } from '../debug-watch-menu-item'
import { XrefMenuItems } from '../xref-menu-items'
import { VariablesBlockAutoComplete } from './autocomplete'
import { CustomHandle } from './handle'
import { getLadderPouVariablesRungNodeAndEdges, validateVariableType } from './utils'
import { DEFAULT_VARIABLE_HEIGHT, DEFAULT_VARIABLE_WIDTH } from './utils/constants'
import { BlockNodeData, BlockVariant, LadderBlockConnectedVariables, VariableNode, VariableProps } from './utils/types'
import { variableElementText, variableElementWidth } from './utils/variable-width'

const VariableElement = (block: VariableProps) => {
  const store = useOpenPLCStoreApi()
  const { id, data } = block
  const pouName = useBoundPou()
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const updateNode = useOpenPLCStore((state) => state.ladderFlowActions.updateNode)
  const relayoutRung = useOpenPLCStore((state) => state.ladderFlowActions.relayoutRung)
  const debugger_ = useDebugger()
  const isDebuggerVisible = useIsDebuggerVisible()
  const getCompositeKey = useDebugCompositeKey()
  const compositeKey = getCompositeKey(data.variable.name)
  // The type of a member or element, which the POU does not declare by that name (see useDebugVariableType).
  const treeType = useDebugVariableType(compositeKey)
  // The block pin this element is attached to, read when the element itself names no variable: an empty
  // pin, a literal or a constant shows the value the block holds at that pin (see blockPinVariableName).
  const ladderFlows = useOpenPLCStore((state) => state.ladderFlows)
  const { blockInputs } = useDebugDisplayOptions()
  const pinVariableName = useMemo(() => {
    const blockId = data.block?.id
    const handleId = data.block?.handleId
    if (!blockId || !handleId) return undefined
    const rung = ladderFlows.find((flow) => flow.name === pouName)?.rungs.find((r) => r.nodes.some((n) => n.id === id))
    const blockNode = rung?.nodes.find((node) => node.id === blockId)
    if (!blockNode) return undefined
    return blockPinVariableName(
      blockNode.data as Parameters<typeof blockPinVariableName>[0],
      handleId,
      data.variant === 'output' ? 'output' : 'input',
    )
  }, [ladderFlows, pouName, id, data.block?.id, data.block?.handleId, data.variant])

  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)
  const autocompleteRef = useRef<
    HTMLDivElement & {
      focus: () => void
      isFocused: boolean
      selectedVariable: { positionInArray: number; variableName: string }
      triggerSubmit?: () => void
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [forceValueModalOpen, setForceValueModalOpen] = useState<boolean>(false)

  const [variableValue, setVariableValue] = useState(data.variable.name)
  const [inputError, setInputError] = useState<boolean>(false)
  const [isAVariable, setIsAVariable] = useState<boolean>(false)
  // What this element reads, forces and watches online: its own variable, or, when it names none (an empty
  // pin, a constant, a literal), the pin it sits on (`motor.Start`), which the block keeps in its instance.
  const debugKey = isAVariable ? compositeKey : pinVariableName ? getCompositeKey(pinVariableName) : undefined
  const { isForced, forcedValue: forcedBoolValue, debugIndex, value: debugValue } = useDebugValue(debugKey ?? '')
  const debugNode = useOpenPLCStore((state) => (debugKey ? state.workspace.debugVariableTree.get(debugKey) : undefined))

  const updateRelatedNode = (rung: RungLadderState, variableNode: VariableNode, variable: PLCVariable) => {
    const relatedBlock = rung.nodes.find((node) => node.id === variableNode.data.block.id)
    if (!relatedBlock) {
      setInputError(true)
      return
    }

    const existing = Array.isArray((relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables)
      ? (relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables
      : []
    const connectedVariables: LadderBlockConnectedVariables = [
      ...existing.filter(
        (v) => v.type !== variableNode.data.variant || v.handleId !== variableNode.data.block.handleId,
      ),
      {
        handleId: variableNode.data.block.handleId,
        handleTableId: (relatedBlock.data as BlockNodeData<BlockVariant>).variant.variables.find(
          (v) => v.name === variableNode.data.block.handleId,
        )?.id,
        type: variableNode.data.variant,
        variable,
      },
    ]

    updateNode({
      editorName: pouName,
      rungId: rung.id,
      nodeId: relatedBlock.id,
      node: {
        ...relatedBlock,
        data: {
          ...relatedBlock.data,
          connectedVariables,
        },
      },
    })
  }

  /**
   * useEffect to sync variableValue with data.variable.name when it changes externally
   * (e.g., from variable rename propagation or autocomplete selection).
   * Only sync when autocomplete is closed to avoid overwriting user input while typing.
   * Note: openAutocomplete is intentionally NOT in the dependency array to prevent a race
   * condition where closing the autocomplete (before blur) would restore the old node value,
   * overwriting the user's cleared input.
   */
  useEffect(() => {
    const name = data.variable?.name ?? ''
    if (!openAutocomplete && name !== '') {
      setVariableValue(name)
    }
  }, [data.variable?.name])

  /**
   * Validate the variable node against the block pin's expected type via the
   * STruC++ LSP. The pin type may be a generic (ANY_NUM, …) and the typed
   * value may be an instance member or struct/array access the local
   * interface list can't resolve. `isAVariable` (yellow) means "not a known
   * symbol"; `inputError` (red) means "known but type-incompatible".
   */
  useEffect(() => {
    const name = data.variable?.name?.trim() ?? ''
    if (!name) {
      setIsAVariable(false)
      setInputError(false)
      return
    }
    let cancelled = false
    void resolveScopeExpressionType(pouName, name).then((res) => {
      if (cancelled) return
      // Leave the current state untouched while the LSP is still warming so
      // we never flash a false error/warning during boot.
      if (res.status === 'unavailable') return
      if (res.status === 'unknown') {
        setIsAVariable(false)
        setInputError(false)
        return
      }
      setIsAVariable(true)
      setInputError(!validateVariableType(res.type, data.block.variableType).isValid)
    })
    return () => {
      cancelled = true
    }
  }, [pous, pouName, data.variable?.name, data.block.variableType.type.value])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValueOnTextareaBlur = (currentValue?: string) => {
    const variableNameToSubmit = currentValue ?? variableValue

    const { project, ladderFlows } = store.getState()
    const { pou, rung, node } = getLadderPouVariablesRungNodeAndEdges(pouName, project.data.pous, ladderFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return
    const variableNode = node as VariableNode

    // Allow clearing a variable from a block handle by submitting an empty name.
    // This resets the variable node so a branch (contacts/coils) can be placed instead.
    if (!variableNameToSubmit.trim()) {
      const emptyVariable = { id: '', name: '' }
      setVariableValue('')
      setIsAVariable(false)
      setInputError(false)
      updateNode({
        editorName: pouName,
        rungId: rung.id,
        nodeId: variableNode.id,
        node: {
          ...variableNode,
          data: {
            ...variableNode.data,
            variable: emptyVariable,
          },
        },
      })
      updateRelatedNode(rung, variableNode, emptyVariable as PLCVariable)
      relayoutRung({ editorName: pouName, rungId: rung.id })
      return
    }

    // For variable nodes (block pins), allow all types including derived (user-defined types)
    // Don't use getVariableByName here as it filters out derived types
    let variable: PLCVariable | { name: string } | undefined = (pou.interface?.variables ?? []).find(
      (v) => v.name.toLowerCase() === variableNameToSubmit.toLowerCase(),
    )
    const literalTypes = getLiteralType(variableNameToSubmit)
    if (variable) {
      setIsAVariable(true)
      setInputError(false)
    } else if (literalTypes) {
      setIsAVariable(false)
      const mismatchType = !literalTypes.includes(data.block.variableType.type.value)
      setInputError(mismatchType)
      variable = { name: variableNameToSubmit }
    } else {
      setIsAVariable(true)
      setInputError(true)
      variable = { name: variableNameToSubmit }
    }

    updateNode({
      editorName: pouName,
      rungId: rung.id,
      nodeId: variableNode.id,
      node: {
        ...variableNode,
        data: {
          ...variableNode.data,
          variable: variable,
        },
      },
    })

    updateRelatedNode(rung, variableNode, variable as PLCVariable)
    // The block leaves room for its elements' names: a new name may stretch the wire (variable-width.ts).
    relayoutRung({ editorName: pouName, rungId: rung.id })
  }

  const onChangeHandler = () => {
    if (!openAutocomplete) {
      setOpenAutocomplete(true)
    }
  }

  const getVariableType = (): string | undefined => {
    if (!data.variable || !data.variable.name) return undefined
    const pou = pous.find((pou) => pou.name === pouName)
    if (!pou) return undefined
    const variable = (pou.interface?.variables ?? []).find(
      (v) => v.name.toLowerCase() === data.variable.name.toLowerCase(),
    )
    return variable?.type.value ?? treeType
  }

  /** The type of what `debugKey` names: the element's variable, or the pin's declared type. */
  const debugType = (): string | undefined => (isAVariable ? getVariableType() : data.block.variableType.type.value)

  const handleForceTrue = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (debugKey) await forceDebugVariable(store, debugger_, debugKey, debugIndex, new Uint8Array([1]), true)
  }

  const handleForceFalse = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (debugKey) await forceDebugVariable(store, debugger_, debugKey, debugIndex, new Uint8Array([0]), false)
  }

  const handleReleaseForce = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (debugKey) await releaseDebugVariable(store, debugger_, debugKey, debugIndex)
  }

  const handleForceValueOpen = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    setForceValueModalOpen(true)
  }




  const handleClick = (e: React.MouseEvent) => {
    if (!isDebuggerVisible || !debugKey) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }

  // Right-click, offline and online: the element's menu (Find references; online Force and Watch too).
  const xrefExpression = data.variable.name?.trim() ? data.variable.name : pinVariableName
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!xrefExpression) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }

  // Go to (a search hit, a cross reference) landed here; the block marks the pin too.
  const { revealed, pulsing: revealPulsing } = useRevealHighlight(id)

  const variableType = getVariableType()
  const isBoolVariable = debugType()?.toUpperCase() === 'BOOL'

  return (
    <>
      <div
        className='relative'
        // The node's own box, where the layout put its handle; the name is drawn from its wire end.
        style={{ width: block.width ?? DEFAULT_VARIABLE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT }}
        onClick={isDebuggerVisible ? handleClick : undefined}
        onContextMenu={handleContextMenu}
      >
        {isDebuggerVisible ? (
          /*
           * Online the element is read, not edited: the name on one line, anchored at the wire end and
           * free to grow away from the block, and the value just above the wire at its
           * pin end, so it covers neither the name nor the block's pin label. A BOOL shows no value: its
           * wire carries the colour.
           */
          <div
            className={cn(
              'absolute top-0 flex items-center whitespace-nowrap text-xs leading-3',
              data.variant === 'output' ? 'left-0' : 'right-0',
              revealed && cn(REVEAL_HIGHLIGHT, 'px-0.5'),
              revealed && revealPulsing && 'animate-pulse',
            )}
            style={{ height: DEFAULT_VARIABLE_HEIGHT }}
          >
            {data.variable.name ? (
              <span
                className={cn({
                  'text-yellow-500': !isAVariable,
                  'font-bold': isForced,
                  'text-[#80C000]': isForced && forcedBoolValue,
                  'text-[#4080FF]': isForced && !forcedBoolValue,
                })}
              >
                {data.variable.name}
              </span>
            ) : (
              <span className='text-neutral-400'>{`(*${data.block.variableType.type.value}*)`}</span>
            )}
            {isForced && <ForcedMarker className='ml-1' />}
            <DebugValuePill
              className={cn('absolute bottom-[calc(50%+7px)]', data.variant === 'output' ? 'left-0' : 'right-0')}
              compositeKey={
                isAVariable
                  ? compositeKey
                  : // An input pin's value only when the project shows block inputs; an output's always.
                    pinVariableName && (data.variant === 'output' || blockInputs)
                    ? getCompositeKey(pinVariableName)
                    : undefined
              }
              variableType={isAVariable ? variableType : data.block.variableType.type.value}
            />
          </div>
        ) : (
          // Wide enough for the name on one line (as the layout reserves room for it), grown away from
          // the block from the wire end: the node itself, and so its handle, stays where the layout put it.
          <div
            className={cn(
              'absolute top-0',
              data.variant === 'output' ? 'left-0' : 'right-0',
              revealed && REVEAL_HIGHLIGHT,
              revealed && revealPulsing && 'animate-pulse',
            )}
            style={{
              width: variableElementWidth(variableElementText(variableValue, data.block.variableType.type.value)),
              height: DEFAULT_VARIABLE_HEIGHT,
            }}
          >
            <HighlightedTextArea
              id={`variable-input-${id}`}
              textAreaClassName={cn('text-center placeholder:text-center text-xs leading-3', {
                'text-yellow-500': !isAVariable,
                'text-red-500': inputError,
                'text-left placeholder:text-left': data.variant === 'output',
                'text-right placeholder:text-right': data.variant === 'input',
                'font-bold': isForced,
                'text-[#80C000]': isForced && forcedBoolValue,
                'text-[#4080FF]': isForced && !forcedBoolValue,
              })}
              highlightClassName={cn('text-center placeholder:text-center text-xs leading-3', {
                'text-left placeholder:text-left': data.variant === 'output',
                'text-right placeholder:text-right': data.variant === 'input',
              })}
              scrollableIndicatorClassName={cn({
                '-right-3': data.variant === 'output',
                '-left-3': data.variant === 'input',
              })}
              placeholder={`(*${data.block.variableType.type.value}*)`}
              textAreaValue={variableValue}
              setTextAreaValue={setVariableValue}
              handleSubmit={handleSubmitVariableValueOnTextareaBlur}
              inputHeight={{
                height: DEFAULT_VARIABLE_HEIGHT,
                scrollLimiter: DEFAULT_VARIABLE_HEIGHT,
              }}
              ref={inputVariableRef}
              disabled={isDebuggerVisible}
              readOnly={isDebuggerVisible}
              onChange={onChangeHandler}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
                if (e.key === 'Enter' && openAutocomplete) {
                  e.preventDefault()
                  autocompleteRef.current?.triggerSubmit?.()
                  inputVariableRef.current?.blur({ submit: false })
                  return
                }
                setKeyPressedAtTextarea(e.key)
              }}
              onKeyUp={() => setKeyPressedAtTextarea('')}
            />
          </div>
        )}
        {openAutocomplete && (
          <div className='relative flex justify-center'>
            <div className='absolute -bottom-1'>
              <VariablesBlockAutoComplete
                ref={autocompleteRef}
                block={block}
                blockType={'variable'}
                valueToSearch={variableValue}
                isOpen={openAutocomplete}
                setIsOpen={(value) => setOpenAutocomplete(value)}
                keyPressed={keyPressedAtTextarea}
              />
            </div>
          </div>
        )}

        {contextMenuPosition && (
          <Popover.Root open={isContextMenuOpen} onOpenChange={setIsContextMenuOpen}>
            <Popover.Portal>
              <Popover.Content
                align='start'
                side='bottom'
                sideOffset={5}
                className={cn(
                  'box z-[100] flex h-fit w-fit min-w-32 flex-col rounded-lg text-xs',
                  'focus:outline-none focus-visible:outline-none',
                  'bg-white text-neutral-1000 dark:bg-neutral-950 dark:text-neutral-300',
                )}
                style={{
                  position: 'fixed',
                  left: `${contextMenuPosition.x}px`,
                  top: `${contextMenuPosition.y}px`,
                }}
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                {isDebuggerVisible && (
                  <>
                    <DebugInOutNote debugIndex={debugIndex} />
                    {canForceDebugLeaf(debugIndex) && (
                      <>
                        {isBoolVariable ? (
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
                              onClick={handleForceValueOpen}
                            >
                              <p>Force value...</p>
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
                      </>
                    )}
                    <DebugWatchMenuItem
                      compositeKey={debugKey}
                      onDone={() => setIsContextMenuOpen(false)}
                      first={!canForceDebugLeaf(debugIndex)}
                    />
                  </>
                )}
                <XrefMenuItems
                  pou={pouName}
                  expression={xrefExpression}
                  onDone={() => setIsContextMenuOpen(false)}
                  first={!isDebuggerVisible}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>

      <ForceValueDialog
        open={forceValueModalOpen}
        onOpenChange={setForceValueModalOpen}
        name={data.variable.name || pinVariableName || ''}
        type={debugType() ?? ''}
        currentValue={debugValue}
        enumValues={debugNode?.enumValues}
        enumCodes={debugNode?.enumCodes}
        onForce={async (value, text) => {
          if (debugKey)
            await forceDebugVariable(store, debugger_, debugKey, debugIndex, value, isForcedValueHigh(text), debugType())
        }}
      />

      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

const exportVariableElement = memo(VariableElement)

export { exportVariableElement as VariableElement }
