// Opt-in census (RUNTIME_PERF_CENSUS=digest, an allowlisted remote switch; writes ../remote-out/digest/digest.json):
// ⭐ e99 — THE EXACTNESS INSTRUMENT FOR A VM CHANGE THAT MUST CHANGE NOTHING BUT TIME. Every corpus script the member
// door serves on the RUNTIME lane, over the deepest committed daily histories (SPY 8,509 bars; JPM 14,546 bars) and a
// short one (RDDT), is run once with the shipped limits (no pane budget), and each run is reduced to a DIGEST: a
// sha256 of every output column's exact values (`Float64` bytes for a number column, so `-0`, `NaN` and every bit are
// held), every budget count, and the stop's sentence. Run it on the base and on the change, and diff the two files:
// a VM change that is exact leaves every digest equal. Also records each run's time (min of 3 warm runs).
import { describe, it, vi, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.RUNTIME_PERF_CENSUS === 'digest'
const OUT = '../remote-out/digest'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const CHARTS = [
  { name: 'SPY-1D', file: path.join(FIX, 'machine-learning-moving-average-backquant-spy-1d-2026-11-17.json') },
  { name: 'JPM-1D', file: path.join(FIX, 'black-scholes-option-pricing-model-w-greeks-loxx-jpm-1d-2026-11-15.json') },
  { name: 'RDDT-1D', file: path.join(FIX, 'kernel-channel-backquant-rddt-1d-2026-11-14.json') },
]

function columnBytes(v) {
  if (v && typeof v.length === 'number' && typeof v !== 'string') {
    const allNum = Array.prototype.every.call(v, (x) => typeof x === 'number')
    if (allNum) return Buffer.from(Float64Array.from(v).buffer)
    return Buffer.from(JSON.stringify(Array.from(v, (x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x))))
  }
  return Buffer.from(JSON.stringify(v === undefined ? null : v))
}

function digestOf(def, rows) {
  const bars = rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  let counts = null; let out = null; let err = null
  const t0 = performance.now()
  try {
    out = computeRuntimeColumns(def, bars, { tf: 'D', newestBarIsForming: false, historyFromListing: true },
      { budgetMs: 600000, onBudget: (b) => { counts = { ...b.counts } } })
  } catch (e) { err = e }
  const ms = performance.now() - t0
  const h = crypto.createHash('sha256')
  for (const k of Object.keys(out || {}).sort()) { h.update(k); h.update('\u0000'); h.update(columnBytes(out[k])); h.update('\u0001') }
  return { columns: h.digest('hex').slice(0, 24), counts, stop: err ? `${err.guard || err.name}: ${err.message}` : null, ms }
}

describe.runIf(RUN)('runtime-lane digest census', () => {
  it('digests', () => {
    const charts = CHARTS.map((c) => ({ ...c, rows: JSON.parse(fs.readFileSync(c.file, 'utf8')).bars.rows }))
    const runs = []
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try { door = enterMemberDoor(fs.readFileSync(path.join(CORPUS, f), 'utf8')) } catch { door = { def: null } }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (!door.def || !door.built || door.built.lane !== 'runtime') continue
      for (const c of charts) {
        const first = digestOf(door.def, c.rows)
        const ms = [first.ms]
        for (let k = 0; k < 3; k += 1) ms.push(digestOf(door.def, c.rows).ms)
        runs.push({ slug: f.replace(/\.pine$/, ''), chart: c.name, columns: first.columns, counts: first.counts, stop: first.stop,
          msWarmMin: Math.round(Math.min(...ms.slice(1))) })
      }
    }
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'digest.json'), JSON.stringify({ runs }, null, 1))
    // eslint-disable-next-line no-console
    console.log('DIGEST RUNS', runs.length)
    expect(runs.length).toBeGreaterThan(0)
  }, 3600000)
})
