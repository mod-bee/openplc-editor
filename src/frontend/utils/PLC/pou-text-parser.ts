import type { PLCPou, PLCVariable, PouType } from '../../../middleware/shared/ports/types'
import { parseIecStringToVariables } from '../generate-iec-string-to-variables'
import { unescapeCommentText } from './comment-text'
import { getLanguageFromExtension } from './pou-file-extensions'
import { trimBodyText } from './pou-text-serializer'

/**
 * A POU file's documentation: its leading comment, with the escaping the
 * serializer applies to `(*` and `*)` undone, so any text round-trips.
 * Every POU reader goes through this rather than `extractDocumentation`.
 */
export const readPouDocumentation = (content: string): { documentation: string; remainingContent: string } => {
  const { documentation, remainingContent } = extractDocumentation(content)
  return { documentation: unescapeCommentText(documentation), remainingContent }
}

/**
 * Helper function to extract the raw text of leading comments (still escaped — see `readPouDocumentation`)
 * @param content - The content to extract documentation from
 * @returns Object with documentation and remaining content
 */
export const extractDocumentation = (content: string): { documentation: string; remainingContent: string } => {
  // A comment is legal wherever whitespace is, so a header may be written as
  // several consecutive blocks.  Taking only the first leaves the rest in
  // front of the declaration, which the declaration regex then fails to match.
  const blocks: string[] = []
  let remainingContent = content
  for (;;) {
    const docMatch = remainingContent.match(/^\s*\(\*\s*(.*?)\s*\*\)\s*\n/s)
    if (!docMatch) break
    blocks.push(docMatch[1].trim())
    remainingContent = remainingContent.slice(docMatch[0].length)
  }
  return {
    documentation: blocks.join('\n\n'),
    remainingContent,
  }
}

/**
 * Helper function to provide clear error messages with line numbers
 * @param message - The error message
 * @param lineNumber - Optional line number where the error occurred
 * @returns Formatted error message
 */
const formatParseError = (message: string, lineNumber?: number): string => {
  /* istanbul ignore next -- lineNumber is reserved for future use; no caller provides it */
  if (lineNumber !== undefined) {
    return `Parse error on line ${lineNumber}: ${message}`
  }
  return `Parse error: ${message}`
}

/**
 * Is `value` the canonical body shape for this graphical language?
 *
 * LD is `{ name, rungs: [...] }`; FBD is `{ name, rung: { nodes: [...] } }`
 * (see `createPouObject`). `JSON.parse` succeeding says nothing about this:
 * `null`, or an object carrying the *other* language's shape, parses fine and
 * then fails much later inside a consumer reading `value.rungs` or
 * `value.rung.nodes`. Checking here keeps the failure nameable, and at the one
 * place that already owns "is this POU readable at all".
 */
export const isGraphicalBodyShape = (value: unknown, language: 'ld' | 'fbd'): boolean => {
  if (typeof value !== 'object' || value === null) return false
  if (language === 'ld') return 'rungs' in value && Array.isArray(value.rungs)
  if (!('rung' in value)) return false
  const rung = value.rung
  if (typeof rung !== 'object' || rung === null) return false
  return 'nodes' in rung && Array.isArray(rung.nodes)
}

/**
 * Index at which a graphical POU's JSON body starts, or -1 when there is none.
 *
 * `serializeGraphicalPouToString` writes the variable declarations, a blank
 * line, then `JSON.stringify(body, null, 2)` — so the body always opens with a
 * brace in **column 0**, and the anchor requires exactly that. A declaration
 * line may legitimately carry a brace (a struct initial value spilling onto its
 * own line, a CODESYS-style `{attribute ...}` pragma, an inline `(* ... *)`
 * comment), but the serializer always indents declarations, so none of them can
 * be mistaken for the body. Allowing an indented brace here would end the
 * declaration scan early and report a malformed declaration as invalid body
 * JSON, pointing the user at the wrong place.
 */
