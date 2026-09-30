// Dev-only: ECONOMIC UI ACCEPTANCE (Phase 2, Gate 7) — headless Chrome over CDP,
// driving the REAL member doors on econ-ui-harness.html against the LOCAL server
// (econ_ui_local_server.py). Screenshots + audit JSON ->
// docs/economic-data/readiness/ui/<mode>/.
//
//   node src/econHarness/captureUiAcceptance.mjs <baseUrl> <mode>
//     mode = enabled   (server started WITHOUT --dark)
//          | dark      (server started WITH --dark: ECON_ENABLED unset)
//
// ⛔ LOCAL ONLY (cdp.mjs refuses non-loopback URLs). Never /charts, never production.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, sleep } from './cdp.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5231'
const MODE = process.argv[3] || 'enabled'
if (!['enabled', 'dark', 'free', 'anon'].includes(MODE)) throw new Error(`bad mode ${MODE}`)
// enabled = flag on + paid · dark = flag UNSET + paid · free / anon = flag on, unentitled
const MEMBER = MODE === 'free' ? 'free' : MODE === 'anon' ? 'anon' : 'paid'
const FULL = MODE === 'enabled'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/economic-data/readiness/ui', MODE)
mkdirSync(OUT, { recursive: true })
const audit = { _run: { at: new Date().toISOString(), base: BASE, mode: MODE,
  note: 'LOCAL server; econ served from local artifacts (ECON_SERVING_SOURCE=local); SPY host bars are a SYNTHETIC seeded random walk (NOT market data)' } }

const QUERIES = ['CPI', 'core cpi', 'inflation', 'unemployment rate', 'nonfarm payrolls', 'initial claims', 'GDP',
  'real GDP', 'fed funds', '10-year treasury', '2-year treasury', 'M2', 'JOLTS', 'housing starts', 'industrial production']
const PRIMARY = [
  { sym: 'USCPI', note: 'monthly line' }, { sym: 'USFEDFUNDSU', note: 'step' }, { sym: 'UST10Y', note: 'daily line' },
  { sym: 'USICSA', note: 'weekly line' }, { sym: 'USRGDPQA', note: 'quarterly histogram' },
]

// ─── page helpers (run inside the page) ─────────────────────────────────────
const H = `
window.__h = {
  q: (sel) => document.querySelector(sel),
  qa: (sel) => [...document.querySelectorAll(sel)],
  byText: (sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === t),
  setInput: (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) },
  dialog: () => document.querySelector('[role="dialog"][aria-label="Symbol search"]'),
  chips: () => { const d = window.__h.dialog(); return d ? [...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => ['All','Stocks','ETFs','Indices','Breadth','Economic'].includes(t)) : null },
  rows: () => { const d = window.__h.dialog(); if (!d) return []; return [...d.querySelectorAll('button')].filter((b) => /resultRow/.test(b.className)).map((b) => ({ text: b.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120), econ: !!b.querySelector('[data-testid="econ-glyph"]'), img: !!b.querySelector('img') })) },
  legend: () => Object.fromEntries([...document.querySelectorAll('[data-testid^="econ-"]')].map((e) => [e.dataset.testid, e.textContent])),
  dbg: () => window.__econUi.debug(),
  chart: () => { const d = window.__econUi.debug(); if (!d) return null; return {
    primarySeriesType: d.primarySeriesType(), panes: (d.priceGeometry() || {}).paneSeries,
    visible: d.visibleTimeRange(),
    engine: (d.engineSeries() || []).map((s) => { const pts = [...s.data, ...s.runs.flat()].filter((p) => Number.isFinite(p.value)); pts.sort((a, b) => String(a.time).localeCompare(String(b.time)) || (a.time - b.time)); return {
      id: s.instanceId, seriesType: s.seriesType, lineType: s.lineType, priceScaleId: s.priceScaleId, pane: s.paneIndex,
      priceFormat: s.priceFormat, renderSeries: 1 + s.runs.length, points: pts.length,
      first: pts[0] || null, last: pts[pts.length - 1] || null } }) } },
}; true`

