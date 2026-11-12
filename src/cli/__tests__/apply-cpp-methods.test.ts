/**
 * METHODs of a C/C++ function block (IEC 61131-3 6.6.5.4), end to end:
 *
 * - `apply` takes the block with its METHOD declarations ahead of the C++, and
 *   refuses a declaration the C++ cannot implement;
 * - save -> reload keeps the declarations at the head of the body;
 * - the build lowers each method to an IEC METHOD with an `{external}` body,
 *   STruC++ compiles the program calling it, and the generated `c_blocks.h` /
 *   `c_blocks_code.cpp` compile with g++;
 * - run on the host, the values reach the C++ (an ANY, a STRING literal on an
 *   ANY, a STRING, an IN_OUT, STRING(n) of any length) and the result and
 *   the VAR_OUTPUTs come back;
 *   `setup()` runs once, before the first method call;
 * - a method's parameters are not in the debugger table.
 */

import { execFileSync, execSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { buildCBlocksFromPous } from '@root/backend/shared/compile/steps/compose-firmware-bundle'
import { injectLibraryBlocks } from '@root/backend/shared/library/inject-library-blocks'
import { fromSchemaShape, type SchemaProjectData, transpileToSt } from '@root/backend/shared/transpilers/st-transpiler'
import { parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import { preprocessPous } from '@root/backend/shared/utils/PLC/preprocess-pous'
import { buildAllProjectFileContentsPure } from '@root/frontend/services/save-actions'
import { createTestStore } from '@root/frontend/store/testing'
import { stlibToSystemLibrary } from '@root/frontend/utils/stlib-to-system-library'
import { toIpcProjectData } from '@root/middleware/adapters/editor/compiler-adapter'
import type { StlibArchiveDTO } from '@root/middleware/shared/ports/library-port'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'
import { compile, compileStlib, loadStlibFromString } from 'strucpp'

jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import { lintProgram } from '../lint/program'
import { type ApplySpec, applySpecSchema } from '../apply/schema'

const BOOL = { definition: 'base-type' as const, value: 'BOOL' }
const DINT = { definition: 'base-type' as const, value: 'DINT' }
const STRING = { definition: 'base-type' as const, value: 'STRING' }

const ENGINE_BODY = `METHOD PUBLIC Record : BOOL
  VAR_INPUT
    DATA : ANY;
    SETTINGS : ANY;
    NAME : STRING;
  END_VAR
  VAR_IN_OUT
    COUNTER : DINT;
    TAG : STRING(16);
  END_VAR
  VAR_OUTPUT
    SIZE : DINT;
    NOTE : STRING(8);
  END_VAR
END_METHOD

(* Clears the call count *)
METHOD PUBLIC Reset
END_METHOD

METHOD PUBLIC Label : STRING
END_METHOD

#include <cstring>

void setup() {
  SETUPS = SETUPS + 1;
}

void loop() {
  SCANS = SCANS + 1;
}

// The method's parameters, the block's pins and its VARs, all by name.
bool Record() {
  CALLS = CALLS + 1;
  COUNTER = COUNTER + 1;
  SIZE = DATA.DISIZE;
  if (SETTINGS.TYPECLASS == strucpp::TYPE_CLASS::TYPE_STRING) {
    LAST_SETTINGS = reinterpret_cast<const char *>(SETTINGS.PVALUE);
  }
  LAST_NAME = NAME;
  TAG = "tagged";
  NOTE = "note-too-long";
  total = total + DATA.DISIZE;
  return ENABLE && DATA.TYPECLASS == strucpp::TYPE_CLASS::TYPE_USERDEF;
}

void Reset()
{
  CALLS = 0;
}

strucpp::IEC_STRING Label() {
  return "eng";
}
`

const SPEC = {
  specVersion: 1,
  dataTypes: [
    {
      derivation: 'structure',
      name: 'PUMP_T',
      variables: [
        { name: 'run', type: BOOL },
        { name: 'hours', type: DINT },
      ],
    },
  ],
  pous: [
    {
      name: 'METHOD_ENGINE',
      kind: 'function-block',
      language: 'cpp',
      variables: [
        { name: 'ENABLE', class: 'input', type: BOOL, initialValue: 'TRUE' },
        { name: 'CALLS', class: 'output', type: DINT },
        { name: 'SETUPS', class: 'output', type: DINT },
        { name: 'SCANS', class: 'output', type: DINT },
        { name: 'LAST_SETTINGS', class: 'output', type: STRING },
        { name: 'LAST_NAME', class: 'output', type: STRING },
        { name: 'total', class: 'local', type: DINT },
      ],
      body: { text: ENGINE_BODY },
    },
    {
      name: 'main',
      kind: 'program',
      language: 'st',
      variables: [
        { name: 'e', type: { definition: 'derived', value: 'METHOD_ENGINE' } },
        { name: 'pump', type: { definition: 'user-data-type', value: 'PUMP_T' } },
        { name: 'n', type: DINT },
        { name: 'sz', type: DINT },
        { name: 'sz2', type: DINT },
        { name: 'ok', type: BOOL },
        { name: 'ok2', type: BOOL },
        { name: 'label', type: STRING, initialValue: "'pump'" },
        { name: 'got', type: STRING },
        { name: 'tag', type: { definition: 'base-type', value: 'STRING(16)' } },
        { name: 'note', type: { definition: 'base-type', value: 'STRING(8)' } },
        { name: 'wideTag', type: STRING },
        { name: 'shortNote', type: { definition: 'base-type', value: 'STRING(4)' } },
      ],
      body: {
        text:
          "ok := e.Record(DATA := pump, SETTINGS := 'y=log', NAME := label, COUNTER := n, TAG := tag, SIZE => sz, NOTE => note);\n" +
          'e.Reset();\n' +
          "ok2 := e.Record(DATA := n, SETTINGS := 'x=now', NAME := 'n', COUNTER := n, TAG := wideTag, SIZE => sz2, NOTE => shortNote);\n" +
          'got := e.Label();\n' +
          'e();\n',
      },
    },
  ],
  tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
  instances: [{ name: 'inst0', task: 'task0', program: 'main' }],
} as unknown as ApplySpec

const hasGpp = (() => {
  try {
    execSync('g++ --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const itIfGpp = hasGpp ? it : it.skip

const RUNTIME_INCLUDE = path.resolve(__dirname, '../../../node_modules/strucpp/src/runtime/include')

function reload(files: Record<string, string>) {
  const pouFiles = Object.entries(files)
    .filter(([relativePath]) => relativePath.startsWith('pous/'))
    .map(([relativePath, content]) => ({ relativePath, content }))
  const dataTypeFiles = Object.entries(files)
    .filter(([relativePath]) => relativePath.startsWith('datatypes/'))
    .map(([relativePath, content]) => ({ relativePath, content }))
  return parseProjectFiles(
    '/p',
    files['project.json'],
    files['devices/configuration.json'] ?? '',
    '',
    pouFiles,
    [],
    [],
    '',
    dataTypeFiles,
  )
}

describe('METHODs of a C/C++ function block', () => {
  const store = createTestStore()
  let projectData: PLCProjectData
  let blockFile = ''

  it('applies, saves and reloads the declarations ahead of the C++', async () => {
    expect(applySpecSchema.safeParse(SPEC).success).toBe(true)
    const outcome = await applySpec(store, SPEC, { prune: false, projectPath: '/p' })
    expect(outcome.errors).toEqual([])

    const files = buildAllProjectFileContentsPure(store)
    const file = files['pous/function-blocks/METHOD_ENGINE.cpp']
    blockFile = file
    expect(file).toMatch(/^FUNCTION_BLOCK METHOD_ENGINE$/m)
    expect(file.indexOf('METHOD PUBLIC Record : BOOL')).toBeGreaterThan(file.lastIndexOf('total : DINT'))
    expect(file.indexOf('#include <cstring>')).toBeGreaterThan(file.indexOf('METHOD PUBLIC Reset'))

    const reloaded = reload(files)
    expect(reloaded.fatalErrors ?? []).toEqual([])
    const engine = reloaded.projectData.pous.find((pou) => pou.name === 'METHOD_ENGINE')
    expect(engine?.interface?.variables.map((v) => v.name)).toEqual([
      'ENABLE',
      'CALLS',
      'SETUPS',
      'SCANS',
      'LAST_SETTINGS',
      'LAST_NAME',
      'total',
    ])
    expect(String(engine?.body.value).indexOf('METHOD PUBLIC Record')).toBe(0)
    projectData = reloaded.projectData
  })

  it('refuses a method the C++ cannot implement', async () => {
    const bad = createTestStore()
    const outcome = await applySpec(
      bad,
      {
        specVersion: 1,
        pous: [
          {
            name: 'BAD_ENGINE',
            kind: 'function-block',
            language: 'cpp',
            variables: [{ name: 'DATA', class: 'input', type: DINT }],
            body: {
              text:
                'METHOD PUBLIC Record : BOOL\n  VAR_INPUT DATA : ANY; END_VAR\nEND_METHOD\n' +
                'METHOD Hidden\nEND_METHOD\n' +
                'void setup() {}\nvoid loop() {}\nvoid Hidden() {}\n',
            },
          },
        ],
      } as unknown as ApplySpec,
      { prune: false, projectPath: '/p' },
    )
    const errors = outcome.errors.join('\n')
    expect(errors).toMatch(/"BAD_ENGINE.Record": the parameter "DATA" has the name of a variable of the block/)
    expect(errors).toMatch(/"BAD_ENGINE.Record" has no C\+\+ function/)
    expect(errors).toMatch(/"BAD_ENGINE.Hidden": declare it METHOD PUBLIC/)
  })

  itIfGpp('builds, and the values reach the C++ and the result comes back', () => {
    const logs: string[] = []
    const prepared = preprocessPous(projectData, false, (level, message) => logs.push(`${level}: ${message}`))
    expect(prepared.validationFailed).toBe(false)
    const processed = prepared.projectData
    const engine = processed.pous.find((pou) => pou.name === 'METHOD_ENGINE')
    const glue = String(engine?.body.value)
    expect(glue).toMatch(/METHOD PUBLIC Record : BOOL/)
    expect(glue).toMatch(/RECORD_result = method_engine__record\(&vars, &args\);/)
    expect(glue).toMatch(/method_engine__reset\(&vars, &args\);/)

    const ipc = toIpcProjectData(processed)
    const transpiled = transpileToSt(fromSchemaShape(ipc as unknown as SchemaProjectData))
    expect(transpiled.errors).toEqual([])
    const st = transpiled.programSt ?? ''

    // `check --lint` reads this ST: the method calls and the generated glue are clean.
    expect(lintProgram({ st, pous: processed.pous, systemLibraries: [], globals: [] })).toEqual([])

    const result = compile(st, {
      headerFileName: 'generated.hpp',
      debug: true,
      lineMapping: true,
      md5: '0123456789abcdef0123456789abcdef',
      pouIncludes: ['c_blocks.h'],
    })
    expect(result.errors.map((error) => error.message)).toEqual([])

    // The block's pins are in the debugger table; the method's parameters are not.
    expect((result.debugMap?.leaves ?? []).map((leaf) => leaf.path)).toEqual([
      'INST0.E.ENABLE',
      'INST0.E.CALLS',
      'INST0.E.SETUPS',
      'INST0.E.SCANS',
      'INST0.E.LAST_SETTINGS',
      'INST0.E.LAST_NAME',
      'INST0.E.TOTAL',
      'INST0.E.HASBEENINITIALIZED',
      'INST0.PUMP.RUN',
      'INST0.PUMP.HOURS',
      'INST0.N',
      'INST0.SZ',
      'INST0.SZ2',
      'INST0.OK',
      'INST0.OK2',
      'INST0.LABEL',
      'INST0.GOT',
      'INST0.TAG',
      'INST0.NOTE',
      'INST0.WIDETAG',
      'INST0.SHORTNOTE',
    ])

    const cppPous = processed.originalCppPous ?? []
    const cBlocks = buildCBlocksFromPous(cppPous, ['PUMP_T'])
    expect(cBlocks.header).toContain('} METHOD_ENGINE_RECORD_ARGS;')
    expect(cBlocks.header).toContain(
      'extern "C" strucpp::IEC_BOOL method_engine__record(METHOD_ENGINE_VARS *vars, METHOD_ENGINE_RECORD_ARGS *args);',
    )
    expect(cBlocks.header).toContain(
      'extern "C" void method_engine__reset(METHOD_ENGINE_VARS *vars, METHOD_ENGINE_RESET_ARGS *args);',
    )
    const code = cBlocks.code ?? ''
    expect(code).not.toContain('METHOD PUBLIC')
    // Line numbers of the C++ are kept: Reset's brace was on its own line.
    expect(code).toMatch(
      /method_engine__reset\(METHOD_ENGINE_VARS \*vars, METHOD_ENGINE_RESET_ARGS \*args\) \{ \(void\)vars; \(void\)args;\n\n {2}CALLS = 0;/,
    )

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-methods-'))
    try {
      fs.writeFileSync(path.join(dir, 'generated.hpp'), result.headerCode)
      fs.writeFileSync(path.join(dir, 'generated.cpp'), result.cppCode)
      fs.writeFileSync(path.join(dir, 'c_blocks.h'), cBlocks.header)
      fs.writeFileSync(path.join(dir, 'c_blocks_code.cpp'), code)
      // The debugger table names every member the class declares.
      fs.writeFileSync(path.join(dir, 'generated_debug.cpp'), result.debugTableCpp ?? '')
      const config = /class (Configuration_\w+)/.exec(result.headerCode)?.[1]
      expect(config).toBeDefined()
      fs.writeFileSync(
        path.join(dir, 'main.cpp'),
        `#include "generated.hpp"
#include <cstdio>
#include <string>
strucpp::${config} g_config;
static int fails = 0;
static void check(const char *what, double got, double want) {
  if (got != want) { std::printf("FAIL %s: got %g want %g\\n", what, got, want); ++fails; }
}
template <typename S>
static void check_s(const char *what, const S &got, const char *want) {
  std::string g = got.get().c_str();
  if (g != want) { std::printf("FAIL %s: got '%s' want '%s'\\n", what, g.c_str(), want); ++fails; }
}
int main() {
  auto &p = g_config.INST0;
  p.run();
  check("setups", p.E.SETUPS, 1);
  check("scans", p.E.SCANS, 1);
  check("calls", p.E.CALLS, 1);
  check("counter", p.N, 2);
  check("ok", p.OK, 1);
  check("ok2", p.OK2, 0);
  check("size", p.SZ, (double)sizeof(strucpp::PUMP_T));
  check("size2", p.SZ2, 4);
  check_s("settings", p.E.LAST_SETTINGS, "x=now");
  check_s("name", p.E.LAST_NAME, "n");
  check_s("label", p.GOT, "eng");
  // STRING(n) in-outs and outputs keep their length; another length binds too.
  check_s("tag", p.TAG, "tagged");
  check_s("note", p.NOTE, "note-too");
  check_s("wide tag", p.WIDETAG, "tagged");
  check_s("short note", p.SHORTNOTE, "note");
  p.run();
  check("setups again", p.E.SETUPS, 1);
  check("counter again", p.N, 4);
  std::printf(fails ? "FAILURES=%d\\n" : "ALL_OK\\n", fails);
  return fails ? 1 : 0;
}
`,
      )
      const bin = path.join(dir, 'engine')
      const built = spawnSync(
        'g++',
        [
          '-std=gnu++17',
          '-Wall',
          '-Wextra',
          `-I${RUNTIME_INCLUDE}`,
          `-I${dir}`,
          '-o',
          bin,
          path.join(dir, 'main.cpp'),
          path.join(dir, 'generated.cpp'),
          path.join(dir, 'c_blocks_code.cpp'),
          path.join(dir, 'generated_debug.cpp'),
        ],
        { encoding: 'utf-8' },
      )
      expect(built.stderr.split('\n').filter((line) => line.includes('error'))).toEqual([])
      expect(built.status).toBe(0)
      // The generated block code compiles without a warning.
      expect(built.stderr.split('\n').filter((line) => line.includes('c_blocks_code.cpp'))).toEqual([])
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

  it('ships in a library: the manifest and the tree carry its methods, and a consumer compiles against it', () => {
    const built = compileStlib([{ fileName: 'METHOD_ENGINE.cpp', source: blockFile }], {
      name: 'engine-lib',
      version: '1.0.0',
      namespace: 'engine',
    })
    expect((built.errors ?? []).map((error) => error.message)).toEqual([])
    const entry = built.archive.manifest.functionBlocks.find((fb) => fb.name === 'METHOD_ENGINE')
    expect(entry?.implementation).toBe('cpp')
    expect(entry?.methods?.map((method) => method.name)).toEqual(['RECORD', 'RESET', 'LABEL'])

    const system = stlibToSystemLibrary(built.archive as unknown as StlibArchiveDTO, { executionControl: true })
    const block = system.pous.find((pou) => pou.name === 'METHOD_ENGINE')
    expect(block?.methods?.map((method) => [method.name, method.returnType])).toEqual([
      ['Record', 'BOOL'],
      ['Reset', undefined],
      ['Label', 'STRING'],
    ])
    expect(block?.methods?.[0].variables.map((variable) => `${variable.class}:${variable.name}`)).toEqual([
      'input:DATA',
      'input:SETTINGS',
      'input:NAME',
      'output:SIZE',
      'output:NOTE',
      'inOut:COUNTER',
      'inOut:TAG',
    ])

    // The consumer's project has no block of its own; the build grafts the library's.
    const consumer: PLCProjectData = {
      ...projectData,
      pous: projectData.pous.filter((pou) => pou.name !== 'METHOD_ENGINE'),
      libraries: [{ name: 'engine-lib', version: '1.0.0' }],
    }
    const grafted = injectLibraryBlocks(consumer, [built.archive as unknown as StlibArchiveDTO])
    const prepared = preprocessPous(grafted, false, () => undefined)
    expect(prepared.validationFailed).toBe(false)
    const ipc = toIpcProjectData(prepared.projectData)
    const transpiled = transpileToSt(fromSchemaShape(ipc as unknown as SchemaProjectData))
    expect(transpiled.errors).toEqual([])
    const result = compile(transpiled.programSt ?? '', {
      headerFileName: 'generated.hpp',
      pouIncludes: ['c_blocks.h'],
      libraries: [loadStlibFromString(JSON.stringify(built.archive))],
    })
    expect(result.errors.map((error) => error.message)).toEqual([])
    expect(result.cppCode).toContain('METHOD_ENGINE::RECORD(')
  })
})
