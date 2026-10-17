/**
 * How slow a large Ladder POU is to open, scroll, select in and edit, on a real project. Numbers only: the
 * timings and the slow frames (long tasks over 50 ms) of each step go to the console and PERF_OUT, with a CPU
 * profile of the whole run (PERF_OUT/profile.cpuprofile) for finding where the time goes. No assertions.
 *
 *   PERF_PROJECT  the project folder
 *   PERF_POUS     comma-separated Ladder POUs to measure, e.g. COMMS_REMOTE,PUMP
 *   PERF_OUT      where the results go (default: a temp folder)
 *
 * The libraries and board packages come from the local editor profile (~/.config/open-plc-editor).
 * Build first, as for every suite here: see "Electron e2e" in CLAUDE.md.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, test } from '@playwright/test'

const SOURCE = process.env.PERF_PROJECT ?? ''
const POUS = (process.env.PERF_POUS ?? 'COMMS_REMOTE').split(',').filter(Boolean)
const OUT = process.env.PERF_OUT ?? join(tmpdir(), 'openplc-e2e-large-pou-perf')
const ROOT = join(tmpdir(), 'openplc-e2e-large-pou')
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
    JSON.stringify([
      { name, path: project, projectFilePath: join(project, 'project.json'), createdAt: now, lastOpenedAt: now },
    ]),
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
    // A test window sits behind others, and Chromium slows the frames of a window it thinks is hidden: off, so
    // the frame times are the editor's own.
    args: [
      join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'),
      `--user-data-dir=${userData}`,
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
    ],
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

type Step = { step: string; ms: number; idle: boolean; longTasks: number; longestMs: number; blockedMs: number }

declare global {
  interface Window {
    __perfLong?: number[]
  }
}

/** Long tasks since the last call: how many, the longest, and the main thread time they blocked. */
async function takeLongTasks(page: Page): Promise<Omit<Step, 'step' | 'ms' | 'idle'>> {
  const tasks = await page.evaluate(() => (window.__perfLong ?? []).splice(0))
  return {
    longTasks: tasks.length,
    longestMs: Math.round(Math.max(0, ...tasks)),
    blockedMs: Math.round(tasks.reduce((a, b) => a + b, 0)),
  }
}

/**
 * Waits until ten animation frames in a row arrive less than 50 ms apart: the page is idle again. Gives up after
 * 30 s and says so: a page that never goes idle keeps redrawing by itself.
 */
async function settled(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const start = performance.now()
        let last = start
        let quiet = 0
        const tick = () => {
          const now = performance.now()
          quiet = now - last < 50 ? quiet + 1 : 0
          last = now
          if (quiet >= 10) resolve(true)
          else if (now - start > 30000) resolve(false)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
}

/** A leaf of the project tree (the explorer on the left), clicked where it shows. */
function treeLeaf(page: Page, name: string) {
  return {
    click: async () => {
      const at = await page.evaluate((text) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          if (t.textContent?.replace(/^\s*\*\s*/, '').trim() !== text || !t.parentElement) continue
          if (t.parentElement.getBoundingClientRect().left >= 360) continue
          t.parentElement.scrollIntoView({ block: 'center' })
          const r = t.parentElement.getBoundingClientRect()
          if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }
        return null
      }, name)
      if (!at) {
        const seen = await page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .filter((e) => e.children.length === 0 && /COMMS/.test(e.textContent ?? ''))
            .map((e) => `${e.tagName} ${JSON.stringify(e.textContent)} ${JSON.stringify(e.getBoundingClientRect())}`)
            .slice(0, 10),
        )
        throw new Error(`${name} is not in the project tree: ${seen.join(' | ')}`)
      }
      await page.mouse.click(at.x, at.y)
    },
  }
}

test.skip(!SOURCE, 'set PERF_PROJECT to a project')
test.setTimeout(600000)

