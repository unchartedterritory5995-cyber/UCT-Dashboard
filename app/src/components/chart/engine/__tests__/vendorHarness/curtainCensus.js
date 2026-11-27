// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.js
//
// ─── (e102, coordinator ruling 2026-11-27) DOES THE RUNTIME LANE'S OFF-LISTING CURTAIN EVER RELEASE A WRONG VALUE? ──
//
// `runtimeColumns.js::computeOffListing` draws a listing document on a chart that does not start at the listing from
// the bar where two runs (A over every bar, B from `shift` bars later) agree to the last bar, and withholds every bar
// before it. Two starts agreeing is evidence, not a proof: the host lane's first page used the same heuristic and was
// found WRONG on 3/571 plots (e101, `firstPageCensus.measure.test.js`), a `var`/event state older than BOTH starts
// making them agree while both differed from a run from an earlier start.
//
// This census holds the curtain's RELEASED values to a run from an earlier start, on what members are served: every
// committed corpus script the member door puts on the RUNTIME lane, on real long captures. Per series:
//   truth   = the plain run (no curtain: `meta.runtimeHistory` cleared, as the curtain's own A and B are built) over
//             EVERY captured row; from the listing where the capture starts there (the real answer), else from the
//             capture's first bar (an earlier start: any disagreement FALSIFIES the curtain's claim that its released
//             values do not depend on where the chart starts);
//   curtain = the member's run over the capture's last `L` rows, off the listing (`historyFromListing: false`), for
//             several `L`;
//   every bar the curtain releases (`i >= withheldBars`) and every key it returns is compared with the truth on the
//   same bar; drawings the curtain releases (`warmup.drawings === 'same-from-two-starts'`) are compared with the
//   truth's live drawings by the curtain's own rule (`sameDrawings`, x moved by the cut).
// Values are graded three ways: EXACT (`Object.is`, or both `na`), WITHIN 1e-9 of their size (the curtain's own
// agreement standard, `sameValue`), and WRONG (anything else, an `na` against a number included).
// Every run is on the door's still clock (`withMemberDoorClock`): a value question, never a wall-clock stop.
// ⛔ OPT-IN (`RUNTIME_PERF_CENSUS=curtain`). Each series is its own test file, so `--shards` runs them in parallel.
import fs from 'node:fs'
import path from 'node:path'
import { vi } from 'vitest'

import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { computeRuntimeColumns, resetRuntimeSessions, withMemberDoorClock } from '../../runtime/runtimeColumns'
import { runtimeWarmupOf, runtimeObjectsOf, runtimeObjectsWithheldOf } from '../../runtime/runtimeObjects'
import { sameDrawings } from '../../runtime/warmupDrawings'

export const CURTAIN_CENSUS_ON = process.env.RUNTIME_PERF_CENSUS === 'curtain'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')

const freshBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const isNa = (x) => typeof x !== 'number' || Number.isNaN(x)
function grade(got, want) {
  if (Object.is(got, want) || (isNa(got) && isNa(want))) return 'exact'
  if (isNa(got) || isNa(want)) return 'wrong'
  return Math.abs(got - want) <= 1e-9 * Math.max(Math.abs(got), Math.abs(want), 1e-300) ? 'tol' : 'wrong'
}
const guardOf = (err) => (err && typeof err.guard === 'string' && err.guard ? err.guard : `error:${String((err && err.message) || err).slice(0, 60)}`)
const bump = (o, k) => { o[k] = (o[k] || 0) + 1 }

