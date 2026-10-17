/**
 * Find in project: the text of every POU in the form the user edits it (Ladder and FBD elements included),
 * the variable tables, the globals, data types, tasks and instances. Each hit carries its place, so the
 * results can go to the rung and element, or the line, where it is.
 */
import type { Project, SearchHit } from '../store/slices/search/types'
import type { XrefProject } from './project-xref'

export interface SearchOptions {
  caseSensitive: boolean
  /** The query is a regular expression; otherwise it is plain text (a `.` is a dot). */
  regex: boolean
}

/** Counts the matches in a text. Throws a SyntaxError for an invalid regular expression. */
export type Matcher = (text: string) => number

export function makeMatcher(query: string, options: SearchOptions): Matcher {
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(source, options.caseSensitive ? 'g' : 'gi')
  return (text) => {
    if (!text) return 0
    regex.lastIndex = 0
    let count = 0
    for (let m = regex.exec(text); m; m = regex.exec(text)) {
      count++
      if (m[0] === '') regex.lastIndex++ // an empty match must not stall
    }
    return count
  }
}

type FlowNode = { id: string; type?: string; data?: unknown }
type NodeData = {
  variable?: { name?: string }
  variant?: string | { name?: string }
  content?: string
  block?: { id?: string; variableType?: { name?: string } }
}

/** The block pin a Ladder variable element sits on, to mark it on the block. */
function pinOf(node: FlowNode): { blockId?: string; pin?: string } {
  const block = ((node.data ?? {}) as NodeData).block
  return node.type === 'variable' && block?.id && block.variableType?.name
    ? { blockId: block.id, pin: block.variableType.name }
    : {}
}

const ELEMENT: Record<string, string> = {
  contact: 'contact',
  coil: 'coil',
  variable: 'variable',
  block: 'block',
  'input-variable': 'input variable',
  'output-variable': 'output variable',
  'inout-variable': 'in-out variable',
  comment: 'comment',
  connector: 'connector',
  continuation: 'continuation',
}

/** The texts a diagram element shows: its name, a block's type, a comment's text. */
function elementTexts(node: FlowNode): Array<{ text: string; what: string }> {
  const data = (node.data ?? {}) as NodeData
  const what = ELEMENT[node.type ?? ''] ?? node.type ?? 'element'
  const texts: Array<{ text: string; what: string }> = []
  if (data.variable?.name?.trim()) texts.push({ text: data.variable.name, what })
  if (node.type === 'block' && typeof data.variant === 'object' && data.variant.name) {
    texts.push({ text: data.variant.name, what: 'block type' })
  }
  if (typeof data.content === 'string' && data.content.trim()) texts.push({ text: data.content, what })
  return texts
}

export type SearchFilter = 'program' | 'function' | 'function-block' | 'data-type' | 'configuration'

export interface SearchInput extends XrefProject {
  dataTypes: Array<{ name: string; derivation: 'array' | 'structure' | 'enumerated' }>
  tasks: Array<{ name: string }>
  instances: Array<{ name: string }>
}

