/**
 * Cross references: every use of every variable in the project, with where it is and what it does there.
 *
 * One walk over the project the user edits (not the compiled ST): Ladder contacts, coils, the variables on
 * block pins and block instances; FBD variables and blocks; ST and IL bodies; and the declarations (POU
 * variable tables, configuration globals, global variable lists). Each use names its OWNER, the variable it
 * resolves to: a global (reached through VAR_EXTERNAL, or used without one) or a variable of the POU that
 * declares it. A use is member-aware: `levelLimit.Trip` is a use of `levelLimit` and of `levelLimit.Trip`,
 * and a use of the whole `levelLimit` (a block call, an in-out binding) touches every member of it.
 *
 * Names compare case-insensitively (IEC 61131-3 6.1.2).
 */
import type { PLCGlobalVariableList, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What a use does with the variable. */
export type XrefAccess = 'read' | 'write' | 'inout' | 'call' | 'declaration'

/** The global namespace, as an owner. */
export const GLOBAL_OWNER = 'GLOBAL'

export interface XrefUse {
  /** The POU the use is in; undefined for a global declaration. */
  pou?: string
  language: 'ld' | 'fbd' | 'st' | 'il' | 'globals'
  /** `GLOBAL`, or the declaring POU's name (as declared). */
  owner: string
  /** The expression as written: `levelLimit.Trip`, `IO.din[FN_PUMP_RUN_FB].q`. */
  expression: string
  /** The expression for comparing: upper case, no spaces. */
  path: string
  access: XrefAccess
  element: 'contact' | 'coil' | 'variable' | 'block' | 'text' | 'declaration'
  /** What the element is, for a person: `contact`, `coil (set)`, `pin Reset of motor`, `VAR_EXTERNAL`. */
  detail: string
  rungId?: string
  /** 1-based, as the editor numbers rungs. */
  rungIndex?: number
  nodeId?: string
  /** For a variable on a block pin: the block element and the pin's name. */
  blockId?: string
  pin?: string
  /** 1-based line and column in an ST / IL body. */
  line?: number
  column?: number
  /** Global variable list name, for a declaration in one. */
  list?: string
}

/** The variable a name refers to: its owner and the path of the part asked about. */
export interface XrefTarget {
  owner: string
  /** The root variable's declared name. */
  root: string
  /** The asked-for part as written (`levelLimit.Trip`). */
  expression: string
  path: string
}

type FlowNode = { id: string; type?: string; data?: unknown }
type FlowEdge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
export interface XrefProject {
  pous: PLCPou[]
  ladderFlows: Array<{ name: string; rungs: Array<{ id: string; nodes: FlowNode[] }> }>
  fbdFlows: Array<{ name: string; rung: { nodes: FlowNode[]; edges?: FlowEdge[] } }>
  globalVariables: Array<Pick<PLCVariable, 'name'> & Partial<PLCVariable>>
  globalVariableLists?: PLCGlobalVariableList[]
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** An expression for comparing: upper case, without spaces. */
export function normalisePath(expression: string): string {
  return expression.replace(/\s+/g, '').toUpperCase()
}

/** Whether `path` is `prefix` or a member / element of it. */
function isPartOf(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false
  const next = path.charAt(prefix.length)
  return next === '' || next === '.' || next === '['
}

function rootOf(path: string): string {
  const m = /^[A-Z_a-z][A-Za-z0-9_]*/.exec(path)
  return m ? m[0] : ''
}

/** The global names: configuration globals and every global variable list. */
function globalNames(project: XrefProject): Map<string, string> {
  const names = new Map<string, string>()
  for (const v of project.globalVariables) names.set(v.name.toUpperCase(), v.name)
  for (const list of project.globalVariableLists ?? []) {
    for (const v of list.variables) if (!names.has(v.name.toUpperCase())) names.set(v.name.toUpperCase(), v.name)
  }
  return names
}

/**
 * Who owns `root` as seen from `pou`: the POU when it declares it (any class but VAR_EXTERNAL), the global
 * namespace for a VAR_EXTERNAL or an undeclared global; undefined when it is no variable (a function, a type,
 * an enumeration value, a keyword).
 */
function ownerOf(
  pou: PLCPou | undefined,
  root: string,
  globals: Map<string, string>,
): { owner: string; root: string } | undefined {
  const upper = root.toUpperCase()
  const declared = pou?.interface?.variables.find((v) => v.name.toUpperCase() === upper)
  if (declared && declared.class !== 'external') return { owner: pou!.name, root: declared.name }
  const global = globals.get(upper)
  if (global !== undefined) return { owner: GLOBAL_OWNER, root: global }
  if (declared) return { owner: GLOBAL_OWNER, root: declared.name }
  return undefined
}

// ---------------------------------------------------------------------------
// ST / IL scanning
// ---------------------------------------------------------------------------

type Token = { kind: 'id' | 'op' | 'other'; text: string; start: number; end: number }

const NUMBER = /\d[\d_]*(?:#[0-9A-Za-z_]+)?(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/y
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y
// What follows `T#`, `INT#`, `UT_STATE#`: a typed literal, not a name.
const TYPED_LITERAL_TAIL = /#[A-Za-z0-9_.:+-]*/y

/** ST tokens, with comments and strings left out. */
function lex(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === '(' && source[i + 1] === '*') {
      const end = source.indexOf('*)', i + 2)
      i = end === -1 ? n : end + 2
    } else if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? n : end
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && source[j] !== c) j += source[j] === '$' ? 2 : 1
      i = j + 1
    } else if (/[A-Za-z_]/.test(c)) {
      IDENT.lastIndex = i
      const m = IDENT.exec(source)!
      const end = i + m[0].length
      if (source[end] === '#') {
        TYPED_LITERAL_TAIL.lastIndex = end
        const tail = TYPED_LITERAL_TAIL.exec(source)
        const literalEnd = end + (tail ? tail[0].length : 1)
        tokens.push({ kind: 'other', text: source.slice(i, literalEnd), start: i, end: literalEnd })
        i = literalEnd
      } else {
        tokens.push({ kind: 'id', text: m[0], start: i, end })
        i = end
      }
    } else if (/\d/.test(c)) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(source)
      const end = i + (m ? m[0].length : 1)
      tokens.push({ kind: 'other', text: source.slice(i, end), start: i, end })
      i = end
    } else {
      const two = source.slice(i, i + 2)
      if (two === ':=' || two === '=>' || two === '..') {
        tokens.push({ kind: 'op', text: two, start: i, end: i + 2 })
        i += 2
      } else {
        tokens.push({ kind: /[.[\](),;]/.test(c) ? 'op' : 'other', text: c, start: i, end: i + 1 })
        i++
      }
    }
  }
  return tokens
}

