/**
 * Cross references: where a variable (or one member of it) is declared, read, written, called and bound,
 * across the whole project, like the cross-reference lists of CODESYS and TwinCAT. A global used through
 * VAR_EXTERNAL in several programs is one variable. A row goes to its rung and element, or its line; online
 * each row shows the live value of what it names.
 */
import { useEffect, useMemo, useState } from 'react'

import { CloseIcon } from '../../../../assets/icons/interface/Close'
import { useDebugDisplayOptions } from '../../../../hooks/use-debug-display-options'
import { useRevealInProject } from '../../../../hooks/use-reveal-in-project'
import { useOpenPLCStore } from '../../../../store'
import type { RevealTarget } from '../../../../store/slices/search/types'
import { cn } from '../../../../utils/cn'
import { formatDebugValue, HIDDEN_VALUE, isSecretValue } from '../../../../utils/debug-pin-values'
import {
  buildGlobalCompositeKey,
  canonicalCompositeKey,
  compositeKeyIndex,
  indexConstantsOf,
  resolveConstantIndexes,
} from '../../../../utils/debug-variable-finder'
import type { XrefProject, XrefTarget, XrefUse } from '../../../../utils/project-xref'
import { buildProjectXref, findXrefUses, GLOBAL_OWNER, resolveXrefTarget } from '../../../../utils/project-xref'

const ACCESS_LABEL: Record<XrefUse['access'], string> = {
  declaration: 'Declared',
  read: 'Read',
  write: 'Write',
  inout: 'In-out',
  call: 'Call',
}

const ACCESS_CLASS: Record<XrefUse['access'], string> = {
  declaration: 'text-neutral-500 dark:text-neutral-400',
  read: 'text-sky-700 dark:text-sky-400',
  write: 'text-amber-700 dark:text-amber-400',
  inout: 'text-violet-700 dark:text-violet-400',
  call: 'text-emerald-700 dark:text-emerald-400',
}

/**
 * Where Go to takes a use, and the block pin to mark there: the pin a variable is wired to, or, for a call
 * of a block whose member was asked for (`levelLimit.LoLo` at `levelLimit`'s call), that member's pin.
 */
function revealTargetOf(use: XrefUse, target?: XrefTarget): RevealTarget {
  if (use.pou === undefined) return { kind: 'globals', variable: use.expression, list: use.list }
  if (use.access === 'declaration') return { kind: 'pou', pou: use.pou, variable: use.expression }
  const member = use.access === 'call' && target ? /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(target.path.slice(use.path.length)) : null
  const pinAt = member
    ? { blockId: use.nodeId, pin: member[1] }
    : use.blockId && use.pin
      ? { blockId: use.blockId, pin: use.pin }
      : {}
  return {
    kind: 'pou',
    pou: use.pou,
    rungId: use.rungId,
    nodeId: use.nodeId,
    line: use.line,
    column: use.column,
    ...pinAt,
  }
}

function whereOf(use: XrefUse): string {
  if (use.rungIndex !== undefined) return `rung ${use.rungIndex}`
  if (use.line !== undefined) return `line ${use.line}`
  if (use.pou === undefined) return use.list ?? 'Global variables'
  return use.access === 'declaration' ? 'variables' : '—'
}

