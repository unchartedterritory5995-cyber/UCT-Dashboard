/**
 * UI consistency sweep — logs into the local dashboard and screenshots every
 * route, nested tab, and a few key modals at desktop + mobile widths. Also
 * probes each page's computed font-families so font drift is quantified, not
 * just eyeballed.
 *
 * Prereqs: backend on :8000, vite dev on :5173, a seeded admin
 * (tools/seed_sweep_admin.py). Playwright is installed in ../uct-sweep.
 *
 * Run (from the external dir so `playwright` resolves):
 *   cd C:\Users\Patrick\uct-sweep && node C:\Users\Patrick\uct-dashboard\tools\ui_sweep.mjs
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:5173'
const EMAIL = 'sweep-admin@uctsweep.com'
const PASSWORD = 'sweep-admin-pw-123'
const OUT = 'C:\\Users\\Patrick\\uct-dashboard\\tools\\ui_sweep_out'
const REPORT = 'C:\\Users\\Patrick\\uct-dashboard\\tools\\ui_sweep_out\\_font_report.json'

fs.mkdirSync(OUT, { recursive: true })

// surface = { slug, path, tabs?: [{slug, click?: text, query?: 'k=v'}] }
const SURFACES = [
  { slug: 'public-landing', path: '/', public: true },
  { slug: 'public-login', path: '/login', public: true },
  { slug: 'public-signup', path: '/signup', public: true },
  { slug: 'public-terms', path: '/terms', public: true },
  { slug: 'public-privacy', path: '/privacy', public: true },
  { slug: 'dashboard', path: '/dashboard' },
  { slug: 'morning-wire', path: '/morning-wire' },
  { slug: 'uct-20', path: '/uct-20' },
  {
    slug: 'breadth', path: '/breadth',
    tabs: [
      { slug: 'breadth-monitor', click: 'Monitor' },
      { slug: 'breadth-views', click: 'Views' },
      { slug: 'breadth-cot', click: 'COT Data' },
      { slug: 'breadth-datacharts', click: 'Data Charts' },
    ],
  },
  { slug: 'charts', path: '/charts' },
  {
    slug: 'calendar', path: '/calendar',
    tabs: [
      { slug: 'calendar-feed', click: 'Feed' },
      { slug: 'calendar-week', click: 'Week' },
      { slug: 'calendar-month', click: 'Month' },
    ],
  },
  { slug: 'calendar-mystocks', path: '/calendar/mystocks' },
  {
    slug: 'screener', path: '/screener',
    tabs: [
      { slug: 'screener-pullback', click: 'Pullback' },
      { slug: 'screener-remount', click: 'Remount' },
      { slug: 'screener-gappers', click: 'Gappers' },
    ],
  },
  { slug: 'patterns', path: '/patterns' },
  { slug: 'options-flow', path: '/options-flow' },
  { slug: 'post-market', path: '/post-market' },
  { slug: 'model-book', path: '/model-book' },
  { slug: 'setup-library', path: '/setup-library' },
  {
    slug: 'journal', path: '/journal',
    tabs: [
      { slug: 'journal-positions', query: 'j2tab=positions' },
      { slug: 'journal-journal', query: 'j2tab=journal' },
      { slug: 'journal-calendar', query: 'j2tab=calendar' },
      { slug: 'journal-accounts', query: 'j2tab=accounts' },
      { slug: 'journal-analytics', query: 'j2tab=analytics' },
      { slug: 'journal-notebook', query: 'j2tab=notebook' },
      { slug: 'journal-compass', query: 'j2tab=compass' },
      { slug: 'journal-community', query: 'j2tab=community' },
    ],
  },
  { slug: 'support', path: '/support' },
  { slug: 'settings', path: '/settings' },
  { slug: 'admin', path: '/admin' },
  { slug: 'admin-chart-health', path: '/admin/chart-health' },
  { slug: 'admin-patterns', path: '/admin/patterns' },
  { slug: 'admin-landing-analytics', path: '/admin/landing-analytics' },
  { slug: 'catalysts-history', path: '/catalysts/history' },
  { slug: 'dark-pool', path: '/dark-pool' },
]

const fontReport = {}

async function dismissIntro(page) {
  // Intro overlay plays on full page loads; dismiss with Escape + click.
  try { await page.keyboard.press('Escape') } catch {}
  try { await page.mouse.click(5, 5) } catch {}
}

async function settle(page, ms = 1600) {
  try { await page.waitForLoadState('networkidle', { timeout: 4000 }) } catch {}
  await page.waitForTimeout(ms)
}

async function probeFonts(page, slug) {
  try {
    const families = await page.evaluate(() => {
      const counts = {}
      const els = document.querySelectorAll('body *')
      for (const el of els) {
        const txt = el.textContent && el.textContent.trim()
        if (!txt) continue
        // only leaf-ish text nodes
        if (el.children.length > 0 && el.childElementCount === el.children.length && !el.innerText?.trim()) continue
        const ff = getComputedStyle(el).fontFamily
        if (ff) counts[ff] = (counts[ff] || 0) + 1
      }
      return counts
    })
    fontReport[slug] = families
  } catch (e) {
    fontReport[slug] = { error: String(e) }
  }
}

async function shoot(page, slug) {
  await dismissIntro(page)
  await settle(page)
  await probeFonts(page, slug)
  await page.screenshot({ path: path.join(OUT, `desktop_${slug}.png`), fullPage: true })
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()

  // ---- login ----
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await dismissIntro(page)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => {})
  await settle(page)
  console.log('logged in:', page.url())

  // ---- desktop sweep ----
  for (const s of SURFACES) {
    try {
      await page.goto(`${BASE}${s.path}`, { waitUntil: 'domcontentloaded' })
      await shoot(page, s.slug)
      console.log('shot', s.slug)
      if (s.tabs) {
        for (const t of s.tabs) {
          try {
            if (t.query) {
              await page.goto(`${BASE}${s.path}?${t.query}`, { waitUntil: 'domcontentloaded' })
            } else if (t.click) {
              const el = page.getByText(t.click, { exact: false }).first()
              await el.click({ timeout: 4000 })
            }
            await shoot(page, t.slug)
            console.log('  tab', t.slug)
          } catch (e) {
            console.log('  tab FAIL', t.slug, String(e).split('\n')[0])
          }
        }
      }
    } catch (e) {
      console.log('shot FAIL', s.slug, String(e).split('\n')[0])
    }
  }

  // ---- a few key modals (best-effort) ----
  // Settings already covers form chrome; add a J2 modal + a ticker popup.
  try {
    await page.goto(`${BASE}/journal?j2tab=positions`, { waitUntil: 'domcontentloaded' })
    await dismissIntro(page); await settle(page)
    const addBtn = page.getByRole('button', { name: /add (position|trade)/i }).first()
    await addBtn.click({ timeout: 4000 })
    await page.waitForTimeout(900)
    await probeFonts(page, 'modal-add-position')
    await page.screenshot({ path: path.join(OUT, 'desktop_modal-add-position.png') })
    console.log('shot modal-add-position')
  } catch (e) { console.log('modal add-position FAIL', String(e).split('\n')[0]) }

  // ---- mobile sweep (key surfaces only) ----
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    isMobile: true,
    hasTouch: true,
  })
  const mpage = await mobile.newPage()
  await mpage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await dismissIntro(mpage)
  await mpage.fill('input[type=email]', EMAIL)
  await mpage.fill('input[type=password]', PASSWORD)
  await mpage.click('button[type=submit]')
  await mpage.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => {})
  await settle(mpage)

  const MOBILE_SURFACES = ['dashboard', 'breadth', 'calendar', 'journal', 'settings', 'screener', 'morning-wire', 'admin']
  for (const slug of MOBILE_SURFACES) {
    const s = SURFACES.find((x) => x.slug === slug)
    if (!s) continue
    try {
      await mpage.goto(`${BASE}${s.path}`, { waitUntil: 'domcontentloaded' })
      await dismissIntro(mpage); await settle(mpage)
      await mpage.screenshot({ path: path.join(OUT, `mobile_${slug}.png`), fullPage: true })
      console.log('mobile shot', slug)
    } catch (e) { console.log('mobile FAIL', slug, String(e).split('\n')[0]) }
  }

  fs.writeFileSync(REPORT, JSON.stringify(fontReport, null, 2))
  console.log('font report written:', REPORT)
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
