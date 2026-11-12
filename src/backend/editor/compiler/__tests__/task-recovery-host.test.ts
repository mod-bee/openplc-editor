/**
 * A task's "On fault" setting in the firmware ({RESTART_ON_FAULT := n};
 * resources/sources/Baremetal/plc_core_place.h, used by arduino_runtime_glue.cpp):
 * a fault of a task with the setting is recovered that long after - a task a
 * runtime error ended resumes, a stopped or stuck PLC restarts into RUN - at most
 * PLC_RECOVER_LIMIT times until a day passes without one; a task without it stays
 * stopped, as always.
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

describeIfGpp('fault recovery rules (plc_core_place.h)', () => {
  let dir: string
  let bin: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-recovery-'))
    fs.writeFileSync(
      path.join(dir, 'main.cpp'),
      `#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "plc_core_place.h"
int main(int, char **argv) {
  if (std::strcmp(argv[1], "replaces") == 0) {
    std::printf("%d", plc_recover_replaces((uint8_t)atoi(argv[2]), (uint8_t)atoi(argv[3]), (uint32_t)atoi(argv[4])) ? 1 : 0);
  } else if (std::strcmp(argv[1], "action") == 0) {
    std::printf("%d", plc_recover_action((uint8_t)atoi(argv[2]), (uint32_t)atoi(argv[3]), atoi(argv[4]) != 0, atoi(argv[5]) != 0));
  } else {
    std::printf("%d", plc_recover_clears(atoll(argv[2]), atoll(argv[3])) ? 1 : 0);
  }
  return 0;
}
`,
    )
    bin = path.join(dir, 'rules')
    execFileSync('g++', [
      '-std=c++14',
      '-Wall',
      '-Wextra',
      '-Werror',
      `-I${BAREMETAL}`,
      path.join(dir, 'main.cpp'),
      '-o',
      bin,
    ])
  })

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const NONE = 0
  const RESUME = 1
  const RESTART = 2
  const replaces = (pending: number, wanted: number, delay: number) =>
    execFileSync(bin, ['replaces', String(pending), String(wanted), String(delay)]).toString() === '1'
  const action = (pending: number, done: number, wasStuck: boolean, stillStuck: boolean) =>
    Number(
      execFileSync(bin, [
        'action',
        String(pending),
        String(done),
        wasStuck ? '1' : '0',
        stillStuck ? '1' : '0',
      ]).toString(),
    )
  const clears = (now: number, since: number) =>
    execFileSync(bin, ['clears', String(now), String(since)]).toString() === '1'

  it('does nothing for a task without the setting (delay 0): it stays stopped, as always', () => {
    expect(replaces(NONE, RESUME, 0)).toBe(false)
    expect(replaces(NONE, RESTART, 0)).toBe(false)
  })

  it('schedules a recovery for a task with the setting', () => {
    expect(replaces(NONE, RESUME, 30)).toBe(true)
    expect(replaces(NONE, RESTART, 30)).toBe(true)
  })

  it('lets a restart override a pending resume, never the other way', () => {
    expect(replaces(RESUME, RESTART, 30)).toBe(true)
    expect(replaces(RESTART, RESUME, 30)).toBe(false)
    expect(replaces(RESTART, RESTART, 30)).toBe(false)
  })

  it('carries out a due recovery while the count allows it', () => {
    expect(action(RESUME, 0, false, false)).toBe(RESUME)
    expect(action(RESTART, 2, false, true)).toBe(RESTART)
  })

  it('stops at the limit, so a fault that comes straight back cannot loop', () => {
    expect(action(RESTART, 3, false, true)).toBe(NONE)
    expect(action(RESUME, 3, false, false)).toBe(NONE)
  })

  it('leaves a stuck task alone that has finished its scan since', () => {
    expect(action(RESTART, 0, true, false)).toBe(NONE)
    expect(action(RESTART, 0, true, true)).toBe(RESTART)
  })

  it('starts the count again after a day without a recovery', () => {
    const day = 24 * 3600 * 1000000
    expect(clears(day - 1, 0)).toBe(false)
    expect(clears(day, 0)).toBe(true)
    expect(clears(5 * day, 4 * day + 1)).toBe(false)
  })
})
