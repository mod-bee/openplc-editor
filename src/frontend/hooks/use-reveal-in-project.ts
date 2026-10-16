/**
 * Go to a place in the project: a search hit, a cross reference, a declaration.
 *
 * Opens the POU's tab (or the global variables), then:
 *  - a Ladder rung / element: the rung opened and scrolled into view, the element selected;
 *  - an FBD element: centred and selected;
 *  - an ST / IL line: the cursor on it;
 *  - a variable: its row selected in the variable table (the table view, every class shown).
 * The diagram part is done by the diagram's own editor once it is showing (`revealTarget` in the store).
 */
import { useCallback } from 'react'

import { useOpenPLCStoreApi } from '../store'
import type { RevealTarget } from '../store/slices/search/types'
import type { TabsProps } from '../store/slices/tabs'
import { CreateEditorObjectFromTab } from '../store/slices/tabs/utils'

export function useRevealInProject(): (target: RevealTarget) => void {
  const store = useOpenPLCStoreApi()

  return useCallback(
    (target: RevealTarget): void => {
      const state = store.getState()
      const { tabsActions, editorActions, searchActions } = state

      const open = (tab: TabsProps) => {
        tabsActions.updateTabs(tab)
        let model = editorActions.getEditorFromEditors(tab.name)
        if (!model) {
          model = CreateEditorObjectFromTab(tab)
          editorActions.addModel(model)
        }
        editorActions.setEditor(model)
        tabsActions.setSelectedTab(tab.name)
      }

      if (target.kind === 'globals') {
        if (target.list) {
          open({ name: target.list, path: target.list, elementType: { type: 'global-variable-list' } })
          const list = state.project.data.globalVariableLists?.find((l) => l.name === target.list)
          const row = list?.variables.findIndex((v) => v.name.toUpperCase() === target.variable?.toUpperCase()) ?? -1
          if (row >= 0) editorActions.updateModelStructureForName(target.list, { display: 'table', selectedRow: row })
          return
        }
        open({ name: 'Resource', path: '/data/configuration/resource', elementType: { type: 'resource' } })
        const row = state.project.data.configurations.resource.globalVariables.findIndex(
          (v) => v.name.toUpperCase() === target.variable?.toUpperCase(),
        )
        if (row >= 0) editorActions.updateModelVariablesForName('Resource', { display: 'table', selectedRow: row })
        return
      }

      const pou = state.project.data.pous.find((p) => p.name.toUpperCase() === target.pou.toUpperCase())
      if (!pou) return
      open({
        name: pou.name,
        path: `/data/pous/${pou.pouType}/${pou.name}`,
        elementType: {
          type: pou.pouType,
          language: pou.body.language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp',
        },
      } as TabsProps)

      if (target.variable !== undefined) {
        const row = (pou.interface?.variables ?? []).findIndex(
          (v) => v.name.toUpperCase() === target.variable!.toUpperCase(),
        )
        if (row >= 0) {
          editorActions.updateModelVariablesForName(pou.name, { display: 'table', classFilter: 'All', selectedRow: row })
        }
        return
      }
      if (target.line !== undefined) {
        editorActions.setEditorCursor(pou.name, {
          lineNumber: target.line,
          column: target.column ?? 1,
          offset: 0,
          target: 'body',
        })
        return
      }
      if (target.rungId !== undefined && pou.body.language === 'ld') {
        editorActions.updateModelLadder({ openRung: { rungId: target.rungId, open: true } })
      }
      searchActions.revealInProject({ ...target, pou: pou.name })
    },
    [store],
  )
}
