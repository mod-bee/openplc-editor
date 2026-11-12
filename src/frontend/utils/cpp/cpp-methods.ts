import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { parseIecStringToVariables } from '../generate-iec-string-to-variables'
import { isArrayVariable, isDescriptorPinType, multiDimensionalContainerType } from '../PLC/array-codegen-helpers'
import { CPP_RUNTIME_INTERNAL_VARIABLE } from './addCppLocalVariables'

/**
 * METHODs of a C/C++ function block (IEC 61131-3 6.6.5.4).
 *
 * The block's file declares each method in its IEC header, after the VAR
 * sections, with no body:
 *
 *     METHOD PUBLIC Record : BOOL
 *       VAR_INPUT DATA : ANY; SETTINGS : STRING; END_VAR
 *     END_METHOD
 *
 * and implements it in the C++ as a function of the same name taking no
 * parameters, `bool Record() { ... }`, where the method's parameters, the
 * block's pins and its VARs are reachable by name. The declarations sit at the
 * head of the POU's body text, as an ST block's methods do, so the model and the
 * file round-trip unchanged; everything here reads them from there.
 */

type CppMethodAccess = 'PUBLIC' | 'PRIVATE' | 'PROTECTED' | 'INTERNAL'

type CppMethod = {
  /** As declared. */
  name: string
  access?: CppMethodAccess
  modifiers: string[]
  /** As declared (`BOOL`, `STRING[20]`); absent for a method returning nothing. */
  returnType?: string
  /** Its VAR_INPUT / VAR_IN_OUT / VAR_OUTPUT parameters, in declaration order. */
  variables: PLCVariable[]
  /** The declaration as written, from `METHOD` up to (not including) `END_METHOD`. */
  declaration: string
}

type CppMethodSplit = {
  methods: CppMethod[]
  /** The C++ after the declarations: the body itself when there are none. */
  code: string
  errors: string[]
}

/** Glue-side names inside the C++ function; a parameter may not take them. */
const RESERVED_PARAMETER_NAMES = new Set(['VARS', 'ARGS'])
/** The block's own entry points. */
const RESERVED_METHOD_NAMES = new Set(['SETUP', 'LOOP'])

/** Index just past the IEC comment at `at`, or `at` when none starts there. */
const skipIecComment = (text: string, at: number): number => {
  const two = text.slice(at, at + 2)
  const close = two === '(*' ? '*)' : two === '/*' ? '*/' : two === '//' ? '\n' : null
  if (close === null) return at
  const end = text.indexOf(close, at + 2)
  return end === -1 ? text.length : end + close.length
}

/** `text` with every IEC comment blanked, offsets and line breaks kept. */
const blankIecComments = (text: string): string => {
  let out = ''
  let at = 0
  while (at < text.length) {
    const end = skipIecComment(text, at)
    if (end !== at) {
      out += text.slice(at, end).replace(/[^\n]/g, ' ')
      at = end
      continue
    }
    out += text[at]
    at++
  }
  return out
}

/** Index of the `END_METHOD` closing the method opened before `from`, or -1. */
const findEndMethod = (text: string, from: number): number => {
  let at = from
  while (at < text.length) {
    const skipped = skipIecComment(text, at)
    if (skipped !== at) {
      at = skipped
      continue
    }
    const c = text[at]
    if (c === "'" || c === '"') {
      const end = text.indexOf(c, at + 1)
      at = end === -1 ? text.length : end + 1
      continue
    }
    if (!/\w/.test(text[at - 1] ?? ' ') && /^END_METHOD\b/i.test(text.slice(at, at + 11))) return at
    at++
  }
  return -1
}

const METHOD_HEADER =
  /^METHOD((?:\s+(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT|OVERRIDE))*)\s+([A-Za-z_]\w*)\s*(?::\s*(\S[\s\S]*?))?\s*$/i

const VAR_KEYWORD_SOURCE = '\\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP|_INST|_STAT|_EXTERNAL|_GLOBAL|_ACCESS|_CONFIG)?\\b'

