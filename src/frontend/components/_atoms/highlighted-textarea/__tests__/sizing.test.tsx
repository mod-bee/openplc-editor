/**
 * The text areas on a diagram (one per element) are sized to their text in one batch: every height reset
 * before the first is read, so a diagram of a thousand elements lays the page out once, not a thousand times.
 * They draw again only for their own text, not for every change in the store.
 */
import { act, render } from '@testing-library/react'
import { Profiler, useState } from 'react'

import { OpenPLCStoreProvider } from '../../../../store'
import { createTestStore } from '../../../../store/testing'
import { HighlightedTextArea } from '..'

const log: string[] = []
let textHeight = 30
const heightProperty = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'height')!

beforeEach(() => {
  log.length = 0
  textHeight = 30
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      log.push('read')
      return textHeight
    },
  })
  Object.defineProperty(CSSStyleDeclaration.prototype, 'height', {
    ...heightProperty,
    set(value: string) {
      if (value === 'auto') log.push('reset')
      heightProperty.set!.call(this, value)
    },
  })
})

afterEach(() => {
  delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
  Object.defineProperty(CSSStyleDeclaration.prototype, 'height', heightProperty)
})

const Area = ({ value, onHeight }: { value: string; onHeight?: (height: number) => void }) => {
  const [text, setText] = useState(value)
  return (
    <HighlightedTextArea
      textAreaValue={text}
      setTextAreaValue={setText}
      inputHeight={{ height: 24, scrollLimiter: 32 }}
      onHeightChange={onHeight}
    />
  )
}

describe('HighlightedTextArea sizing', () => {
  it('resets every area before reading any, and reports each height', async () => {
    const heights: number[] = []
    const { container } = render(
      <OpenPLCStoreProvider store={createTestStore()}>
        <Area value='a' onHeight={(h) => heights.push(h)} />
        <Area value='b' onHeight={(h) => heights.push(h)} />
        <Area value='c' onHeight={(h) => heights.push(h)} />
      </OpenPLCStoreProvider>,
    )
    await act(async () => {})
    // Two resets per area (the text and its highlight), then the three reads.
    expect(log).toEqual(['reset', 'reset', 'reset', 'reset', 'reset', 'reset', 'read', 'read', 'read'])
    // Text under the limit: its own height.
    expect(heights).toEqual([30, 30, 30])
    expect(container.querySelector('textarea')!.style.height).toBe('30px')
  })

  it('takes the set height once the text reaches the limit', async () => {
    textHeight = 40
    const heights: number[] = []
    const { container } = render(
      <OpenPLCStoreProvider store={createTestStore()}>
        <Area value='long' onHeight={(h) => heights.push(h)} />
      </OpenPLCStoreProvider>,
    )
    await act(async () => {})
    expect(container.querySelector('textarea')!.style.height).toBe('24px')
    expect(heights).toEqual([40])
  })

  it('does not measure again for a redraw with the same text and limits', async () => {
    const store = createTestStore()
    const { rerender } = render(
      <OpenPLCStoreProvider store={store}>
        <Area value='a' />
      </OpenPLCStoreProvider>,
    )
    await act(async () => {})
    log.length = 0
    rerender(
      <OpenPLCStoreProvider store={store}>
        <Area value='a' />
      </OpenPLCStoreProvider>,
    )
    await act(async () => {})
    expect(log).toEqual([])
  })

  it('draws again for the search query, not for other store changes', async () => {
    const store = createTestStore()
    let renders = 0
    render(
      <OpenPLCStoreProvider store={store}>
        <Profiler id='area' onRender={() => renders++}>
          <Area value='level' />
        </Profiler>
      </OpenPLCStoreProvider>,
    )
    await act(async () => {})
    const before = renders
    act(() => store.getState().workspaceActions.setDebugXrefKeys(['x']))
    expect(renders).toBe(before)
    act(() => store.getState().searchActions.setSearchQuery('lev'))
    expect(renders).toBe(before + 1)
  })
})
