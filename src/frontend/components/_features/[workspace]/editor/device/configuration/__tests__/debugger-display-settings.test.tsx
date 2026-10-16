import { beforeEach, describe, expect, it } from '@jest/globals'
import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { OpenPLCStore } from '../../../../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../../../../store/testing'
import { DebuggerDisplaySettings } from '../components/debugger-display-settings'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })
const setting = () => store.getState().deviceDefinitions.configuration.debugDisplay
const toggle = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

describe('DebuggerDisplaySettings', () => {
  it('shows the defaults when the project sets nothing: 3 decimals, inputs shown, passwords hidden', () => {
    render(<DebuggerDisplaySettings />)
    expect((screen.getByLabelText('Decimal places') as HTMLInputElement).value).toBe('3')
    expect(toggle('Block input values').checked).toBe(true)
    expect(toggle('Function input values').checked).toBe(true)
    expect(toggle('Hide passwords').checked).toBe(true)
  })

  it('stores only what differs from the defaults, and nothing once back at them', () => {
    render(<DebuggerDisplaySettings />)
    fireEvent.change(screen.getByLabelText('Decimal places'), { target: { value: '1' } })
    fireEvent.click(toggle('Function input values'))
    expect(setting()).toEqual({ decimals: 1, functionInputs: false })

    fireEvent.change(screen.getByLabelText('Decimal places'), { target: { value: '3' } })
    fireEvent.click(toggle('Function input values'))
    expect(setting()).toBeUndefined()
  })

  it('refuses decimals outside 0..6', () => {
    render(<DebuggerDisplaySettings />)
    fireEvent.change(screen.getByLabelText('Decimal places'), { target: { value: '9' } })
    expect(setting()).toBeUndefined()
  })
})
