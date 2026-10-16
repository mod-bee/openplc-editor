import { beforeEach, describe, expect, it } from '@jest/globals'
import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { BoardInfo } from '../../../../../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../../../../store/testing'
import { BuildOutputSwitch } from '../components/build-output-switch'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })

const esp32: BoardInfo = { compiler: 'arduino-cli', core: 'esp32:esp32', preview: '', specs: {} }

describe('BuildOutputSwitch', () => {
  it('is offered on an Arduino board, off by default, without a count', () => {
    render(<BuildOutputSwitch boardInfo={esp32} />)
    expect((screen.getByRole('checkbox', { name: 'Keep build output' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByLabelText('Builds kept')).toBeNull()
  })

  it('turns on with 10 kept, and the count can be changed', () => {
    render(<BuildOutputSwitch boardInfo={esp32} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep build output' }))
    expect(store.getState().deviceDefinitions.configuration.buildOutput).toEqual({ keep: true, count: 10 })

    fireEvent.change(screen.getByLabelText('Builds kept'), { target: { value: '4' } })
    expect(store.getState().deviceDefinitions.configuration.buildOutput).toEqual({ keep: true, count: 4 })
  })

  it('turning it off removes the setting', () => {
    store.getState().deviceActions.setBuildOutput({ keep: true, count: 3 })
    render(<BuildOutputSwitch boardInfo={esp32} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep build output' }))
    expect(store.getState().deviceDefinitions.configuration.buildOutput).toBeUndefined()
  })

  it('is not offered for a board it cannot reach', () => {
    render(<BuildOutputSwitch boardInfo={undefined} />)
    expect(screen.queryByRole('checkbox', { name: 'Keep build output' })).toBeNull()
  })
})
