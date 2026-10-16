/**
 * How a debug session's values READ on a real project's diagrams.
 *
 * The suite opens a copy of a project, builds its debug tree from the project's own `debug-map.json` with
 * the editor's code (through the e2e hook, src/frontend/e2e-hook.ts), fills every value, and takes a
 * screenshot of each requested rung. There is no PLC: the values are made up, the rendering is the real
 * one. The screenshots are for looking at; the assertions only check that the values reached the page.
 *
 *   DEBUG_DISPLAY_PROJECT  the project folder (it needs build/<board>/src/debug-map.json)
 *   DEBUG_DISPLAY_SHOTS    where the screenshots go (default: a temp folder)
 *   DEBUG_DISPLAY_RUNGS    POU:text pairs, comma-separated: each shot is the rung holding that text
 *   DEBUG_DISPLAY_CONFIG   set to also shot the Configuration screen's General tab
 *   DEBUG_DISPLAY_WATCH    global variables to watch (comma-separated); the window is shot with the watch panel
 *   DEBUG_DISPLAY_EXPAND   watch-panel nodes to open, by composite key (e.g. Config0:well,Config0:well.Data)
 *
 * The libraries and board packages come from the local editor profile (~/.config/open-plc-editor).
 * Build first, as for every suite here: see "Electron e2e" in CLAUDE.md.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const SOURCE = process.env.DEBUG_DISPLAY_PROJECT ?? ''
const SHOTS = process.env.DEBUG_DISPLAY_SHOTS ?? join(tmpdir(), 'openplc-e2e-debug-display-shots')
const RUNGS = (process.env.DEBUG_DISPLAY_RUNGS ?? '')
  .split(',')
  .map((pair) => pair.split(':'))
  .filter((pair): pair is [string, string] => pair.length === 2)
const ROOT = join(tmpdir(), 'openplc-e2e-debug-display')
const PROFILE = join(homedir(), '.config', 'open-plc-editor')

/** Copy a profile folder whose registry names absolute paths, pointing them at the copy. */
function copyRegistryFolder(name: string, userData: string): void {
  const from = join(PROFILE, name)
  if (!existsSync(from)) return
  const to = join(userData, name)
  cpSync(from, to, { recursive: true })
  const registry = join(to, 'registry.json')
  if (existsSync(registry)) writeFileSync(registry, readFileSync(registry, 'utf-8').split(from).join(to))
}

