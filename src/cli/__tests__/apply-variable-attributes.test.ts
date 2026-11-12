/**
 * Attribute pragmas on a variable through `apply` -> save -> reload, on an ST
 * POU and a C++ block alike, and into the ST the build compiles.
 */

import { parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import { buildAllProjectFileContentsPure } from '@root/frontend/services/save-actions'
import { createTestStore } from '@root/frontend/store/testing'

jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'
import { applySpecSchema } from '../apply/schema'

const store = createTestStore()

const INT = { definition: 'base-type' as const, value: 'INT' }
const BOOL = { definition: 'base-type' as const, value: 'BOOL' }

const block = (name: string, language: 'st' | 'cpp', variables: Array<Record<string, unknown>>) => ({
  name,
  kind: 'function-block' as const,
  language,
  variables,
  body: { text: language === 'st' ? 'nWork := nWork + 1;' : 'void setup() {}\nvoid loop() {}' },
})

const apply = (pous: unknown[]) =>
  applySpec(store, { specVersion: 1, pous } as ApplySpec, { prune: true, projectPath: '/does/not/matter' })

function reload() {
  const files = buildAllProjectFileContentsPure(store)
  const pouFiles = Object.entries(files)
    .filter(([path]) => path.startsWith('pous/'))
    .map(([relativePath, content]) => ({ relativePath, content }))
  const parsed = parseProjectFiles('/p', files['project.json'], '', '', pouFiles, [], [])
  return { files, pous: parsed.projectData.pous }
}

describe.each(['st', 'cpp'] as const)('variable attributes on a %s block', (language) => {
  const name = `FB_ATTR_${language.toUpperCase()}`
  const variables = [
    { name: 'bRun', class: 'input', type: BOOL },
    { name: 'nWork', class: 'local', type: INT, attributes: ['hide', { name: 'conditionalshow', value: 'Lib' }] },
  ]
  const work = () =>
    reload()
      .pous.find((pou) => pou.name === name)
      ?.interface?.variables.find((v) => v.name === 'nWork')

  it('are set by apply, written as pragmas and read back after a save', async () => {
    expect((await apply([block(name, language, variables)])).errors).toEqual([])
    const file = Object.entries(reload().files).find(([path]) => path.endsWith(`/${name}.${language}`))?.[1] ?? ''
    expect(file).toContain("{attribute 'hide'}")
    expect(file).toContain("{attribute 'conditionalshow' := 'Lib'}")
    expect(work()?.attributes).toEqual([{ name: 'hide' }, { name: 'conditionalshow', value: 'Lib' }])
  })

  it('are left alone by a spec that does not mention them, and removed by []', async () => {
    await apply([block(name, language, variables)])
    await apply([block(name, language, [variables[0], { name: 'nWork', class: 'local', type: INT }])])
    expect(work()?.attributes).toEqual([{ name: 'hide' }, { name: 'conditionalshow', value: 'Lib' }])
    await apply([block(name, language, [variables[0], { name: 'nWork', class: 'local', type: INT, attributes: [] }])])
    expect(work()).not.toHaveProperty('attributes')
  })
})

describe('the spec', () => {
  it('refuses an attribute that cannot be written as a pragma', () => {
    const spec = {
      specVersion: 1,
      pous: [block('FB_BAD', 'st', [{ name: 'a', type: INT, attributes: [{ name: 'x', value: "it's" }] }])],
    }
    expect(applySpecSchema.safeParse(spec).success).toBe(false)
  })
})
