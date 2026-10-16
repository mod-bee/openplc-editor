/**
 * keepBuildOutputFiles: a build's output copied into <project>/output/<board>/<time>_<md5>/, against a real
 * temporary project folder.
 */
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { boardFolderName, keepBuildOutputFiles } from '../keep-build-output'

const MD5 = '918755a13fec9d922637d43561e24a4a'
let project: string
let compilationPath: string
let sourceFolderPath: string

async function write(path: string, content: string) {
  await fs.mkdir(join(path, '..'), { recursive: true })
  await fs.writeFile(path, content)
}

beforeEach(async () => {
  project = await fs.mkdtemp(join(tmpdir(), 'keep-build-output-'))
  compilationPath = join(project, 'build', 'ModBee Node UIO')
  sourceFolderPath = join(compilationPath, 'src')
  await write(join(sourceFolderPath, 'debug-map.json'), '{"md5":"x"}')
})

afterEach(async () => {
  await fs.rm(project, { recursive: true, force: true })
})

const paths = (now = new Date(2026, 9, 16, 14, 5, 9)) => ({
  projectPath: project,
  compilationPath,
  sourceFolderPath,
  compressSourceFolder: async () => Buffer.from('ZIP'),
  now,
})

const firmware = (count = 10) => ({
  kind: 'firmware' as const,
  boardTarget: 'ModBee Node UIO',
  fqbn: 'esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=enabled',
  md5: MD5,
  count,
  manifest: { kind: 'firmware', programMd5: MD5 },
})

async function exportFirmware() {
  const dir = join(compilationPath, 'examples', 'Baremetal', 'build', 'esp32.esp32.esp32s3')
  await write(join(dir, 'Baremetal.ino.bin'), 'APP')
  await write(join(dir, 'Baremetal.ino.merged.bin'), 'FULL')
  await write(join(dir, 'Baremetal.ino.bootloader.bin'), 'BOOT')
  // Left out: debugging files, arduino-cli's duplicates, files that are not the sketch's.
  await write(join(dir, 'Baremetal.ino.elf'), 'ELF')
  await write(join(dir, 'Baremetal.ino.map'), 'MAP')
  await write(join(dir, 'Baremetal.ino_flashed.bin'), 'APP')
  await write(join(dir, 'Baremetal.ino.bootloader_flashed.bin'), 'BOOT')
  await write(join(dir, 'boot_app0.bin'), 'OTHER')
}

describe('keepBuildOutputFiles', () => {
  it("keeps only a board build's flashable images, renamed, with build.json", async () => {
    await exportFirmware()
    const result = await keepBuildOutputFiles(firmware(), paths())

    expect(result.folder).toBe(join(project, 'output', 'ModBee Node UIO', '2026-10-16_140509_918755a1'))
    expect(result.files).toEqual(['firmware.bin', 'firmware.bootloader.bin', 'firmware.merged.bin', 'build.json'])
    expect(await fs.readFile(join(result.folder!, 'firmware.bin'), 'utf8')).toBe('APP')
    const manifest = JSON.parse(await fs.readFile(join(result.folder!, 'build.json'), 'utf8'))
    expect(manifest).toEqual({
      kind: 'firmware',
      programMd5: MD5,
      files: ['firmware.bin', 'firmware.bootloader.bin', 'firmware.merged.bin'],
    })
  })

  it('keeps the program.zip of a Runtime v4 build', async () => {
    const result = await keepBuildOutputFiles(
      { ...firmware(), kind: 'runtime-v4', boardTarget: 'OpenPLC Runtime v4', fqbn: undefined },
      paths(),
    )
    expect(result.files).toEqual(['program.zip', 'build.json'])
    expect(await fs.readFile(join(result.folder!, 'program.zip'), 'utf8')).toBe('ZIP')
  })

  it('keeps the newest builds only, and never touches a folder it did not make', async () => {
    await exportFirmware()
    const boardDir = join(project, 'output', 'ModBee Node UIO')
    await fs.mkdir(join(boardDir, 'notes'), { recursive: true })
    for (let minute = 0; minute < 4; minute++) {
      await keepBuildOutputFiles(firmware(2), paths(new Date(2026, 9, 16, 14, minute, 0)))
    }
    expect((await fs.readdir(boardDir)).sort()).toEqual([
      '2026-10-16_140200_918755a1',
      '2026-10-16_140300_918755a1',
      'notes',
    ])
  })

  it('gives two builds in the same second their own folders', async () => {
    await exportFirmware()
    const first = await keepBuildOutputFiles(firmware(), paths())
    const second = await keepBuildOutputFiles(firmware(), paths())
    expect(second.folder).toBe(`${first.folder}-2`)
  })

  it('makes nothing when the build exported no firmware', async () => {
    const result = await keepBuildOutputFiles(firmware(), paths())
    expect(result.folder).toBeUndefined()
    expect(result.errors?.[0].message).toContain('no firmware folder')
    await expect(fs.access(join(project, 'output'))).rejects.toThrow()
  })

  it('makes a board name safe as a folder name', () => {
    expect(boardFolderName('ModBee Node UIO')).toBe('ModBee Node UIO')
    expect(boardFolderName('Arduino Uno R4 / WiFi')).toBe('Arduino Uno R4 _ WiFi')
  })
})