export const findGraphicalBodyStartIndex = (content: string, fromIndex: number): number => {
  const match = content.slice(fromIndex).match(/^\{/m)
  /* istanbul ignore next -- a matched regex always carries an index */
  if (match?.index === undefined) return -1
  return fromIndex + match.index
}

/**
 * Helper function to find the last END_VAR in the content
 * @param content - The content to search
 * @param startIndex - The index to start searching from
 * @param stopAtIndex - Optional exclusive upper bound for the search. Graphical
 *   POUs pass the start of their JSON body: a placed native (C/C++, Python)
 *   library block carries its authored source in `node.data.variant.body`, and
 *   that source has its own VAR ... END_VAR. Scanning the whole file would take
 *   the embedded END_VAR as the end of the declarations and slice the body from
 *   the middle of the JSON, so the POU failed to parse and the project could
 *   not be opened at all (DOPE-592).
 * @returns The index after the last END_VAR, or -1 if not found
 */
export const findLastEndVarIndex = (content: string, startIndex: number, stopAtIndex?: number): number => {
  const region = stopAtIndex === undefined ? content : content.slice(0, stopAtIndex)
  let lastEndVarIndex = -1
  let searchIndex = startIndex

  let endVarMatch = region.slice(searchIndex).match(/\bEND_VAR\b/i)
  while (endVarMatch && endVarMatch.index !== undefined) {
    lastEndVarIndex = searchIndex + endVarMatch.index + endVarMatch[0].length
    searchIndex = lastEndVarIndex
    endVarMatch = region.slice(searchIndex).match(/\bEND_VAR\b/i)
  }

  return lastEndVarIndex
}

/**
 * Parse a textual POU (ST, IL) from string to PLCPou object
 * @param content - The text content to parse
 * @param language - The language code (st, il)
 * @param type - The POU type (program, function, function-block)
 * @returns Parsed PLCPou object
 * @throws Error if parsing fails
 */
/**
 * The keyword a POU of each kind opens and closes with.
 *
 * One copy. These maps, the header regex built from them and the scan for the
 * start of the VAR section were written out four times — three times in this
 * file and again in the loader's fallback — and they had already drifted: the
 * fallback sliced the declarations from the `VAR` keyword rather than from the
 * start of its line, so the indentation fix (DOPE-650) reached three of the four
 * paths and a POU that failed to parse still came back re-indented.
 */
export const POU_TYPE_KEYWORDS: Record<string, string> = {
  program: 'PROGRAM',
  function: 'FUNCTION',
  'function-block': 'FUNCTION_BLOCK',
  interface: 'INTERFACE',
}

export const POU_END_KEYWORDS: Record<string, string> = {
  program: 'END_PROGRAM',
  function: 'END_FUNCTION',
  'function-block': 'END_FUNCTION_BLOCK',
  interface: 'END_INTERFACE',
}

export interface PouHeaderMatch {
  /** The matched header text, whose length is where the body may start. */
  text: string
  name: string
  /** Present for a FUNCTION, which declares what it returns. */
  returnType?: string
  /**
   * `EXTENDS`: a function block's base, or an interface's bases as written
   * (`A, B`; IEC 61131-3 6.6.6.6).
   */
  extends?: string
  /** A function block's `IMPLEMENTS` list (6.6.6.4). */
  implements?: string[]
  /** `FUNCTION_BLOCK ABSTRACT` (6.6.5.8.2). */
  isAbstract?: boolean
  /** `FUNCTION_BLOCK FINAL` (6.6.5.8.3). */
  isFinal?: boolean
}

const NAME_LIST = '[\\w.]+(?:\\s*,\\s*[\\w.]+)*'

/**
 * The declaration at the head of `content` (IEC 61131-3 Annex A): `PROGRAM
 * Main`, `FUNCTION Add : INT`, `FUNCTION_BLOCK [ABSTRACT | FINAL] Pump
 * [EXTENDS Base] [IMPLEMENTS I1, I2]`, `INTERFACE I [EXTENDS A, B]`.
 *
 * One matcher for every reader, so a clause the model carries is never dropped
 * by one of them: anything between the name and the first VAR block that the
 * pattern does not take falls outside the header and is lost.
 */
export const matchPouHeader = (content: string, pouType: string): PouHeaderMatch | undefined => {
  const keyword = POU_TYPE_KEYWORDS[pouType]
  if (!keyword) return undefined
  if (pouType === 'interface') {
    const match = content.match(new RegExp(`^\\s*INTERFACE\\s+(\\w+)(?:\\s+EXTENDS\\s+(${NAME_LIST}))?`, 'i'))
    if (!match) return undefined
    return {
      text: match[0],
      name: match[1],
      ...(match[2]
        ? {
            extends: match[2]
              .split(',')
              .map((n) => n.trim())
              .join(', '),
          }
        : {}),
    }
  }
  if (pouType === 'function-block') {
    const match = content.match(
      new RegExp(
        `^\\s*FUNCTION_BLOCK\\s+(?:(ABSTRACT|FINAL)\\s+)?(\\w+)(?:\\s+EXTENDS\\s+([\\w.]+))?(?:\\s+IMPLEMENTS\\s+(${NAME_LIST}))?`,
        'i',
      ),
    )
    if (!match) return undefined
    const modifier = match[1]?.toUpperCase()
    return {
      text: match[0],
      name: match[2],
      ...(match[3] ? { extends: match[3] } : {}),
      ...(match[4] ? { implements: match[4].split(',').map((n) => n.trim()) } : {}),
      ...(modifier === 'ABSTRACT' ? { isAbstract: true } : {}),
      ...(modifier === 'FINAL' ? { isFinal: true } : {}),
    }
  }
  // A FUNCTION's return type keeps its declared length (`STRING(48)`, or the
  // `STRING[48]` form): dropped, the header text ended before it and the
  // function came back returning a plain STRING.
  const match = content.match(
    new RegExp(`^\\s*(${keyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+(?:\\s*(?:\\(\\s*\\w+\\s*\\)|\\[\\s*\\w+\\s*\\]))?))?`, 'i'),
  )
  if (!match) return undefined
  return { text: match[0], name: match[2], ...(match[3] ? { returnType: match[3] } : {}) }
}

/** The header's POU-level clauses, as the model's `interface` carries them. */
export const headerInterfaceFields = (
  header: PouHeaderMatch,
): Pick<NonNullable<PLCPou['interface']>, 'extends' | 'implements' | 'isAbstract' | 'isFinal'> => ({
  ...(header.extends ? { extends: header.extends } : {}),
  ...(header.implements && header.implements.length > 0 ? { implements: header.implements } : {}),
  ...(header.isAbstract ? { isAbstract: true } : {}),
  ...(header.isFinal ? { isFinal: true } : {}),
})

/**
 * Where the first METHOD of a function block starts (IEC 61131-3 Annex A
 * `FB_Decl`: the methods follow the VAR sections and precede the body), or -1.
 *
 * A method has VAR sections of its own, so the block's declarations end before
 * it: the methods stay with the body text, ahead of the body's statements, the
 * order the standard writes them in. Comments and string literals are skipped,
 * so a `METHOD` in a comment is not one.
 */
export const findFirstMethodIndex = (content: string, fromIndex: number): number => {
  let i = fromIndex
  while (i < content.length) {
    const c = content[i]
    if (c === '(' && content[i + 1] === '*') {
      const end = content.indexOf('*)', i + 2)
      if (end === -1) return -1
      i = end + 2
      continue
    }
    if (c === '/' && content[i + 1] === '/') {
      const end = content.indexOf('\n', i)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (c === "'" || c === '"') {
      const end = content.indexOf(c, i + 1)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if ((c === 'M' || c === 'm') && (i === 0 || !/\w/.test(content[i - 1]))) {
      const word = content.slice(i, i + 6)
      if (word.toUpperCase() === 'METHOD' && !/\w/.test(content[i + 6] ?? '')) return i
    }
    i++
  }
  return -1
}

/**
 * The POU's declaration text and where its body starts.
 *
 * The text runs from the start of the LINE holding the first `VAR` keyword to
 * the last `END_VAR`, because it is written back to the file verbatim: slicing
 * at the keyword dropped the indentation in front of it and re-indented every
 * POU in the project on the first save.
 *
 * `boundAtGraphicalBody` stops the `END_VAR` scan at the JSON body of a ladder
 * or FBD POU, for the reason spelled out on `findLastEndVarIndex`.
 */
export const extractVariablesSection = (
  content: string,
  bodyStartIndex: number,
  options: { boundAtGraphicalBody?: boolean; methods?: boolean } = {},
): { text: string; bodyStartIndex: number } => {
  // A function block's methods carry VAR sections of their own: the block's
  // declarations end at the first one (see findFirstMethodIndex).
  const methodStart = options.methods === true ? findFirstMethodIndex(content, bodyStartIndex) : -1
  const varStartIndex = content.search(/\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b/i)
  if (varStartIndex === -1 || (methodStart !== -1 && varStartIndex > methodStart)) {
    return { text: '', bodyStartIndex }
  }

  const graphicalBodyStart = options.boundAtGraphicalBody ? findGraphicalBodyStartIndex(content, varStartIndex) : -1
  const stopAt = [graphicalBodyStart, methodStart].filter((index) => index !== -1)
  const lastEndVarIndex = findLastEndVarIndex(
    content,
    varStartIndex,
    stopAt.length === 0 ? undefined : Math.min(...stopAt),
  )
  if (lastEndVarIndex === -1) return { text: '', bodyStartIndex }

  // Back up over the INDENTATION in front of the keyword, and no further. The
  // line is taken so the user's indentation survives the round trip, but a POU
  // may be written `PROGRAM main VAR` on one line, and taking that whole line
  // put the header inside the declarations: the POU failed to parse, opened as
  // an unparsed fallback, and the next save wrote its header twice.
  const lineStart = content.lastIndexOf('\n', varStartIndex) + 1
  const indent = content.slice(lineStart, varStartIndex)
  const from = /^[ \t]*$/.test(indent) ? lineStart : varStartIndex
  return { text: content.slice(from, lastEndVarIndex), bodyStartIndex: lastEndVarIndex }
}

export const parseTextualPouFromString = (content: string, language: string, type: string): PLCPou => {
  try {
    const { documentation, remainingContent } = readPouDocumentation(content)

    const typeKeyword = POU_TYPE_KEYWORDS[type]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    // One header matcher for every reader (matchPouHeader): a clause it does
    // not take — EXTENDS, IMPLEMENTS, ABSTRACT — falls outside the header and
    // is dropped, so the block reaches the compiler without it.
    const header = matchPouHeader(remainingContent, type)

    if (!header) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = header.name
    const returnType = header.returnType // Only present for functions

    if (type === 'function' && !returnType) {
      throw new Error(formatParseError(`Function ${pouName} must have a return type`))
    }

    const section = extractVariablesSection(remainingContent, header.text.length, {
      methods: type === 'function-block' || type === 'interface',
    })
    const variablesString = section.text
    const bodyStartIndex = section.bodyStartIndex

    const variables = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

    const endKeyword = POU_END_KEYWORDS[type]
    const endKeywordRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endKeywordRegex)

    if (endMatch === -1) {
      throw new Error(formatParseError(`Could not find ${endKeyword}`))
    }

    const bodyContent = trimBodyText(remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch))

    // returnType is guaranteed non-empty for functions (validated above)
    /* istanbul ignore next -- defensive: returnType fallback is unreachable for functions */
    const resolvedReturnType = returnType || ''

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: resolvedReturnType } : {}),
        ...headerInterfaceFields(header),
        variables,
      },
      body: {
        language: language as 'st' | 'il',
        value: bodyContent,
      },
      documentation,
      // The declaration text is the source of truth (DOPE-650): keep the block
      // exactly as it was written, so comments, blank lines and alignment survive
      // the round trip through the table. It used to be kept only when parsing
      // FAILED, so a successful load silently discarded everything the model
      // does not carry.
      variablesText: variablesString,
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse textual POU: ${error.message}`)
    }
    throw new Error('Failed to parse textual POU: Unknown error')
  }
}

/**
 * Parse a hybrid POU (Python, C++) from string to PLCPou object
 * @param content - The text content to parse
 * @param language - The language code (python, cpp)
 * @param type - The POU type (program, function, function-block)
 * @returns Parsed PLCPou object
 * @throws Error if parsing fails
 */
export const parseHybridPouFromString = (content: string, language: string, type: string): PLCPou => {
  try {
    const { documentation, remainingContent } = readPouDocumentation(content)

    const typeKeyword = POU_TYPE_KEYWORDS[type]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    // One header matcher for every reader (matchPouHeader): a clause it does
    // not take — EXTENDS, IMPLEMENTS, ABSTRACT — falls outside the header and
    // is dropped, so the block reaches the compiler without it.
    const header = matchPouHeader(remainingContent, type)

    if (!header) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = header.name
    const returnType = header.returnType // Only present for functions

    if (type === 'function' && !returnType) {
      throw new Error(formatParseError(`Function ${pouName} must have a return type`))
    }

    const section = extractVariablesSection(remainingContent, header.text.length, {
      methods: type === 'function-block' || type === 'interface',
    })
    const variablesString = section.text
    const bodyStartIndex = section.bodyStartIndex

    const variables = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

    // Strip the trailing END keyword from the body content, matching how textual/graphical parsers handle it
    const endKeyword = POU_END_KEYWORDS[type]
    let bodyContent = remainingContent.slice(bodyStartIndex).trim()
    /* istanbul ignore next -- defensive: type already validated above */
    if (endKeyword) {
      const endKeywordRegex = new RegExp(`\\s*\\b${endKeyword}\\b\\s*$`, 'i')
      bodyContent = bodyContent.replace(endKeywordRegex, '').trim()
    }

    // returnType is guaranteed non-empty for functions (validated above)
    /* istanbul ignore next -- defensive: returnType fallback is unreachable for functions */
    const resolvedReturnType = returnType || ''

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: resolvedReturnType } : {}),
        ...headerInterfaceFields(header),
        variables,
      },
      body: {
        language: language as 'python' | 'cpp',
        value: bodyContent,
      },
      documentation,
      // The declaration text is the source of truth (DOPE-650): keep the block
      // exactly as it was written, so comments, blank lines and alignment survive
      // the round trip through the table. It used to be kept only when parsing
      // FAILED, so a successful load silently discarded everything the model
      // does not carry.
      variablesText: variablesString,
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse hybrid POU: ${error.message}`)
    }
    throw new Error('Failed to parse hybrid POU: Unknown error')
  }
}

