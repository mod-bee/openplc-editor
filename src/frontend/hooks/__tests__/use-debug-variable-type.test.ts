/**
 * useDebugVariableType — the type of the value a diagram's name reads, from the debug tree. A variable
 * box naming a member or an element (`IO.dout[2].q`) has no declaration of its own; without the tree's
 * type its value badge had nothing to go on and stayed blank.
 */
import { renderHook } from '@testing-library/react'

import { useDebugVariableType } from '../use-debug-value'

type State = { workspace: { debugVariableTree: Map<string, { type: string }> } }
let state: State

jest.mock('../../store', () => ({
  useOpenPLCStore: (selector: (s: State) => unknown) => selector(state),
}))

beforeEach(() => {
  state = {
    workspace: {
      debugVariableTree: new Map([
        ['Config0:IO.dout[2].q', { type: 'BOOL' }],
        ['Config0:LINK.sts.wifiIp', { type: 'DWORD' }],
      ]),
    },
  }
})

describe('useDebugVariableType', () => {
  it("gives a member's or an element's type from the debug tree", () => {
    expect(renderHook(() => useDebugVariableType('Config0:LINK.sts.wifiIp')).result.current).toBe('DWORD')
    expect(renderHook(() => useDebugVariableType('Config0:IO.dout[2].q')).result.current).toBe('BOOL')
  })

  it('is undefined for a key the tree does not have, as outside a debug session', () => {
    expect(renderHook(() => useDebugVariableType('Main:nothing')).result.current).toBeUndefined()
  })
})
