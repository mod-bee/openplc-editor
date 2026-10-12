import { beforeEach, describe, expect, it } from '@jest/globals'
import { render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { BoardInfo } from '../../../../../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../../../../store/testing'
import { OutputsOnStopSelect } from '../components/outputs-on-stop-select'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })

const esp32: BoardInfo = { compiler: 'arduino-cli', core: 'esp32:esp32', preview: '', specs: {} }

describe('OutputsOnStopSelect', () => {
  it('is offered on an Arduino board, showing Off by default', () => {
    render(<OutputsOnStopSelect boardInfo={esp32} />)
    expect(screen.getByRole('combobox', { name: 'Outputs on STOP / error' }).textContent).toContain('Off')
  })

  it("shows the project's choice", () => {
    store.getState().deviceActions.setOutputsOnStop('hold')
    render(<OutputsOnStopSelect boardInfo={esp32} />)
    expect(screen.getByRole('combobox', { name: 'Outputs on STOP / error' }).textContent).toContain('Hold last value')
  })

  it('is not offered for a board it cannot reach', () => {
    render(<OutputsOnStopSelect boardInfo={undefined} />)
    expect(screen.queryByRole('combobox', { name: 'Outputs on STOP / error' })).toBeNull()
  })
})