/**
 * Parse a graphical POU (LD, FBD) from string to PLCPou object.
 * Graphical POUs store their body as JSON between the variable declarations and the END keyword.
 * @param content - The text content to parse
 * @param language - The language code (ld, fbd)
 * @param type - The POU type (program, function, function-block)
 * @returns Parsed PLCPou object
 * @throws Error if parsing fails
 */
export const parseGraphicalPouFromString = (content: string, language: string, type: string): PLCPou => {
  try {
    const { documentation, remainingContent } = readPouDocumentation(content)

    const typeKeyword = POU_TYPE_KEYWORDS[type]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    // One header matcher for every reader (matchPouHeader): a clause it does
    // not take — EXTENDS, IMPLEMENTS, ABSTRACT — falls outside the header and
    // is dropped, so the block reaches the compiler without it.
    const header = matchPouHeader(remainingContent, type)

    if (!header) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = header.name
    const returnType = header.returnType

    if (type === 'function' && !returnType) {
      throw new Error(formatParseError(`Function ${pouName} must have a return type`))
    }

    const section = extractVariablesSection(remainingContent, header.text.length, {
      boundAtGraphicalBody: true,
    })
    const variablesString = section.text
    const bodyStartIndex = section.bodyStartIndex

    const variables: PLCVariable[] = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

    const endKeyword = POU_END_KEYWORDS[type]
    const endKeywordRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endKeywordRegex)

    if (endMatch === -1) {
      throw new Error(formatParseError(`Could not find ${endKeyword}`))
    }

    const bodyContent = remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch).trim()

    let parsedBody: unknown
    try {
      parsedBody = JSON.parse(bodyContent)
    } catch (jsonError: unknown) {
      if (jsonError instanceof Error) {
        throw new Error(formatParseError(`Invalid JSON in graphical body: ${jsonError.message}`))
      }
      throw new Error(formatParseError('Invalid JSON in graphical body'))
    }

    // Deliberately OUTSIDE the catch above. A body that parsed but carries the
    // wrong shape is not a JSON error, and saying "Invalid JSON" about valid
    // JSON sends the reader hunting for a syntax error that is not there. That
    // matters here more than usual: on an unrecoverable POU this text is the
    // Console line that explains why the project opened empty.
    // Narrowing (not `as`) gives TypeScript the literal union for free.
    if ((language === 'ld' || language === 'fbd') && !isGraphicalBodyShape(parsedBody, language)) {
      throw new Error(
        formatParseError(
          `Invalid graphical body shape: ${
            language === 'ld'
              ? 'expected an object with a "rungs" array'
              : 'expected an object with a "rung" object holding a "nodes" array'
          }`,
        ),
      )
    }

    // returnType is guaranteed non-empty for functions (validated above)
    /* istanbul ignore next -- defensive: returnType fallback is unreachable for functions */
    const resolvedReturnType = returnType || ''

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: resolvedReturnType } : {}),
        ...headerInterfaceFields(header),
        variables,
      },
      body: {
        language: language as 'ld' | 'fbd',
        value: parsedBody,
      },
      documentation,
      // The declaration text is the source of truth (DOPE-650): keep the block
      // exactly as it was written, so comments, blank lines and alignment survive
      // the round trip through the table. It used to be kept only when parsing
      // FAILED, so a successful load silently discarded everything the model
      // does not carry.
      variablesText: variablesString,
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse graphical POU: ${error.message}`)
    }
    throw new Error('Failed to parse graphical POU: Unknown error')
  }
}

/**
 * Detect language from file extension
 * @param filePath - The file path with extension
 * @returns The language code
 * @throws Error if extension is not supported
 */
export const detectLanguageFromExtension = (filePath: string): string => {
  const extension = filePath.slice(filePath.lastIndexOf('.'))
  return getLanguageFromExtension(extension)
}
