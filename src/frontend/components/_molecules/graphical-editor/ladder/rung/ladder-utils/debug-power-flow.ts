/**
 * Debug power-flow evaluation for one ladder rung.
 *
 * During a debug session the editor colours energized wires green. That means
 * answering, per edge, "is power reaching here?" — which is a pure walk over
 * the rung's nodes and edges plus the live boolean values.
 *
 * Extracted from `body.tsx` so it can be tested without dragging the whole
 * component tree (and its ESM-only LSP dependency) into the test runner.
 */

import type { RungLadderState } from '../../../../../../store/slices/ladder'
import { blockPinVariableName, isTrueValue } from '../../../../../../utils/debug-pin-values'
import { edgeTriggerInstanceName, edgeTriggerTypeForVariant } from '../../../../../../utils/PLC/edge-trigger-instance'

export type LadderDebugContext = {
  isFunctionBlockPou: boolean
  hasProgramInstance: boolean
  getCompositeKey: (variableName: string) => string
  boolValues: Map<string, string>
}

export type RungDebugStates = {
  edgeStates: Map<string, boolean>
  nodeInputStates: Map<string, boolean>
}

export const computeRungDebugStates = (
  nodes: RungLadderState['nodes'],
  edges: RungLadderState['edges'],
  ctx: LadderDebugContext,
): RungDebugStates => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const edgesByTarget = new Map<string, RungLadderState['edges']>()
  for (const edge of edges) {
    const list = edgesByTarget.get(edge.target)
    if (list) list.push(edge)
    else edgesByTarget.set(edge.target, [edge])
  }

  /** Whether power reaches a block's EN pin. */
  const enState = (blockId: string): boolean =>
    (edgesByTarget.get(blockId) ?? []).some(
      (edge) => edge.targetHandle?.toUpperCase() === 'EN' && determineEdgeState(edge.id),
    )

  const getNodeOutputState = (
    nodeId: string,
    sourceHandle: string | null | undefined,
    isInputGreen: boolean,
  ): boolean | undefined => {
    const node = nodeById.get(nodeId)
    if (!node) return undefined

    if (node.type === 'powerRail') {
      return (node.data as { variant: 'left' | 'right' }).variant === 'left'
    }

    if (node.type === 'parallel') {
      return isInputGreen
    }

    if (node.type === 'contact') {
      const contactData = node.data as { variable?: { name: string }; variant: string; numericId?: string }
      const variableName = contactData.variable?.name
      if (!variableName) return undefined

      // An edge contact passes the trigger's pulse, not the variable's level.
      const edgeTriggerType = edgeTriggerTypeForVariant(contactData.variant)
      const edgeTriggerName = edgeTriggerType ? edgeTriggerInstanceName(edgeTriggerType, contactData.numericId) : null
      if (edgeTriggerType && !edgeTriggerName) return undefined

      const compositeKey = ctx.getCompositeKey(edgeTriggerName ? `${edgeTriggerName}.Q` : variableName)
      const value = ctx.boolValues.get(compositeKey)
      if (value === undefined) return undefined

      const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
      const contactState = contactData.variant === 'negated' ? !isTrue : isTrue

      return isInputGreen && contactState
    }

    if (node.type === 'coil') {
      return isInputGreen
    }

    // Execute ("ST Block") conducts rung power straight through: its ENO is
    // its EN, same as a coil. Without this the power-flow highlight stops
    // dead at the box during debug even though the rung really does energize
    // whatever follows it.
    if (node.type === 'execute') {
      return isInputGreen
    }

    if (node.type === 'block') {
      const blockData = node.data as Parameters<typeof blockPinVariableName>[0]
      if (!sourceHandle) return undefined

      if (!ctx.isFunctionBlockPou && !ctx.hasProgramInstance) return undefined

      const pinName = blockPinVariableName(blockData, sourceHandle, 'output')
      const value = pinName === undefined ? undefined : isTrueValue(ctx.boolValues.get(ctx.getCompositeKey(pinName)))
      if (value !== undefined) return value

      // ENO mirrors EN at every call (STruC++ emits it so, and keeps no debug value for it): the
      // block's ENO is energized exactly when its EN is.
      if (sourceHandle.toUpperCase() === 'ENO') return enState(nodeId)
      return undefined
    }

    // An element on a block's input pin feeds the wire into the pin: a BOOL variable with its own value,
    // TRUE / FALSE written out, or else the value the block holds at that pin (an empty pin, a constant).
    if (node.type === 'variable') {
      const variableData = node.data as {
        variant?: string
        variable?: { name?: string }
        block?: { id?: string; handleId?: string }
      }
      if (variableData.variant !== 'input') return undefined
      const name = variableData.variable?.name?.trim() ?? ''
      if (/^(TRUE|FALSE)$/i.test(name)) return name.toUpperCase() === 'TRUE'
      const own = name ? isTrueValue(ctx.boolValues.get(ctx.getCompositeKey(name))) : undefined
      if (own !== undefined) return own
      const block = variableData.block?.id ? nodeById.get(variableData.block.id) : undefined
      const handle = variableData.block?.handleId
      if (!block || !handle) return undefined
      const pinName = blockPinVariableName(block.data as Parameters<typeof blockPinVariableName>[0], handle, 'input')
      return pinName === undefined ? undefined : isTrueValue(ctx.boolValues.get(ctx.getCompositeKey(pinName)))
    }

    return undefined
  }

  const edgeStates = new Map<string, boolean>()
  // Ids on the current recursion stack. A rung the editor builds is acyclic,
  // but an imported or hand-edited file can close a loop, and re-entering one
  // recurses until the stack gives out. A cycle reaches no rail, so the
  // re-entry is dead.
  const edgesInProgress = new Set<string>()

  const determineEdgeState = (edgeId: string): boolean => {
    const cached = edgeStates.get(edgeId)
    if (cached !== undefined) return cached
    if (edgesInProgress.has(edgeId)) return false

    const edge = edgeById.get(edgeId)
    if (!edge) return false

    edgesInProgress.add(edgeId)
    try {
      const incomingEdges = edgesByTarget.get(edge.source) ?? []

      let isInputGreen = false
      if (incomingEdges.length === 0) {
        const sourceNode = nodeById.get(edge.source)
        isInputGreen = sourceNode?.type === 'powerRail' && (sourceNode.data as { variant: string }).variant === 'left'
      } else {
        isInputGreen = incomingEdges.some((incomingEdge) => determineEdgeState(incomingEdge.id))
      }

      const sourceOutputState = getNodeOutputState(edge.source, edge.sourceHandle, isInputGreen)

      const isGreen = sourceOutputState === true
      edgeStates.set(edgeId, isGreen)
      return isGreen
    } finally {
      edgesInProgress.delete(edgeId)
    }
  }

  edges.forEach((edge) => {
    determineEdgeState(edge.id)
  })

  const nodeInputStates = new Map<string, boolean>()
  const nodesInProgress = new Set<string>()

  const determineNodeInputState = (nodeId: string): boolean => {
    const cached = nodeInputStates.get(nodeId)
    if (cached !== undefined) return cached
    if (nodesInProgress.has(nodeId)) return false

    const node = nodeById.get(nodeId)
    if (!node) return false

    if (node.type === 'powerRail' && (node.data as { variant: string }).variant === 'left') {
      nodeInputStates.set(nodeId, true)
      return true
    }

    const incomingEdges = edgesByTarget.get(nodeId) ?? []

    if (incomingEdges.length === 0) {
      nodeInputStates.set(nodeId, false)
      return false
    }

    nodesInProgress.add(nodeId)
    try {
      const hasGreenInput = incomingEdges.some((incomingEdge) => {
        const sourceInputGreen = determineNodeInputState(incomingEdge.source)
        const sourceOutputGreen = getNodeOutputState(incomingEdge.source, incomingEdge.sourceHandle, sourceInputGreen)
        return sourceOutputGreen === true
      })

      nodeInputStates.set(nodeId, hasGreenInput)
      return hasGreenInput
    } finally {
      nodesInProgress.delete(nodeId)
    }
  }

  nodes.forEach((node) => {
    determineNodeInputState(node.id)
  })

  return { edgeStates, nodeInputStates }
}
