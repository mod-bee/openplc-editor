/**
 * "Keep build output": a copy of what a successful build produced, in the project, outside the build
 * folder the editor regenerates on every build (`createBasicDirectories` removes `build/<board>/`).
 *
 *   <project>/output/<board>/<YYYY-MM-DD_HHMMSS>_<md5:8>/
 *     firmware.bin, firmware.merged.bin, ...   a board build: only the images that are flashed or sent
 *                                              by OTA (.bin / .hex / .uf2), `Baremetal.ino*` renamed
 *                                              `firmware*`; no .elf / .map, no arduino-cli `_flashed`
 *                                              duplicates
 *     program.zip                              a Runtime v4 build: the bundle it uploads
 *     build.json                               what was built, with the files listed
 *
 * The newest `count` folders per board are kept; older ones (by name, which sorts by time) go.
 */
import type { KeepBuildOutputArgs, KeepBuildOutputResult } from '@root/middleware/shared/ports/compiler-platform-port'
import { promises as fs } from 'fs'
import { join } from 'path'

export interface KeepBuildOutputPaths {
  /** The project folder. */
  projectPath: string
  /** `<project>/build/<board>/`: holds the sketch and arduino-cli's exported files. */
  compilationPath: string
  /** `<compilationPath>/src/`: the generated sources, what a Runtime v4 build zips. */
  sourceFolderPath: string
  /** Zips a folder the way the Runtime v4 upload does. */
  compressSourceFolder: (folderPath: string) => Promise<Buffer>
  /** The build time (tests pass a fixed one). */
  now?: Date
}

const SKETCH_PREFIX = 'Baremetal.ino'
/** What is flashed or sent by OTA; the rest (.elf, .map, .eep, ...) is left out. */
const FLASHABLE = /\.(bin|hex|uf2)$/i
const KEPT_FOLDER = /^\d{4}-\d{2}-\d{2}_\d{6}_[0-9a-f]{8}(-\d+)?$/

/** A board name as a folder name: anything but letters, digits, space, `.`, `_`, `-` becomes `_`. */
export function boardFolderName(boardTarget: string): string {
  return boardTarget.replace(/[^A-Za-z0-9 ._-]/g, '_').trim() || 'board'
}

/** `YYYY-MM-DD_HHMMSS` in local time, as a person reads the folder list. */
function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Where arduino-cli exported this build's files: `examples/Baremetal/build/<vendor.arch.board>/`, the
 * FQBN's first three parts (its options never appear in the name), else the one folder there is.
 */
async function firmwareExportDir(compilationPath: string, fqbn: string | undefined): Promise<string | null> {
  const buildDir = join(compilationPath, 'examples', 'Baremetal', 'build')
  if (fqbn) {
    const canonical = join(buildDir, fqbn.split(':').slice(0, 3).join('.'))
    if (await exists(canonical)) return canonical
  }
  try {
    const entries = await fs.readdir(buildDir, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory())
    return dirs.length === 1 ? join(buildDir, dirs[0].name) : null
  } catch {
    return null
  }
}

/** A folder for this build that does not exist yet (two builds in one second get `-2`, `-3`, ...). */
async function newFolder(boardDir: string, base: string): Promise<string> {
  let folder = join(boardDir, base)
  for (let n = 2; await exists(folder); n++) folder = join(boardDir, `${base}-${n}`)
  await fs.mkdir(folder, { recursive: true })
  return folder
}

/** Remove the oldest kept builds beyond `count`. Only folders this feature names are touched. */
async function prune(boardDir: string, count: number): Promise<void> {
  const entries = await fs.readdir(boardDir, { withFileTypes: true })
  const kept = entries
    .filter((e) => e.isDirectory() && KEPT_FOLDER.test(e.name))
    .map((e) => e.name)
    .sort()
  for (const name of kept.slice(0, Math.max(0, kept.length - count))) {
    await fs.rm(join(boardDir, name), { recursive: true, force: true })
  }
}

export async function keepBuildOutputFiles(
  args: KeepBuildOutputArgs,
  paths: KeepBuildOutputPaths,
): Promise<KeepBuildOutputResult> {
  // Gather first, so a build with nothing to keep leaves no empty folder behind.
  const copies: Array<{ from: string; to: string }> = []
  let zip: Buffer | null = null
  if (args.kind === 'firmware') {
    const exportDir = await firmwareExportDir(paths.compilationPath, args.fqbn)
    if (!exportDir) {
      return {
        files: [],
        errors: [{ message: 'the build exported no firmware folder', line: 0, column: 0, severity: 'error' }],
      }
    }
    for (const entry of await fs.readdir(exportDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(SKETCH_PREFIX)) continue
      // `_flashed` files are arduino-cli's byte-identical copies of the images as written.
      if (!FLASHABLE.test(entry.name) || entry.name.includes('_flashed')) continue
      copies.push({ from: join(exportDir, entry.name), to: `firmware${entry.name.slice(SKETCH_PREFIX.length)}` })
    }
    if (copies.length === 0) {
      return {
        files: [],
        errors: [{ message: `no firmware files in ${exportDir}`, line: 0, column: 0, severity: 'error' }],
      }
    }
  } else {
    zip = await paths.compressSourceFolder(paths.sourceFolderPath)
  }

  const boardDir = join(paths.projectPath, 'output', boardFolderName(args.boardTarget))
  const folder = await newFolder(boardDir, `${stamp(paths.now ?? new Date())}_${args.md5.slice(0, 8).toLowerCase()}`)
  const files: string[] = []
  if (zip) {
    await fs.writeFile(join(folder, 'program.zip'), new Uint8Array(zip))
    files.push('program.zip')
  }
  for (const { from, to } of copies) {
    await fs.copyFile(from, join(folder, to))
    files.push(to)
  }
  files.sort()
  await fs.writeFile(join(folder, 'build.json'), `${JSON.stringify({ ...args.manifest, files }, null, 2)}\n`)
  await prune(boardDir, args.count)
  return { folder, files: [...files, 'build.json'] }
}