/** A name chain found in text: `a.b[i].c`, with its offsets and what it does. */
interface Chain {
  expression: string
  start: number
  access: Exclude<XrefAccess, 'declaration'>
}

/**
 * The name chains in ST source. A chain followed by `:=` outside any parentheses is assigned; one after `=>`
 * receives a block output; one followed by `(` is called. A name followed by `:=` or `=>` inside a call's
 * parentheses is the called block's parameter, not a variable here, and is left out. The names inside a
 * subscript are chains of their own (read).
 */
export function scanStChains(source: string): Chain[] {
  const tokens = lex(source)
  const depth: number[] = []
  let d = 0
  for (const t of tokens) {
    if (t.text === '(') d++
    depth.push(d)
    if (t.text === ')') d = Math.max(0, d - 1)
  }
  const chains: Chain[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind !== 'id' || tokens[i - 1]?.text === '.') continue
    let j = i
    let end = t.end
    for (;;) {
      const next = tokens[j + 1]
      if (next?.text === '.' && tokens[j + 2]?.kind === 'id') {
        j += 2
        end = tokens[j].end
      } else if (next?.text === '[') {
        let k = j + 1
        let brackets = 0
        for (; k < tokens.length; k++) {
          if (tokens[k].text === '[') brackets++
          if (tokens[k].text === ']' && --brackets === 0) break
        }
        if (k >= tokens.length) break
        j = k
        end = tokens[k].end
      } else break
    }
    const after = tokens[j + 1]?.text
    const before = tokens[i - 1]?.text
    let access: Chain['access'] = 'read'
    if (after === ':=' || after === '=>') {
      if (depth[i] > 0) continue // a formal parameter of the call around it
      access = 'write'
    } else if (before === '=>') access = 'write'
    else if (after === '(') access = 'call'
    chains.push({ expression: source.slice(t.start, end), start: t.start, access })
  }
  return chains
}

