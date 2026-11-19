/**
 * useDebugCompositeKey — the key a diagram reads a debug value under. A name
 * reaching a global through the POU's VAR_EXTERNAL reads the global's value
 * (`Config0:<name>`), the key the poller polls; anything else is the POU's own.
 */
import { renderHook } from '@testing-library/react'

import type { PLCGlobalVariable, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../store'
import { createEditorObjectForPou } from '../../store/slices/shared/utils'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useDebugCompositeKey } from '../use-debug-composite-key'

const variable = (name: string, cls: PLCVariable['class']): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'BOOL' },
  location: '',
  documentation: '',
  debug: false,
})

const stirrer: PLCPou = {
  name: 'Stirrer',
  pouType: 'program',
  interface: {
    variables: [variable('mixerMotor', 'external'), variable('IO', 'external'), variable('run', 'local')],
  },
  body: { language: 'st', value: '' },
  documentation: '',
}

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
  store.getState().editorActions.setEditor(createEditorObjectForPou('Stirrer', 'program', 'st'))
  store.setState((state) => ({ project: { ...state.project, data: { ...state.project.data, pous: [stirrer] } } }))
})

const renderKey = () => renderHook(() => useDebugCompositeKey(), { wrapper: createStoreWrapper(store) }).result

describe('useDebugCompositeKey', () => {
  it('reads a pin of a global block instance and a global member from the global', () => {
    const result = renderKey()
    expect(result.current('mixerMotor.RUNNING')).toBe('Config0:mixerMotor.RUNNING')
    expect(result.current('IO.dout[6].q')).toBe('Config0:IO.dout[6].q')
  })

  it("reads the POU's own variable under the POU", () => {
    expect(renderKey().current('run')).toBe('Stirrer:run')
  })

  it("reads a name typed in another case under the debug tree's spelling", () => {
    // A compiled library stores block members in upper case; IEC names are not case-sensitive.
    store.getState().workspaceActions.setDebugVariableIndexes(
      new Map([
        ['Config0:mixerMotor.RUNNING', 4],
        ['Stirrer:RUN', 5],
      ]),
    )
    const result = renderKey()
    expect(result.current('mixerMotor.Running')).toBe('Config0:mixerMotor.RUNNING')
    expect(result.current('run')).toBe('Stirrer:RUN')
    expect(result.current('notInTree')).toBe('Stirrer:notInTree')
  })

  it('reads an array element whose subscript names a constant by its number', () => {
    const lamp: PLCGlobalVariable = {
      name: 'DO_FAULT_LAMP',
      class: 'global',
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
      flag: 'constant',
      initialValue: '2',
    }
    store.setState((state) => {
      const { configurations } = state.project.data
      return {
        project: {
          ...state.project,
          data: {
            ...state.project.data,
            configurations: { ...configurations, resource: { ...configurations.resource, globalVariables: [lamp] } },
          },
        },
      }
    })
    expect(renderKey().current('IO.dout[DO_FAULT_LAMP].q')).toBe('Config0:IO.dout[2].q')
  })
})