/** Run the census over one capture. `series = { file, tf, fromListing, ticker, exchange, tails: [L, ...] }`. */
export function runCurtainCensus(series) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const cap = JSON.parse(fs.readFileSync(path.join(HARNESS, series.file), 'utf8'))
  const rows = cap.bars.rows
  const N = rows.length
  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  const symbol = { ticker: series.ticker, exchange: series.exchange }
  const base = { tf: series.tf, newestBarIsForming: false, symbol }
  const t = {
    series: series.file, rows: N, fromListing: series.fromListing, tails: series.tails,
    corpus: files.length, runtimeDocs: 0, listingDocs: 0, routedDocs: 0, strategyDocs: 0,
    truthRefused: {}, curtainRefused: {}, curtainRuns: 0, released: 0,
    plotsReleased: 0, barsCompared: 0, exact: 0, tol: 0, wrong: 0,
    drawingsReleased: 0, drawingsWrong: 0, drawingsWithheld: 0,
    routedRuns: 0, routedPlotsDiffering: 0,
    wrongCases: [], tolCases: [], drawingCases: [], routedCases: [],
  }
  for (const f of files) {
    const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
    let door
    try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
    try {
      if (!door.def || !door.built || door.built.lane !== 'runtime' || door.def.compute.kind !== 'runtime') continue
      t.runtimeDocs += 1
      const def = door.def
      const hist = def.meta && def.meta.runtimeHistory
      if (hist && hist !== 'listing') { t.strategyDocs += 1; continue }
      const listing = hist === 'listing'
      if (listing) t.listingDocs += 1; else t.routedDocs += 1
      const plain = { ...def, meta: { ...def.meta, runtimeHistory: undefined } }
      let truth
      try {
        resetRuntimeSessions()
        truth = withMemberDoorClock(() => computeRuntimeColumns(plain, freshBars(rows),
          { ...base, historyFromListing: series.fromListing === true }))
      } catch (err) { bump(t.truthRefused, guardOf(err)); continue }
      const truthObjs = runtimeObjectsOf(truth)
      for (const L of series.tails) {
        if (!(L > 0 && L < N)) continue
        const K = N - L
        let got
        try {
          resetRuntimeSessions()
          got = withMemberDoorClock(() => computeRuntimeColumns(def, freshBars(rows.slice(K)),
            { ...base, historyFromListing: false }))
        } catch (err) { bump(t.curtainRefused, guardOf(err)); continue }
        if (!listing) {
          // a routed document has no curtain: every bar is served from the chart's first bar (informational)
          t.routedRuns += 1
          for (const key of Object.keys(got)) {
            const want = truth[key]
            if (!want) continue
            let firstDiff = -1
            let lastDiff = -1
            for (let i = 0; i < L; i += 1) {
              if (grade(got[key][i], want[K + i]) === 'wrong') { if (firstDiff < 0) firstDiff = i; lastDiff = i }
            }
            if (firstDiff >= 0) {
              t.routedPlotsDiffering += 1
              t.routedCases.push(`${f} L=${L} ${key} differs on bars ${firstDiff}..${lastDiff} of ${L}`)
            }
          }
          continue
        }
        t.curtainRuns += 1
        const w = runtimeWarmupOf(got)
        if (!w) { bump(t.curtainRefused, 'no-warmup-record'); continue }
        t.released += 1
        const from = w.withheldBars
        for (const key of Object.keys(got)) {
          const want = truth[key]
          const col = got[key]
          t.plotsReleased += 1
          if (!want) { t.wrong += 1; t.wrongCases.push(`${f} L=${L} ${key}: no such column in the truth`); continue }
          let nWrong = 0
          let nTol = 0
          let firstBad = -1
          let sample = null
          for (let i = from; i < L; i += 1) {
            const g = grade(col[i], want[K + i])
            t.barsCompared += 1
            if (g === 'exact') { t.exact += 1; continue }
            if (g === 'tol') { t.tol += 1; nTol += 1; continue }
            t.wrong += 1
            nWrong += 1
            if (firstBad < 0) { firstBad = i; sample = [col[i], want[K + i]] }
          }
          if (nWrong) t.wrongCases.push(`${f} L=${L} ${key}: ${nWrong} wrong of ${L - from} released (withheld ${from}), `
            + `first at bar ${firstBad}: served ${sample[0]} truth ${sample[1]}`)
          if (nTol) t.tolCases.push(`${f} L=${L} ${key}: ${nTol} within 1e-9`)
        }
        if (w.drawings === 'same-from-two-starts') {
          t.drawingsReleased += 1
          const gotObjs = runtimeObjectsOf(got)
          const v = truthObjs && gotObjs ? sameDrawings(truthObjs.live, gotObjs.live, K) : { same: false, why: 'a run kept no drawings' }
          if (!v.same) { t.drawingsWrong += 1; t.drawingCases.push(`${f} L=${L}: ${v.why}`) }
        } else if (runtimeObjectsWithheldOf(got)) t.drawingsWithheld += 1
      }
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      resetRuntimeSessions()
    }
  }
  const scriptsWrong = [...new Set(t.wrongCases.map((c) => c.split(' ')[0]))]
  // eslint-disable-next-line no-console
  console.log(`curtain census ${series.file}: ${JSON.stringify({ ...t, wrongCases: t.wrongCases.length,
    tolCases: t.tolCases.length, drawingCases: t.drawingCases.length, routedCases: t.routedCases.length, scriptsWrong })}\n`
    + t.wrongCases.map((c) => `  WRONG ${c}`).join('\n') + '\n'
    + t.drawingCases.map((c) => `  DRAWINGS-WRONG ${c}`).join('\n') + '\n'
    + t.tolCases.slice(0, 40).map((c) => `  TOL ${c}`).join('\n') + '\n'
    + t.routedCases.slice(0, 40).map((c) => `  ROUTED ${c}`).join('\n'))
  // the whole record comes back from a remote run (`tools/remote_tests.py --download`): remote-out/ is uploaded
  const out = path.join(REPO, 'remote-out', 'curtain-census')
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, `${series.file.replace(/\.json$/, '')}.json`), JSON.stringify(t, null, 1))
  return t
}

/** The census's verdict for one series: non-vacuous, then nothing released differs from the truth. */
export function expectNoWrongRelease(t, expect) {
  expect(t.listingDocs).toBeGreaterThan(20)   // non-vacuity: the runtime corpus was reached
  expect(t.released).toBeGreaterThan(0)       // non-vacuity: some curtain released values
  expect(t.barsCompared).toBeGreaterThan(0)
  // ⛔⛔ (e102) the rule: no value the curtain releases differs from a run from an earlier start
  expect(t.wrongCases).toEqual([])
  expect(t.drawingCases).toEqual([])
}