/** Search the project. `filters` empty: everything. */
export function searchProject(
  input: SearchInput,
  query: string,
  options: SearchOptions,
  filters: SearchFilter[] = [],
): { functions: Project['functions']; count: number } {
  const match = makeMatcher(query, options)
  const wanted = (kind: SearchFilter) => filters.length === 0 || filters.includes(kind)
  let count = 0
  const pous: Project['functions']['pous'] = { program: [], function: [], 'function-block': [] }

  for (const pou of input.pous) {
    if (pou.pouType === 'interface' || !wanted(pou.pouType)) continue
    const hits: SearchHit[] = []
    const add = (hit: SearchHit) => {
      hits.push(hit)
      count += hit.count
    }

    for (const v of pou.interface?.variables ?? []) {
      const n = match(v.name)
      if (n) {
        const cls = v.class === 'local' || !v.class ? '' : `_${v.class === 'inOut' ? 'IN_OUT' : v.class.toUpperCase()}`
        add({ text: v.name, where: `VAR${cls}`, target: { kind: 'pou', pou: pou.name, variable: v.name }, count: n })
      }
    }

    const language = pou.body.language
    if (language === 'ld') {
      const flow = input.ladderFlows.find((f) => f.name.toUpperCase() === pou.name.toUpperCase())
      flow?.rungs.forEach((rung, index) => {
        const comment = (rung as { comment?: string }).comment ?? ''
        const n = match(comment)
        if (n) {
          add({
            text: comment.trim(),
            where: `rung ${index + 1} · comment`,
            target: { kind: 'pou', pou: pou.name, rungId: rung.id },
            count: n,
          })
        }
        for (const node of rung.nodes) {
          for (const { text, what } of elementTexts(node)) {
            const m = match(text)
            if (m) {
              add({
                text,
                where: `rung ${index + 1} · ${what}`,
                target: { kind: 'pou', pou: pou.name, rungId: rung.id, nodeId: node.id, ...pinOf(node) },
                count: m,
              })
            }
          }
        }
      })
    } else if (language === 'fbd') {
      const flow = input.fbdFlows.find((f) => f.name.toUpperCase() === pou.name.toUpperCase())
      for (const node of flow?.rung.nodes ?? []) {
        for (const { text, what } of elementTexts(node)) {
          const m = match(text)
          if (m) add({ text, where: what, target: { kind: 'pou', pou: pou.name, nodeId: node.id }, count: m })
        }
      }
    } else if (typeof pou.body.value === 'string') {
      pou.body.value.split('\n').forEach((line, index) => {
        const m = match(line)
        if (m) {
          add({
            text: line.trim(),
            where: `line ${index + 1}`,
            target: { kind: 'pou', pou: pou.name, line: index + 1, column: Math.max(1, line.search(/\S/) + 1) },
            count: m,
          })
        }
      })
    }

    const nameMatches = match(pou.name) > 0
    if (nameMatches) count++
    if (nameMatches || hits.length > 0) {
      const list = pous[pou.pouType]
      list.push({
        name: pou.name,
        language: language as 'ld' | 'sfc' | 'fbd' | 'il' | 'st' | 'python' | 'cpp',
        pouType: pou.pouType,
        nameMatches,
        hits,
      })
    }
  }
  for (const key of Object.keys(pous) as Array<keyof typeof pous>) if (pous[key].length === 0) delete pous[key]

  const globals: SearchHit[] = []
  if (wanted('configuration')) {
    for (const v of input.globalVariables) {
      const n = match(v.name)
      if (n) globals.push({ text: v.name, where: 'VAR_GLOBAL', target: { kind: 'globals', variable: v.name }, count: n })
    }
    for (const list of input.globalVariableLists ?? []) {
      for (const v of list.variables) {
        const n = match(v.name)
        if (n) {
          globals.push({
            text: v.name,
            where: `VAR_GLOBAL (${list.name})`,
            target: { kind: 'globals', variable: v.name, list: list.name },
            count: n,
          })
        }
      }
    }
  }
  count += globals.reduce((sum, hit) => sum + hit.count, 0)

  const dataTypes = wanted('data-type')
    ? input.dataTypes.filter((t) => match(t.name) > 0).map((t) => ({ name: t.name, type: t.derivation }))
    : []
  const tasks = wanted('configuration') ? input.tasks.filter((t) => match(t.name) > 0).map((t) => t.name) : []
  const instances = wanted('configuration')
    ? input.instances.filter((t) => match(t.name) > 0).map((t) => t.name)
    : []
  count += dataTypes.length + tasks.length + instances.length

  return {
    functions: { pous, dataTypes, globals, resource: { task: tasks.join(', '), instance: instances.join(', ') } },
    count,
  }
}
