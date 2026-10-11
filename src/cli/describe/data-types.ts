/**
 * A data type as the spec `apply` takes, so `describe` and `apply` round-trip.
 */

import type { PLCDataType, PLCVariableType } from '@root/middleware/shared/ports/types'

/**
 * An array reads back as its ELEMENT type plus the bounds, which is what `apply`
 * takes. Reporting the store's rendered `value` ("ARRAY [0..3] OF INT") would
 * hand back a document that cannot be applied: `apply` derives that text from
 * `dimensions`, so it would end up nested inside itself on the next pass.
 */
export function describeVariableType(type: PLCVariableType): Record<string, unknown> {
  if (type.definition !== 'array' || !type.data) {
    return { definition: type.definition, value: type.value }
  }
  return {
    definition: 'array',
    value: type.data.baseType.value,
    dimensions: type.data.dimensions.map((entry) => entry.dimension),
  }
}

export function describeDataType(dataType: PLCDataType): Record<string, unknown> | null {
  if (dataType.derivation === 'enumerated') {
    // The spec `apply` takes: a bare name, or `{ name, value }` for a named
    // value (IEC 61131-3 Ed.3 6.4.4.3), so describe and apply round-trip.
    return {
      name: dataType.name,
      derivation: 'enumerated',
      ...(dataType.baseType ? { baseType: dataType.baseType } : {}),
      values: dataType.values.map((value) =>
        value.value ? { name: value.description, value: value.value } : value.description,
      ),
      ...(dataType.initialValue ? { initialValue: dataType.initialValue } : {}),
    }
  }
  if (dataType.derivation === 'structure') {
    return {
      name: dataType.name,
      derivation: 'structure',
      // Every field `apply` takes, so a describe -> apply round trip keeps the
      // member's initial value (`cmdMode : INT := -1`) and an array member's
      // bounds.
      variables: dataType.variable.map((member) => ({
        name: member.name,
        type: describeVariableType(member.type),
        ...(member.initialValue?.simpleValue?.value ? { initialValue: member.initialValue.simpleValue.value } : {}),
        ...(member.documentation ? { documentation: member.documentation } : {}),
      })),
    }
  }
  return {
    name: dataType.name,
    derivation: 'array',
    baseType: { definition: dataType.baseType.definition, value: dataType.baseType.value },
    dimensions: dataType.dimensions.map((entry) => entry.dimension),
    ...(dataType.initialValue ? { initialValue: dataType.initialValue } : {}),
  }
}
