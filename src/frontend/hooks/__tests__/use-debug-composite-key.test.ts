/**
 * useDebugCompositeKey — the key a diagram reads a debug value under. A name
 * reaching a global through the POU's VAR_EXTERNAL reads the global's value
 * (`Config0:<name>`), the key the poller polls; anything else is the POU's own.
 */
import { renderHook } from '@testing-library/react'

import { useDebugCompositeKey } from '../use-debug-composite-key'

type State = {
  editor: { meta: { name: string } }
  project: {
    data: {
      pous: Array<{ name: string; pouType: string; interface: { variables: Array<{ name: string; class: string }> } }>
    }
  }
  workspace: {
    fbSelectedInstance: Map<string, string>
    fbDebugInstances: Map<string, unknown[]>
    debugVariableIndexes: Map<string, number>
  }
}
let state: State

jest.mock('../../store', () => ({
  useOpenPLCStore: (selector: (s: State) => unknown) => selector(state),
}))

beforeEach(() => {
  state = {
    editor: { meta: { name: 'Stirrer' } },
    project: {
      data: {
        pous: [
          {
            name: 'Stirrer',
            pouType: 'program',
            interface: {
              variables: [
                { name: 'mixerMotor', class: 'external' },
                { name: 'IO', class: 'external' },
                { name: 'run', class: 'local' },
              ],
            },
          },
        ],
      },
    },
    workspace: { fbSelectedInstance: new Map(), fbDebugInstances: new Map(), debugVariableIndexes: new Map() },
  }
})

describe('useDebugCompositeKey', () => {
  it('reads a pin of a global block instance and a global member from the global', () => {
    const { result } = renderHook(() => useDebugCompositeKey())
    expect(result.current('mixerMotor.RUNNING')).toBe('Config0:mixerMotor.RUNNING')
    expect(result.current('IO.dout[6].q')).toBe('Config0:IO.dout[6].q')
  })

  it("reads the POU's own variable under the POU", () => {
    const { result } = renderHook(() => useDebugCompositeKey())
    expect(result.current('run')).toBe('Stirrer:run')
  })

  it("reads a name typed in another case under the debug tree's spelling", () => {
    // A compiled library stores block members in upper case; IEC names are not case-sensitive.
    state.workspace.debugVariableIndexes = new Map([
      ['Config0:mixerMotor.RUNNING', 4],
      ['Stirrer:RUN', 5],
    ])
    const { result } = renderHook(() => useDebugCompositeKey())
    expect(result.current('mixerMotor.Running')).toBe('Config0:mixerMotor.RUNNING')
    expect(result.current('run')).toBe('Stirrer:RUN')
    expect(result.current('notInTree')).toBe('Stirrer:notInTree')
  })
})
