/**
 * The project's watch list on disk: `<project>/debugger/watch.json`.
 *
 * Read when a project opens; written whenever the list changes. It is kept apart from the project's own
 * files (which the save flow writes and the unsaved-changes tracking compares), so watching or unwatching
 * something online never marks the project unsaved, and a project without the file simply has an empty
 * list.
 */
import { useEffect, useRef } from 'react'

import { useProject } from '../../middleware/shared/providers'
import { useOpenPLCStore } from '../store'

export const WATCH_FILE = 'debugger/watch.json'

interface WatchFile {
  version: 1
  /** Debug composite keys, in the order they were added. */
  items: string[]
}

/** The keys a watch file holds; an unreadable or foreign file holds none. */
export function parseWatchFile(content: string | undefined): string[] {
  if (!content) return []
  try {
    const parsed = JSON.parse(content) as Partial<WatchFile>
    return Array.isArray(parsed.items) ? parsed.items.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function serializeWatchFile(items: string[]): string {
  const file: WatchFile = { version: 1, items }
  return `${JSON.stringify(file, null, 2)}\n`
}

const watchFilePath = (projectPath: string) => `${projectPath}/${WATCH_FILE}`.replace(/\/+/g, '/')

export function useDebugWatchFile(): void {
  const projectPort = useProject()
  const projectPath = useOpenPLCStore((state) => state.project.meta.path)
  const watchList = useOpenPLCStore((state) => state.workspace.debugWatchList)
  const setDebugWatchList = useOpenPLCStore((state) => state.workspaceActions.setDebugWatchList)
  // The path whose file the list now reflects: nothing is written before it has been read.
  const loadedFor = useRef<string | null>(null)
  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    loadedFor.current = null
    if (!projectPath) return
    let cancelled = false
    void projectPort.readFileContent(watchFilePath(projectPath)).then((result) => {
      if (cancelled) return
      const items = parseWatchFile(result.success ? result.content : undefined)
      lastWritten.current = serializeWatchFile(items)
      setDebugWatchList(items)
      loadedFor.current = projectPath
    })
    return () => {
      cancelled = true
    }
  }, [projectPath, projectPort, setDebugWatchList])

  useEffect(() => {
    if (!projectPath || loadedFor.current !== projectPath) return
    const content = serializeWatchFile(watchList)
    if (content === lastWritten.current) return
    lastWritten.current = content
    void projectPort.saveFile(watchFilePath(projectPath), content)
  }, [watchList, projectPath, projectPort])
}
