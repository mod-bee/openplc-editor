/**
 * An element renamed only in case (`main` -> `Main`) on a real, case-sensitive file system (Linux): the old
 * file is a second file and must go, or the project holds the element twice ("Duplicate program
 * declaration: MAIN"). On a case-insensitive one (macOS, Windows) both names are the one file just
 * written, which ProjectService keeps and gives the new case; that branch needs such a file system.
 */
import type { WriteProjectFiles } from '@root/middleware/shared/ports/project-port'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { ProjectService } from '../index'

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/userData' },
  BrowserWindow: class {},
  dialog: {},
}))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'case-rename-'))
  mkdirSync(join(dir, 'pous', 'programs'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const files = (overrides: Partial<WriteProjectFiles>): WriteProjectFiles => ({
  projectPath: dir,
  projectJson: '{"meta":{},"data":{}}',
  pouFiles: [{ relativePath: 'pous/programs/Main.st', content: 'PROGRAM Main\nEND_PROGRAM\n' }],
  serverFiles: [],
  remoteDeviceFiles: [],
  dataTypeFiles: [],
  deletions: [],
  ...overrides,
})

const service = () => new ProjectService({} as ConstructorParameters<typeof ProjectService>[0])

describe('ProjectService.writeProjectFiles: a rename only in case', () => {
  it('removes the old file when it is a second file (a case-sensitive file system)', async () => {
    writeFileSync(join(dir, 'pous', 'programs', 'main.st'), 'PROGRAM main\nEND_PROGRAM\n')
    const result = await service().writeProjectFiles(files({ deletions: ['pous/programs/main.st'] }))
    expect(result.success).toBe(true)
    expect(readdirSync(join(dir, 'pous', 'programs'))).toEqual(['Main.st'])
  })

  it('never deletes a path the same save writes', async () => {
    const result = await service().writeProjectFiles(files({ deletions: ['pous/programs/Main.st'] }))
    expect(result.success).toBe(true)
    expect(existsSync(join(dir, 'pous', 'programs', 'Main.st'))).toBe(true)
  })
})
