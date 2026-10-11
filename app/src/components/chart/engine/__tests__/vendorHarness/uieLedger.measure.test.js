// app/src/components/chart/engine/__tests__/vendorHarness/uieLedger.measure.test.js
//
// ⭐⭐ UIE PHASE 4 (M2) — THE COMPATIBILITY LEDGER: EVERY COMMITTED CORPUS SCRIPT, THROUGH
// THE PRODUCT PATH, ON SIX CHARTS, WITH WHAT TRADINGVIEW EVIDENCE GRADES IT.
//
// Per script:
//   * the member door's answer (the lane it mints — formula, object, runtime — or the
//     refusal by name), with the runtime pane's build flag ON for this measurement only
//     (`vi.stubEnv`, never a shared environment);
//   * on each chart, through the registry (`computeFor`, the binder's own call, the pane
//     budget included): drawn (a column with a value) or the named stop, and the time;
//   * SAVE / RELOAD: the definition through JSON and a second install computes the same
//     columns, bit for bit;
//   * INPUTS: one declared numeric input moved inside its author's bounds changes the run;
//   * the features the source uses (persistent vars, arrays, UDTs, loops, drawings, …);
//   * EVIDENCE: every committed TradingView capture of THIS source (matched by text),
//     graded by the vendor harness — plots MATCH = mathematically verified; objects
//     MATCH = drawings verified on counts, texts and colours (v1 compares no coordinates,
//     so "visually verified" is claimed for nothing beyond that).
// Nothing here is a parity claim on its own: the charts are real bars with no TradingView
// values beside them; only the captures grade.
//
// ⛔ OPT-IN (UIE_LEDGER=1, UIE_LEDGER_OUT=<file.json>). Asserts only that it ran.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { runtimeWarmupOf, runtimeObjectsOf, runtimeObjectsWithheldOf } from '../../runtime/runtimeObjects'

