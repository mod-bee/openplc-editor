import type { PLCPou as IpcPou } from '@root/backend/shared/types/PLC/open-plc'
import type { PLCPou as FlatPou } from '@root/middleware/shared/ports/types'

/**
 * Convert the editor backend's nested IPC POU format to the flat port POU
 * format expected by shared utilities (e.g. serializePouToText).
 */
export function ipcPouToFlat(pou: IpcPou): FlatPou & { variablesText?: string } {
  const data = pou.data as Record<string, unknown>
  return {
    name: pou.data.name,
    pouType: pou.type as FlatPou['pouType'],
    interface: {
      returnType: (data.returnType as string | undefined) ?? undefined,
      // Named explicitly, or `serializePouToText` drops the EXTENDS clause.
      ...(data.extends ? { extends: data.extends as string } : {}),
      // IMPLEMENTS / ABSTRACT / FINAL likewise (IEC 61131-3 6.6.6.4, 6.6.5.8).
      ...(Array.isArray(data.implements) && data.implements.length > 0
        ? { implements: data.implements as string[] }
        : {}),
      ...(data.isAbstract === true ? { isAbstract: true } : {}),
      ...(data.isFinal === true ? { isFinal: true } : {}),
      variables: (data.variables ?? []) as NonNullable<FlatPou['interface']>['variables'],
    },
    body: pou.data.body as FlatPou['body'],
    documentation: pou.data.documentation,
    variablesText: (data.variablesText as string | undefined) ?? undefined,
  }
}
