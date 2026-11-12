/** A declaration's attribute pragmas (CODESYS), one line each, written before it. */
import { renderAttributePragma } from '../../../../../frontend/utils/PLC/attribute-pragmas'
import type { ProgramChunk } from '../helpers/program'
import type { TranspileVariable } from '../types'

export function attributeChunks(variable: TranspileVariable, indent: string): ProgramChunk[] {
  return (variable.attributes ?? []).map((attribute) => [`${indent}${renderAttributePragma(attribute)}\n`, []])
}
