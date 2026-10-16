/**
 * A place in the project that Go to opens: a POU (a Ladder rung and element, an FBD element, an ST / IL line,
 * or a row of its variable table), or the global variables (a row of them).
 */
export type RevealTarget =
  | {
      kind: 'pou'
      pou: string
      rungId?: string
      nodeId?: string
      line?: number
      column?: number
      /** A row of the POU's variable table. */
      variable?: string
    }
  | { kind: 'globals'; variable?: string; list?: string }

/** One search hit: the text that matched, where it is, and how many matches it holds. */
export type SearchHit = {
  text: string
  /** `rung 3 · contact`, `line 12`, `VAR_EXTERNAL`. */
  where: string
  target: RevealTarget
  count: number
}

export type Project = {
  searchQuery: string
  projectName: string
  functions: {
    pous: Record<
      'program' | 'function' | 'function-block',
      Array<{
        name: string
        language: 'ld' | 'sfc' | 'fbd' | 'il' | 'st' | 'python' | 'cpp'
        pouType: 'program' | 'function' | 'function-block' | 'interface'
        /** Its name matched. */
        nameMatches: boolean
        hits: SearchHit[]
      }>
    >
    dataTypes: Array<{
      name: string
      type: 'array' | 'structure' | 'enumerated'
    }>
    /** Configuration globals and global variable lists. */
    globals: SearchHit[]
    resource: {
      task: string
      instance: string
    }
  }
  searchCounts?: number
  searchID: string
}

export type SearchState = {
  searchQuery: string
  searchResults: Project[]
  sensitiveCase: boolean
  regularExpression: boolean
  /** The last Go to, for the editor of its POU to scroll to and select; `seq` makes a repeat a new request. */
  revealTarget: (RevealTarget & { seq: number }) | null
  /** What the Cross references panel shows: a name as written in a POU (none: a global's name). */
  xrefRequest: { pou?: string; expression: string; seq: number } | null
}

export type SearchActions = {
  setSearchQuery: (query: string) => void
  setSearchResults: (project: Project) => void
  setSensitiveCase: (sensitiveCase: boolean) => void
  setRegularExpression: (regularExpression: boolean) => void
  removeSearchResult: (itemID: string) => void
  revealInProject: (target: RevealTarget) => void
  showCrossReferences: (request: { pou?: string; expression: string }) => void
  closeCrossReferences: () => void
  clearSearch: () => void
}

export type SearchSlice = SearchState & { searchActions: SearchActions }
