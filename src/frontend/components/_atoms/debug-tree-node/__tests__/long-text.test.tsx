/** The watch shows 126 characters of a longer STRING, says how many there are, and shows all on request. */
import { fireEvent, render, screen } from '@testing-library/react'

import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { TreeNode } from '..'

const TEXT = 'a'.repeat(126) + 'b'.repeat(174)

/** `runtimeLength`: what FC 0x4F reported, as the poller stores it. */
const renderNode = (value: string, type = 'STRING(320)', runtimeLength?: number) => {
  const store = createTestStore()
  if (runtimeLength !== undefined) {
    store.getState().workspaceActions.setDebugValues({ textLengths: new Map([['main:line', runtimeLength]]) })
  }
  return render(
    <TreeNode
      node={{ name: 'line', fullPath: 'MAIN.LINE', compositeKey: 'main:line', type, isComplex: false, debugIndex: 1 }}
      onToggleExpand={() => undefined}
      getValue={() => value}
    />,
    { wrapper: createStoreWrapper(store) },
  )
}

describe('watch: a STRING longer than 126 characters', () => {
  it('shows 126 characters and "126 of n shown"', () => {
    renderNode(`"${TEXT}"`)
    expect(screen.getByText(`"${'a'.repeat(126)}…"`)).toBeTruthy()
    expect(screen.getByTestId('debug-long-text-toggle').textContent).toBe('126 of 300 shown · Show all')
    expect(screen.queryByTestId('debug-long-text')).toBeNull()
  })

  it('shows the whole value on "Show all"', () => {
    renderNode(`"${TEXT}"`)
    fireEvent.click(screen.getByTestId('debug-long-text-toggle'))
    expect(screen.getByTestId('debug-long-text').textContent).toBe(TEXT)
    expect(screen.getByTestId('debug-long-text-toggle').textContent).toContain('Show less')
  })

  it('a value that fits has no note', () => {
    renderNode('"short"')
    expect(screen.queryByTestId('debug-long-text-toggle')).toBeNull()
  })

  it('counts a STRING in bytes, as the runtime does', () => {
    // 150 two-byte characters: 300 bytes, of which the 126-byte window holds 63 characters.
    renderNode(`"${'é'.repeat(150)}"`, 'STRING(320)', 300)
    expect(screen.getByTestId('debug-long-text-toggle').textContent).toBe('126 of 300 shown · Show all')
    expect(screen.getByText(`"${'é'.repeat(63)}…"`)).toBeTruthy()
  })

  it('counts a WSTRING in UTF-16 code units', () => {
    renderNode(`"${'Ω'.repeat(200)}"`, 'WSTRING(300)', 200)
    expect(screen.getByTestId('debug-long-text-toggle').textContent).toBe('126 of 200 shown · Show all')
  })
})