/** Parse one declaration, `METHOD` up to `END_METHOD`. */
const parseMethod = (declaration: string, errors: string[]): CppMethod | undefined => {
  const blank = blankIecComments(declaration)
  const firstVar = new RegExp(VAR_KEYWORD_SOURCE, 'i').exec(blank)
  const headerEnd = firstVar?.index ?? blank.length
  const header = METHOD_HEADER.exec(blank.slice(0, headerEnd).trim())
  if (!header) {
    errors.push(
      `Cannot read the method declaration "${blank.slice(0, headerEnd).trim().split('\n')[0]}". ` +
        'Write it as "METHOD PUBLIC <name> : <type>" (or without ": <type>" for a method that returns nothing).',
    )
    return undefined
  }
  const words = header[1].trim() === '' ? [] : header[1].trim().toUpperCase().split(/\s+/)
  const access = words.find((word): word is CppMethodAccess =>
    ['PUBLIC', 'PRIVATE', 'PROTECTED', 'INTERNAL'].includes(word),
  )
  const name = header[2]
  const returnType = header[3]?.trim()

  let variables: PLCVariable[] = []
  if (firstVar) {
    const lastEndVar = blank.search(/\bEND_VAR\b(?![\s\S]*\bEND_VAR\b)/i)
    if (lastEndVar === -1) {
      errors.push(`Method "${name}": a VAR section has no END_VAR.`)
      return undefined
    }
    const sectionsEnd = lastEndVar + 'END_VAR'.length
    if (blank.slice(sectionsEnd).trim() !== '') {
      errors.push(
        `Method "${name}" of a C/C++ block declares its interface only. ` +
          `Write its body in C++, as the function "${name}()".`,
      )
      return undefined
    }
    const sections = blank.slice(firstVar.index, sectionsEnd)
    const refused = Array.from(sections.matchAll(new RegExp(VAR_KEYWORD_SOURCE, 'gi')), (match) =>
      match[0].toUpperCase(),
    ).filter((keyword) => !['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT'].includes(keyword))
    if (refused.length > 0) {
      errors.push(
        `Method "${name}" declares ${refused[0]}. A C/C++ block's method takes VAR_INPUT, VAR_IN_OUT and ` +
          'VAR_OUTPUT only; keep working values as locals of its C++ function.',
      )
      return undefined
    }
    try {
      variables = parseIecStringToVariables(declaration.slice(firstVar.index, sectionsEnd))
    } catch (error) {
      errors.push(`Method "${name}": ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  return {
    name,
    ...(access !== undefined ? { access } : {}),
    modifiers: words.filter((word) => word !== access),
    ...(returnType !== undefined && returnType !== '' ? { returnType } : {}),
    variables,
    declaration,
  }
}

/**
 * Split a C/C++ block's body into its METHOD declarations and its C++.
 *
 * Declarations are read from the head of the body, with comments between
 * them, up to the first text that is not one: that is the C++. A body that
 * declares no method is returned unchanged.
 */
const splitCppMethods = (body: string): CppMethodSplit => {
  const methods: CppMethod[] = []
  const errors: string[] = []
  let at = 0
  let end = 0
  while (at < body.length) {
    if (/\s/.test(body[at])) {
      at++
      continue
    }
    const skipped = skipIecComment(body, at)
    if (skipped !== at) {
      at = skipped
      continue
    }
    if (!/^METHOD\b/i.test(body.slice(at, at + 7))) break
    const close = findEndMethod(body, at + 6)
    if (close === -1) {
      errors.push(`A METHOD of this C/C++ block has no END_METHOD.`)
      return { methods, code: body, errors }
    }
    const method = parseMethod(body.slice(at, close), errors)
    if (method) methods.push(method)
    at = end = close + 'END_METHOD'.length
  }
  if (methods.length === 0 && errors.length === 0) return { methods, code: body, errors }
  return { methods, code: body.slice(end).replace(/^[ \t]*\r?\n/, ''), errors }
}

/** The C/C++ text with comments and literals blanked, offsets and line breaks kept. */
const blankCppCommentsAndLiterals = (code: string): string => {
  let out = ''
  let at = 0
  while (at < code.length) {
    const two = code.slice(at, at + 2)
    let end = at
    if (two === '//') {
      end = code.indexOf('\n', at)
      if (end === -1) end = code.length
    } else if (two === '/*') {
      end = code.indexOf('*/', at + 2)
      end = end === -1 ? code.length : end + 2
    } else if (code[at] === '"' || code[at] === "'") {
      const quote = code[at]
      end = at + 1
      while (end < code.length && code[end] !== quote && code[end] !== '\n') {
        end += code[end] === '\\' ? 2 : 1
      }
      end = Math.min(end + 1, code.length)
    }
    if (end !== at) {
      out += code.slice(at, end).replace(/[^\n]/g, ' ')
      at = end
      continue
    }
    out += code[at]
    at++
  }
  return out
}

/** One method's C++ function as written: `<returnType> <name>() {`. */
type CppMethodDefinition = {
  /** Start of the return type. */
  start: number
  /** Just past the opening brace. */
  end: number
  returnType: string
}

const NOT_A_TYPE = /\b(?:return|else|case|do|if|while|for|switch|new|delete|throw|goto|sizeof)\b/

/**
 * Every definition of a function named `name` (any case) with no parameters,
 * found outside comments and literals.
 */
const findMethodDefinitions = (code: string, name: string): CppMethodDefinition[] => {
  const blank = blankCppCommentsAndLiterals(code)
  const pattern = /\b([A-Za-z_]\w*)\s*\(\s*(?:void\s*)?\)\s*\{/g
  const found: CppMethodDefinition[] = []
  for (const match of blank.matchAll(pattern)) {
    if (match[1].toUpperCase() !== name.toUpperCase()) continue
    const nameStart = match.index
    const boundary = Math.max(
      blank.lastIndexOf(';', nameStart),
      blank.lastIndexOf('{', nameStart),
      blank.lastIndexOf('}', nameStart),
    )
    // Preprocessor lines between the boundary and the name are not the type.
    let typeStart = boundary + 1
    let typeText = blank.slice(typeStart, nameStart)
    for (const line of typeText.match(/^[ \t]*#[^\n]*\n/gm) ?? []) {
      const index = typeText.indexOf(line)
      typeStart += index + line.length
      typeText = typeText.slice(index + line.length)
    }
    const returnType = typeText.trim()
    if (returnType === '' || !/^[\w:<>,*&\s]+$/.test(returnType) || NOT_A_TYPE.test(returnType)) continue
    found.push({
      start: typeStart + typeText.indexOf(returnType),
      end: nameStart + match[0].length,
      returnType,
    })
  }
  return found
}

/** The C name of a method's entry point: `<pou>__<method>`, lower case. */
const cppMethodFunctionName = (pouName: string, methodName: string): string =>
  `${pouName.toLowerCase()}__${methodName.toLowerCase()}`

/** The C struct holding a method's parameters: `<POU>_<METHOD>_ARGS`. */
const cppMethodArgsStructName = (pouName: string, methodName: string): string =>
  `${pouName.toUpperCase()}_${methodName.toUpperCase()}_ARGS`

const isRefusedReturnType = (type: string): string | undefined => {
  const upper = type.toUpperCase()
  if (isDescriptorPinType(upper) || upper.startsWith('ANY')) return 'a generic type'
  if (upper.startsWith('ARRAY')) return 'an array'
  if (/^(?:REF_TO|REFERENCE\s+TO|POINTER\s+TO)\b/.test(upper)) return 'a reference'
  return undefined
}

/**
 * Everything wrong with a C/C++ POU's methods, each as a message naming the
 * POU. Empty for a POU that declares none.
 */
const cppMethodErrors = (pou: {
  name: string
  pouType: string
  variables: readonly PLCVariable[]
  body: string
}): string[] => {
  const split = splitCppMethods(pou.body)
  const errors = split.errors.map((error) => `"${pou.name}": ${error}`)
  if (split.methods.length === 0) return errors

  const at = (method: CppMethod) => `"${pou.name}.${method.name}"`
  if (pou.pouType !== 'function-block') {
    errors.push(`"${pou.name}": only a function block has methods (IEC 61131-3 6.6.5.4).`)
    return errors
  }

  const blockNames = new Set(pou.variables.map((variable) => variable.name.toUpperCase()))
  blockNames.add(CPP_RUNTIME_INTERNAL_VARIABLE.toUpperCase())
  const seen = new Set<string>()

  for (const method of split.methods) {
    const upper = method.name.toUpperCase()
    if (seen.has(upper)) errors.push(`${at(method)} is declared more than once.`)
    seen.add(upper)
    if (RESERVED_METHOD_NAMES.has(upper)) {
      errors.push(`${at(method)}: "${method.name}" is the block's own entry point; name the method otherwise.`)
    }
    if (blockNames.has(upper)) {
      errors.push(`${at(method)}: the block already has a variable named "${method.name}".`)
    }
    if (method.access !== 'PUBLIC') {
      errors.push(
        `${at(method)}: declare it METHOD PUBLIC. A method without an access specifier is PROTECTED ` +
          '(IEC 61131-3 6.6.5.4), and only a PUBLIC method can be called on an instance.',
      )
    }
    for (const modifier of method.modifiers) {
      if (modifier === 'ABSTRACT' || modifier === 'OVERRIDE') {
        errors.push(`${at(method)}: ${modifier} does not apply to a C/C++ block's method.`)
      }
    }
    if (method.returnType !== undefined) {
      const refused = isRefusedReturnType(method.returnType)
      if (refused) errors.push(`${at(method)}: a method cannot return ${refused} ("${method.returnType}").`)
    }
    const params = new Set<string>()
    for (const variable of method.variables) {
      const name = variable.name.toUpperCase()
      if (blockNames.has(name)) {
        errors.push(
          `${at(method)}: the parameter "${variable.name}" has the name of a variable of the block. ` +
            'In the C++ both are reached by name, so give the parameter its own name.',
        )
      }
      if (RESERVED_PARAMETER_NAMES.has(name)) {
        errors.push(`${at(method)}: "${variable.name}" is used by the generated C++; name the parameter otherwise.`)
      }
      if (name === upper) {
        errors.push(`${at(method)}: the parameter "${variable.name}" has the method's own name.`)
      }
      if (params.has(name)) errors.push(`${at(method)}: the parameter "${variable.name}" is declared twice.`)
      params.add(name)
    }

    const definitions = findMethodDefinitions(split.code, method.name)
    if (definitions.length === 0) {
      errors.push(
        `${at(method)} has no C++ function. Define "${method.returnType === undefined ? 'void' : '<type>'} ` +
          `${method.name}() { ... }" in the block's C++.`,
      )
    } else if (definitions.length > 1) {
      errors.push(`${at(method)} has ${definitions.length} C++ functions "${method.name}()"; define it once.`)
    } else {
      const isVoid = definitions[0].returnType === 'void'
      if (method.returnType === undefined && !isVoid) {
        errors.push(`${at(method)} returns nothing, so its C++ function must be "void ${method.name}()".`)
      }
      if (method.returnType !== undefined && isVoid) {
        errors.push(`${at(method)} returns ${method.returnType}, so its C++ function cannot be void.`)
      }
    }
  }
  return errors
}

/**
 * The statement binding one parameter to its name inside the method's C++
 * function, as a pin is bound in `loop()`: a one-dimensional array to its
 * offset pointer, anything else to the value itself.
 */
const cppMethodParameterBinding = (variable: PLCVariable): string => {
  const field = `args->${variable.name.toUpperCase()}`
  const binding =
    isArrayVariable(variable) && !multiDimensionalContainerType(variable)
      ? `auto* const ${variable.name} = ${field};`
      : `auto& ${variable.name} = *${field};`
  return `${binding} (void)${variable.name};`
}

export {
  blankCppCommentsAndLiterals,
  type CppMethod,
  cppMethodArgsStructName,
  cppMethodErrors,
  cppMethodFunctionName,
  cppMethodParameterBinding,
  type CppMethodSplit,
  findMethodDefinitions,
  splitCppMethods,
}
