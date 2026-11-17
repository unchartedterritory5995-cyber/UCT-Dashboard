// app/src/components/chart/engine/runtime/__tests__/strategyArmedCensus.measure.test.js
//
// ─── THE STRATEGY CENSUS, ARMED: WHAT WOULD TRANSFER IF THE OWNER ARMED THE BROKER ──
//
// A MEASUREMENT, run only when its env is set (never in the ordinary suite). The coverage map
// never counts an order-placing strategy as transferring (`tools/pine_coverage/coverage_map.py`
// `transfers_fully`), because the broker is DARK (`strategyBrokerGate.js`,
// `VITE_PINE_STRATEGY_BROKER_ENABLED`): with it off, order calls are skipped and nothing simulates
// the trades. Arming is the owner's act (W9 ruling D6). This file measures, per strategy script,
// what arming would serve, WITHOUT arming anything: every flag is a `vi.stubEnv` inside this test.
//
// Each script is asked three things, on the census's own reference bars (NYSE:RDDT 1D, the capture
// `coverageMapDoorCensus.measure.test.js` binds `cleanBound` on, run from the listing):
//
//   1. door      the member door (`memberPaneDefinition` + `installUserDefinitions`) with the three
//                flags on (objects-only, runtime pane, broker), the runtime-on census lane's permits.
//                `clean` is the census's `isClean`; `holdsBroker` says the door's document runs the
//                broker (it does so ONLY for a strategy whose outputs read a `strategy.*` value:
//                `pineRuntimeFrontend.js::buildRuntimeIr`'s retry on `pine:strategy-call`).
//   2. doorRun   that document's broker run, built as the door builds it, with the COMMITTED pin
//                ledger (`brokerPins.resolved.json`): ok, or the refusal that stops it (guard, rule).
//   3. forced    the same script built in broker mode WHATEVER its outputs read (`__strategyBroker`,
//                rule 11's repaint check applied first, as the retry applies it): a counterfactual for
//                the strategies the door never hands to the broker. Run twice: with the ledger
//                (`ledger`), and with every rule allowed (`all`), which lists every rule the script
//                exercises, so `unpinned` is the whole list of rules it still needs pinned.
//
// The run context is the product's (`runtimeColumns.js`): `confirmed` (the reference's newest bar
// had finished), `historyWindowBars` 5000, and `minContract` derived from the symbol through
// `bind.js::symbolConstants` (an unwitnessed exchange stays undefined and a cash / percent size
// refuses Q-S1a by name, as on a member's chart).
//
// Env: STRATEGY_ARMED_INPUT (json [{key, path}]), STRATEGY_ARMED_OUT (jsonl, rewritten).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { assessObjectLoss } from '../../ast/objectLoss'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { strategyRepaintConstruct } from '../../ast/strategyRepaint.js'
import { symbolConstants, minContractOf } from '../../ast/bind.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { strategyRecordOf, STRATEGY_WINDOW_HISTORY } from '../strategyRecord.js'
import RESOLVED from '../brokerPins.resolved.json'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { loadCapture } from '../../__tests__/vendorHarness/harness.js'
import { barsOfCapture } from '../../__tests__/vendorHarness/strategyHarness.js'
import { armedStrategyVerdict, historyWindowBarsOf } from './strategyArmed.js'

const INPUT = process.env.STRATEGY_ARMED_INPUT
const OUT = process.env.STRATEGY_ARMED_OUT
const RUN = !!(INPUT && OUT)
const DEF_ID = 'u_strategy-armed-census'
const WINDOW = historyWindowBarsOf(path.resolve(process.cwd(), '..'))
const REFERENCE = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness/k-clustering-rddt-1d-2026-09-28.json')
const SYMBOL = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' })

afterEach(() => { vi.unstubAllEnvs() })

