/**
 * The firmware's ESP32 retain store (resources/sources/Baremetal/openplc_retain_weak.cpp),
 * built for the host against a fake NVS that keeps its keys in a file, so each
 * run of the harness is one boot. A save writes only the 512-byte chunks that
 * changed, then a header; a power cut at any write must leave the old values or
 * the new ones, never a mix and never nothing.
 */
import { execFileSync, execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const FIXTURES = path.join(__dirname, 'fixtures', 'retain-store')
const BAREMETAL = path.resolve(__dirname, '../../../../../resources/sources/Baremetal')

const hasGpp = (() => {
  try {
    execSync('g++ --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const describeIfGpp = hasGpp ? describe : describe.skip

type Read = { status: number; len: number; same: boolean }

describeIfGpp('ESP32 retain store: chunked, changed chunks only, power-cut safe', () => {
  let dir: string
  let bin: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retain-store-'))
    for (const f of fs.readdirSync(FIXTURES)) fs.copyFileSync(path.join(FIXTURES, f), path.join(dir, f))
    for (const f of ['openplc_retain_weak.cpp', 'openplc_retain.h', 'license_blob.h'])
      fs.copyFileSync(path.join(BAREMETAL, f), path.join(dir, f))
    bin = path.join(dir, 'rs')
    execFileSync(
      'g++',
      [
        '-std=c++14',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-DARDUINO_ARCH_ESP32',
        '-I.',
        '-o',
        bin,
        'harness.cpp',
        'openplc_retain_weak.cpp',
      ],
      { cwd: dir, stdio: 'pipe' },
    )
  }, 120_000)

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  const nvs = (name: string) => path.join(dir, `${name}.nvs`)
  const run = (file: string, args: string[]) => execFileSync(bin, [file, ...args], { encoding: 'utf-8' })
  const reads = (out: string): Read[] =>
    [...out.matchAll(/READ (\d+) (\d+) (\d)/g)].map((m) => ({ status: +m[1], len: +m[2], same: m[3] === '1' }))
  const stats = (out: string) => {
    const m = /STATS (\d+) (\d+) (\d+)/.exec(out)!
    return { puts: +m[1], bytes: +m[2], keys: +m[3] }
  }

  /** Two bytes changed in each of three chunks. */
  const change = ['poke', '100', '1', 'poke', '101', '2', 'poke', '9000', '3', 'poke', '21999', '4']

  it('first save writes every chunk and a header; the next boot reads it back', () => {
    const f = nvs('first')
    const out = run(f, ['blob', '22000', '1', 'read', '65535', 'write', 'stats'])
    expect(reads(out)[0].status).toBe(1) // NO_DATA on a first boot
    expect(stats(out)).toEqual({ puts: 44, bytes: 22000 + 28, keys: 44 })
    expect(reads(run(f, ['blob', '22000', '1', 'read', '65535']))[0]).toEqual({ status: 0, len: 22000, same: true })
  })

  it('an unchanged blob writes nothing; a small change writes its chunk and the header only', () => {
    const f = nvs('delta')
    run(f, ['blob', '22000', '1', 'read', '65535', 'write'])
    expect(stats(run(f, ['blob', '22000', '1', 'read', '65535', 'write', 'flush', 'stats']))).toMatchObject({
      puts: 0,
    })
    const out = run(f, ['blob', '22000', '1', 'read', '65535', 'poke', '5000', '7', 'write', 'flush', 'stats'])
    expect(stats(out)).toMatchObject({ puts: 2, bytes: 512 + 28 })
    expect(reads(run(f, ['blob', '22000', '1', 'poke', '5000', '7', 'read', '65535']))[0].same).toBe(true)
  })

  it('a power cut at any write leaves the old values or the new ones, never a mix', () => {
    const base = nvs('base')
    run(base, ['blob', '22000', '1', 'read', '65535', 'write'])
    // Three chunks then the header: four writes. Cut after 0..4 of them.
    for (let k = 0; k <= 4; k++) {
      const f = nvs(`cut${k}`)
      fs.copyFileSync(base, f)
      run(f, ['blob', '22000', '1', 'read', '65535', ...change, 'cut', String(k), 'write', 'flush'])
      const asOld = reads(run(f, ['blob', '22000', '1', 'read', '65535']))[0]
      const asNew = reads(run(f, ['blob', '22000', '1', ...change, 'read', '65535']))[0]
      expect(asOld.status).toBe(0)
      expect(asOld.same !== asNew.same).toBe(true) // exactly one of the two
      expect(asNew.same).toBe(k >= 4) // new only once the header is written
    }
  })

  it('cuts across several saves in a row still leave a whole set of values', () => {
    const f = nvs('chain')
    run(f, ['blob', '22000', '1', 'read', '65535', 'write'])
    for (let round = 0; round < 6; round++) {
      // Each round changes chunk 3 and chunk 20 again, cutting after a varying write.
      const before = ['poke', '1600', String(round), 'poke', '10300', String(round)]
      const after = ['poke', '1600', String(round + 100), 'poke', '10300', String(round + 100)]
      run(f, ['blob', '22000', '1', ...before, 'write'])
      run(f, ['blob', '22000', '1', ...before, 'read', '65535', ...after, 'cut', String(round % 4), 'write', 'flush'])
      const asBefore = reads(run(f, ['blob', '22000', '1', ...before, 'read', '65535']))[0]
      const asAfter = reads(run(f, ['blob', '22000', '1', ...after, 'read', '65535']))[0]
      expect(asBefore.same !== asAfter.same).toBe(true)
    }
  })

  it('reads a store written before chunking, and replaces it on the first save', () => {
    const f = nvs('legacy')
    run(f, ['blob', '22000', '1', 'legacy'])
    expect(reads(run(f, ['blob', '22000', '1', 'read', '65535']))[0]).toEqual({ status: 0, len: 22000, same: true })
    // A cut before the header: the old record still reads.
    const g = nvs('legacy-cut')
    fs.copyFileSync(f, g)
    run(g, ['blob', '22000', '1', 'read', '65535', 'poke', '7', '7', 'cut', '10', 'write'])
    expect(reads(run(g, ['blob', '22000', '1', 'read', '65535']))[0].same).toBe(true)
    // A whole save: chunks and header, the old key removed.
    const out = run(f, ['blob', '22000', '1', 'read', '65535', 'poke', '7', '7', 'write', 'stats'])
    expect(stats(out)).toMatchObject({ puts: 44, keys: 44 })
    expect(reads(run(f, ['blob', '22000', '1', 'poke', '7', '7', 'read', '65535']))[0].same).toBe(true)
  })

  it('a smaller program removes the chunks past its end', () => {
    const f = nvs('shrink')
    run(f, ['blob', '22000', '1', 'read', '65535', 'write'])
    const out = run(f, ['read', '65535', 'blob', '3000', '2', 'write', 'stats'])
    expect(stats(out).keys).toBe(6 * 2 + 1) // both slots of the 6 chunks left, and the header
    expect(reads(run(f, ['blob', '3000', '2', 'read', '65535']))[0]).toEqual({ status: 0, len: 3000, same: true })
  })

  // The store says how often it wants the values (openplc_retain_mode), as a
  // runtime v4 plugin does: the built-in store is PERIODIC; a board package's
  // store that replaces it gets every scan unless it says otherwise.
  it('the built-in store is periodic; a replacing store is every scan unless it says', () => {
    const build = (name: string, extra: string[]) => {
      const out = path.join(dir, name)
      execFileSync(
        'g++',
        ['-std=c++14', '-Os', '-Wall', '-Wextra', '-Werror', '-DARDUINO_ARCH_ESP32', '-I.', '-o', out, ...extra],
        { cwd: dir, stdio: 'pipe' },
      )
      return (file: string) => execFileSync(out, [file, 'mode'], { encoding: 'utf-8' }).trim()
    }
    const sources = ['harness.cpp', 'openplc_retain_weak.cpp']
    expect(build('builtin', sources)(nvs('m1'))).toBe('MODE 1')
    expect(build('vpp', [...sources, 'vpp_store.cpp'])(nvs('m2'))).toBe('MODE 0')
    expect(build('vpp-periodic', [...sources, '-DVPP_STORE_PERIODIC', 'vpp_store.cpp'])(nvs('m3'))).toBe('MODE 1')
  }, 120_000)

  it('a buffer smaller than the stored blob is told its size (TOO_LARGE)', () => {
    const f = nvs('large')
    run(f, ['blob', '22000', '1', 'read', '65535', 'write'])
    expect(reads(run(f, ['read', '1000']))[0]).toMatchObject({ status: 4, len: 22000 })
  })
})
