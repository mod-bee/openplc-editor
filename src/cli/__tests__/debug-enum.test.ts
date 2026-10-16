/**
 * An enumeration online, from the CLI.
 *
 * The PLC holds an enumeration as its number; the editor shows and forces it by member name. The CLI does
 * the same: `debug force mode Auto` forces the member, and `debug read` reports the member next to the
 * number. The names come from the debug tree at the variable's address, so a variable reached by its raw
 * debug path (`INSTANCE0.M`) gets them too.
 */

import { createTestStore } from '@root/frontend/store/testing'
import { packDebugAddr, parseDebugMap } from '@root/frontend/utils/debug-parser'

import { formatValue } from '../debug/format'
import { decodeVariableValues, encodeValue, indexDebugMap } from '../debug/variables'

function enumProject() {
  const store = createTestStore()
  store.setState((state) => ({
    project: {
      ...state.project,
      data: {
        ...state.project.data,
        dataTypes: [
          {
            name: 'Mode',
            derivation: 'enumerated',
            values: [{ description: 'Off' }, { description: 'Hand' }, { description: 'Auto' }],
          },
        ] as never,
        pous: [
          {
            name: 'Main',
            pouType: 'program',
            interface: {
              variables: [
                {
                  name: 'm',
                  class: 'local',
                  type: { definition: 'derived', value: 'Mode' },
                  location: '',
                  documentation: '',
                },
              ],
            },
            body: { language: 'st', value: '' },
          },
        ] as never,
        configurations: {
          ...state.project.data.configurations,
          resource: {
            ...state.project.data.configurations.resource,
            instances: [{ name: 'INSTANCE0', task: 'Task0', program: 'Main' }],
          },
        },
      },
    },
  }))
  const map = parseDebugMap(
    JSON.stringify({
      version: 2,
      md5: 'abc',
      typeTags: {},
      arrays: [{ index: 0, count: 1 }],
      leaves: [{ arrayIdx: 0, elemIdx: 0, path: 'INSTANCE0.M', type: 'INT', size: 2 }],
    }),
  )
  if (!map) throw new Error('fixture did not parse')
  return indexDebugMap(store, map)
}

describe('an enumeration in the CLI debugger', () => {
  const index = enumProject()
  const variable = index.byIndex.get(packDebugAddr({ arrayIdx: 0, elemIdx: 0 }))

  it('knows the member names at the address, whichever name reaches it', () => {
    expect(variable).toMatchObject({ enumValues: ['Off', 'Hand', 'Auto'] })
    expect(index.byName.get('INSTANCE0.M')).toMatchObject({ enumValues: ['Off', 'Hand', 'Auto'] })
  })

  it('forces a member by name, in any case, or by number', () => {
    if (!variable) throw new Error('no variable')
    expect(encodeValue(variable, 'Auto')).toEqual({ success: true, bytes: new Uint8Array([2, 0]) })
    expect(encodeValue(variable, 'hand')).toEqual({ success: true, bytes: new Uint8Array([1, 0]) })
    expect(encodeValue(variable, '2')).toEqual({ success: true, bytes: new Uint8Array([2, 0]) })
  })

  it('refuses a name the enumeration does not have, listing the ones it has', () => {
    if (!variable) throw new Error('no variable')
    const result = encodeValue(variable, 'Remote')
    expect(result.success).toBe(false)
    expect(!result.success && result.error).toContain('Off, Hand, Auto')
  })

  it('reads the member next to the number', () => {
    if (!variable) throw new Error('no variable')
    const [value] = decodeVariableValues({
      requested: [variable],
      payload: new Uint8Array([2, 0]),
      lastIndex: 0,
      endian: 'le',
      forced: new Set(),
    })
    expect(value).toMatchObject({ value: 2, member: 'Auto' })
    expect(formatValue(value)).toBe('Auto (2)')
  })
})
