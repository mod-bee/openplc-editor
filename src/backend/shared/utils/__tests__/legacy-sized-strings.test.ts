import type { RawProjectFile } from '../../../../middleware/shared/ports/project-port'
import { liftSizedStringTypes } from '../legacy-sized-strings'
import { parseProjectFiles } from '../parse-project-files'

// An editor that allowed only 254 saved `STRING(320)` as a user-data-type of that
// name. Loading lifts it to the base-type it always was (E3).
describe('legacy sized-string types', () => {
  it('lifts a sized STRING / WSTRING user-data-type to a base-type, anywhere in the tree', () => {
    const input = {
      variables: [
        { name: 'a', type: { definition: 'user-data-type', value: 'STRING(320)' } },
        { name: 'b', type: { definition: 'user-data-type', value: 'wstring[300]' } },
        {
          name: 'c',
          type: {
            definition: 'array',
            value: 'ARRAY[0..3] OF STRING(320)',
            data: { baseType: { definition: 'user-data-type', value: 'STRING(320)' }, dimensions: [] },
          },
        },
      ],
    }
    expect(liftSizedStringTypes(input)).toEqual({
      variables: [
        { name: 'a', type: { definition: 'base-type', value: 'STRING(320)' } },
        { name: 'b', type: { definition: 'base-type', value: 'WSTRING(300)' } },
        {
          name: 'c',
          type: {
            definition: 'array',
            value: 'ARRAY[0..3] OF STRING(320)',
            data: { baseType: { definition: 'base-type', value: 'STRING(320)' }, dimensions: [] },
          },
        },
      ],
    })
  })

  it.each(['MY_TYPE', 'STRING(0)', 'STRING(65536)', 'INT(4)', 'STRING'])('leaves %s alone', (value) => {
    const type = { definition: 'user-data-type', value }
    expect(liftSizedStringTypes({ type })).toEqual({ type })
  })

  it('returns the same object when nothing changes', () => {
    const input = { a: [{ type: { definition: 'base-type', value: 'INT' } }] }
    expect(liftSizedStringTypes(input)).toBe(input)
  })

  it('is applied on project load: globals, JSON POUs and legacy data types', () => {
    const legacy = { definition: 'user-data-type', value: 'STRING(320)' }
    const projectJson = JSON.stringify({
      meta: { name: 'P', type: 'plc-project' },
      data: {
        dataTypes: [
          {
            name: 'MSG',
            derivation: 'structure',
            variable: [{ name: 'text', type: legacy }],
          },
        ],
        pous: [],
        configuration: {
          resource: {
            tasks: [],
            instances: [],
            globalVariables: [{ name: 'G', class: 'global', type: legacy, location: '', documentation: '' }],
          },
        },
      },
    })
    const pou: RawProjectFile = {
      relativePath: 'pous/programs/main.json',
      content: JSON.stringify({
        name: 'main',
        pouType: 'program',
        interface: {
          variables: [{ name: 'w', class: 'local', type: { definition: 'user-data-type', value: 'WSTRING(1000)' } }],
        },
        body: { language: 'st', value: '' },
        documentation: '',
      }),
    }
    const result = parseProjectFiles('/p', projectJson, '{}', '[]', [pou], [], [])
    const data = result.projectData
    expect(data.configurations.resource.globalVariables[0].type).toEqual({
      definition: 'base-type',
      value: 'STRING(320)',
    })
    expect(data.pous[0].interface?.variables[0].type).toEqual({ definition: 'base-type', value: 'WSTRING(1000)' })
    expect(JSON.stringify(data.dataTypes)).toContain('{"definition":"base-type","value":"STRING(320)"}')
  })
})
