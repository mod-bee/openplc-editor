/**
 * Where the firmware runs an IEC task (resources/sources/Baremetal/plc_core_place.h),
 * the same rule on every bare-metal target: a task's Core setting where the
 * board has that core, else Auto, the core setup() runs on, as before the
 * setting existed.
 */
import { execFileSync, execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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

describeIfGpp('task core placement (plc_core_place.h)', () => {
  let dir: string
  let bin: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-place-'))
    fs.writeFileSync(
      path.join(dir, 'main.cpp'),
      `#include <cstdio>
#include <cstdlib>
#include "plc_core_place.h"
int main(int, char **argv) {
  const int wanted = atoi(argv[1]), cores = atoi(argv[2]), plc_core = atoi(argv[3]);
  std::printf("%d", plc_core_place(wanted, cores, plc_core));
  return 0;
}
`,
    )
    bin = path.join(dir, 'place')
    execFileSync('g++', ['-std=c++14', '-Wall', '-Wextra', '-Werror', `-I${BAREMETAL}`, path.join(dir, 'main.cpp'), '-o', bin])
  })

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const place = (wanted: number, cores: number, plcCore: number) =>
    execFileSync(bin, [String(wanted), String(cores), String(plcCore)]).toString()

  it('runs an Auto task on the PLC core, as before', () => {
    expect(place(-1, 2, 1)).toBe('1')
    expect(place(-1, 1, 0)).toBe('0')
  })

  it('runs a task on the core it was given when the board has it', () => {
    expect(place(0, 2, 1)).toBe('0')
    expect(place(1, 2, 1)).toBe('1')
    expect(place(0, 1, 0)).toBe('0')
  })

  it('puts a core the board lacks on Auto', () => {
    expect(place(1, 1, 0)).toBe('0')
    expect(place(2, 2, 1)).toBe('1')
  })
})
