import { createStore } from 'zustand/vanilla'

import { createSearchSlice } from '../slices/search/slice'
import type { Project, SearchSlice } from '../slices/search/types'

function makeStore() {
  return createStore<SearchSlice>()(createSearchSlice)
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    searchQuery: 'test',
    projectName: 'Project1',
    functions: {
      pous: {
        program: [],
        function: [],
        'function-block': [],
      },
      dataTypes: [],
      globals: [],
      resource: { task: '', instance: '' },
    },
    searchID: 'id-1',
    ...overrides,
  }
}

describe('createSearchSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    const state = store.getState()
    expect(state.searchQuery).toBe('')
    expect(state.searchResults).toEqual([])
    expect(state.sensitiveCase).toBe(false)
    expect(state.regularExpression).toBe(false)
    expect(state.revealTarget).toBeNull()
  })

  // -------------------------------------------------------------------------
  // setSearchQuery
  // -------------------------------------------------------------------------
  it('setSearchQuery', () => {
    store.getState().searchActions.setSearchQuery('hello')
    expect(store.getState().searchQuery).toBe('hello')
  })

  // -------------------------------------------------------------------------
  // setSearchResults
  // -------------------------------------------------------------------------
  it('setSearchResults adds a new result', () => {
    const project = makeProject()
    store.getState().searchActions.setSearchResults(project)
    expect(store.getState().searchResults).toHaveLength(1)
    expect(store.getState().searchResults[0]).toEqual(project)
  })

  it('setSearchResults replaces an existing result with same searchQuery', () => {
    const project1 = makeProject({ searchID: 'id-1', searchQuery: 'test', projectName: 'P1' })
    const project2 = makeProject({ searchID: 'id-2', searchQuery: 'test', projectName: 'P2' })

    store.getState().searchActions.setSearchResults(project1)
    store.getState().searchActions.setSearchResults(project2)

    expect(store.getState().searchResults).toHaveLength(1)
    expect(store.getState().searchResults[0].projectName).toBe('P2')
  })

  it('setSearchResults adds results with different searchQuery', () => {
    const project1 = makeProject({ searchQuery: 'foo' })
    const project2 = makeProject({ searchQuery: 'bar' })

    store.getState().searchActions.setSearchResults(project1)
    store.getState().searchActions.setSearchResults(project2)

    expect(store.getState().searchResults).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // setSensitiveCase
  // -------------------------------------------------------------------------
  it('setSensitiveCase', () => {
    store.getState().searchActions.setSensitiveCase(true)
    expect(store.getState().sensitiveCase).toBe(true)

    store.getState().searchActions.setSensitiveCase(false)
    expect(store.getState().sensitiveCase).toBe(false)
  })

  // -------------------------------------------------------------------------
  // setRegularExpression
  // -------------------------------------------------------------------------
  it('setRegularExpression', () => {
    store.getState().searchActions.setRegularExpression(true)
    expect(store.getState().regularExpression).toBe(true)

    store.getState().searchActions.setRegularExpression(false)
    expect(store.getState().regularExpression).toBe(false)
  })

  // -------------------------------------------------------------------------
  // removeSearchResult
  // -------------------------------------------------------------------------
  it('removeSearchResult removes by searchID', () => {
    const p1 = makeProject({ searchID: 'id-1' })
    const p2 = makeProject({ searchID: 'id-2', searchQuery: 'other' })

    store.getState().searchActions.setSearchResults(p1)
    store.getState().searchActions.setSearchResults(p2)
    expect(store.getState().searchResults).toHaveLength(2)

    store.getState().searchActions.removeSearchResult('id-1')
    expect(store.getState().searchResults).toHaveLength(1)
    expect(store.getState().searchResults[0].searchID).toBe('id-2')
  })

  it('removeSearchResult does nothing when searchID not found', () => {
    const p1 = makeProject({ searchID: 'id-1' })
    store.getState().searchActions.setSearchResults(p1)
    store.getState().searchActions.removeSearchResult('nonexistent')
    expect(store.getState().searchResults).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // revealInProject
  // -------------------------------------------------------------------------
  it('revealInProject makes every Go to a new request, even to the same place', () => {
    const target = { kind: 'pou' as const, pou: 'PUMP', rungId: 'r1', nodeId: 'n1' }
    store.getState().searchActions.revealInProject(target)
    const first = store.getState().revealTarget
    store.getState().searchActions.revealInProject(target)
    expect(store.getState().revealTarget).toEqual({ ...target, seq: (first?.seq ?? 0) + 1 })
  })

  // -------------------------------------------------------------------------
  // clearSearch
  // -------------------------------------------------------------------------
  it('clearSearch resets all search state', () => {
    store.getState().searchActions.setSearchQuery('test')
    store.getState().searchActions.setSearchResults(makeProject())
    store.getState().searchActions.setSensitiveCase(true)
    store.getState().searchActions.setRegularExpression(true)
    store.getState().searchActions.revealInProject({ kind: 'globals', variable: 'x' })

    store.getState().searchActions.clearSearch()

    const state = store.getState()
    expect(state.searchQuery).toBe('')
    expect(state.searchResults).toEqual([])
    expect(state.sensitiveCase).toBe(false)
    expect(state.regularExpression).toBe(false)
    expect(state.revealTarget).toBeNull()
  })
})
