/**
 * useDebugVariableType — the type of the value a diagram's name reads, from the debug tree. A variable
 * box naming a member or an element (`IO.dout[2].q`) has no declaration of its own; without the tree's
 * type its value badge had nothing to go on and stayed blank.
 */
import { renderHook } from '@testing-library/react'

import type { DebugTreeNode } from '../../../middleware/shared/ports/types'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useDebugVariableType } from '../use-debug-value'

const leaf = (compositeKey: string, type: string): DebugTreeNode => ({
  name: compositeKey,
  fullPath: compositeKey,
  compositeKey,
  type,
  isComplex: false,
})

const renderType = (key: string) => {
  const store = createTestStore()
  store.getState().workspaceActions.setDebugVariableTree(
    new Map([
      ['Config0:IO.dout[2].q', leaf('Config0:IO.dout[2].q', 'BOOL')],
      ['Config0:LINK.sts.wifiIp', leaf('Config0:LINK.sts.wifiIp', 'DWORD')],
    ]),
  )
  return renderHook(() => useDebugVariableType(key), { wrapper: createStoreWrapper(store) }).result.current
}

describe('useDebugVariableType', () => {
  it("gives a member's or an element's type from the debug tree", () => {
    expect(renderType('Config0:LINK.sts.wifiIp')).toBe('DWORD')
    expect(renderType('Config0:IO.dout[2].q')).toBe('BOOL')
  })

  it('is undefined for a key the tree does not have, as outside a debug session', () => {
    expect(renderType('Main:nothing')).toBeUndefined()
  })
})