async function main() {
  const b = await launch({ width: 1400, height: 800 })
  const page = async (q) => {
    await b.open(`${BASE}/econ-ui-harness.html?${q}&member=${MEMBER}`)
    await b.waitFor('!!(window.__econUi)', { timeout: 30000 })
    await b.evaluate(H)
  }
  const save = async (name) => { writeFileSync(join(OUT, `${name}.png`), await b.shot()); return `${name}.png` }
  const reqs = () => b.evaluate('window.__econUi.requests.map((r) => r.url)')

  // ═══ 1. SYMBOL SEARCH ═════════════════════════════════════════════════════
  await page('sym=SPY&tf=D')
  await sleep(2500)
  await b.evaluate(H)
  const openSearch = async () => {
    await b.evaluate(`(() => { const l = document.querySelector('[data-testid="sym-label"]'); l.closest('button').click(); return true })()`)
    await b.waitFor('!!window.__h.dialog()')
    await sleep(800)
  }
  await openSearch()
  const search = { chips: await b.evaluate('window.__h.chips()'), queries: {} }
  for (const q of QUERIES) {
    await b.evaluate(`window.__h.setInput(window.__h.dialog().querySelector('input'), ${JSON.stringify(q.toUpperCase())})`)
    await sleep(700)
    const rows = await b.evaluate('window.__h.rows()')
    search.queries[q] = { rows: rows.slice(0, 6), econRows: rows.filter((r) => r.econ).length, logoOnEconRow: rows.some((r) => r.econ && r.img) }
    if (q === 'CPI' || q === 'fed funds') search.queries[q].screenshot = await save(`search-all-${q.replace(/\W+/g, '-')}`)
  }
  // Economic chip: browse (empty box) + search
  await b.evaluate(`window.__h.setInput(window.__h.dialog().querySelector('input'), '')`)
  const hasEconChip = await b.evaluate(`!!window.__h.byText('[role="dialog"] button', 'Economic')`)
  if (hasEconChip) {
    await b.evaluate(`window.__h.byText('[role="dialog"] button', 'Economic').click()`)
    await sleep(600)
    search.economicChipBrowse = { rows: (await b.evaluate('window.__h.rows()')).length, screenshot: await save('search-economic-chip-browse') }
    await b.evaluate(`window.__h.setInput(window.__h.dialog().querySelector('input'), 'INITIAL CLAIMS')`)
    await sleep(700)
    search.economicChipSearch = { q: 'initial claims', rows: (await b.evaluate('window.__h.rows()')).slice(0, 4) }
    // keyboard: back to All with Tab (Economic is last), then select the econ CPI row by clicking
    await b.evaluate(`window.__h.byText('[role="dialog"] button', 'All').click()`)
  }
  search.requests = (await reqs()).filter((u) => u.includes('/api/ticker-search')).slice(-4)
  await b.evaluate(`window.__h.setInput(window.__h.dialog().querySelector('input'), 'CPI')`)
  await sleep(800)
  const picked = await b.evaluate(`(() => { const d = window.__h.dialog(); const r = [...d.querySelectorAll('button')].find((x) => x.querySelector('[data-testid="econ-glyph"]')); if (!r) return null; r.click(); return true })()`)
  await sleep(2500)
  search.selectEconRow = { clicked: !!picked, symAfter: await b.evaluate('window.__econUi.state.sym') }
  audit.search = search

  // ═══ 2. PRIMARY CHARTS at D / W / M ═══════════════════════════════════════
  audit.primary = {}
  for (const { sym, note } of (FULL ? PRIMARY : PRIMARY.slice(0, 1))) {
    for (const tf of (FULL ? ['D', 'W', 'M'] : ['D'])) {
      await page(`sym=ECON:${sym}&tf=${tf}`)
      await b.waitFor(`(() => { const c = window.__h.chart(); return c && c.engine.some((e) => e.id === 'econp:${sym}' && e.points > 0) })()`, { timeout: FULL ? 25000 : 6000 })
      await sleep(900)
      const r = { note, chart: await b.evaluate('window.__h.chart()'), legend: await b.evaluate('window.__h.legend()'),
        header: await b.evaluate(`document.querySelector('[data-testid="sym-label"]')?.textContent`),
        tfButtons: await b.evaluate(`[...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter((t) => /^(1m|5m|15m|30m|1h|1D|1W|1M|\\d+[mh])$/.test(t))`) }
      // hover the middle of the plot: the strip must follow the cursor to that observation
      await b.hover(640, 420)
      await sleep(400)
      r.legendHover = await b.evaluate('window.__h.legend()')
      await b.hover(1395, 795)
      const all = await reqs()
      r.stockOnlyRequests = all.filter((u) => /\/api\/(bars|bars-history|ticker-meta|ticker-logo|ticker-ipo|chart\/markers|chart-news|patterns|darkpool|research\/snapshot)/.test(u))
      r.econResponses = await b.evaluate(`Promise.all(['/api/econ/catalog', '/api/econ/series/${sym}'].map((u) => fetch(u, { credentials: 'include' }).then((x) => [u, x.status])))`)
      r.screenshot = await save(`primary-${sym}-${tf}`)
      audit.primary[`${sym}-${tf}`] = r
    }
  }

  // ═══ 3. ADD INDICATOR (the member's real door) + OVERLAYS on SPY ══════════
  await page('sym=SPY&tf=D')
  await sleep(3000)
  await b.evaluate(H)
  await b.evaluate('window.__econUi.openSettings()')
  await sleep(600)
  await b.evaluate(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find((x) => /Indicators/i.test(x.textContent)); t && t.click(); return !!t })()`)
  await sleep(500)
  await b.evaluate(`(() => { const a = document.querySelector('[data-testid="add-enter"]'); if (a && !document.querySelector('[data-testid="add-surface"]')) a.click(); return true })()`)
  await sleep(700)
  const add = { tabs: await b.evaluate(`[...document.querySelectorAll('[role="tab"][data-tab]')].map((x) => x.dataset.tab)`) }
  if (add.tabs.includes('economic')) {
    await b.evaluate(`document.querySelector('[role="tab"][data-tab="economic"]').click()`)
    await sleep(600)
    add.browseRows = await b.evaluate(`[...document.querySelectorAll('[role="option"][data-result-kind="economic"]')].length`)
    add.browseSample = await b.evaluate(`[...document.querySelectorAll('[role="option"][data-result-kind="economic"]')].slice(0, 5).map((o) => o.textContent.replace(/\\s+/g, ' ').trim().slice(0, 110))`)
    add.browseScreenshot = await save('add-indicator-economic-browse')
    // BROWSE-create USCPI
    await b.evaluate(`document.querySelector('[role="option"][data-result-key="economic:USCPI"]').click()`)
    await sleep(900)
    // SEARCH-create USFEDFUNDSU ("fed funds target" synonym) and USNFPCHG (histogram, negatives)
    for (const [q, key] of [['fed funds target', 'economic:USFEDFUNDSU'], ['nonfarm payrolls monthly change', 'economic:USNFPCHG']]) {
      await b.evaluate(`(() => { const a = document.querySelector('[data-testid="add-enter"]'); if (a && !document.querySelector('[data-testid="add-surface"]')) a.click(); return true })()`)
      await sleep(500)
      await b.evaluate(`window.__h.setInput(document.querySelector('[role="searchbox"]'), ${JSON.stringify(q)})`)
      await sleep(700)
      add[`search:${q}`] = await b.evaluate(`[...document.querySelectorAll('[role="option"][data-result-kind="economic"]')].map((o) => o.dataset.resultKey)`)
      if (q === 'fed funds target') add.searchScreenshot = await save('add-indicator-economic-search')
      await b.evaluate(`document.querySelector('[role="option"][data-result-key="${key}"]')?.click()`)
      await sleep(900)
    }
    add.storedInstances = await b.evaluate(`window.__econUi.state.stored.indicatorInstances.filter((i) => i && !i.removed && /^econ:/.test((i.inputs||{}).source||'')).map((i) => ({ id: i.instanceId, defId: i.defId, source: i.inputs.source, presentation: i.presentation || null, placement: i.placement || null }))`)
    add.preferenceWritesBlocked = await b.evaluate('window.__econUi.blocked')
  }
  audit.addIndicator = add
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await sleep(500)
  // close the modal if still open
  await b.evaluate(`(() => { const c = [...document.querySelectorAll('button')].find((x) => /close/i.test(x.getAttribute('aria-label') || '')); c && c.click(); return true })()`)

  // Overlays at D / W / 5m — the same extra-tab blob, only the timeframe changes
  audit.overlays = {}
  if (add.storedInstances && add.storedInstances.length) {
    const points = await b.evaluate(`Promise.all(['USCPI','USFEDFUNDSU','USNFPCHG'].map((s) => fetch('/api/econ/series/' + s, { credentials: 'include' }).then((r) => r.json()).then((j) => [s, j.points])))`)
    for (const tf of ['D', 'W', '5']) {
      await b.evaluate(`window.__econUi.setTf(${JSON.stringify(tf)})`)
      await b.waitFor(`(() => { const c = window.__h.chart(); return c && c.engine.filter((e) => /^inst:dataSeries/.test(e.id) && e.points > 0).length >= 3 })()`, { timeout: 25000 })
      await sleep(1500)
      const chart = await b.evaluate('window.__h.chart()')
      // no look-ahead: every plotted (time,value) must equal the latest value released at/before that bar
      const la = await b.evaluate(`(() => {
        const d = window.__econUi.debug(); const out = {}
        const srcOf = Object.fromEntries(window.__econUi.state.stored.indicatorInstances.filter((i) => i && /^econ:/.test((i.inputs||{}).source||'')).map((i) => [i.instanceId, i.inputs.source.slice(5)]))
        const P = Object.fromEntries(${JSON.stringify(points)})
        // StockChart's display offset for intraday (getETOffset: one constant, computed now)
        const _n = new Date()
        const OFF = Math.round((new Date(_n.toLocaleString('en-US', { timeZone: 'America/New_York' })) - new Date(_n.toLocaleString('en-US', { timeZone: 'UTC' }))) / 1000)
        const tf = ${JSON.stringify(tf)}
        const fmtH = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
        const close16 = (y, m, dd) => { const t = Date.UTC(y, m - 1, dd, 20) / 1000; return Number(fmtH.format(new Date(t * 1000))) === 16 ? t : t + 3600 }
        const refSec = (t) => {
          const [y, m, dd] = t.split('-').map(Number)
          if (tf === 'W') { const e = new Date(Date.UTC(y, m - 1, dd)); const f = new Date(e.getTime() + ((5 - e.getUTCDay() + 7) % 7) * 864e5); return close16(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()) }
          return close16(y, m, dd)
        }
        for (const s of d.engineSeries()) {
          const sym = srcOf[s.instanceId]; if (!sym) continue
          const pts0 = P[sym]
          // ⛔ NEGATIVE CONTROL: the same check against releases moved 15 days EARLIER
          // must report mismatches — proof the check can see a look-ahead at all.
          const runCheck = (pts) => { let leaks = 0; let checked = 0
          const all = [...s.data, ...s.runs.flat()].filter((p) => Number.isFinite(p.value))
          for (const p of all) {
            // intraday: plotted time = bar START (UTC) + the chart's display offset
            // (StockChart getETOffset, one constant); the bar may show a value
            // only if it was released STRICTLY BEFORE the bar's END (strict, no look-ahead)
            const ref = typeof p.time === 'string' ? refSec(p.time) : (p.time - OFF + 300 - 1e-6)
            checked++
            // the value a bar may show = the NEWEST PERIOD released at/before its close
            const known = pts.filter((q) => q[0] <= ref)
            let best = null
            for (const q of known) if (!best || String(q[3]) >= String(best[3])) best = q
            if (!best || !Number.isFinite(best[1]) || Math.abs(best[1] - p.value) > 1e-9) leaks++
          }
          return { leaks, checked } }
          const { leaks, checked } = runCheck(pts0)
          const control = runCheck(pts0.map((q) => [q[0] - 15 * 86400, ...q.slice(1)]))
          out[sym] = { checked, barsNotEqualToNewestReleasedValue: leaks, negativeControlShift15dEarlier: control.leaks, renderSeries: 1 + s.runs.length, pane: s.paneIndex, scale: s.priceScaleId, type: s.seriesType, lineType: s.lineType }
        }
        return out })()`)
      audit.overlays[tf] = { chart, check: la, legend: await b.evaluate('window.__h.legend()'), screenshot: await save(`overlay-SPY-${tf}`) }
    }
  }

  audit.consoleErrors = b.consoleErrors
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(audit, null, 2))
  b.close()
  process.stdout.write(`${MODE}: search chips=${JSON.stringify(audit.search.chips)} addTabs=${JSON.stringify(audit.addIndicator.tabs)} primary=${Object.keys(audit.primary).length} overlays=${Object.keys(audit.overlays).length} errors=${audit.consoleErrors.length}\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
