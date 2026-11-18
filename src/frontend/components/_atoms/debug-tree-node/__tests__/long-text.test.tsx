/** The watch shows 126 characters of a longer STRING, says how many there are, and shows all on request. */
import { fireEvent, render, screen } from '@testing-library/react'

import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { TreeNode } from '..'

const TEXT = 'a'.repeat(126) + 'b'.repeat(174)

const renderNode = (value: string, type = 'STRING(320)') =>
  render(
    <TreeNode
      node={{ name: 'line', fullPath: 'MAIN.LINE', compositeKey: 'main:line', type, isComplex: false, debugIndex: 1 }}
      onToggleExpand={() => undefined}
      getValue={() => value}
    />,
    { wrapper: createStoreWrapper(createTestStore()) },
  )

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
})
