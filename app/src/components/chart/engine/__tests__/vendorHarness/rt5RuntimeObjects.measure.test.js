// app/src/components/chart/engine/__tests__/vendorHarness/rt5RuntimeObjects.measure.test.js
//
// ─── RT5 — THE RUN'S OWN DRAWINGS AGAINST EVERY CAPTURE THAT RECORDED OBJECTS ──
//
// Two readings per capture, written to one JSON (opt-in: `RT5_MEASURE=1
// RT5_MEASURE_OUT=<file.json>`):
//
//   door   — `gradeCapture` with the objects-only pane AND the runtime pane on:
//            the verdict a member's chart would get, and which lane drew the
//            objects (`ours.objects.lane === 'runtime'` is the RT5 door).
//   direct — the script built WITH its drawings (`objectsInRun`) and run on the
//            capture's own bars, whatever the door decides: per family, our held
//            count and texts against the capture's records. ⭐ This is the
//            instrument that tests the STORE's semantics (collector, tables,
//            setters) on every capture, not only the ones the door routes here.
//            Bars that do not start at the listing are run anyway and flagged
//            (`fromListing: false`): a `var` seeded off TradingView's bar 0 can
//            disagree there, which the door refuses by R-W.
//
// ⛔ IT ASSERTS NO COUNT — it measures. The rails are elsewhere.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR, loadCapture, gradeCapture } from './harness'
import { toProductBars, tfCodeOf } from './ourSide'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock'
import { lowerIrProgram } from '../../runtime/lowerIr'
import { execute } from '../../runtime/vm'

const RUN = process.env.RT5_MEASURE === '1'
const OUT = process.env.RT5_MEASURE_OUT
const ONLY = process.env.RT5_MEASURE_ONLY || ''

afterEach(() => { vi.unstubAllEnvs() })

function direct(capture) {
  const bars = toProductBars(capture)
  const tf = tfCodeOf(capture.timeframe)
  let built
  try {
    built = buildRuntimeIr(capture.source.text, {
      bars, inputs: {}, objectsInRun: true, pane: true, basePeriod: tf, tf,
      ...runtimeClockOpts(capture.newestBarIsForming ?? null, { tf }),
    })
  } catch (err) { return { ok: false, why: `build threw: ${err.message}` } }
  if (!built.ok) return { ok: false, why: `${(built.refusal || {}).guard}: ${String((built.refusal || {}).message || '').slice(0, 200)}` }
  if (!(built.diagnostics && built.diagnostics.objectOps > 0)) return { ok: false, why: 'no drawing op lowered' }
  if ((built.ir.requests || []).length) return { ok: false, why: 'requests other bars' }
  let program
  try { program = lowerIrProgram(built.ir) } catch (err) { return { ok: false, why: `lower: ${err.message}` } }
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const t0 = Date.now()
  let res
  try {
    res = execute(program, {
      bars: bars.length, series, columns: program.columns, confirmed: capture.newestBarIsForming === false,
      barTimes: bars.map((b) => b.t),
    })
  } catch (err) { return { ok: false, why: `run: ${String(err.message).slice(0, 200)}` } }
  const fin = res.objects.finish()
  const held = { lines: 0, labels: 0, boxes: 0, tables: 0, linefills: 0, tableCells: 0 }
  const texts = { labels: [], tableCells: [] }
  for (const o of fin.live) {
    const k = { line: 'lines', label: 'labels', box: 'boxes', table: 'tables', linefill: 'linefills' }[o.family]
    held[k] += 1
    if (o.family === 'label') texts.labels.push(o.props.text || '')
    if (o.family === 'table') {
      held.tableCells += (o.cells || []).filter((c) => c.props.text !== undefined || c.props.bgcolor !== undefined).length
      for (const c of o.cells || []) if (c.props.text) texts.tableCells.push(c.props.text)
    }
  }
  return { ok: true, ms: Date.now() - t0, status: fin.status, reason: fin.reason, withheld: fin.withheld, held, texts, stats: fin.stats }
}

function vendorOf(capture) {
  const o = capture.objects || {}
  const r = o.records || {}
  const n = (k) => (Array.isArray(r[k]) ? r[k].length : (o.counts || {})[k] || 0)
  return {
    held: { lines: n('lines'), labels: n('labels'), boxes: n('boxes'), tables: n('tables'), linefills: n('linefills'), tableCells: n('tableCells') },
    texts: { labels: ((o.texts || {}).labels || []), tableCells: ((o.texts || {}).tableCells || []) },
  }
}

const sameMultiset = (a, b) => {
  if (a.length !== b.length) return false
  const x = [...a].sort()
  const y = [...b].sort()
  return x.every((v, i) => v === y[i])
}

describe.skipIf(!RUN)('RT5 — runtime objects vs captures', () => {
  it('measures every harness capture that recorded objects', () => {
    const files = fs.readdirSync(HARNESS_DIR).filter((f) => f.endsWith('.json')).sort()
    const rows = []
    for (const f of files) {
      if (ONLY && !f.includes(ONLY)) continue
      const loaded = loadCapture(path.join(HARNESS_DIR, f))
      if (!loaded.capture) continue
      const cap = loaded.capture
      const rec = cap.objects && cap.objects.records
      if (!rec || !Object.values(rec).some((v) => Array.isArray(v) && v.length)) continue
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try {
        const { verdict, ours } = gradeCapture(cap)
        door = {
          verdict: verdict.verdict,
          objects: verdict.objects ? { verdict: verdict.objects.verdict, reason: String(verdict.objects.reason || '').slice(0, 300) } : null,
          lane: ours && ours.objects ? ours.objects.lane || 'host' : null,
          refusal: ours && !ours.ok ? String(ours.refusal || '').slice(0, 200) : null,
        }
      } catch (err) { door = { error: String(err.message).slice(0, 200) } }
      vi.unstubAllEnvs()
      const d = direct(cap)
      const v = vendorOf(cap)
      const fams = d.ok ? Object.keys(v.held).filter((k) => v.held[k] || d.held[k]) : []
      const agree = d.ok ? Object.fromEntries(fams.map((k) => [k, d.held[k] === v.held[k]])) : null
      const labelTexts = d.ok && v.texts.labels.length ? sameMultiset(d.texts.labels, v.texts.labels) : null
      const onlyIn = (a, b) => { const m = new Map(); for (const x of b) m.set(x, (m.get(x) || 0) + 1); const out = []; for (const x of a) { if (m.get(x)) m.set(x, m.get(x) - 1); else out.push(x) } return out }
      const textDiff = d.ok && labelTexts === false
        ? { ours: onlyIn(d.texts.labels, v.texts.labels).slice(0, 6), vendor: onlyIn(v.texts.labels, d.texts.labels).slice(0, 6) } : null
      rows.push({
        file: f, fromListing: !!(cap.history && cap.history.startsAtBar0), bars: (cap.bars && cap.bars.rows || []).length,
        door, direct: d.ok ? { ms: d.ms, status: d.status, reason: d.reason, withheld: d.withheld, held: d.held } : d,
        vendor: v.held, agree, labelTexts, textDiff,
      })
    }
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 1))
    expect(rows.length).toBeGreaterThan(0)
  }, 1800000)
})