const CrossReferences = () => {
  const request = useOpenPLCStore((s) => s.xrefRequest)
  const closeCrossReferences = useOpenPLCStore((s) => s.searchActions.closeCrossReferences)
  const pous = useOpenPLCStore((s) => s.project.data.pous)
  const configurations = useOpenPLCStore((s) => s.project.data.configurations)
  const globalVariableLists = useOpenPLCStore((s) => s.project.data.globalVariableLists)
  const ladderFlows = useOpenPLCStore((s) => s.ladderFlows)
  const fbdFlows = useOpenPLCStore((s) => s.fbdFlows)
  const isDebuggerVisible = useOpenPLCStore((s) => s.workspace.isDebuggerVisible)
  const debugVariableIndexes = useOpenPLCStore((s) => s.workspace.debugVariableIndexes)
  const debugVariableTree = useOpenPLCStore((s) => s.workspace.debugVariableTree)
  const boolValues = useOpenPLCStore((s) => s.workspace.debugBoolValues)
  const nonBoolValues = useOpenPLCStore((s) => s.workspace.debugNonBoolValues)
  const setDebugXrefKeys = useOpenPLCStore((s) => s.workspaceActions.setDebugXrefKeys)
  const { decimals, hideSecrets } = useDebugDisplayOptions()
  const reveal = useRevealInProject()

  // Only the asked-for member and what reaches it, or every use of its variable.
  const [wholeVariable, setWholeVariable] = useState(false)
  useEffect(() => setWholeVariable(false), [request?.seq])

  const project = useMemo<XrefProject>(
    () => ({
      pous,
      ladderFlows,
      fbdFlows,
      globalVariables: configurations.resource.globalVariables,
      globalVariableLists,
    }),
    [pous, ladderFlows, fbdFlows, configurations.resource.globalVariables, globalVariableLists],
  )
  const uses = useMemo(() => buildProjectXref(project), [project])
  const target = useMemo(
    () => (request ? resolveXrefTarget(project, request.pou, request.expression) : undefined),
    [project, request],
  )
  const rows = useMemo(() => {
    if (!target) return []
    return findXrefUses(uses, target, wholeVariable).sort((a, b) => {
      if ((a.access === 'declaration') !== (b.access === 'declaration')) return a.access === 'declaration' ? -1 : 1
      const pou = (a.pou ?? '').localeCompare(b.pou ?? '')
      if (pou !== 0) return pou
      return (a.rungIndex ?? a.line ?? 0) - (b.rungIndex ?? b.line ?? 0)
    })
  }, [uses, target, wholeVariable])

  // The debug key each row reads, online: a global's, or a program's own; a function block's own variables
  // have no single instance to read here.
  const keyIndex = useMemo(() => compositeKeyIndex(debugVariableIndexes.keys()), [debugVariableIndexes])
  const keyOf = useMemo(() => {
    const constantsByPou = new Map<string, Map<string, number>>()
    return (use: XrefUse): string | undefined => {
      const pou = use.pou ? pous.find((p) => p.name === use.pou) : undefined
      let constants = constantsByPou.get(use.pou ?? '')
      if (!constants) {
        constants = indexConstantsOf({ configurations, globalVariableLists }, pou?.interface?.variables ?? [])
        constantsByPou.set(use.pou ?? '', constants)
      }
      const name = resolveConstantIndexes(use.expression.replace(/\s+/g, ''), constants)
      if (use.owner === GLOBAL_OWNER) return canonicalCompositeKey(keyIndex, buildGlobalCompositeKey(name))
      if (pou?.pouType === 'program') return canonicalCompositeKey(keyIndex, `${pou.name}:${name}`)
      return undefined
    }
  }, [pous, configurations, globalVariableLists, keyIndex])

  // Online: the rows' values are polled while the panel shows them.
  useEffect(() => {
    if (!isDebuggerVisible) return
    const keys = new Set<string>()
    for (const use of rows) {
      const key = keyOf(use)
      if (key && debugVariableIndexes.has(key)) keys.add(key)
    }
    setDebugXrefKeys([...keys])
    return () => setDebugXrefKeys([])
  }, [rows, keyOf, isDebuggerVisible, debugVariableIndexes, setDebugXrefKeys])

  const valueOf = (use: XrefUse): string => {
    const key = keyOf(use)
    if (!key) return ''
    const value = boolValues.get(key) ?? nonBoolValues.get(key)
    if (value === undefined) return ''
    const type = debugVariableTree.get(key)?.type
    if (hideSecrets && isSecretValue(key, type)) return HIDDEN_VALUE
    return formatDebugValue(value, type, decimals)
  }

  if (!request) return null
  const declaration = rows.find((r) => r.access === 'declaration' && (r.pou === undefined || r.owner !== GLOBAL_OWNER))
  const isMember = target !== undefined && target.path !== target.root.toUpperCase()

  return (
    <div className='flex h-full w-full flex-col gap-2 rounded-lg border-[0.75px] border-neutral-200 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-950'>
      <div className='flex flex-wrap items-center gap-3'>
        <p className='text-sm font-medium text-neutral-950 dark:text-white'>
          {request.expression}
          <span className='ml-2 font-normal text-neutral-500 dark:text-neutral-400'>
            {!target
              ? 'is not a variable'
              : `${target.owner === GLOBAL_OWNER ? 'global' : `in ${target.owner}`} · ${rows.filter((r) => r.access !== 'declaration').length} uses`}
          </span>
        </p>
        {declaration && (
          <button
            type='button'
            onClick={() => reveal(revealTargetOf(declaration))}
            className='rounded border border-neutral-300 px-2 py-0.5 text-neutral-850 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-850'
          >
            Go to declaration
          </button>
        )}
        {isMember && (
          <label className='flex cursor-pointer items-center gap-1 text-neutral-700 dark:text-neutral-300'>
            <input type='checkbox' checked={wholeVariable} onChange={(e) => setWholeVariable(e.target.checked)} />
            All of {target.root}
          </label>
        )}
        <CloseIcon
          aria-label='Close cross references'
          className='ml-auto w-4 cursor-pointer stroke-brand hover:stroke-red-500 dark:stroke-white'
          onClick={closeCrossReferences}
        />
      </div>
      <div className='min-h-0 flex-1 overflow-auto'>
        <table className='w-full border-collapse text-left'>
          <thead className='sticky top-0 bg-white text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400'>
            <tr>
              <th className='px-2 py-1 font-medium'>POU</th>
              <th className='px-2 py-1 font-medium'>Where</th>
              <th className='px-2 py-1 font-medium'>Element</th>
              <th className='px-2 py-1 font-medium'>Expression</th>
              <th className='px-2 py-1 font-medium'>Access</th>
              {isDebuggerVisible && <th className='px-2 py-1 font-medium'>Value</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((use, index) => (
              <tr
                key={index}
                data-testid='xref-row'
                onClick={() => reveal(revealTargetOf(use, target))}
                className='cursor-pointer border-t border-neutral-100 text-neutral-850 hover:bg-neutral-100 dark:border-neutral-850 dark:text-neutral-200 dark:hover:bg-neutral-850'
              >
                <td className='px-2 py-1'>{use.pou ?? 'Configuration'}</td>
                <td className='whitespace-nowrap px-2 py-1'>{whereOf(use)}</td>
                <td className='px-2 py-1'>{use.detail}</td>
                <td className='px-2 py-1 font-mono'>{use.expression}</td>
                <td className={cn('px-2 py-1 font-medium', ACCESS_CLASS[use.access])}>{ACCESS_LABEL[use.access]}</td>
                {isDebuggerVisible && <td className='whitespace-nowrap px-2 py-1 font-mono'>{valueOf(use)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export { CrossReferences, revealTargetOf }
