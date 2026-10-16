/**
 * The project's watch list file (`debugger/watch.json`) and the store's watch list.
 */
import { createTestStore } from '../../store/testing'
import { parseWatchFile, serializeWatchFile } from '../use-debug-watch-file'

describe('watch file', () => {
  it('round-trips the items, in order', () => {
    const items = ['Config0:well.Data.set.tanks', 'Pump:motor.Start']
    expect(parseWatchFile(serializeWatchFile(items))).toEqual(items)
  })

  it('reads a missing, damaged or foreign file as an empty list', () => {
    expect(parseWatchFile(undefined)).toEqual([])
    expect(parseWatchFile('{not json')).toEqual([])
    expect(parseWatchFile('{"items": "x"}')).toEqual([])
    expect(parseWatchFile('{"items": ["a", 3, null, "b"]}')).toEqual(['a', 'b'])
  })
})

describe('watch list in the store', () => {
  it('adds once, removes, and replaces without duplicates', () => {
    const store = createTestStore()
    const { addDebugWatch, removeDebugWatch, setDebugWatchList } = store.getState().workspaceActions
    addDebugWatch('Config0:a')
    addDebugWatch('Config0:b')
    addDebugWatch('Config0:a')
    expect(store.getState().workspace.debugWatchList).toEqual(['Config0:a', 'Config0:b'])
    removeDebugWatch('Config0:a')
    expect(store.getState().workspace.debugWatchList).toEqual(['Config0:b'])
    setDebugWatchList(['x', 'x', 'y'])
    expect(store.getState().workspace.debugWatchList).toEqual(['x', 'y'])
  })

  it('does not mark the project unsaved', () => {
    const store = createTestStore()
    const before = store.getState().workspace.editingState
    store.getState().workspaceActions.addDebugWatch('Config0:a')
    expect(store.getState().workspace.editingState).toBe(before)
  })
})
