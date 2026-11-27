// app/src/components/chart/engine/__tests__/vendorHarness/firstPageCensus.measure.test.js
//
// ─── (e101 correctness unit, coordinator ruling 2026-11-27) DOES THE HOST LANE'S FIRST PAGE EVER PAINT A WRONG VALUE? ──
//
// `firstPage.js` draws a plot on a cold pane's first page when two starts `FIRST_PAGE_PROBE` (251) bars apart agree bit
// for bit on every page bar. Agreement of two starts is not a proof that the FULL history agrees: a `var` state or a
// recursive ta state whose deciding event is older than both starts (a running all-time high whose extreme lies before
// the probe window, say) agrees between the starts and differs from the full run. Such a plot is painted WRONG until the
// full answer lands. This census measures how often that happens on what members are served: every committed corpus
// script the member door puts on the HOST lane, on real long series, its first page held to the full-history run of the
// same plan on the page's bars.
// ⛔ OPT-IN (`RUNTIME_PERF_CENSUS=digest`). It asserts nothing about the count (that is the finding); it asserts reach.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { astLanePlan, astColumnsGiven } from '../../astColumns'
import { firstPageWindow, FIRST_PAGE_ROWS, FIRST_PAGE_POST_ROWS } from '../../firstPage'

const RUN = process.env.RUNTIME_PERF_CENSUS === 'digest'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const SERIES = [
  { file: 'adx-and-di-for-v4-spy-1d-2026-11-17.json', tf: 'D', historyFromListing: true },
  { file: '3-level-zigzag-semafor-spy-60-2026-11-14.json', tf: '60', historyFromListing: false },
]

afterEach(() => { vi.unstubAllEnvs() })
const freshBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))

describe.skipIf(!RUN)('the host lane\'s first page against the full history (opt-in)', () => {
  it('counts every exact-on-the-page plot whose page values differ from the full run', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200)
    const tally = { hostScripts: 0, pages: 0, plots: 0, exactOnPage: 0, wrong: [], threw: 0 }
    const series = SERIES.map((s) => {
      const cap = JSON.parse(fs.readFileSync(path.join(HARNESS, s.file), 'utf8'))
      return { ...s, rows: cap.bars.rows }
    })
    for (const s of series) expect(s.rows.length, s.file).toBeGreaterThan(2 * FIRST_PAGE_ROWS + 251)
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      try {
        if (!door.def || !door.built || door.built.lane === 'runtime' || door.def.compute.kind !== 'ast') continue
        tally.hostScripts += 1
        for (const s of series) {
          const rows = freshBars(s.rows)
          const ctx = { tf: s.tf, newestBarIsForming: false, historyFromListing: s.historyFromListing,
            symbol: { ticker: 'SPY', exchange: 'NYSE Arca' } }
          let plan
          let page
          let full
          try {
            plan = astLanePlan(door.def, rows, undefined, ctx)
            if (plan.done || plan.win) continue
            page = firstPageWindow(plan.def, rows.slice(rows.length - FIRST_PAGE_POST_ROWS), plan.scalars, ctx, null)
            full = astColumnsGiven(plan.def, rows, plan.scalars, ctx, null)
          } catch { tally.threw += 1; continue }
          tally.pages += 1
          page.keys.forEach((key, j) => {
            tally.plots += 1
            if (!page.exact[j]) return
            tally.exactOnPage += 1
            const col = full[key]
            const vals = page.values[j]
            let firstBad = -1
            for (let i = 0; i < FIRST_PAGE_ROWS; i += 1) {
              const want = col ? col[col.length - FIRST_PAGE_ROWS + i] : undefined
              if (!Object.is(Number(want), vals[i]) && !(Number.isNaN(Number(want)) && Number.isNaN(vals[i]))) { firstBad = i; break }
            }
            if (firstBad >= 0) tally.wrong.push(`${f} ${s.tf} ${key} first page bar ${firstBad}`)
          })
        }
      } finally {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
      }
    }
    // eslint-disable-next-line no-console
    console.log(`first page census: ${JSON.stringify({ ...tally, wrong: tally.wrong.length })}\n`
      + tally.wrong.map((w) => `  WRONG ${w}`).join('\n'))
    expect(tally.hostScripts).toBeGreaterThan(50) // non-vacuity: the host corpus was reached
    expect(tally.exactOnPage).toBeGreaterThan(0)  // non-vacuity: some plot is drawn on a first page
  }, 3600000)
})
