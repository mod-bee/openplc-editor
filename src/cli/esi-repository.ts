/**
 * The project's ESI repository for the CLI: the shared repository port and
 * file store on the same `devices/esi` folder the desktop uses, with the
 * shared parser run in-process.
 */

import { EsiProjectFiles } from '@root/backend/editor/ethercat/esi-project-files'
import { createFileEsiRowStore } from '@root/backend/shared/ethercat/esi-file-store'
import { runEsiParseOp } from '@root/backend/shared/ethercat/esi-parse-ops'
import { createEsiRepositoryPort } from '@root/backend/shared/ethercat/esi-repository-port'
import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type { EsiParserMechanism, EsiRowStore } from '@root/middleware/shared/ports/esi-repository-mechanisms'

export interface ProjectEsiRepository {
  port: EsiPort
  /** Raw rows and XML, for callers that need no parsed summary. */
  rows: EsiRowStore
}

export function openProjectEsiRepository(projectPath: string): ProjectEsiRepository {
  const files = new EsiProjectFiles()
  const rows = createFileEsiRowStore({
    read: (name) => files.read(projectPath, name),
    write: (name, text) => files.write(projectPath, name, text),
    remove: (name) => files.remove(projectPath, name),
    list: () => files.list(projectPath),
  })
  const parser: EsiParserMechanism = {
    run: (request) => Promise.resolve(runEsiParseOp(request)),
  }
  return { port: createEsiRepositoryPort({ parser, store: rows }), rows }
}
