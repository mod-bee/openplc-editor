import { useCallback, useMemo } from 'react'

import { useOpenPLCStore } from '../store'
import {
  buildReferenceCompositeKey,
  canonicalCompositeKey,
  compositeKeyIndex,
  externalNamesOf,
} from '../utils/debug-variable-finder'

/**
 * Hook that returns a memoized function to build composite keys for debug variable lookups.
 * Handles both program POUs (simple `pouName:variableName` format) and function block POUs
 * (resolved to `programName:fbVariableName.variableName` using the selected FB instance context).
 *
 * Uses targeted Zustand selectors so it only re-renders when the active editor,
 * the current POU's type, or the selected FB instance changes — not on every
 * unrelated project or workspace mutation.
 */
export const useDebugCompositeKey = () => {
  const editorName = useOpenPLCStore(useCallback((s) => s.editor.meta.name, []))
  const pouType = useOpenPLCStore(
    useCallback((s) => s.project.data.pous.find((p) => p.name === s.editor.meta.name)?.pouType, []),
  )
  const variables = useOpenPLCStore(
    useCallback((s) => s.project.data.pous.find((p) => p.name === s.editor.meta.name)?.interface?.variables, []),
  )
  // A reference to one of the POU's VAR_EXTERNALs is the shared global, keyed as the poller keys it.
  const externals = useMemo(() => externalNamesOf(variables ?? []), [variables])
  // The debug tree's keys, so a name spelled in another case reads the same value (IEC names are
  // case-insensitive). Rebuilt only when a debug session builds its tree.
  const debugVariableIndexes = useOpenPLCStore(useCallback((s) => s.workspace.debugVariableIndexes, []))
  const keyIndex = useMemo(() => compositeKeyIndex(debugVariableIndexes.keys()), [debugVariableIndexes])
  const fbSelectedInstance = useOpenPLCStore(useCallback((s) => s.workspace.fbSelectedInstance, []))
  const fbDebugInstances = useOpenPLCStore(useCallback((s) => s.workspace.fbDebugInstances, []))

  const fbInstanceContext = useMemo(() => {
    if (pouType !== 'function-block') return null
    const fbTypeKey = editorName.toUpperCase()
    const selectedKey = fbSelectedInstance.get(fbTypeKey)
    if (!selectedKey) return null
    const instances = fbDebugInstances.get(fbTypeKey) || []
    return instances.find((inst) => inst.key === selectedKey) || null
  }, [pouType, editorName, fbSelectedInstance, fbDebugInstances])

  const getCompositeKey = useCallback(
    (variableName: string): string => {
      const localPrefix = fbInstanceContext
        ? `${fbInstanceContext.programName}:${fbInstanceContext.fbVariableName}.`
        : `${editorName}:`
      return canonicalCompositeKey(keyIndex, buildReferenceCompositeKey(externals, localPrefix, variableName))
    },
    [fbInstanceContext, editorName, externals, keyIndex],
  )

  return getCompositeKey
}
