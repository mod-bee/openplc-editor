/**
 * A task's "Stack" and "Stop PLC if stuck" settings in the firmware
 * (resources/sources/Baremetal/plc_core_place.h), the same rules on every
 * bare-metal target: a stack within the target's bounds, else the default; a
 * task past the stuck limit stops the PLC unless set not to, then it is
 * reported and the PLC keeps running.
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

describeIfGpp('task stack and stuck rules (plc_core_place.h)', () => {
  let dir: string
  let bin: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-settings-'))
    fs.writeFileSync(
      path.join(dir, 'main.cpp'),
      `#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "plc_core_place.h"
int main(int, char **argv) {
  if (std::strcmp(argv[1], "stack") == 0) {
    std::printf("%u", (unsigned)plc_task_stack((uint32_t)std::strtoul(argv[2], nullptr, 10), 16384, 2048, 65536));
  } else if (std::strcmp(argv[1], "deadline") == 0) {
    std::printf("%lld", (long long)plc_task_stop_deadline(atoll(argv[2]), atoll(argv[3]), atoll(argv[4]),
                                                          PLC_STOP_WAIT_KEEP_RUNNING_US, atoi(argv[5]) != 0));
  } else {
    std::printf("%d", plc_task_stuck_action(atoi(argv[2]) != 0, atoi(argv[3]) != 0));
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

  const stack = (wanted: number) => execFileSync(bin, ['stack', String(wanted)]).toString()
  const stuck = (pastLimit: boolean, stopOnStuck: boolean) =>
    Number(execFileSync(bin, ['stuck', pastLimit ? '1' : '0', stopOnStuck ? '1' : '0']).toString())

  it('gives a task on Default (0) the default stack, as before', () => {
    expect(stack(0)).toBe('16384')
  })

  it('gives a task the stack it asks for within the bounds', () => {
    expect(stack(8192)).toBe('8192')
    expect(stack(2048)).toBe('2048')
    expect(stack(65536)).toBe('65536')
  })

  it('gives a size outside the bounds the default', () => {
    expect(stack(1024)).toBe('16384')
    expect(stack(65537)).toBe('16384')
  })

  it('stops the PLC for a task past the limit, as always (PLC_STUCK_STOP)', () => {
    expect(stuck(true, true)).toBe(1)
  })

  it('only reports a task past the limit that is set not to stop the PLC (PLC_STUCK_REPORT)', () => {
    expect(stuck(true, false)).toBe(2)
  })

  const deadline = (release: number, limit: number, stopAt: number, stopOnStuck: boolean) =>
    Number(
      execFileSync(bin, ['deadline', String(release), String(limit), String(stopAt), stopOnStuck ? '1' : '0']).toString(),
    )

  it('lets a stop wait for a task to its own stuck limit, as before', () => {
    expect(deadline(0, 1000000, 500000, true)).toBe(1000000)
  })

  it('lets a stop wait at least 10 s for a task set not to stop the PLC', () => {
    expect(deadline(0, 1000000, 500000, false)).toBe(10500000)
    expect(deadline(0, 20000000, 500000, false)).toBe(20000000)
  })

  it('does nothing before the limit (PLC_STUCK_NONE)', () => {
    expect(stuck(false, true)).toBe(0)
    expect(stuck(false, false)).toBe(0)
  })
})