test('large Ladder POU: open, scroll, select, edit', async () => {
  const { userData, name } = writeFixture()
  mkdirSync(OUT, { recursive: true })
  const { app, page } = await launch(userData)
  const results: Step[] = []
  const measure = async (step: string, action: () => Promise<void>) => {
    await takeLongTasks(page)
    const t0 = Date.now()
    await action()
    const idle = await settled(page)
    const r = { step, ms: Date.now() - t0, idle, ...(await takeLongTasks(page)) }
    results.push(r)
    console.log(JSON.stringify(r))
  }
  try {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.evaluate(() => {
      window.__perfLong = []
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__perfLong!.push(e.duration)
      }).observe({ type: 'longtask', buffered: false })
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
    await cdp.send('Profiler.start')

    await measure('open project', async () => {
      await page.getByText(name, { exact: true }).first().click({ timeout: 30000 })
      await page.locator('[data-testid], body').first().waitFor()
      await page.waitForTimeout(3000)
    })

    await page.screenshot({ path: join(OUT, 'opened.png') })

    for (const pou of POUS) {
      const rungCount = (await page.evaluate(
        (p) =>
          window.__openplcE2E!.store.getState().ladderFlows.find((f: { name: string }) => f.name === p)?.rungs.length,
        pou,
      )) as number | undefined
      await measure(`${pou}: open tab (${rungCount ?? '?'} rungs)`, async () => {
        await treeLeaf(page, pou).click()
        await page.locator('.react-flow:visible').first().waitFor({ timeout: 120000 })
      })
      console.log(
        JSON.stringify({
          pou,
          diagrams: await page.locator('.react-flow').count(),
          diagramsShowing: await page.locator('.react-flow:visible').count(),
          elements: await page.locator('.react-flow__node').count(),
          domNodes: await page.evaluate(() => document.querySelectorAll('*').length),
        }),
      )
      const scroller = page
        .locator('.react-flow:visible')
        .first()
        .locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]')
      await measure(`${pou}: scroll to the end (20 steps)`, async () => {
        for (let i = 0; i < 20; i++) {
          await scroller.evaluate((el) => el.scrollBy(0, el.scrollHeight / 20))
          await page.waitForTimeout(30)
        }
      })
      await scroller.evaluate((el) => el.scrollTo(0, 0))
      await settled(page)
      // Smoothness: frame times while the mouse wheel scrolls, as a user does (slow frames are a stutter).
      const box = (await scroller.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __framesOn: boolean }
        w.__frames = []
        w.__framesOn = true
        let last = performance.now()
        const tick = () => {
          const now = performance.now()
          w.__frames.push(now - last)
          last = now
          if (w.__framesOn) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      for (let i = 0; i < 60; i++) {
        await page.mouse.wheel(0, 120)
        await page.waitForTimeout(16)
      }
      const frames = await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __framesOn: boolean }
        w.__framesOn = false
        return w.__frames
      })
      const sorted = [...frames].sort((a, b) => a - b)
      const smooth = {
        step: `${pou}: wheel scroll (60 notches)`,
        frames: frames.length,
        medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
        p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
        over50ms: frames.filter((f) => f > 50).length,
        worstMs: Math.round(sorted[sorted.length - 1] ?? 0),
      }
      console.log(JSON.stringify(smooth))
      writeFileSync(join(OUT, `${pou}-wheel.json`), JSON.stringify(smooth))
      await scroller.evaluate((el) => el.scrollTo(0, 0))
      await settled(page)
      const node = page.locator('.react-flow__node').locator('visible=true').nth(2)
      await measure(`${pou}: select an element`, async () => {
        await node.click({ force: true })
      })
      const field = page.locator('.react-flow textarea:visible').first()
      if ((await field.count()) > 0) {
        const before = await field.inputValue()
        await measure(`${pou}: type 5 characters into a variable`, async () => {
          await field.click({ force: true })
          await field.press('End')
          await page.keyboard.type('XXXXX', { delay: 40 })
        })
        await measure(`${pou}: change it back (blur)`, async () => {
          await field.fill(before)
          await field.press('Enter')
        })
      }
      await measure(`${pou}: switch away (to Resource) and back`, async () => {
        await treeLeaf(page, 'Resource').click()
        await settled(page)
        await treeLeaf(page, pou).click()
      })
    }

    const { profile } = await cdp.send('Profiler.stop')
    writeFileSync(join(OUT, 'profile.cpuprofile'), JSON.stringify(profile))
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  } finally {
    await app.close()
  }
})
