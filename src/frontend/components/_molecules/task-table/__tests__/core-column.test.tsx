import { beforeEach, describe, expect, it } from '@jest/globals'
import { render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { BoardInfo, PLCTask } from '../../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { TaskTable } from '..'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })

const boards = new Map<string, BoardInfo>([
  ['ESP32-S3', { compiler: 'arduino-cli', core: 'esp32:esp32', platform: 'esp32:esp32:esp32s3', preview: '', specs: {} }],
  ['ESP32-C3', { compiler: 'arduino-cli', core: 'esp32:esp32', platform: 'esp32:esp32:esp32c3', preview: '', specs: {} }],
])

const tasks: PLCTask[] = [
  { name: 'main', triggering: 'Cyclic', interval: 'T#50ms', priority: 0 },
  { name: 'net', triggering: 'Cyclic', interval: 'T#20ms', priority: 1, core: 0 },
]

function select(board: string, vendorScreenData: Record<string, unknown> = {}) {
  store.setState((state) => ({
    deviceAvailableOptions: { ...state.deviceAvailableOptions, availableBoards: boards },
    deviceDefinitions: {
      ...state.deviceDefinitions,
      configuration: { ...state.deviceDefinitions.configuration, deviceBoard: board, vendorScreenData },
    },
  }))
}

describe('the task table Core column', () => {
  it('shows each task core, Auto where none is set', () => {
    select('ESP32-S3')
    render(<TaskTable tableData={tasks} selectedRow={-1} handleRowClick={() => {}} />)
    expect(screen.getByText('Core')).toBeTruthy()
    expect(screen.getByLabelText('Core of main').textContent).toContain('Auto')
    expect(screen.getByLabelText('Core of net').textContent).toContain('Core 0')
  })

  it('can be changed on a dual-core board in RTOS mode', () => {
    select('ESP32-S3')
    render(<TaskTable tableData={tasks} selectedRow={-1} handleRowClick={() => {}} />)
    expect(screen.getByLabelText('Core of main').hasAttribute('disabled')).toBe(false)
  })

  it('offers Auto only on a single-core board, or with RTOS mode off', () => {
    select('ESP32-C3')
    const { unmount } = render(<TaskTable tableData={tasks} selectedRow={-1} handleRowClick={() => {}} />)
    expect(screen.getByLabelText('Core of main').hasAttribute('disabled')).toBe(true)
    unmount()
    select('ESP32-S3', { rtos: { enabled: false } })
    render(<TaskTable tableData={tasks} selectedRow={-1} handleRowClick={() => {}} />)
    expect(screen.getByLabelText('Core of main').hasAttribute('disabled')).toBe(true)
  })

  it('flags a core the board cannot give the task', () => {
    select('ESP32-C3')
    render(<TaskTable tableData={tasks} selectedRow={-1} handleRowClick={() => {}} />)
    expect(screen.queryAllByLabelText('Core this board cannot give the task')).toHaveLength(0)
    const pinned: PLCTask[] = [{ name: 'net', triggering: 'Cyclic', interval: 'T#20ms', priority: 1, core: 1 }]
    render(<TaskTable tableData={pinned} selectedRow={-1} handleRowClick={() => {}} />)
    expect(screen.getAllByLabelText('Core this board cannot give the task')).toHaveLength(1)
  })
})
