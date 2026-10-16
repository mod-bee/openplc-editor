/**
 * The variable references in a line of Structured Text, for the debugger's inline values.
 *
 * A reference is a name followed by any members and subscripts: `speed`, `motor.Running`,
 * `IO.dout[DO_FAULT_LAMP].q`. Each is resolved the way the diagrams resolve a name (case-insensitively,
 * a constant subscript by its value, a VAR_EXTERNAL to the shared global), so the text shows the value
 * the poller reads. Matching the debug keys' own text against the source could not do that: the source
 * writes `IO.dout[DO_FAULT_LAMP].q` where the key is `IO.dout[2].q`.
 */

export type BlockCommentState = false | 'paren' | 'slash'

/**
 * Blank out comment spans in a single line, carrying block-comment
 * state across lines. Characters are replaced with spaces rather than
 * removed so column positions stay aligned with the real line.
 *
 * ST has two block-comment forms — `(* … *)` and `/* … *\/` — plus
 * `//` to end of line.
 */
export function stripLineComments(
  line: string,
  state: BlockCommentState,
): { stripped: string; state: BlockCommentState } {
  const chars = [...line]
  let s = state
  let i = 0
  while (i < chars.length) {
    if (s) {
      const endMarker = s === 'paren' ? ')' : '/'
      if (chars[i] === '*' && chars[i + 1] === endMarker) {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = false
      } else {
        chars[i] = ' '
        i++
      }
    } else {
      if (chars[i] === '/' && chars[i + 1] === '/') {
        for (let j = i; j < chars.length; j++) chars[j] = ' '
        break
      }
      if (chars[i] === '(' && chars[i + 1] === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = 'paren'
      } else if (chars[i] === '/' && chars[i + 1] === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = 'slash'
      } else {
        i++
      }
    }
  }

  return { stripped: chars.join(''), state: s }
}

/** Blank out the contents of string literals (`'…'`, `"…"`), keeping columns, so text in one is not a name. */
function blankStrings(line: string): string {
  return line.replace(/'(?:\$.|[^'$])*'|"(?:\$.|[^"$])*"/g, (literal) => ' '.repeat(literal.length))
}

/** A name, then any `.member` and `[subscripts]`, spaces allowed around them. */
const REFERENCE = /[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[[^[\]]*\])*/g
/** One step of a reference: the leading name, or a member, or a subscript. */
const SEGMENT = /^(?:[A-Za-z_]\w*|\s*\.\s*[A-Za-z_]\w*|\s*\[[^[\]]*\])/

export interface StReferenceSpan {
  key: string
  /** 1-based columns, end exclusive, as Monaco ranges take them. */
  startCol: number
  endCol: number
}

/**
 * The live references in one comment-stripped line. `resolve` turns a reference's text (spaces removed)
 * into the key whose value it shows, or undefined when nothing is live under it. A reference with no
 * live value of its own shows its longest prefix that has one (`motor.speed` of `motor.speed.raw`).
 * Each key is shown once per line, at its first reference.
 */
export function findStReferences(line: string, resolve: (reference: string) => string | undefined): StReferenceSpan[] {
  const text = blankStrings(line)
  const found: StReferenceSpan[] = []
  const shown = new Set<string>()
  for (const match of text.matchAll(REFERENCE)) {
    const start = match.index ?? 0
    const before = text[start - 1]
    // Part of a longer token: a typed literal's value (`T#5s`, `INT#3`) or a name after a member dot.
    if (before !== undefined && /[\w#.]/.test(before)) continue
    // A typed literal's type (`INT#3`, `T#5s`) is not a variable.
    if (text[start + match[0].length] === '#') continue

    // The end of each step, longest first.
    const ends: number[] = []
    let rest = match[0]
    let consumed = 0
    while (rest.length > 0) {
      const segment = SEGMENT.exec(rest)
      if (!segment) break
      consumed += segment[0].length
      ends.push(consumed)
      rest = rest.slice(segment[0].length)
    }
    for (const end of ends.reverse()) {
      const key = resolve(match[0].slice(0, end).replace(/\s+/g, ''))
      if (key === undefined) continue
      if (!shown.has(key)) {
        shown.add(key)
        found.push({ key, startCol: start + 1, endCol: start + end + 1 })
      }
      break
    }
  }
  return found
}