const RUN = process.env.UIE_LEDGER === '1'
const OUT = process.env.UIE_LEDGER_OUT
// UIE_LEDGER_EVIDENCE_ONLY=1: grade the captures, skip the six charts (a re-grade)
const EVIDENCE_ONLY = process.env.UIE_LEDGER_EVIDENCE_ONLY === '1'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const rowsOf = (f) => JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, f), 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const stitch = (rows, n) => {
  let out = rows.slice()
  while (out.length < n) {
    const span = out[out.length - 1].t - out[0].t + 300
    out = [...rows.map((b) => ({ ...b, t: b.t - span })).slice(-(n - out.length)), ...out]
  }
  return out.slice(-n)
}
const norm = (s) => String(s || '').replace(/\r\n/g, '\n').trim()
const FEATURES = {
  'var state': /^\s*var\s|\bvarip\b/m,
  reassignment: /:=/,
  arrays: /\barray\.(new|from)/,
  'user types': /^\s*type\s+\w+/m,
  'user functions': /^\s*\w+\s*\([^)]*\)\s*=>/m,
  loops: /^\s*(for|while)\s/m,
  'nested loops': /^(\s+)(for|while)\s[\s\S]*?^\1\s+(for|while)\s/m,
  'history refs': /\w\[\s*\w+\s*\]/,
  'multiple plots': /(plot(shape|char)?\s*\([\s\S]*){2,}/,
  histogram: /style\s*=\s*plot\.style_(histogram|columns)/,
  fills: /\bfill\s*\(/,
  'dynamic colours': /color\s*=\s*[^,\n]*\?/,
  labels: /\blabel\.new/, boxes: /\bbox\.new/, lines: /\bline\.new/, tables: /\btable\.new/,
  'object deletes': /\.(delete)\s*\(/,
  'request.*': /\brequest\.(security|security_lower_tf)/,
}

afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!RUN)('UIE Phase 4 — the compatibility ledger (opt-in)', () => {
  it('every corpus script, six charts, every capture of it', () => {
    expect(OUT, 'UIE_LEDGER_OUT').toBeTruthy()
    const daily = rowsOf('vw-deadband-ticks-aapl-1d-2026-09-28.json')
    const five = rowsOf('vw-bar-origin-rddt-5-2026-10-02.json')
    const charts = [
      { name: 'D listing', bars: daily, ctx: { tf: 'D', historyFromListing: true, symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } } },
      { name: 'D limited', bars: daily.slice(-5000), ctx: { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } } },
      { name: '1m', bars: rowsOf('vw-bar-counters-spy-1-2026-10-02.json'), ctx: { tf: '1', symbol: { ticker: 'SPY', exchange: 'AMEX' } } },
      { name: '5m', bars: five, ctx: { tf: '5', symbol: { ticker: 'RDDT', exchange: 'NYSE' } } },
      { name: '60m', bars: rowsOf('vw-bool-cast-spy-60-2026-09-28.json'), ctx: { tf: '60', symbol: { ticker: 'SPY', exchange: 'AMEX' } } },
      { name: '5m 32k', bars: stitch(five, 32000), ctx: { tf: '5', symbol: { ticker: 'RDDT', exchange: 'NYSE' } } },
    ].map((c) => ({ ...c, ctx: { newestBarIsForming: false, ...c.ctx } }))

    // ── the evidence: every capture, keyed by its source text ──
    const captures = new Map()
    for (const f of fs.readdirSync(HARNESS_DIR).filter((x) => x.endsWith('.json'))) {
      let cap = null
      try { cap = loadCapture(path.join(HARNESS_DIR, f)).capture } catch { cap = null }
      const text = cap && cap.source && cap.source.text
      if (!text) continue
      const k = norm(text)
      if (!captures.has(k)) captures.set(k, [])
      captures.get(k).push({ id: f.replace(/\.json$/, ''), cap })
    }

    const ledger = []
    const ID = 'u_member-pane-ledger'
    const ID2 = 'u_member-pane-ledger-reload'
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      const row = { slug: f.replace(/\.pine$/, '').split('__')[0], file: f,
        features: Object.entries(FEATURES).filter(([, re]) => re.test(source)).map(([k]) => k), charts: {} }
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let built
      try { built = memberPaneDefinition({ source, id: ID, name: 'ledger' }) } catch (e) { built = { ok: false, guard: 'throw', reason: String(e.message) } }
      if (EVIDENCE_ONLY) {
        row.door = built.ok ? { ok: true, lane: built.lane || 'formula' } : { ok: false, guard: built.guard || null }
      } else if (!built.ok) {
        row.door = { ok: false, guard: built.guard || null, reason: String(built.reason || '').slice(0, 200) }
      } else {
        row.door = { ok: true, lane: built.lane || 'formula', inputs: (built.definition.inputs || []).length,
          objects: !!(built.definition.objects || (built.definition.compute && built.definition.compute.objects)) }
        const { installed, errors } = registry.installUserDefinitions([built.definition])
        if (!installed.length) row.door = { ok: false, guard: 'install', reason: errors.join(' | ').slice(0, 200) }
        else {
          const def = installed[0]
          const keys = (def.plots || []).filter((p) => !p.hidden).map((p) => p.key)
          for (const c of charts) {
            const t0 = performance.now()
            let cols
            try { cols = registry.computeFor(def, c.bars, undefined, c.ctx) } catch (e) { cols = null; row.charts[c.name] = { outcome: 'throw', why: String(e.message).slice(0, 120) } }
            const ms = Math.round(performance.now() - t0)
            if (!cols) continue
            // a column is an Array (runtime lane) or a Float64Array (formula lane)
            const anyValue = keys.some((k) => cols[k] && typeof cols[k].length === "number" && Array.from(cols[k]).some((v) => Number.isFinite(v)))
            const objs = runtimeObjectsOf(cols)
            const withheld = runtimeObjectsWithheldOf(cols)
            const err = Object.values(registry.columnErrors(cols) || {})[0]
            const w = runtimeWarmupOf(cols)
            row.charts[c.name] = {
              outcome: anyValue || (objs && objs.live.length) ? 'drawn' : err ? err.guard : 'empty',
              ms,
              ...(w ? { warmup: w.withheldBars } : {}),
              ...(objs ? { drawings: objs.live.length } : withheld ? { drawings: 'withheld' } : {}),
              ...(err && !anyValue ? { why: String(err.message || '').slice(0, 160) } : {}),
            }
          }
          // ── save / reload: through JSON, a second install, the same columns ──
          const limited = charts[1]
          try {
            const again = JSON.parse(JSON.stringify({ ...built.definition, id: ID2 }))
            const r = registry.installUserDefinitions([again])
            if (r.installed.length) {
              const a = registry.computeFor(def, limited.bars, undefined, limited.ctx)
              const b = registry.computeFor(r.installed[0], limited.bars, undefined, limited.ctx)
              row.reload = keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k])) ? 'identical' : 'DIFFERS'
            } else row.reload = `install refused: ${r.errors.join(' | ').slice(0, 120)}`
          } catch (e) { row.reload = `throw: ${String(e.message).slice(0, 120)}` }
          registry.uninstallUserDefinition(ID2)
          // ── inputs: one numeric input moved inside its author's bounds ──
          const knob = (def.inputs || []).find((i) => (i.type === 'int' || i.type === 'float')
            && Number.isFinite(i.default) && !['lineWidth'].includes(i.key) && !/Width$/.test(i.key))
          if (knob) {
            const step = knob.type === 'int' ? 1 : (knob.step || Math.abs(knob.default) * 0.1 || 0.1)
            let v = knob.default + step
            if (Number.isFinite(knob.max) && v > knob.max) v = knob.default - step
            if (!Number.isFinite(knob.min) || v >= knob.min) {
              try {
                const a = registry.computeFor(def, limited.bars, undefined, limited.ctx)
                const b = registry.computeFor(def, limited.bars, { [knob.key]: v }, limited.ctx)
                row.inputs = { key: knob.key, from: knob.default, to: v,
                  effect: keys.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])) ? 'changes the run' : 'no change' }
              } catch (e) { row.inputs = { key: knob.key, effect: `throw: ${String(e.message).slice(0, 80)}` } }
            }
          }
        }
        registry.uninstallUserDefinition(ID)
      }
      // ── the evidence for THIS source ──
      const caps = captures.get(norm(source)) || []
      row.evidence = caps.map(({ id, cap }) => {
        try {
          const v = gradeCapture(cap).verdict
          const plots = (v.plots || [])
          // ⛔ A MATCH OVER NOTHING IS NOT EVIDENCE: a plot TradingView leaves `na` on every
          // bar (a marker switched off by default) "agrees" with any all-`na` column. Only a
          // plot TradingView gives a value on at least one bar counts as verified.
          const pv = cap.plotValues || { fields: [], rows: [] }
          const vendorValues = (title) => {
            const p = ((cap.study && cap.study.plots) || []).find((x) => x.title === title)
            const i = p ? pv.fields.indexOf(p.id) : -1
            return i < 0 ? null : pv.rows.filter((r) => r[i] !== null && r[i] !== undefined).length
          }
          const real = plots.filter((p) => vendorValues(p.title) !== 0)
          return { id, verdict: v.verdict,
            plots: { match: real.filter((p) => p.verdict === 'MATCH').length,
              diverge: real.filter((p) => p.verdict === 'DIVERGE').length, total: real.length,
              vacuous: plots.length - real.length },
            objects: v.objects ? v.objects.verdict : null }
        } catch (e) { return { id, verdict: 'throw', why: String(e.message).slice(0, 120) } }
      })
      vi.unstubAllEnvs()
      ledger.push(row)
    }
    expect(ledger.length).toBeGreaterThan(200)
    fs.writeFileSync(OUT, JSON.stringify(ledger, null, 1))
  }, 7200000)
})
