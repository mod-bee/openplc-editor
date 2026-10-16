/**
 * Inline debug-value badges for a Structured Text Monaco surface.
 *
 * During a debug session the first reference to each live variable on a
 * line gets an ` = <value>` badge rendered after it. The references are
 * parsed out of the text (see `findStReferences`) and resolved as the
 * diagrams resolve a name: case-insensitively, a constant subscript by its
 * value, a VAR_EXTERNAL to the shared global's `Config0:` key.
 *
 * Extracted from the POU-level Monaco editor so the graphical Execute
 * ("ST Block") element gets identical badges without duplicating the
 * scanner. The POU editor supplies its own prefix (`<pouName>:`, or an
 * instance-qualified one for function blocks); the Execute field
 * supplies the prefix of the POU that owns it.
 *
 * Comments are stripped before scanning so a variable named in a
 * comment doesn't collect a badge.
 */

import type * as monaco from 'monaco-editor'
import { type RefObject, useCallback, useEffect, useMemo } from 'react'

import { useOpenPLCStore } from '../store'
import {
  buildReferenceCompositeKey,
  compositeKeyIndex,
  externalNamesOf,
  indexConstantsOf,
  resolveConstantIndexes,
} from '../utils/debug-variable-finder'
import { type BlockCommentState, findStReferences, stripLineComments } from '../utils/st-debug-references'
import { useDebugBoolValuesMap, useDebugNonBoolValuesMap } from './use-debug-value'

export type UseStDebugDecorationsOptions = {
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>
  monacoRef: RefObject<typeof monaco | null>
  /** Composite-key prefix, e.g. `MyProgram:` or `Prog:fbInstance.`. */
  prefix: string | undefined
  /** The POU the text belongs to: its VAR_EXTERNALs are shown from the shared globals' values. */
  pouName?: string
  /** Gate — callers pass false when hidden, not debugging, or non-ST. */
  enabled: boolean
  /**
   * Any value that changes when the model's text changes, so the scan
   * re-runs. The POU editor passes Monaco's version id; simpler
   * surfaces can pass the text itself.
   */
  modelVersion: unknown
  /**
   * Optional guard: when set, decorations are skipped unless the
   * editor's model URI matches. The POU editor needs this because
   * `@monaco-editor/react` can swap models a tick after a tab change.
   */
  expectedUri?: string
}

export function useStDebugDecorations({
  editorRef,
  monacoRef,
  prefix,
  pouName,
  enabled,
  modelVersion,
  expectedUri,
}: UseStDebugDecorationsOptions): void {
  const debugBoolValues = useDebugBoolValuesMap()
  const debugNonBoolValues = useDebugNonBoolValuesMap()
  const pouVariables = useOpenPLCStore(
    useCallback((s) => s.project.data.pous.find((p) => p.name === pouName)?.interface?.variables, [pouName]),
  )
  const externals = useMemo(() => externalNamesOf(pouVariables ?? []), [pouVariables])
  const configurations = useOpenPLCStore(useCallback((s) => s.project.data.configurations, []))
  const globalVariableLists = useOpenPLCStore(useCallback((s) => s.project.data.globalVariableLists, []))
  const constants = useMemo(
    () => indexConstantsOf({ configurations, globalVariableLists }, pouVariables ?? []),
    [configurations, globalVariableLists, pouVariables],
  )

  // Cheap identity for "which variables are live", so the scan doesn't
  // re-run on every poll tick that merely changes values.
  const debugVarKeySet = useMemo(() => {
    const keys: string[] = []
    for (const key of debugBoolValues.keys()) keys.push(key)
    for (const key of debugNonBoolValues.keys()) keys.push(key)
    return keys.sort().join('\0')
  }, [debugBoolValues, debugNonBoolValues])

  const positions = useMemo(() => {
    if (!enabled || prefix === undefined) return null
    const editor = editorRef.current
    if (!editor || !monacoRef.current) return null

    const model = editor.getModel()
    if (!model) return null
    if (expectedUri !== undefined && model.uri.toString() !== expectedUri) return null

    // The live keys, by their upper-case form: IEC names are case-insensitive.
    const live = compositeKeyIndex([...debugBoolValues.keys(), ...debugNonBoolValues.keys()])
    if (live.size === 0) return null
    const resolve = (reference: string): string | undefined =>
      live.get(
        buildReferenceCompositeKey(externals, prefix, resolveConstantIndexes(reference, constants)).toUpperCase(),
      )

    const found: Array<{ key: string; line: number; startCol: number; endCol: number }> = []
    let blockCommentState: BlockCommentState = false

    for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
      const result = stripLineComments(model.getLineContent(lineNumber), blockCommentState)
      blockCommentState = result.state
      for (const span of findStReferences(result.stripped, resolve)) found.push({ ...span, line: lineNumber })
    }

    return found
    // `debugVarKeySet` stands in for the two maps' key sets; values are
    // read in the effect below, which reruns on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, prefix, externals, constants, expectedUri, debugVarKeySet, modelVersion])

  useEffect(() => {
    const editor = editorRef.current
    const monacoInstance = monacoRef.current
    if (!positions || !editor || !monacoInstance || prefix === undefined) return

    const decorations: monaco.editor.IModelDeltaDecoration[] = positions.map(({ key, line, startCol, endCol }) => ({
      range: new monacoInstance.Range(line, startCol, line, endCol),
      options: {
        after: {
          content: ` = ${debugBoolValues.get(key) ?? debugNonBoolValues.get(key) ?? '?'} `,
          inlineClassName: 'debug-inline-value',
        },
      },
    }))

    const collection = editor.createDecorationsCollection(decorations)
    return () => collection.clear()
    // `editorRef` / `monacoRef` are refs: stable identities that never
    // trigger a rerun, and re-reading them here is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, prefix, debugBoolValues, debugNonBoolValues])
}
