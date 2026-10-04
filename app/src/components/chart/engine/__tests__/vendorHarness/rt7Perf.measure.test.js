// app/src/components/chart/engine/__tests__/vendorHarness/rt7Perf.measure.test.js
//
// ─── RT7 — the runtime run's wall time on 5,000 daily bars, and a digest of what it drew ─
//
// Opt-in (`RT7_PERF=1`, optional `RT7_PERF_OUT=<file.json>`, `RT7_PERF_RUNS`,
// `RT7_PERF_SLUGS=a,b`). For every runtime-lane corpus script it mints the member's
// document through the real door, runs `computeRuntimeColumns` (the one computation the
// worker runs) on the last 5,000 bars of `vw-deadband-ticks-aapl-1d-2026-09-28` from the
// listing, and records the median wall time and a sha256 of every column and object it
// produced. Two runs of this file on two trees prove a speed-up changed NOTHING drawn:
// the digests must be identical.
// ⛔ IT ASSERTS NO TIME — a wall clock on a shared box is a measurement, not a rail.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Session } from 'node:inspector'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'

const RUN = process.env.RT7_PERF === '1'
const OUT = process.env.RT7_PERF_OUT
const RUNS = Number(process.env.RT7_PERF_RUNS || 5)
const PROFILE = process.env.RT7_PERF_PROFILE // a .cpuprofile path: the timed runs are profiled
const ONLY = (process.env.RT7_PERF_SLUGS || '').split(',').filter(Boolean)
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const DAILY = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-deadband-ticks-aapl-1d-2026-09-28.json')

afterEach(() => { vi.unstubAllEnvs() })

const digest = (cols) => {
  const h = createHash('sha256')
  for (const k of Object.keys(cols || {}).sort()) {
    const v = cols[k]
    h.update(k)
    if (v && typeof v.length === 'number' && typeof v !== 'string') {
      h.update(Buffer.from(Float64Array.from(v, (x) => (typeof x === 'number' ? x : NaN)).buffer))
    } else h.update(JSON.stringify(v) || '')
  }
  // objects ride a non-enumerable/symbol property in some shapes: include anything JSON can see
  try { h.update(JSON.stringify(Object.getOwnPropertySymbols(cols || {}).map((s) => cols[s]))) } catch { /* not serialisable */ }
  return h.digest('hex').slice(0, 16)
}

describe.skipIf(!RUN)('RT7 — runtime run time on 5,000 daily bars (opt-in)', () => {
  it('times every runtime-lane corpus script and digests its output', async () => {
    const rows = JSON.parse(fs.readFileSync(DAILY, 'utf8')).bars.rows.slice(-5000)
    const toBars = () => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } }
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    const out = []
    let session = null
    if (PROFILE) {
      session = new Session(); session.connect()
      session.post('Profiler.enable'); session.post('Profiler.setSamplingInterval', { interval: 200 }); session.post('Profiler.start')
    }
    for (const f of files) {
      const slug = f.replace(/\.pine$/, '').split('__')[0]
      if (ONLY.length && !ONLY.includes(slug)) continue
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let built
      try { built = memberPaneDefinition({ source: fs.readFileSync(path.join(CORPUS, f), 'utf8'), id: 'u_rt7_perf', name: slug }) } catch { continue }
      vi.unstubAllEnvs()
      if (!built || !built.ok || built.lane !== 'runtime') continue
      const times = []
      let dg = null
      let err = null
      for (let k = 0; k < RUNS; k += 1) {
        const t0 = performance.now()
        let cols = null
        try { cols = computeRuntimeColumns(built.definition, toBars(), ctx, { budgetMs: 600000 }) } catch (e) { err = `${e.guard || e.name}: ${String(e.message).slice(0, 80)}` }
        times.push(performance.now() - t0)
        const d = err ? `ERR ${err}` : digest(cols)
        if (dg !== null) expect(d, `${slug} is deterministic`).toBe(dg)
        dg = d
      }
      times.sort((a, b) => a - b)
      out.push({ slug, medianMs: Number(times[Math.floor(times.length / 2)].toFixed(1)), minMs: Number(times[0].toFixed(1)), digest: dg })
    }
    if (session) {
      await new Promise((resolve) => session.post('Profiler.stop', (err, res) => {
        if (!err) fs.writeFileSync(PROFILE, JSON.stringify(res.profile))
        resolve()
      }))
    }
    // eslint-disable-next-line no-console
    console.log(`\nRT7PERF ${out.length} runtime scripts\n${out.map((r) => `RT7PERF ${r.slug.padEnd(60)} ${String(r.medianMs).padStart(8)} ms (min ${r.minMs})  ${r.digest}`).join('\n')}`)
    if (OUT) fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)
    expect(out.length).toBeGreaterThan(0)
  }, 1800000)
})
