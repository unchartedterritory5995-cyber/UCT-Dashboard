// ⭐ HISTORY PARITY — what a +10k-bar step costs the paths that scale with depth (docs/pine/HISTORY-PARITY.md §4, §9).
//
// OPT-IN (`RUNTIME_PERF_CENSUS=history-depth`): a timing is a measurement, never a rail on a shared runner. It is the
// pure-code half of CHART SPEED's condition ("measure a +10k step before fixing numbers"); the browser half (heap,
// paint, a press on a board) is the bench rig's. Synthetic 1m extended-hours rows of a US name (synthetic prices),
// N = 20k / 30k / 40k / 50k / 60k, median of 7 after 2 warm-ups, for:
//   clamp   data/barStore/extendedSession.clampToExtendedSession (store ingest, every answer)
//   fold    chart/offGridBars.foldOffGridBars (on-grid fast path: one scan)
//   reduce  barStore reducer, a `rest-full` answer of N rows into an empty entry (finalize's depth cap above N)
//   trim    the same entry with the depth cap 10k below N (the rolling trim's slice)
//   clone   structuredClone of the rows (the IndexedDB persist's structured clone)
//   start   tvRunStart over the rows
//   json    the rows' JSON size in MB (a wire and memory proxy)
// Writes ../remote-out/history-depth.json (python tools/remote_tests.py ... --env RUNTIME_PERF_CENSUS=history-depth
// --download <dir>) and prints one line per N.
import { it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { clampToExtendedSession } from '../../../../data/barStore/extendedSession.js'
import { foldOffGridBars } from '../../offGridBars.js'
import { reduce, initialState } from '../../../../data/barStore/reducer.js'
import { keyOf } from '../../../../data/barStore/types.js'
import { etUnix } from '../../../../data/barStore/__fixtures__/seededSeries.js'
import { tvRunStart } from '../tvRunStart.js'

const RUN = process.env.RUNTIME_PERF_CENSUS === 'history-depth'
const SIZES = [20000, 30000, 40000, 50000, 60000]

/** `n` 1m bars, 04:00-20:00 ET, weekdays, ending on 2026-11-20 (holidays ignored: the cost is per row). */
function rows1m(n) {
  const days = []
  const d = new Date(Date.UTC(2026, 10, 20))
  while (days.length * 960 < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  days.reverse()
  const out = []
  let p = 500
  for (const day of days) {
    for (let m = 4 * 60; m < 20 * 60; m++) {
      p += Math.sin(out.length / 37) * 0.05
      out.push({ t: etUnix(day, m), o: p, h: p + 0.1, l: p - 0.1, c: p + 0.02, v: 100 + (out.length % 50) })
    }
  }
  return out.slice(out.length - n)
}

function median(fn, reps = 7) {
  for (let i = 0; i < 2; i++) fn()
  const xs = []
  for (let i = 0; i < reps; i++) { const t0 = performance.now(); fn(); xs.push(performance.now() - t0) }
  xs.sort((a, b) => a - b)
  return +xs[reps >> 1].toFixed(2)
}

it.skipIf(!RUN)('history depth: the cost of +10k bars on the paths that scale with depth', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const now = Date.UTC(2026, 10, 20, 21, 0)
  vi.setSystemTime(now)
  const K = keyOf({ sym: 'SPY', tf: '1' })
  const out = []
  for (const n of SIZES) {
    const rows = rows1m(n)
    expect(rows.length).toBe(n)
    const ctx = { nowMs: now, streamLive: false }
    const r = {
      n,
      clamp: median(() => clampToExtendedSession(rows, 'SPY')),
      fold: median(() => foldOffGridBars(rows, '1')),
      reduce: median(() => reduce(initialState(K, ctx), { type: 'rest-full', payload: { bars: rows } }, { ...ctx, depthCap: n + 1000 })),
      trim: median(() => reduce(initialState(K, ctx), { type: 'rest-full', payload: { bars: rows } }, { ...ctx, depthCap: n - 10000 })),
      clone: median(() => structuredClone(rows)),
      start: median(() => tvRunStart('1', rows, 'America/New_York')),
      json: +(JSON.stringify(rows).length / 1e6).toFixed(2),
    }
    out.push(r)
    console.log(`[history-depth] ${JSON.stringify(r)}`)
  }
  vi.useRealTimers()
  const dir = path.resolve(process.cwd(), '..', 'remote-out')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'history-depth.json'), JSON.stringify({ node: process.version, unit: 'ms (median of 7)', rows: out }, null, 1))
}, 600000)