function writeFixture(): { project: string; userData: string; name: string } {
  rmSync(ROOT, { recursive: true, force: true })
  const project = join(ROOT, 'project')
  const userData = join(ROOT, 'userdata')
  cpSync(SOURCE, project, { recursive: true, filter: (path) => !path.includes(`${SOURCE}/output`) })
  const name = (JSON.parse(readFileSync(join(project, 'project.json'), 'utf-8')) as { meta: { name: string } }).meta
    .name

  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([{ name, path: project, projectFilePath: join(project, 'project.json'), createdAt: now, lastOpenedAt: now }]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
  copyRegistryFolder('libraries', userData)
  copyRegistryFolder('packages', userData)
  return { project, userData, name }
}

function withoutRunAsNode(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) env[key] = value
  }
  return env
}

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    // A shell inside VS Code carries ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
    env: { ...withoutRunAsNode(), NODE_ENV: 'production', OPENPLC_E2E: '1' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          return { app, page: w }
        }
      } catch {
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

/** The debug map of the project's board build. */
function readDebugMap(project: string): unknown {
  const build = join(project, 'build')
  for (const board of readdirSync(build)) {
    const path = join(build, board, 'src', 'debug-map.json')
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
  }
  throw new Error(`no debug-map.json under ${build}`)
}

test.skip(!SOURCE, 'set DEBUG_DISPLAY_PROJECT to a project with a debug map')
test.setTimeout(240000)

test('debug values on the diagrams', async () => {
  const { project, userData, name } = writeFixture()
  mkdirSync(SHOTS, { recursive: true })
  const { app, page } = await launch(userData)
  await page.setViewportSize({ width: 1600, height: 1400 })
  await page.getByText(name, { exact: true }).first().click({ timeout: 30000 })
  await page.waitForTimeout(4000)

  const debugMap = readDebugMap(project)
  const leaves = await page.evaluate((map) => {
    const hook = window.__openplcE2E
    if (!hook) throw new Error('e2e hook missing: was OPENPLC_E2E passed?')
    const state = hook.store.getState()
    const data = state.project.data
    const { treeMap } = hook.buildDebugVariableTreeMap(
      data.pous,
      data.configurations.resource.instances,
      hook.debugMapToEntries(map as never),
      data,
      state.libraries.system,
    )
    const indexes = hook.deriveVariableIndexMap(treeMap, map as never)
    // Values of every kind, as the poller's decoder writes them.
    const boolValues = new Map<string, string>()
    const nonBoolValues = new Map<string, string>()
    let n = 0
    for (const [key, node] of treeMap) {
      if (node.isComplex || node.debugIndex === undefined) continue
      n++
      const type = node.type.toUpperCase()
      if (type === 'BOOL') boolValues.set(key, n % 3 === 0 ? 'TRUE' : 'FALSE')
      else if (node.enumValues && node.enumValues.length > 0) nonBoolValues.set(key, node.enumValues[0])
      else if (type === 'REAL' || type === 'LREAL') nonBoolValues.set(key, ((n % 997) / 29.7).toFixed(6))
      else if (type.startsWith('STRING')) nonBoolValues.set(key, '"wifi-down-under"')
      else if (type === 'TIME') nonBoolValues.set(key, 'T#1s500ms')
      else nonBoolValues.set(key, String(n % 200))
    }
    const actions = state.workspaceActions
    actions.setDebugVariableIndexes(indexes)
    actions.setDebugVariableTree(treeMap)
    actions.setDebugValues({ boolValues, nonBoolValues })
    actions.setDebuggerVisible(true)
    return boolValues.size + nonBoolValues.size
  }, debugMap)
  expect(leaves).toBeGreaterThan(0)

  try {
    await shootRungs(page)
    const watch = (process.env.DEBUG_DISPLAY_WATCH ?? '').split(',').filter(Boolean)
    if (watch.length > 0) {
      await page.evaluate(
        ({ names, expand }) => {
          const state = window.__openplcE2E!.store.getState()
          const globals = state.project.data.configurations.resource.globalVariables
          for (const name of names) {
            const rowId = globals.findIndex((v) => v.name === name)
            if (rowId !== -1) state.projectActions.updateVariable({ scope: 'global', rowId, data: { debug: true } })
          }
          for (const key of expand) state.workspaceActions.toggleDebugExpandedNode(key)
        },
        { names: watch, expand: (process.env.DEBUG_DISPLAY_EXPAND ?? '').split(',').filter(Boolean) },
      )
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(SHOTS, 'watch-panel.png') })
    }
    if (process.env.DEBUG_DISPLAY_CONFIG) {
      await page.getByText('Configuration', { exact: true }).locator('visible=true').first().click({ timeout: 30000 })
      await page.getByRole('tab', { name: 'General' }).click({ timeout: 30000 })
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(SHOTS, 'configuration-general.png') })
    }
  } catch (error) {
    await page.screenshot({ path: join(SHOTS, 'failure-window.png') })
    throw error
  }

  await app.close()
})

async function shootRungs(page: Page): Promise<void> {
  for (const [pou, text] of RUNGS) {
    await page.getByText(pou, { exact: true }).locator('visible=true').first().click({ timeout: 30000 })
    await page.waitForTimeout(1500)
    // Rungs render as they scroll into view: scroll the rung list until the text is there.
    const target = page.getByText(text, { exact: true }).locator('visible=true')
    await page.mouse.move(900, 500)
    for (let i = 0; i < 60 && (await target.count()) === 0; i++) {
      await page.mouse.wheel(0, 400)
      await page.waitForTimeout(200)
    }
    const flow = page
      .locator('.react-flow:visible')
      .filter({ has: page.getByText(text, { exact: true }) })
      .first()
    await flow.scrollIntoViewIfNeeded({ timeout: 30000 })
    await page.waitForTimeout(800)
    await flow.screenshot({ path: join(SHOTS, `${pou}-${text.replace(/[^\w]+/g, '_')}.png`) })
  }
}
