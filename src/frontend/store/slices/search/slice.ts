import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { SearchSlice } from './types'

const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (setState) => ({
  searchQuery: '',
  searchResults: [],
  sensitiveCase: false,
  regularExpression: false,
  revealTarget: null,
  xrefRequest: null,

  searchActions: {
    setSearchQuery: (searchQuery) => {
      setState(
        produce((state: SearchSlice) => {
          state.searchQuery = searchQuery
        }),
      )
    },

    setSearchResults: (newSearchResult) => {
      setState(
        produce((state: SearchSlice) => {
          const index = state.searchResults.findIndex((result) => result.searchQuery === newSearchResult.searchQuery)
          if (index !== -1) {
            state.searchResults.splice(index, 1)
          }
          state.searchResults.push(newSearchResult)
        }),
      )
    },

    setSensitiveCase: (sensitiveCase) => {
      setState(
        produce((state: SearchSlice) => {
          state.sensitiveCase = sensitiveCase
        }),
      )
    },

    setRegularExpression: (regularExpression) => {
      setState(
        produce((state: SearchSlice) => {
          state.regularExpression = regularExpression
        }),
      )
    },

    removeSearchResult: (itemID) =>
      setState((state) => ({
        searchResults: state.searchResults.filter((item) => item.searchID !== itemID),
      })),

    showCrossReferences: (request) => {
      setState(
        produce((state: SearchSlice) => {
          state.xrefRequest = { ...request, seq: (state.xrefRequest?.seq ?? 0) + 1 }
        }),
      )
    },
    closeCrossReferences: () => {
      setState(
        produce((state: SearchSlice) => {
          state.xrefRequest = null
        }),
      )
    },
    revealInProject: (target) => {
      setState(
        produce((state: SearchSlice) => {
          state.revealTarget = { ...target, seq: (state.revealTarget?.seq ?? 0) + 1 }
        }),
      )
    },

    clearSearch: () => {
      setState(
        produce((state: SearchSlice) => {
          state.searchQuery = ''
          state.searchResults = []
          state.sensitiveCase = false
          state.regularExpression = false
          state.revealTarget = null
          state.xrefRequest = null
        }),
      )
    },
  },
})

export { createSearchSlice }