const GATE = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
/** The flag NAMES are read off their gate modules, never typed. */
const flagOf = (src) => (src.match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const short = (s, n = 240) => (s == null ? null : String(s).slice(0, n))
const ALL = () => true
const PINNED = new Set(Object.keys((RESOLVED && RESOLVED.rules) || {}))

/** The census's `isClean`, over the door's own answer. */
function door(source) {
  let d
  try {
    d = memberPaneDefinition({ source, id: DEF_ID, name: 'armed' })
  } catch (err) {
    return { threw: short((err && err.message) || err) }
  }
  const t = d.translation || {}
  const refusals = (t.refusals || []).map((r) => r.guard || null)
  let loss = null
  try { loss = assessObjectLoss(t) } catch { loss = null }
  let installed = null
  if (d.ok) {
    try {
      installed = registry.installUserDefinitions([d.definition]).installed.length > 0
    } catch {
      installed = false
    } finally {
      try { registry.uninstallUserDefinition(DEF_ID) } catch { /* nothing installed */ }
    }
  }
  const withheldObjects = !!(d.ok && t.objects && (t.objects.ops || []).length && !(d.definition && d.definition.objects))
  const withheldPaints = (((t.presentation || {}).paints) || []).filter((p) => p && p.withheld).length
  const lossVerdict = loss ? loss.verdict : null
  const lane = d.lane || (d.ok ? 'host' : null)
  // the RUNTIME-ON lane's judgement (`coverage_map.py::runtimeClean`): a runtime document keeps the host
  // translation's refusals beside it by design, so an attach by the runtime lane is what counts there
  const clean = (!!d.ok && installed !== false && refusals.length === 0
    && (lossVerdict === 'clean' || lossVerdict == null) && !withheldObjects && !(withheldPaints > 0))
    || (!!d.ok && installed !== false && lane === 'runtime')
  let holdsBroker = false
  try { holdsBroker = !!d.ok && JSON.stringify(d.definition).includes(`"${STRATEGY_WINDOW_HISTORY}"`) } catch { holdsBroker = false }
  return {
    attached: !!d.ok, clean, lane, guard: d.guard || null,
    reason: d.ok ? null : short(d.reason), refusals: [...new Set(refusals)], holdsBroker,
    runtimeDeclined: d.runtimeDeclined ? d.runtimeDeclined.code : null,
  }
}

/** Build as the door builds (`strategyHarness.js::buildAsTheDoorDoes`): the drawing build when it lowers a
 *  drawing, else the value build. `force`: broker mode whatever the outputs read. */
function buildAsTheDoor(source, bars, force) {
  const opts = { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true, ...runtimeClockOpts(false) }
  if (force) {
    const repaint = strategyRepaintConstruct(source)
    if (repaint) return { ok: false, refusal: { guard: 'runtime:strategy-repaint', message: `\`${repaint}\`` } }
    opts.__strategyBroker = true
  }
  const lower = (b) => lowerIrProgram(b.ir, { historyFromListing: true })
  const drawing = buildRuntimeIr(source, { ...opts, objectsInRun: true })
  if (drawing.ok) {
    const program = lower(drawing)
    if ((program.objectOps || []).length > 0) return { ok: true, built: drawing, program }
  }
  const value = buildRuntimeIr(source, { ...opts, objectTrees: [] })
  if (value.ok) return { ok: true, built: value, program: lower(value) }
  const vr = value.refusal || {}
  const refusal = !drawing.ok && (vr.guard === 'runtime:object-op' || vr.guard === 'runtime:no-output') ? (drawing.refusal || {}) : vr
  return { ok: false, refusal }
}

function run(made, bars, pins) {
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((x) => x[k])))
  const barTimes = bars.map((x) => x.t)
  let res
  try {
    res = execute(made.program, {
      bars: bars.length, series, columns: made.program.columns, confirmed: true, barTimes,
      historyWindowBars: WINDOW, minContract: minContractOf(symbolConstants(SYMBOL)),
    }, undefined, pins ? { brokerPinned: pins } : {})
  } catch (e) {
    return { ok: false, guard: (e && e.guard) || 'runtime:error', rule: (e && e.rule) || null,
      probe: (e && e.probe) || null, setting: (e && e.setting) || null, message: short(e && e.message) }
  }
  try {
    const rec = strategyRecordOf({ summary: res.broker, decl: made.built.ir.broker, barTimes, historyWindowBars: WINDOW, confirmed: true })
    return { ok: true, rulesUsed: [...rec.rulesUsed].sort(), trades: rec.trades.length, orders: rec.orders.length }
  } catch (e) {
    return { ok: false, guard: 'record:threw', rule: null, probe: null, setting: null, message: short(e && e.message) }
  }
}

