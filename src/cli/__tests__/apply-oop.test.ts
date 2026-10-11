/**
 * IEC 61131-3 object-oriented parts through the CLI, the project model and the
 * compile path (6.6.5 function block inheritance, 6.6.6 interfaces):
 *
 * - `apply` declares an INTERFACE POU, a function block that IMPLEMENTS it with
 *   METHODs ahead of its body, an ABSTRACT base with an `R_EDGE` input, a
 *   `VAR PROTECTED` and a `VAR NON_RETAIN` section, and a block that EXTENDS it;
 * - save -> reload keeps every clause and qualifier;
 * - the transpiled ST carries them, and STruC++ builds the library from it;
 * - the library's manifest, read back as the editor's library model, offers
 *   the interface as a type and marks the blocks: EN / ENO on every block, the
 *   abstract one not placeable, the edge input;
 * - a Ladder rung wires an instance of the derived block to the
 *   interface-typed input of another library block, the rung drives EN, and
 *   the project compiles against the library.
 */

import { parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import { fromSchemaShape, type SchemaProjectData, transpileToSt } from '@root/backend/shared/transpilers/st-transpiler'
import { buildAllProjectFileContentsPure } from '@root/frontend/services/save-actions'
import { flushFlowWriteBacks } from '@root/frontend/store/slices/shared/flow-writeback'
import { createTestStore } from '@root/frontend/store/testing'
import { buildBlockVariant } from '@root/frontend/utils/PLC/block-variant'
import { validateVariableType } from '@root/frontend/utils/PLC/validate-variable-type'
import { stlibToSystemLibrary } from '@root/frontend/utils/stlib-to-system-library'
import { toIpcProjectData } from '@root/middleware/adapters/editor/compiler-adapter'
import type { StlibArchiveDTO } from '@root/middleware/shared/ports/library-port'
import { compile, compileStlib, loadStlibFromString } from 'strucpp'

jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const BOOL = { definition: 'base-type' as const, value: 'BOOL' }
const INT = { definition: 'base-type' as const, value: 'INT' }

const LIBRARY_SPEC = {
  specVersion: 1,
  pous: [
    {
      name: 'OI_STATUS',
      kind: 'interface',
      language: 'st',
      body: { text: 'METHOD Code : INT\nEND_METHOD\n' },
    },
    {
      name: 'OI_MOTOR',
      kind: 'interface',
      language: 'st',
      extends: ['OI_STATUS'],
      body: { text: 'METHOD IsRunning : BOOL\nEND_METHOD\n' },
    },
    {
      name: 'OM_BASE',
      kind: 'function-block',
      language: 'st',
      abstract: true,
      implements: ['OI_MOTOR'],
      variables: [
        { name: 'Start', class: 'input', edge: 'rising', type: BOOL },
        { name: 'Running', class: 'output', type: BOOL },
        { name: 'want', access: 'protected', type: BOOL },
        { name: 'firstScan', flag: 'non-retain', type: BOOL, initialValue: 'TRUE' },
      ],
      body: {
        text:
          'METHOD PUBLIC Code : INT\n  Code := 1;\nEND_METHOD\n' +
          'METHOD PUBLIC IsRunning : BOOL\n  IsRunning := Running;\nEND_METHOD\n\n' +
          'IF Start THEN want := TRUE; END_IF;\nRunning := want;\nfirstScan := FALSE;\n',
      },
    },
    {
      name: 'OM_VSD',
      kind: 'function-block',
      language: 'st',
      extends: 'OM_BASE',
      variables: [{ name: 'Hz', class: 'input', type: INT }],
      body: { text: 'METHOD PUBLIC OVERRIDE Code : INT\n  Code := 2;\nEND_METHOD\n\nSUPER();\n' },
    },
    {
      name: 'OP_PUMP',
      kind: 'function-block',
      language: 'st',
      variables: [
        { name: 'Motor', class: 'input', type: { definition: 'derived' as const, value: 'OI_MOTOR' } },
        { name: 'Ok', class: 'output', type: BOOL },
      ],
      body: { text: 'Ok := Motor <> NULL;\nIF Ok THEN Ok := Motor.IsRunning(); END_IF;\n' },
    },
  ],
} as unknown as ApplySpec

function saveFiles(store: ReturnType<typeof createTestStore>) {
  // As a save does: the diagrams' edits are written back into the POUs first.
  flushFlowWriteBacks(store.getState)
  return buildAllProjectFileContentsPure(store)
}

function reload(files: Record<string, string>) {
  const pouFiles = Object.entries(files)
    .filter(([path]) => path.startsWith('pous/'))
    .map(([relativePath, content]) => ({ relativePath, content }))
  return parseProjectFiles('/p', files['project.json'], files['devices/configuration.json'] ?? '', '', pouFiles, [], [])
}

function transpile(store: ReturnType<typeof createTestStore>): string {
  const ipc = toIpcProjectData(store.getState().project.data)
  const result = transpileToSt(fromSchemaShape(ipc as unknown as SchemaProjectData))
  expect(result.errors).toEqual([])
  return result.programSt ?? ''
}

describe('interfaces, methods and inheritance in a library project', () => {
  const store = createTestStore()

  it('applies, saves and reloads every clause and qualifier', async () => {
    const outcome = await applySpec(store, LIBRARY_SPEC, { prune: false, projectPath: '/p' })
    expect(outcome.errors).toEqual([])

    const files = saveFiles(store)
    const iface = files['pous/interfaces/OI_MOTOR.st']
    expect(iface).toContain('INTERFACE OI_MOTOR EXTENDS OI_STATUS')
    expect(iface).toContain('END_INTERFACE')
    expect(iface).not.toMatch(/\bVAR\b/)
    const base = files['pous/function-blocks/OM_BASE.st']
    expect(base).toContain('FUNCTION_BLOCK ABSTRACT OM_BASE IMPLEMENTS OI_MOTOR')
    expect(base).toMatch(/Start : BOOL R_EDGE;/)
    expect(base).toMatch(/VAR PROTECTED\s+want : BOOL;/)
    expect(base).toMatch(/VAR NON_RETAIN\s+firstScan : BOOL := TRUE;/)
    expect(files['pous/function-blocks/OM_VSD.st']).toContain('FUNCTION_BLOCK OM_VSD EXTENDS OM_BASE')

    const { projectData, fatalErrors, warnings } = reload(files)
    expect(fatalErrors ?? []).toEqual([])
    expect(warnings ?? []).toEqual([])
    const byName = new Map(projectData.pous.map((pou) => [pou.name, pou]))
    expect(byName.get('OI_MOTOR')?.pouType).toBe('interface')
    expect(byName.get('OI_MOTOR')?.interface?.extends).toBe('OI_STATUS')
    expect(byName.get('OI_MOTOR')?.interface?.variables).toEqual([])
    const reloadedBase = byName.get('OM_BASE')
    expect(reloadedBase?.interface?.isAbstract).toBe(true)
    expect(reloadedBase?.interface?.implements).toEqual(['OI_MOTOR'])
    const vars = new Map((reloadedBase?.interface?.variables ?? []).map((v) => [v.name, v]))
    expect(vars.get('Start')?.edge).toBe('rising')
    expect(vars.get('want')?.access).toBe('protected')
    expect(vars.get('firstScan')?.flag).toBe('non-retain')
    // The methods stay with the body, ahead of its statements.
    const body = String(reloadedBase?.body.value)
    expect(body.indexOf('METHOD PUBLIC Code')).toBe(0)
    expect(body.indexOf('IF Start THEN')).toBeGreaterThan(body.indexOf('END_METHOD'))
    expect(byName.get('OM_VSD')?.interface?.extends).toBe('OM_BASE')
  })

  it('refuses clauses a kind does not allow', async () => {
    const outcome = await applySpec(
      store,
      {
        specVersion: 1,
        pous: [
          { name: 'BAD_IFACE', kind: 'interface', language: 'st', variables: [{ name: 'x', type: INT }] },
          { name: 'BAD_FN', kind: 'function', language: 'st', returnType: 'INT', implements: ['OI_MOTOR'] },
          {
            name: 'BAD_EDGE',
            kind: 'function-block',
            language: 'st',
            variables: [{ name: 'n', class: 'input', edge: 'rising', type: INT }],
          },
        ],
      } as unknown as ApplySpec,
      { prune: false, projectPath: '/p' },
    )
    expect(outcome.errors.join('\n')).toMatch(/BAD_IFACE.*declares no variables/)
    expect(outcome.errors.join('\n')).toMatch(/BAD_FN.*function-block only/)
    expect(outcome.errors.join('\n')).toMatch(/BAD_EDGE.*BOOL input only/)
  })

  it('transpiles them, and STruC++ builds the library with its interfaces in the manifest', () => {
    const st = transpile(store)
    expect(st).toMatch(/^INTERFACE OI_MOTOR EXTENDS OI_STATUS$/m)
    expect(st).toMatch(/^FUNCTION_BLOCK ABSTRACT OM_BASE IMPLEMENTS OI_MOTOR$/m)
    expect(st).toMatch(/^FUNCTION_BLOCK OM_VSD EXTENDS OM_BASE$/m)
    expect(st).toMatch(/Start : BOOL R_EDGE;/)
    expect(st).toMatch(/VAR PROTECTED/)
    expect(st).toMatch(/VAR NON_RETAIN/)

    const lib = compileStlib([{ fileName: 'oop.st', source: st }], {
      name: 'oop-lib',
      version: '1.0.0',
      namespace: 'oop',
    })
    expect((lib.errors ?? []).map((error) => error.message)).toEqual([])
    const manifest = lib.archive.manifest
    expect((manifest.interfaces ?? []).map((i) => i.name).sort()).toEqual(['OI_MOTOR', 'OI_STATUS'])

    // The editor's view of the installed library.
    const system = stlibToSystemLibrary(lib.archive as unknown as StlibArchiveDTO, { executionControl: true })
    expect(system.interfaces?.map((i) => i.name).sort()).toEqual(['OI_MOTOR', 'OI_STATUS'])
    const pou = (name: string) => system.pous.find((entry) => entry.name === name)
    expect(pou('OM_BASE')?.isAbstract).toBe(true)
    expect(pou('OM_VSD')?.extends).toBe('OM_BASE')
    expect(pou('OM_BASE')?.implements).toEqual(['OI_MOTOR'])
    expect(pou('OM_VSD')?.variables.find((v) => v.name === 'START')?.edge).toBe('R_EDGE')
    expect(pou('OP_PUMP')?.executionControl).toBe(true)
    expect(pou('OM_VSD')?.methods?.map((m) => m.name)).toEqual(['CODE', 'ISRUNNING'])
  })
})

describe('a project wiring a library instance to an interface pin in Ladder', () => {
  const libraryStore = createTestStore()
  const store = createTestStore()

  it('gives the library blocks EN / ENO, accepts the instance and compiles', async () => {
    await applySpec(libraryStore, LIBRARY_SPEC, { prune: false, projectPath: '/p' })
    const lib = compileStlib([{ fileName: 'oop.st', source: transpile(libraryStore) }], {
      name: 'oop-lib',
      version: '1.0.0',
      namespace: 'oop',
    })
    expect((lib.errors ?? []).map((error) => error.message)).toEqual([])
    const system = stlibToSystemLibrary(lib.archive as unknown as StlibArchiveDTO, { executionControl: true })
    store.getState().libraryActions.setSystemLibraries([...store.getState().libraries.system, system])

    // An ABSTRACT block is never placed (6.6.5.8.2).
    const abstract = buildBlockVariant({
      blockRef: 'system/oop-lib/OM_BASE',
      systemLibraries: store.getState().libraries.system,
      userLibraries: [],
      pous: [],
    })
    expect(abstract.ok).toBe(false)

    // The pin check takes an instance of a block implementing the interface,
    // directly or through its base (6.6.6.5.1), and nothing else.
    expect(validateVariableType('OM_VSD', 'OI_MOTOR').isValid).toBe(true)
    expect(validateVariableType('OM_VSD', 'OI_STATUS').isValid).toBe(true)
    expect(validateVariableType('OP_PUMP', 'OI_MOTOR').isValid).toBe(false)

    const outcome = await applySpec(
      store,
      {
        specVersion: 1,
        pous: [
          {
            name: 'main',
            kind: 'program',
            language: 'ld',
            variables: [
              { name: 'Motor1', type: { definition: 'derived', value: 'OM_VSD' } },
              { name: 'Pump1', type: { definition: 'derived', value: 'OP_PUMP' } },
              { name: 'Go', type: BOOL },
              { name: 'PumpOk', type: BOOL },
            ],
            body: {
              rungs: [
                { outputs: [{ block: { call: 'system/oop-lib/OM_VSD', instance: 'Motor1', inputs: { HZ: '50' } } }] },
                {
                  logic: { contact: { variable: 'Go', variant: 'default' } },
                  outputs: [
                    {
                      block: {
                        call: 'system/oop-lib/OP_PUMP',
                        instance: 'Pump1',
                        inputs: { MOTOR: 'Motor1' },
                        outputs: { OK: 'PumpOk' },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      } as unknown as ApplySpec,
      { prune: false, projectPath: '/p' },
    )
    expect(outcome.errors).toEqual([])

    // EN / ENO on the library blocks: the rung drives EN, never a data pin.
    const flow = store.getState().ladderFlows.find((entry) => entry.name === 'main')
    const pump = flow?.rungs[1].nodes.find((node) => node.type === 'block')
    const variant = (pump?.data as { variant?: { variables: Array<{ name: string }> } }).variant
    expect(variant?.variables.slice(0, 2).map((v) => v.name)).toEqual(['EN', 'ENO'])

    // Through save -> reload: the rung lives in the ladder flow until then.
    const { projectData } = reload(saveFiles(store))
    const ipc = toIpcProjectData(projectData)
    const transpiled = transpileToSt(fromSchemaShape(ipc as unknown as SchemaProjectData))
    expect(transpiled.errors).toEqual([])
    const st = transpiled.programSt ?? ''
    expect(st).toContain('Motor1(EN := TRUE, HZ := 50);')
    expect(st).toContain('Pump1(EN := Go, MOTOR := Motor1);')

    const archive = loadStlibFromString(JSON.stringify(lib.archive))
    const result = compile(st, { libraries: [archive] })
    expect(result.errors.map((error) => error.message)).toEqual([])
  })
})
