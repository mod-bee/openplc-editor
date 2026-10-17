/**
 * Find in project, Go to, right-click Find references / Go to declaration and the Cross references panel,
 * on a real project, offline. Screenshots are for looking at; the assertions check the steps happened.
 *
 *   FIND_XREF_PROJECT  the project folder
 *   FIND_XREF_SHOTS    where the screenshots go (default: a temp folder)
 *   FIND_XREF_QUERY    the text to find (a name used on a Ladder contact), e.g. levelLimit.Trip
 *   FIND_XREF_POU      a Ladder POU holding a contact to right-click, e.g. PUMP
 *   FIND_XREF_CONTACT  that contact's name, e.g. levelLimit.LoLo
 *
 * The libraries and board packages come from the local editor profile (~/.config/open-plc-editor).
 * Build first, as for every suite here: see "Electron e2e" in CLAUDE.md.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const SOURCE = process.env.FIND_XREF_PROJECT ?? ''
const SHOTS = process.env.FIND_XREF_SHOTS ?? join(tmpdir(), 'openplc-e2e-find-xref-shots')
const QUERY = process.env.FIND_XREF_QUERY ?? 'levelLimit.Trip'
const POU = process.env.FIND_XREF_POU ?? 'PUMP'
const CONTACT = process.env.FIND_XREF_CONTACT ?? 'levelLimit.LoLo'
const ROOT = join(tmpdir(), 'openplc-e2e-find-xref')
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

function writeFixture(): { userData: string; name: string } {
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
  return { userData, name }
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

test.skip(!SOURCE, 'set FIND_XREF_PROJECT to a project')
test.setTimeout(240000)

test('find, go to, find references', async () => {
  const { userData, name } = writeFixture()
  mkdirSync(SHOTS, { recursive: true })
  const { app, page } = await launch(userData)
  const shot = (file: string) => page.screenshot({ path: join(SHOTS, file) })
  try {
    await page.setViewportSize({ width: 1600, height: 1200 })
    await page.getByText(name, { exact: true }).first().click({ timeout: 30000 })
    await page.waitForTimeout(4000)

    // 1. Find in project: type and press Enter.
    await page.evaluate(() => window.__openplcE2E!.store.getState().workspaceActions.setModalOpen('findInProject', true))
    const input = page.getByPlaceholder('Search').locator('visible=true').first()
    await input.fill(QUERY)
    await input.press('Enter')
    await page.waitForTimeout(1000)
    await shot('1-find-results.png')
    // A hit's place, `rung 1 · contact` (not the editor's own "Create new rung").
    const hit = page.getByText(/^rung \d+ · /).locator('visible=true')
    expect(await hit.count()).toBeGreaterThan(0)

    // 2. Go to the first Ladder hit: its rung in view, the element selected.
    await hit.first().click()
    await page.waitForTimeout(1500)
    await shot('2-goto-hit.png')

    // 3. Right-click a contact offline: Find references / Go to declaration.
    await page.getByText(POU, { exact: true }).locator('visible=true').first().click()
    await page.waitForTimeout(1500)
    const contact = page.locator('.react-flow textarea:visible')
    let target = -1
    for (let i = 0; i < (await contact.count()); i++) {
      if ((await contact.nth(i).inputValue()) === CONTACT) {
        target = i
        break
      }
    }
    expect(target).toBeGreaterThanOrEqual(0)
    await contact.nth(target).click({ button: 'right', force: true })
    await page.waitForTimeout(500)
    await shot('3-contact-menu.png')
    await page.getByText('Find references', { exact: true }).locator('visible=true').first().click()
    await page.waitForTimeout(1000)
    await shot('4-xref-panel.png')
    const rows = page.getByTestId('xref-row')
    expect(await rows.count()).toBeGreaterThan(1)

    // 4. "All of" the variable, then go to a row in another POU.
    const all = page.getByText(/^All of /).locator('visible=true')
    if ((await all.count()) > 0) {
      await all.first().click()
      await page.waitForTimeout(500)
      await shot('5-xref-all.png')
    }
    const otherRow = rows.filter({ hasNotText: POU }).filter({ hasText: 'rung' })
    if ((await otherRow.count()) > 0) {
      await otherRow.first().click()
      await page.waitForTimeout(1500)
      await shot('6-xref-goto-row.png')
    }

    // 4b. A block call of the variable: the asked-for member's pin is marked on the block.
    const call = rows.filter({ hasText: ' block' }).filter({ hasText: 'Call' })
    if ((await call.count()) > 0) {
      await call.first().click()
      await page.waitForTimeout(1500)
      await shot('6b-call-pin.png')
    }

    // 4c. A variable on a block pin: the variable and the block's pin are marked.
    await page.evaluate(() =>
      window.__openplcE2E!.store.getState().searchActions.showCrossReferences({ expression: 'resetAll' }),
    )
    await page.waitForTimeout(800)
    const onPin = page.getByTestId('xref-row').filter({ hasText: /input Reset of/ })
    if ((await onPin.count()) > 0) {
      await onPin.first().click()
      await page.waitForTimeout(1500)
      await shot('6c-variable-pin.png')
    }

    // 5. Go to declaration from the panel.
    await page.getByText('Go to declaration', { exact: true }).locator('visible=true').first().click()
    await page.waitForTimeout(1500)
    await shot('7-declaration.png')
  } finally {
    await app.close()
  }
})
