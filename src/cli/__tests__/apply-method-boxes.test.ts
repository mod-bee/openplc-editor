/**
 * Method boxes in Ladder and FBD (IEC 61131-3 6.6.5.4; CODESYS draws a method
 * call as a box with the instance above it), end to end:
 *
 * - `apply` places a block whose `call` names `<block>.<method>` and whose
 *   `instance` names the instance, with the method's parameters as pins and
 *   its result on OUT;
 * - it refuses a method the block does not have, an instance that is missing
 *   or of another type, and a method the block keeps to itself;
 * - the transpiled program calls `<instance>.<method>(...)`, gated by the rung,
 *   and run on the host the values come back.
 */
import { execFileSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { fromSchemaShape, type SchemaProjectData, transpileToSt } from '@root/backend/shared/transpilers/st-transpiler'
import { parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import { preprocessPous } from '@root/backend/shared/utils/PLC/preprocess-pous'
import { buildAllProjectFileContentsPure } from '@root/frontend/services/save-actions'
import { flushFlowWriteBacks } from '@root/frontend/store/slices/shared/flow-writeback'
import { createTestStore } from '@root/frontend/store/testing'
import { toIpcProjectData } from '@root/middleware/adapters/editor/compiler-adapter'
import { compile } from 'strucpp'

import { applySpec } from '../apply/plan'
import { describeFbdBody } from '../describe/fbd'
import { describeLadderBody } from '../describe/ladder'
import { type ApplySpec, applySpecSchema } from '../apply/schema'

const BOOL = { definition: 'base-type' as const, value: 'BOOL' }
const DINT = { definition: 'base-type' as const, value: 'DINT' }
const counter = { definition: 'derived' as const, value: 'Counter' }

const COUNTER_BODY = `METHOD PUBLIC Add : DINT
  VAR_INPUT
    nStep : DINT := 1;
  END_VAR
  VAR_OUTPUT
    nTwice : DINT;
  END_VAR
  n := n + nStep;
  nTwice := n * 2;
  Add := n;
END_METHOD

METHOD PUBLIC Clear
  VAR_INPUT
    nTo : DINT;
  END_VAR
  n := nTo;
END_METHOD

METHOD PRIVATE Secret : DINT
  Secret := n;
END_METHOD

nCalls := nCalls + 1;
`

const SPEC = {
  specVersion: 1,
  pous: [
    {
      name: 'Counter',
      kind: 'function-block',
      language: 'st',
      variables: [
        { name: 'nCalls', class: 'output', type: DINT },
        { name: 'n', class: 'local', type: DINT },
      ],
      body: { text: COUNTER_BODY },
    },
    {
      name: 'ladderMain',
      kind: 'program',
      language: 'ld',
      variables: [
        { name: 'c', type: counter },
        { name: 'go', type: BOOL, initialValue: 'TRUE' },
        { name: 'stop', type: BOOL },
        { name: 'nStepIn', type: DINT, initialValue: '3' },
        { name: 'sum', type: DINT },
        { name: 'twice', type: DINT },
        { name: 'sum2', type: DINT },
        { name: 'ran', type: BOOL },
      ],
      body: {
        rungs: [
          {
            logic: { contact: { variable: 'go', variant: 'default' } },
            outputs: [
              {
                block: {
                  call: 'user/Counter.Add',
                  instance: 'c',
                  inputs: { nStep: 'nStepIn' },
                  outputs: { OUT: 'sum', NTWICE: 'twice' },
                },
              },
              { coil: { variable: 'ran', variant: 'default' } },
            ],
          },
          {
            logic: { contact: { variable: 'stop', variant: 'default' } },
            outputs: [
              {
                block: { call: 'user/Counter.Add', instance: 'c', inputs: { nStep: '100' }, outputs: { OUT: 'sum2' } },
              },
            ],
          },
        ],
      },
    },
    {
      name: 'fbdMain',
      kind: 'program',
      language: 'fbd',
      variables: [
        { name: 'c2', type: counter },
        { name: 'r', type: DINT },
      ],
      body: {
        nodes: [
          { label: 'k', kind: 'input-variable', variable: '5' },
          { label: 'add', kind: 'block', call: 'user/Counter.Add', instance: 'c2' },
          { label: 'out', kind: 'output-variable', variable: 'r' },
        ],
        connections: [
          { from: 'k', to: 'add.nStep' },
          { from: 'add.OUT', to: 'out' },
        ],
      },
    },
  ],
  tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
  instances: [
    { name: 'ld0', task: 'task0', program: 'ladderMain' },
    { name: 'fbd0', task: 'task0', program: 'fbdMain' },
  ],
} as unknown as ApplySpec

const hasGpp = (() => {
  try {
    execFileSync('g++', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const itIfGpp = hasGpp ? it : it.skip
const RUNTIME_INCLUDE = path.resolve(__dirname, '../../../node_modules/strucpp/src/runtime/include')

/** The spec with one Ladder rung output replaced. */
const withLadderBlock = (block: Record<string, unknown>): ApplySpec => {
  const spec = structuredClone(SPEC) as unknown as { pous: Array<{ name: string; body: unknown }> }
  const ladder = spec.pous.find((pou) => pou.name === 'ladderMain')!
  ladder.body = { rungs: [{ logic: { contact: { variable: 'go', variant: 'default' } }, outputs: [{ block }] }] }
  return spec as unknown as ApplySpec
}

describe('method boxes in Ladder and FBD', () => {
  it('refuses what a method box cannot be', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ call: 'user/Counter.Nope', instance: 'c' }, /unknown method/],
      [{ call: 'user/Counter.Secret', instance: 'c' }, /not callable/],
      [{ call: 'user/Counter.Add' }, /a method box needs "instance"/],
      [{ call: 'user/Counter.Add', instance: 'missing' }, /"missing" is not declared; declare it as Counter/],
      [{ call: 'user/Counter.Add', instance: 'go' }, /"go" is BOOL, not Counter/],
      [{ call: 'user/Counter.Add', instance: 'c', inputs: { nNope: '1' } }, /has no input pin "nNope"/],
    ]
    for (const [block, message] of cases) {
      const outcome = await applySpec(createTestStore(), withLadderBlock(block), { prune: false, projectPath: '/p' })
      expect(outcome.errors.join('\n')).toMatch(message)
    }
  })

  it('describes a method box as apply takes it, and applies the description again', async () => {
    const store = createTestStore()
    expect((await applySpec(store, SPEC, { prune: false, projectPath: '/p' })).errors).toEqual([])
    expect(flushFlowWriteBacks(store.getState)).toEqual([])
    const pous = store.getState().project.data.pous
    const userPous = new Set(pous.map((pou) => pou.name))
    const ladder = describeLadderBody(pous.find((pou) => pou.name === 'ladderMain')?.body.value, [], userPous)
    const fbd = describeFbdBody(pous.find((pou) => pou.name === 'fbdMain')?.body.value, [], userPous)
    if (!ladder.ok || !fbd.ok) throw new Error('not described')
    const first = (ladder.body.rungs[0] as { outputs: Array<{ block?: Record<string, unknown> }> }).outputs[0].block
    expect(first).toMatchObject({
      call: 'user/Counter.Add',
      instance: 'c',
      inputs: { nStep: 'nStepIn' },
      outputs: { OUT: 'sum', nTwice: 'twice' },
    })
    const fbdBlock = (fbd.body as unknown as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (node) => node.kind === 'block',
    )
    expect(fbdBlock).toMatchObject({ call: 'user/Counter.Add', instance: 'c2' })

    const again = structuredClone(SPEC) as unknown as { pous: Array<{ name: string; body: unknown }> }
    again.pous.find((pou) => pou.name === 'ladderMain')!.body = ladder.body
    again.pous.find((pou) => pou.name === 'fbdMain')!.body = fbd.body
    const reapplied = await applySpec(createTestStore(), again as unknown as ApplySpec, {
      prune: false,
      projectPath: '/p',
    })
    expect(reapplied.errors).toEqual([])
  })

  itIfGpp('applies, transpiles to method calls, and the values come back', async () => {
    const parsed = applySpecSchema.safeParse(SPEC)
    expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([])
    const store = createTestStore()
    const outcome = await applySpec(store, SPEC, { prune: false, projectPath: '/p' })
    expect(outcome.errors).toEqual([])

    // Saved and read back: a diagram reaches the POU's body on save, as in the editor.
    expect(flushFlowWriteBacks(store.getState)).toEqual([])
    const files = buildAllProjectFileContentsPure(store)
    const pouFiles = Object.entries(files)
      .filter(([relativePath]) => relativePath.startsWith('pous/'))
      .map(([relativePath, content]) => ({ relativePath, content }))
    const reloaded = parseProjectFiles(
      '/p',
      files['project.json'],
      files['devices/configuration.json'] ?? '',
      '',
      pouFiles,
      [],
      [],
      '',
      [],
    )
    expect(reloaded.fatalErrors ?? []).toEqual([])
    const processed = preprocessPous(reloaded.projectData, false, () => {}).projectData
    const transpiled = transpileToSt(fromSchemaShape(toIpcProjectData(processed) as unknown as SchemaProjectData))
    expect(transpiled.errors).toEqual([])
    const st = transpiled.programSt ?? ''
    // The rung gates the call through EN; the result and the output come back through temps.
    expect(st).toMatch(/_TMP_Add\d+_OUT := c\.Add\(EN := go, nStep := nStepIn, .*nTwice => _TMP_Add\d+_nTwice/)
    expect(st).toMatch(/_TMP_Add\d+_OUT := c2\.Add\(nStep := 5, /)

    const result = compile(st, { headerFileName: 'generated.hpp' })
    expect(result.errors.map((error) => error.message)).toEqual([])

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'method-boxes-'))
    try {
      fs.writeFileSync(path.join(dir, 'generated.hpp'), result.headerCode)
      fs.writeFileSync(path.join(dir, 'generated.cpp'), result.cppCode)
      const config = /class (Configuration_\w+)/.exec(result.headerCode)?.[1]
      fs.writeFileSync(
        path.join(dir, 'main.cpp'),
        `#include "generated.hpp"
#include <cstdio>
strucpp::${config} g_config;
static int fails = 0;
static void check(const char *what, double got, double want) {
  if (got != want) { std::printf("FAIL %s: got %g want %g\\n", what, got, want); ++fails; }
}
int main() {
  auto &l = g_config.LD0;
  auto &f = g_config.FBD0;
  l.run();
  f.run();
  check("sum", l.SUM, 3);
  check("twice", l.TWICE, 6);
  check("ran", l.RAN, 1);
  // The second rung is off: its call does not run, its output keeps its value.
  check("sum2", l.SUM2, 0);
  check("fbd r", f.R, 5);
  // A method call does not run the block's body.
  check("ncalls", l.C.NCALLS, 0);
  l.run();
  check("sum again", l.SUM, 6);
  std::printf(fails ? "FAILURES=%d\\n" : "ALL_OK\\n", fails);
  return fails ? 1 : 0;
}
`,
      )
      const bin = path.join(dir, 'boxes')
      const built = spawnSync(
        'g++',
        [
          '-std=gnu++17',
          `-I${RUNTIME_INCLUDE}`,
          `-I${dir}`,
          '-o',
          bin,
          path.join(dir, 'main.cpp'),
          path.join(dir, 'generated.cpp'),
        ],
        { encoding: 'utf-8' },
      )
      expect(built.stderr.split('\n').filter((line) => line.includes('error'))).toEqual([])
      let out = ''
      try {
        out = execFileSync(bin).toString()
      } catch (error) {
        out = String((error as { stdout?: Buffer }).stdout ?? error)
      }
      expect(out.trim()).toBe('ALL_OK')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