const IL_WRITE = new Set(['ST', 'STN', 'S', 'R'])
const IL_CALL = new Set(['CAL', 'CALC', 'CALCN'])
const IL_NO_OPERAND = new Set(['JMP', 'JMPC', 'JMPCN', 'RET', 'RETC', 'RETCN'])

/** The operand of each IL instruction: written by ST / S / R, called by CAL, otherwise read. */
function scanIlChains(source: string): Chain[] {
  const chains: Chain[] = []
  let offset = 0
  for (const line of source.split('\n')) {
    const m = /^(\s*(?:[A-Za-z_]\w*\s*:)?\s*)([A-Za-z]+)(\s+)([A-Za-z_][\w.[\]]*)/.exec(line)
    if (m) {
      const op = m[2].toUpperCase()
      if (!IL_NO_OPERAND.has(op)) {
        const start = offset + m[1].length + m[2].length + m[3].length
        chains.push({
          expression: m[4],
          start,
          access: IL_WRITE.has(op) ? 'write' : IL_CALL.has(op) ? 'call' : 'read',
        })
      }
    }
    offset += line.length + 1
  }
  return chains
}

function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

type NodeData = {
  variable?: { name?: string }
  variant?: string | { name?: string; variables?: Array<{ name: string; class?: string }> }
  block?: { id?: string; variableType?: { name?: string; class?: string } }
}

const COIL_DETAIL: Record<string, string> = {
  set: 'coil (set)',
  reset: 'coil (reset)',
  negated: 'coil (negated)',
  risingEdge: 'coil (rising edge)',
  fallingEdge: 'coil (falling edge)',
}
const CONTACT_DETAIL: Record<string, string> = {
  negated: 'contact (negated)',
  risingEdge: 'contact (rising edge)',
  fallingEdge: 'contact (falling edge)',
}

