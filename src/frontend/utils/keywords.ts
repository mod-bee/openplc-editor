const booleanTypes = ['BOOL']
const unsignedIntegerTypes = ['ANY_NUM', 'USINT', 'UINT', 'UDINT', 'ULINT', 'BYTE', 'WORD', 'DWORD', 'LWORD']
const integerTypes = ['SINT', 'INT', 'DINT', 'LINT', ...unsignedIntegerTypes]
const floatTypes = ['ANY_NUM', 'REAL', 'LREAL']

const literals = [
  // Boolean Literals
  { pattern: /^(TRUE|FALSE)$/, types: booleanTypes },
  { pattern: /^(0|1)$/, types: [...booleanTypes, ...integerTypes, ...floatTypes] },
  // Number literals
  { pattern: /^2#[01_]+$/, types: integerTypes },
  { pattern: /^8#[0-7_]+$/, types: integerTypes },
  { pattern: /^16#[0-9A-Fa-f_]+$/, types: integerTypes },
  { pattern: /^-?[0-9]+$/, types: integerTypes },
  { pattern: /^-?[0-9]+\.[0-9]+$/, types: floatTypes },
  // Time literals
  { pattern: /^T#[0-9:\-_shmydSMHDY]+$/, types: ['TIME'] },
  { pattern: /^D#[0-9:\-_shmydSMHDY]+$/, types: ['DATE'] },
  { pattern: /^TOD#[0-9:\-_shmydSMHDY]+$/, types: ['TOD'] },
  { pattern: /^DT#[0-9:\-_shmydSMHDY]+$/, types: ['DT'] },
  // String literals
  { pattern: /^'.*'$/, types: ['STRING'] },
]

/**
 * The words no name may take, in any case (IEC 61131-3 Ed.3 6.1.3: keywords
 * "shall not be used for any other purpose, for example, variable names").
 *
 * Ed.3 has no keyword annex; its keywords are the terminal words of the Annex A
 * grammar. This list is those, the generic type names of 6.4.2 (Figure 5), the
 * standard function block names (also type names, so an instance may not share
 * one), and the extra words STruC++ lexes as keywords wherever they appear
 * (PROPERTY, POINTER, PERSISTENT, VAR_INST, END_GET, END_SET, …) -- a name
 * spelled like one of those does not parse.
 *
 * Not here: CODESYS words STruC++ reads as ordinary names (BEGIN, END, CONST,
 * ENUM, UNION, GOTO, LABEL, STATIC, VIRTUAL, VOID, AND_THEN, OR_ELSE,
 * VAR_STAT), and SET / GET, which are not IEC keywords at all -- the standard
 * names an RS input SET (6.6.3.5.2, Table 44). See `contextualWords`.
 */
const keywords = [
  // Structural declarations
  'PROGRAM',
  'END_PROGRAM',
  'FUNCTION',
  'END_FUNCTION',
  'FUNCTION_BLOCK',
  'END_FUNCTION_BLOCK',
  'METHOD',
  'END_METHOD',
  'CLASS',
  'END_CLASS',
  'INTERFACE',
  'END_INTERFACE',
  'NAMESPACE',
  'END_NAMESPACE',
  'CONFIGURATION',
  'END_CONFIGURATION',
  'RESOURCE',
  'END_RESOURCE',
  // `RESOURCE Res0 ON PLC` -- the compiler lexes ON as a keyword everywhere, so
  // an enumeration value named ON emits a `_types.st` that will not parse.
  'ON',
  'TASK',
  'TYPE',
  'END_TYPE',

  // Variable declarations
  'VAR',
  'VAR_INPUT',
  'VAR_OUTPUT',
  'VAR_IN_OUT',
  'VAR_TEMP',
  'VAR_GLOBAL',
  'VAR_ACCESS',
  'VAR_EXTERNAL',
  'VAR_INST',
  'VAR_CONFIG',
  'END_VAR',

  // Data structures
  'STRUCT',
  'END_STRUCT',
  'ARRAY',
  'PROPERTY',
  'END_PROPERTY',
  'RETAIN',
  'PERSISTENT',
  'NON_RETAIN',

  // Control flow
  'IF',
  'THEN',
  'ELSE',
  'ELSIF',
  'END_IF',
  'CASE',
  'OF',
  'END_CASE',
  'FOR',
  'TO',
  'BY',
  'DO',
  'END_FOR',
  'WHILE',
  'END_WHILE',
  'REPEAT',
  'UNTIL',
  'END_REPEAT',
  'EXIT',
  'RETURN',
  'CONTINUE',

  // Primitive types
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  '__XWORD',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TIME_OF_DAY',
  'TOD',
  'DATE_AND_TIME',
  'DT',
  'STRING',
  'WSTRING',
  'CHAR',
  'WCHAR',

  // Special types
  'ANY',
  'ANY_DERIVED',
  'ANY_ELEMENTARY',
  'ANY_MAGNITUDE',
  'ANY_NUM',
  'ANY_REAL',
  'ANY_INT',
  'ANY_BIT',
  'ANY_STRING',
  'ANY_DATE',
  'POINTER',
  'REF',
  'REF_TO',

  // Access modifiers
  'PUBLIC',
  'PRIVATE',
  'PROTECTED',
  'INTERNAL',
  'ABSTRACT',
  'FINAL',
  'OVERRIDE',
  'EXTENDS',
  'IMPLEMENTS',
  'THIS',
  'SUPER',

  // Constants and literals
  'TRUE',
  'FALSE',
  'NULL',

  // Logical operators as words
  'AND',
  'OR',
  'NOT',
  'XOR',
  'MOD',

  // Actions and steps (SFC)
  'ACTION',
  'END_ACTION',
  'STEP',
  'END_STEP',
  'INITIAL_STEP',
  'TRANSITION',
  'END_TRANSITION',
  'FROM',
  'TO',
  'WITH',
  'USING',

  // Attributes and directives
  'AT',
  'CONSTANT',
  'OVERLAP',
  // STruC++ property accessor blocks: lexed as keywords everywhere.
  'END_GET',
  'END_SET',

  // Standard function blocks
  'TON',
  'TOF',
  'TP',
  'CTU',
  'CTD',
  'CTUD',
  'R_TRIG',
  'F_TRIG',
  'RS',
  'SR',
]

export const builtinFunctions = [
  // Mathematical
  'ABS',
  'SQRT',
  'EXP',
  'EXPT',
  'LN',
  'LOG',
  'SIN',
  'COS',
  'TAN',
  'ASIN',
  'ACOS',
  'ATAN',
  'CEIL',
  'FLOOR',
  'ROUND',
  'TRUNC',
  'FRAC',
  'MAX',
  'MIN',
  'LIMIT',
  'MUX',
  'SEL',

  // Type conversion
  'BOOL_TO_BYTE',
  'BOOL_TO_WORD',
  'BOOL_TO_DWORD',
  'BOOL_TO_LWORD',
  'BYTE_TO_BOOL',
  'BYTE_TO_WORD',
  'BYTE_TO_DWORD',
  'BYTE_TO_LWORD',
  'WORD_TO_BOOL',
  'WORD_TO_BYTE',
  'WORD_TO_DWORD',
  'WORD_TO_LWORD',
  'DWORD_TO_BOOL',
  'DWORD_TO_BYTE',
  'DWORD_TO_WORD',
  'DWORD_TO_LWORD',
  'LWORD_TO_BOOL',
  'LWORD_TO_BYTE',
  'LWORD_TO_WORD',
  'LWORD_TO_DWORD',
  'INT_TO_REAL',
  'REAL_TO_INT',
  'DINT_TO_REAL',
  'REAL_TO_DINT',
  'STRING_TO_INT',
  'INT_TO_STRING',
  'REAL_TO_STRING',
  'STRING_TO_REAL',
  'TIME_TO_DINT',
  'DINT_TO_TIME',
  'DATE_TO_DINT',
  'DINT_TO_DATE',

  // String functions
  'CONCAT',
  'DELETE',
  'FIND',
  'INSERT',
  'LEFT',
  'LEN',
  'MID',
  'REPLACE',
  'RIGHT',
  'UPPER_CASE',
  'LOWER_CASE',
  'TRIM',

  // Bit manipulation
  'SHL',
  'SHR',
  'ROL',
  'ROR',
  // 'AND', // already included above
  // 'OR',
  // 'XOR',
  // 'NOT',

  // Memory and pointers
  'ADR',
  'SIZEOF',
  'REF',
  'DREF',
  'MOVE',
  'FILL',

  // System functions. NOW is not reserved: IEC 61131-3 Ed.3 has no NOW keyword
  // or standard function, and no bundled library declares one.
  'RTC',
  'SEMA',
  '__NEW',
  '__DELETE',
]

/**
 * SET and GET: not IEC keywords (Ed.3 6.6.3.5.2, Table 44 names an RS input
 * SET). STruC++ reads them as ordinary names in declarations, member access and
 * parameter lists, but its enumeration-value, type and POU name rules take only
 * a plain identifier, so there they still do not parse.
 */
const contextualWords = ['SET', 'GET']

/**
 * Every name nothing may take: the keywords. Exported so `openplc-cli keywords`
 * can publish exactly what `apply` enforces, rather than a second list written
 * down beside it.
 */
export const reservedWords: readonly string[] = [...keywords]

/**
 * Names a POU, data type or variable list may not take on top of
 * `reservedWords`: the standard functions (Annex A `Std_Func_Name`), which are
 * names of POUs already declared rather than keywords, and SET / GET. A
 * variable, structure field or pin may use them (`limit`, `set`): it lives in
 * its own scope, and 6.1.2 / 6.1.3 refuse only keywords there.
 */
export const elementOnlyReservedWords: readonly string[] = [...contextualWords, ...builtinFunctions]

export function getLiteralType(name: string): string[] | undefined {
  const result = literals.find((x) => x.pattern.test(name))
  if (result) {
    return ['ANY', ...result.types]
  }
}

function isLiteral(name: string): boolean {
  return getLiteralType(name) !== undefined
}

/**
 * May a variable, structure field, pin or instance take this name?
 * IEC 61131-3 Ed.3 6.1.2 (shape) and 6.1.3 (no keyword, in any case).
 */
export function isLegalIdentifier(name: string): [boolean, string] {
  if (isLiteral(name)) return [false, 'is a literal']
  if (reservedWords.includes(name.toUpperCase())) return [false, 'is a reserved word']
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return [false, 'contains illegal characters']
  return [true, '']
}

/** May a POU, data type or variable list take this name? Also not a standard function, SET or GET. */
export function isLegalElementName(name: string): [boolean, string] {
  const [legal, reason] = isLegalIdentifier(name)
  if (!legal) return [legal, reason]
  if (contextualWords.includes(name.toUpperCase())) return [false, 'is a reserved word']
  if (builtinFunctions.includes(name.toUpperCase())) return [false, 'is the name of a standard function']
  return [true, '']
}

/** May an enumeration value take this name? Also not SET or GET (see `contextualWords`). */
export function isLegalEnumValue(name: string): [boolean, string] {
  const [legal, reason] = isLegalIdentifier(name)
  if (!legal) return [legal, reason]
  if (contextualWords.includes(name.toUpperCase())) return [false, 'is a reserved word']
  return [true, '']
}

export function sanitizeVariableInput(e: HTMLInputElement) {
  const originalValue = e.value
  const originalCursorPosition = e.selectionStart || 0
  let workingValue = originalValue
  // numbers at the beginning are invalid, so help the user by preceding with an underscore
  workingValue = workingValue.replace(/^([0-9])/, '_$1')
  // substitute whitespace and hyphens with underscores
  workingValue = workingValue.replace(/[\s-]/g, '_')
  // remove any invalid characters remaining
  workingValue = workingValue.replace(/[^a-zA-Z0-9_]/g, '')
  e.value = workingValue
  // need to adjust the cursor position, by default the cursor will go to the end when changing el.value
  const cursorOffset = workingValue.length - originalValue.length
  e.selectionStart = originalCursorPosition + cursorOffset
  e.selectionEnd = e.selectionStart
}