/** A tester-only strategy (no plot, no drawing) has no output for any build to carry
 *  (`runtime:no-output`). To still ask what its ORDERS exercise, the forced side appends one
 *  read of the position (a measurement probe, never a door answer) and says so (`probedPlot`). */
const PROBE_PLOT = 'plot(strategy.position_size, "uct_armed_census_probe")'

function brokerSide(source, bars, force) {
  let made
  let probedPlot = false
  try {
    made = buildAsTheDoor(source, bars, force)
    if (force && !made.ok && (made.refusal || {}).guard === 'runtime:no-output') {
      probedPlot = true
      made = buildAsTheDoor(`${source.replace(/\s+$/, '')}\n${PROBE_PLOT}\n`, bars, force)
    }
  } catch (err) {
    return { stage: 'build', ok: false, guard: 'build:threw', message: short((err && err.message) || err), probedPlot }
  }
  if (!made.ok) {
    const r = made.refusal || {}
    return { stage: 'build', ok: false, guard: r.guard || r.code || 'build', message: short(r.message), probedPlot }
  }
  if (!made.built.ir || !made.built.ir.broker) return { stage: 'no-broker', ok: false }
  const ledger = run(made, bars, null)
  const all = run(made, bars, ALL)
  return {
    stage: 'run', ok: ledger.ok, ledger, all, probedPlot,
    unpinned: all.ok ? all.rulesUsed.filter((id) => !PINNED.has(id)) : null,
  }
}

describe.skipIf(!RUN)('strategy census, broker armed (measurement only)', () => {
  it('answers every strategy script with the three flags on', () => {
    // every module this file measures is loaded by now (static imports, collected before the body runs)
    fs.writeFileSync(`${OUT}.started`, new Date().toISOString())
    const objectsFlag = flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js'))
    const runtimeFlag = flagOf(GATE('src/components/chart/engine/runtimePaneGate.js'))
    const brokerFlag = flagOf(GATE('src/components/chart/engine/strategyBrokerGate.js'))
    for (const f of [objectsFlag, runtimeFlag, brokerFlag]) expect(f).toMatch(/^VITE_/)
    const bars = barsOfCapture(loadCapture(REFERENCE).capture)
    expect(bars && bars.length).toBeGreaterThan(100)
    const items = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
    const rows = []
    for (const it of items) {
      const source = fs.readFileSync(it.path, 'utf8')
      vi.stubEnv(objectsFlag, '1')
      vi.stubEnv(runtimeFlag, '1')
      vi.stubEnv(brokerFlag, '1')
      __permitRuntimePaneForTests()
      __allowEveryRuntimeScriptForTests()
      const row = { key: it.key, door: door(source) }
      row.armed = armedStrategyVerdict({ source, door, bars, ctx: { tf: 'D', symbol: SYMBOL, newestBarIsForming: false,
        historyFromListing: true, historyWindowBars: WINDOW } })
      row.doorRun = brokerSide(source, bars, false)
      row.forced = brokerSide(source, bars, true)
      vi.unstubAllEnvs()
      rows.push(row)
    }
    fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    console.log(`strategy armed census: ${rows.length} rows -> ${OUT}`)
    expect(rows.length).toBe(items.length)
  }, 3600 * 1000)
})