/** Build the project's cross references. */
export function buildProjectXref(project: XrefProject): XrefUse[] {
  const uses: XrefUse[] = []
  const globals = globalNames(project)

  /** The uses inside one name or expression an element carries (a name, or names in a subscript). */
  const addExpression = (
    pou: PLCPou,
    text: string,
    base: Omit<XrefUse, 'owner' | 'expression' | 'path' | 'access'> & { access: XrefUse['access'] },
  ) => {
    for (const chain of scanStChains(text)) {
      const root = rootOf(chain.expression)
      const owner = ownerOf(pou, root, globals)
      if (!owner) continue
      // The element's own name takes the element's access; a name inside its subscript is read.
      const own = chain.start === text.search(/\S/)
      uses.push({
        ...base,
        owner: owner.owner,
        expression: chain.expression,
        path: normalisePath(chain.expression),
        access: own ? base.access : 'read',
        detail: own ? base.detail : `subscript in ${text.trim()}`,
      })
    }
  }

  for (const pou of project.pous) {
    const language = pou.body.language

    // Declarations: the POU's own variable table.
    for (const v of pou.interface?.variables ?? []) {
      const owner = ownerOf(pou, v.name, globals)
      if (!owner) continue
      uses.push({
        pou: pou.name,
        language: language === 'ld' || language === 'fbd' ? language : language === 'il' ? 'il' : 'st',
        owner: owner.owner,
        expression: v.name,
        path: normalisePath(v.name),
        access: 'declaration',
        element: 'declaration',
        detail: `VAR${v.class === 'local' || !v.class ? '' : `_${v.class === 'inOut' ? 'IN_OUT' : v.class.toUpperCase()}`}`,
      })
    }

    if (language === 'ld') {
      const flow = project.ladderFlows.find((f) => f.name.toUpperCase() === pou.name.toUpperCase())
      flow?.rungs.forEach((rung, rungIdx) => {
        const at = { pou: pou.name, language: 'ld' as const, rungId: rung.id, rungIndex: rungIdx + 1 }
        const blocks = new Map(rung.nodes.filter((n) => n.type === 'block').map((n) => [n.id, n]))
        for (const node of rung.nodes) {
          const data = (node.data ?? {}) as NodeData
          const name = data.variable?.name ?? ''
          if (!name.trim()) continue
          const variant = typeof data.variant === 'string' ? data.variant : ''
          if (node.type === 'contact') {
            addExpression(pou, name, {
              ...at,
              nodeId: node.id,
              element: 'contact',
              access: 'read',
              detail: CONTACT_DETAIL[variant] ?? 'contact',
            })
          } else if (node.type === 'coil') {
            addExpression(pou, name, {
              ...at,
              nodeId: node.id,
              element: 'coil',
              access: 'write',
              detail: COIL_DETAIL[variant] ?? 'coil',
            })
          } else if (node.type === 'variable') {
            const pin = data.block?.variableType
            const block = data.block?.id ? blocks.get(data.block.id) : undefined
            const blockName = ((block?.data ?? {}) as NodeData).variable?.name
            const blockType = typeof (block?.data as NodeData | undefined)?.variant === 'object'
              ? ((block?.data as NodeData).variant as { name?: string }).name
              : undefined
            const of = blockName?.trim() ? blockName : (blockType ?? 'block')
            addExpression(pou, name, {
              ...at,
              nodeId: node.id,
              ...(data.block?.id && pin?.name ? { blockId: data.block.id, pin: pin.name } : {}),
              element: 'variable',
              access: pin?.class === 'inOut' ? 'inout' : variant === 'output' ? 'write' : 'read',
              detail: `${pin?.class === 'inOut' ? 'in-out' : variant === 'output' ? 'output' : 'input'} ${pin?.name ?? ''} of ${of}`.replace(/\s+/g, ' '),
            })
          } else if (node.type === 'block') {
            const type = typeof data.variant === 'object' ? data.variant.name : undefined
            addExpression(pou, name, {
              ...at,
              nodeId: node.id,
              element: 'block',
              access: 'call',
              detail: type ? `${type} block` : 'block',
            })
          }
        }
      })
    } else if (language === 'fbd') {
      const flow = project.fbdFlows.find((f) => f.name.toUpperCase() === pou.name.toUpperCase())
      const fbdBlocks = new Set((flow?.rung.nodes ?? []).filter((n) => n.type === 'block').map((n) => n.id))
      for (const node of flow?.rung.nodes ?? []) {
        const data = (node.data ?? {}) as NodeData
        const name = data.variable?.name ?? ''
        if (!name.trim()) continue
        // The block pin a variable is wired to: the edge's handle on the block is the pin's name.
        const wire = (flow?.rung.edges ?? []).find(
          (e) => (e.source === node.id && fbdBlocks.has(e.target)) || (e.target === node.id && fbdBlocks.has(e.source)),
        )
        const pinAt =
          wire && node.type !== 'block'
            ? wire.source === node.id
            ? { blockId: wire.target, pin: wire.targetHandle ?? undefined }
            : { blockId: wire.source, pin: wire.sourceHandle ?? undefined }
          : {}
        const at = { pou: pou.name, language: 'fbd' as const, nodeId: node.id, ...pinAt }
        if (node.type === 'input-variable') {
          addExpression(pou, name, { ...at, element: 'variable', access: 'read', detail: 'input variable' })
        } else if (node.type === 'output-variable') {
          addExpression(pou, name, { ...at, element: 'variable', access: 'write', detail: 'output variable' })
        } else if (node.type === 'inout-variable') {
          addExpression(pou, name, { ...at, element: 'variable', access: 'inout', detail: 'in-out variable' })
        } else if (node.type === 'block') {
          const type = typeof data.variant === 'object' ? data.variant.name : undefined
          addExpression(pou, name, {
            ...at,
            element: 'block',
            access: 'call',
            detail: type ? `${type} block` : 'block',
          })
        }
      }
    } else if (language === 'st' || language === 'il') {
      const source = typeof pou.body.value === 'string' ? pou.body.value : ''
      const chains = language === 'st' ? scanStChains(source) : scanIlChains(source)
      for (const chain of chains) {
        const owner = ownerOf(pou, rootOf(chain.expression), globals)
        if (!owner) continue
        const { line, column } = lineAndColumn(source, chain.start)
        uses.push({
          pou: pou.name,
          language,
          owner: owner.owner,
          expression: chain.expression,
          path: normalisePath(chain.expression),
          access: chain.access,
          element: 'text',
          detail: `line ${line}`,
          line,
          column,
        })
      }
    }
  }

  // Global declarations.
  for (const v of project.globalVariables) {
    uses.push({
      language: 'globals',
      owner: GLOBAL_OWNER,
      expression: v.name,
      path: normalisePath(v.name),
      access: 'declaration',
      element: 'declaration',
      detail: 'VAR_GLOBAL',
    })
  }
  for (const list of project.globalVariableLists ?? []) {
    for (const v of list.variables) {
      uses.push({
        language: 'globals',
        list: list.name,
        owner: GLOBAL_OWNER,
        expression: v.name,
        path: normalisePath(v.name),
        access: 'declaration',
        element: 'declaration',
        detail: `VAR_GLOBAL (${list.name})`,
      })
    }
  }
  return uses
}

