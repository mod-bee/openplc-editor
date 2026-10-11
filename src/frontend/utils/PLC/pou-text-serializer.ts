import type { PLCPou } from '../../../middleware/shared/ports/types'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'
import { escapeCommentText } from './comment-text'
import { pouDeclarationLine } from './pou-declaration-line'
import { getEndKeyword } from './pou-file-extensions'

/** PLCPou extended with optional variablesText from code-mode editing */
type SerializablePou = PLCPou & { variablesText?: string }

// Escaped, or a `*)` in the text ends the comment early and the rest lands in
// front of the POU header, where the loader can no longer find it.
const formatDocumentation = (documentation: string | undefined): string => {
  if (documentation && documentation.trim()) {
    return `(* ${escapeCommentText(documentation.trim())} *)\n\n`
  }
  return ''
}

// EXTENDS / IMPLEMENTS / ABSTRACT must survive the round trip, or saving a
// derived POU un-derives it.
/**
 * A textual body as the file holds it: no leading or trailing whitespace. The reader takes the body back the same way, so what is written
 * is what loads -- `describe` -> `apply` and load -> save no longer add or drop
 * a blank line before END_xxx.
 */
export const trimBodyText = (text: string): string => text.trim()

const buildDeclaration = (pou: SerializablePou): string => `${pouDeclarationLine(pou)}\n`

const buildVariables = (pou: SerializablePou): string => {
  // An INTERFACE has no VAR sections of its own (IEC 61131-3 6.6.6.1).
  if (pou.pouType === 'interface') return pou.variablesText?.trim() ? pou.variablesText : ''
  if (pou.variablesText != null) return pou.variablesText
  const variables = pou.interface?.variables ?? []
  return generateIecVariablesToString(variables)
}

export const serializeTextualPouToString = (pou: SerializablePou): string => {
  if (pou.body.language !== 'st' && pou.body.language !== 'il') {
    throw new Error(`serializeTextualPouToString only supports ST and IL languages, got: ${pou.body.language}`)
  }

  let result = formatDocumentation(pou.documentation)
  result += buildDeclaration(pou)
  result += buildVariables(pou) + '\n\n'
  result += trimBodyText(String(pou.body.value)) + '\n\n'
  result += getEndKeyword(pou.pouType)

  return result
}

export const serializeHybridPouToString = (pou: SerializablePou): string => {
  if (pou.body.language !== 'python' && pou.body.language !== 'cpp') {
    throw new Error(`serializeHybridPouToString only supports Python and C++ languages, got: ${pou.body.language}`)
  }

  let result = formatDocumentation(pou.documentation)
  result += buildDeclaration(pou)
  result += buildVariables(pou) + '\n'
  result += pou.body.value + '\n\n'
  result += getEndKeyword(pou.pouType)

  return result
}

export const serializeGraphicalPouToString = (pou: SerializablePou): string => {
  if (pou.body.language !== 'ld' && pou.body.language !== 'fbd') {
    throw new Error(`serializeGraphicalPouToString only supports LD and FBD languages, got: ${pou.body.language}`)
  }

  let result = formatDocumentation(pou.documentation)
  result += buildDeclaration(pou)
  result += buildVariables(pou) + '\n\n'
  result += JSON.stringify(pou.body.value, null, 2) + '\n'
  result += getEndKeyword(pou.pouType)

  return result
}

export const serializePouToText = (pou: SerializablePou): string => {
  const language = pou.body.language

  if (language === 'st' || language === 'il') {
    return serializeTextualPouToString(pou)
  } else if (language === 'python' || language === 'cpp') {
    return serializeHybridPouToString(pou)
  } else if (language === 'ld' || language === 'fbd') {
    return serializeGraphicalPouToString(pou)
  } else {
    throw new Error(`Unsupported language: ${language}`)
  }
}
