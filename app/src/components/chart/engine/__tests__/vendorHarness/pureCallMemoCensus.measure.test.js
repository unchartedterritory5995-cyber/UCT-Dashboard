// Opt-in census (RUNTIME_PERF_CENSUS=pure-memo, an allowlisted remote switch; writes ../remote-out/pure-memo):
// ⭐⭐ e99 b2 — every corpus script the member door serves on the RUNTIME lane, over the deepest committed daily
// histories (SPY 8,509 bars; JPM 14,546 bars) and a short one (RDDT), run with the pure-leaf memo ON and OFF
// (`runtime/pureCalls.js`). ⛔ ASSERTS EXACTNESS: every column byte-identical (`Object.is`, value by value), every
// budget count identical, and the same stop with the same sentence. Records which scripts the memo engaged and the
// time each way (asserts no timing).
import { describe, it, vi, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.RUNTIME_PERF_CENSUS === 'pure-memo'
const OUT = '../remote-out/pure-memo'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const CHARTS = [
  { name: 'SPY-1D', file: path.join(FIX, 'machine-learning-moving-average-backquant-spy-1d-2026-11-17.json') },
  { name: 'JPM-1D', file: path.join(FIX, 'black-scholes-option-pricing-model-w-greeks-loxx-jpm-1d-2026-11-15.json') },
  { name: 'RDDT-1D', file: path.join(FIX, 'kernel-channel-backquant-rddt-1d-2026-11-14.json') },
]

function run(def, rows, pureMemo) {
  const bars = rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  let counts = null; let memo = null; let out = null; let err = null
  const t0 = performance.now()
  try {
    out = computeRuntimeColumns(def, bars, { tf: 'D', newestBarIsForming: false, historyFromListing: true },
      { budgetMs: 600000, ...(pureMemo ? {} : { pureMemo: false }), onBudget: (b) => { counts = { ...b.counts }; memo = b.pureMemo || null } })
  } catch (e) { err = e }
  return { ms: performance.now() - t0, out, counts, memo, stop: err ? `${err.guard || err.name}: ${err.message}` : null }
}

/** Every difference between two runs' results, by name (empty = exact). */
function differences(a, b) {
  const d = []
  if (a.stop !== b.stop) d.push(`stop: ${a.stop} | ${b.stop}`)
  if (JSON.stringify(a.counts) !== JSON.stringify(b.counts)) d.push(`counts: ${JSON.stringify(a.counts)} | ${JSON.stringify(b.counts)}`)
  const ka = Object.keys(a.out || {}).sort(); const kb = Object.keys(b.out || {}).sort()
  if (JSON.stringify(ka) !== JSON.stringify(kb)) d.push(`outputs: ${ka} | ${kb}`)
  for (const k of ka) {
    const x = a.out[k]; const y = b.out && b.out[k]
    if (x && typeof x.length === 'number' && y && typeof y.length === 'number' && typeof x !== 'string') {
      if (x.length !== y.length) { d.push(`${k}: length ${x.length} | ${y.length}`); continue }
      for (let i = 0; i < x.length; i += 1) if (!Object.is(x[i], y[i])) { d.push(`${k}[${i}]: ${x[i]} | ${y[i]}`); break }
    } else if (JSON.stringify(x) !== JSON.stringify(y)) d.push(`${k}: differs`)
  }
  return d
}

describe.runIf(RUN)('pure-leaf memo, exact over the runtime-lane corpus', () => {
  it('census', () => {
    const charts = CHARTS.map((c) => ({ ...c, rows: JSON.parse(fs.readFileSync(c.file, 'utf8')).bars.rows }))
    const scripts = []
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try { door = enterMemberDoor(fs.readFileSync(path.join(CORPUS, f), 'utf8')) } catch { door = { def: null } }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (!door.def || !door.built || door.built.lane !== 'runtime') continue
      for (const c of charts) {
        const on = run(door.def, c.rows, true)
        const off = run(door.def, c.rows, false)
        scripts.push({ slug: f.replace(/\.pine$/, ''), chart: c.name, bars: c.rows.length, memo: on.memo,
          msOn: Math.round(on.ms), msOff: Math.round(off.ms), stop: on.stop ? on.stop.slice(0, 160) : null,
          differences: differences(on, off) })
      }
    }
    const differing = scripts.filter((s) => s.differences.length)
    const engaged = scripts.filter((s) => s.memo && s.memo.hits > 0)
    const summary = { runs: scripts.length, scripts: new Set(scripts.map((s) => s.slug)).size, differing: differing.length,
      engaged: engaged.map((s) => `${s.slug}@${s.chart} hits ${s.memo.hits} entries ${s.memo.entries} ${s.msOff}->${s.msOn} ms`) }
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'pure-memo.json'), JSON.stringify({ summary, scripts }, null, 1))
    // eslint-disable-next-line no-console
    console.log('PURE MEMO SUMMARY', JSON.stringify(summary))
    expect(scripts.length).toBeGreaterThan(0)
    expect(differing.map((s) => `${s.slug}@${s.chart}: ${s.differences.slice(0, 2).join(' / ')}`)).toEqual([])
  }, 3600000)
})