/**
 * The variable an expression written in `pouName` refers to, or undefined when its root is no variable.
 * `pouName` undefined: a global name.
 */
export function resolveXrefTarget(
  project: XrefProject,
  pouName: string | undefined,
  expression: string,
): XrefTarget | undefined {
  const chain = scanStChains(expression)[0]
  if (!chain) return undefined
  const pou = pouName ? project.pous.find((p) => p.name.toUpperCase() === pouName.toUpperCase()) : undefined
  const owner = ownerOf(pou, rootOf(chain.expression), globalNames(project))
  if (!owner) return undefined
  return { owner: owner.owner, root: owner.root, expression: chain.expression, path: normalisePath(chain.expression) }
}

/**
 * The uses of a target. `wholeVariable`: every use of its root variable. Otherwise the uses of the asked-for
 * part, of its members, and of the whole it is part of (a block call or an in-out binding of `levelLimit`
 * reaches `levelLimit.Trip`).
 */
export function findXrefUses(uses: XrefUse[], target: XrefTarget, wholeVariable = false): XrefUse[] {
  const owner = target.owner.toUpperCase()
  const rootPath = normalisePath(target.root)
  return uses.filter((use) => {
    if (use.owner.toUpperCase() !== owner) return false
    if (!isPartOf(use.path, rootPath)) return false
    if (wholeVariable || target.path === rootPath) return true
    return isPartOf(use.path, target.path) || isPartOf(target.path, use.path)
  })
}

/**
 * The name under a text cursor (1-based column), up to the end of the identifier the cursor is on: on
 * `Trip` of `levelLimit.Trip` it is `levelLimit.Trip`, on `levelLimit` it is `levelLimit`; inside a
 * subscript it is the name there. Undefined when the cursor is on no name.
 */
export function nameChainAt(line: string, column: number): string | undefined {
  const at = column - 1
  let best: Chain | undefined
  for (const chain of scanStChains(line)) {
    if (at >= chain.start && at <= chain.start + chain.expression.length) {
      if (!best || chain.start >= best.start) best = chain
    }
  }
  if (!best) return undefined
  let end = at
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end])) end++
  const cut = best.expression.slice(0, end - best.start)
  return /[A-Za-z0-9_\]]$/.test(cut) ? cut : best.expression
}
