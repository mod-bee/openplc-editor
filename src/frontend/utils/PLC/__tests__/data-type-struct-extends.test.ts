// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
/**
 * STRUCT EXTENDS (CODESYS online help, "Data Structure: STRUCT", extension of
 * a type declaration): `TYPE ST_MotorSet EXTENDS ST_EquipmentSet : STRUCT`.
 * The structure's `extends` names its base; `variable` holds only its own
 * members. Read from and written to a `.dt` file, emitted for the compiler
 * with the base first, and kept on a rename of the base.
 */
import { generateDataTypes } from '../../../../backend/shared/transpilers/st-transpiler/emit/data-types'
import type { TranspileProject } from '../../../../backend/shared/transpilers/st-transpiler/types'
import type { PLCDataType } from '../../../../middleware/shared/ports/types'
import { findAllReferencesToDataType, renameDataTypeInDataType } from '../../data-type-references'
import { parseDataTypeFromText } from '../data-type-declarations'
import { serializeDataTypeToText } from '../data-type-serializer'

const derived: PLCDataType = {
  name: 'ST_MotorSet',
  derivation: 'structure',
  extends: 'ST_EquipmentSet',
  variable: [{ name: 'rSpeed', type: { definition: 'base-type', value: 'real' } }],
}

describe('a structure that EXTENDS another, in a .dt file', () => {
  it('is read with its base, as the user spelled it', () => {
    const result = parseDataTypeFromText(
      `TYPE\n  ST_MotorSet EXTENDS ST_EquipmentSet : STRUCT\n    rSpeed : REAL;\n  END_STRUCT;\nEND_TYPE\n`,
      'ST_MotorSet',
    )
    expect(result.error).toBeUndefined()
    expect(result.dataType).toMatchObject({ name: 'ST_MotorSet', derivation: 'structure', extends: 'ST_EquipmentSet' })
  })

  it('round-trips through the serializer', () => {
    const text = serializeDataTypeToText(derived)
    expect(text).toContain('ST_MotorSet EXTENDS ST_EquipmentSet : STRUCT')
    const back = parseDataTypeFromText(text, 'ST_MotorSet')
    expect(back.dataType).toMatchObject({ extends: 'ST_EquipmentSet' })
    expect(back.dataType?.derivation === 'structure' ? back.dataType.variable.map((v) => v.name) : []).toEqual([
      'rSpeed',
    ])
  })

  it('has no base when it extends nothing', () => {
    const result = parseDataTypeFromText(`TYPE\n  ST_A : STRUCT\n    n : INT;\n  END_STRUCT;\nEND_TYPE\n`, 'ST_A')
    expect(result.dataType).not.toHaveProperty('extends')
  })
})

describe('a structure that EXTENDS another, emitted for the compiler', () => {
  it('names its base, declared first', () => {
    const project: TranspileProject = {
      dataTypes: [
        {
          name: 'ST_MotorSet',
          derivation: 'structure',
          extends: 'ST_EquipmentSet',
          variable: [{ name: 'rSpeed', class: 'local', type: { definition: 'base-type', value: 'REAL' } }],
        },
        {
          name: 'ST_EquipmentSet',
          derivation: 'structure',
          variable: [{ name: 'nMode', class: 'local', type: { definition: 'base-type', value: 'INT' } }],
        },
      ],
      pous: [],
      configuration: { tasks: [], instances: [], globalVariables: [] },
    }
    const text = generateDataTypes(project)
      .map(([chunk]) => chunk)
      .join('')
    expect(text).toContain('ST_MotorSet EXTENDS ST_EquipmentSet : STRUCT')
    expect(text.indexOf('ST_EquipmentSet : STRUCT')).toBeLessThan(text.indexOf('ST_MotorSet EXTENDS'))
  })
})

describe('renaming the base of a structure', () => {
  it('counts the EXTENDS as a reference and renames it', () => {
    const impact = findAllReferencesToDataType('st_equipmentset', [], [], [derived])
    expect(impact.totalReferences).toBe(1)
    expect(renameDataTypeInDataType(derived, 'ST_EquipmentSet', 'ST_Base')).toMatchObject({ extends: 'ST_Base' })
    expect(renameDataTypeInDataType(derived, 'Other', 'X')).toBeNull()
  })
})
