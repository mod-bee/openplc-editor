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
  [
    'ESP32-S3',
    { compiler: 'arduino-cli', core: 'esp32:esp32', platform: 'esp32:esp32:esp32s3', preview: '', specs: {} },
  ],
])

const tasks: PLCTask[] = [
  { name: 'logic', triggering: 'Cyclic', interval: 'T#50ms', priority: 0, stack: 8192 },
  { name: 'comms', triggering: 'Cyclic', interval: 'T#100ms', priority: 5, stopOnStuck: false },
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

const table = (data: PLCTask[] = tasks) => <TaskTable tableData={data} selectedRow={-1} handleRowClick={() => {}} />

describe('the task table Stop PLC if stuck and Stack columns', () => {
  it('shows each task setting, Yes and Default where none is set', () => {
    select('ESP32-S3')
    render(table())
    expect(screen.getByText('Stop PLC if stuck')).toBeTruthy()
    expect(screen.getByText('Stack')).toBeTruthy()
    expect(screen.getByLabelText('Stop PLC if logic is stuck').textContent).toContain('Yes')
    expect(screen.getByLabelText('Stop PLC if comms is stuck').textContent).toContain('No')
    expect(screen.getByLabelText('Stack of logic').textContent).toContain('8 KB')
    expect(screen.getByLabelText('Stack of comms').textContent).toContain('Default')
  })

  it('can be changed in RTOS mode', () => {
    select('ESP32-S3')
    render(table())
    expect(screen.getByLabelText('Stop PLC if logic is stuck').hasAttribute('disabled')).toBe(false)
    expect(screen.getByLabelText('Stack of comms').hasAttribute('disabled')).toBe(false)
  })

  it('stays on the defaults with RTOS mode off, and flags a setting the build will refuse', () => {
    select('ESP32-S3', { rtos: { enabled: false } })
    render(table([{ name: 'main', triggering: 'Cyclic', interval: 'T#50ms', priority: 0 }, ...tasks]))
    expect(screen.getByLabelText('Stop PLC if main is stuck').hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Stack of main').hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByLabelText('Setting this board cannot give the task')).toHaveLength(1)
    expect(screen.getAllByLabelText('Stack this board cannot give the task')).toHaveLength(1)
  })

  it('flags a stack outside the board range', () => {
    select('ESP32-S3')
    render(table([{ name: 'tiny', triggering: 'Cyclic', interval: 'T#50ms', priority: 0, stack: 2048 }]))
    expect(screen.getAllByLabelText('Stack this board cannot give the task')).toHaveLength(1)
  })
})
