import type { PLCPou } from '../../../middleware/shared/ports/types'
import { getStartKeyword } from './pou-file-extensions'

/**
 * A POU's declaration line, without a line break (IEC 61131-3 Annex A):
 * `PROGRAM Main`, `FUNCTION Add : INT`, `FUNCTION_BLOCK [ABSTRACT | FINAL]
 * Pump [EXTENDS Base] [IMPLEMENTS I1, I2]`, `INTERFACE I [EXTENDS A, B]`.
 *
 * One writer for the file serializer and the LSP stub, so a clause the model
 * carries survives both: a dropped EXTENDS un-derives a block on save, a
 * dropped IMPLEMENTS makes its instances unassignable to the interface.
 */
export const pouDeclarationLine = (pou: Pick<PLCPou, 'pouType' | 'name' | 'interface'>): string => {
  const startKeyword = getStartKeyword(pou.pouType)
  const iface = pou.interface
  if (pou.pouType === 'function' && iface?.returnType) {
    return `${startKeyword} ${pou.name} : ${iface.returnType}`
  }
  if (pou.pouType === 'interface') {
    return iface?.extends ? `${startKeyword} ${pou.name} EXTENDS ${iface.extends}` : `${startKeyword} ${pou.name}`
  }
  const modifier = iface?.isAbstract ? 'ABSTRACT ' : iface?.isFinal ? 'FINAL ' : ''
  let line = `${startKeyword} ${modifier}${pou.name}`
  if (iface?.extends) line += ` EXTENDS ${iface.extends}`
  if (iface?.implements && iface.implements.length > 0) line += ` IMPLEMENTS ${iface.implements.join(', ')}`
  return line
}
