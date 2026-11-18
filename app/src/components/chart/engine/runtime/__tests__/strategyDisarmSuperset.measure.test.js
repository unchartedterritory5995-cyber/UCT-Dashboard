// app/src/components/chart/engine/runtime/__tests__/strategyDisarmSuperset.measure.test.js
//
// ─── ⭐⭐ Engine 77 (#1833, fix/strategy-disarmed-taint) — DOES AN ADMISSION TAKE AWAY ANYTHING A MEMBER SEES? ──────
//
// A MEASUREMENT, run only when its env is set (never in the ordinary suite): the coordinator's acceptance (ruling
// 2026-11-18 (c)) for admitting `strategy-decl`. For every strategy, on a member's DAILY bars (`ourSide.js::
// toProductBars`, `/api/bars`'s ISO date keys), through the member's product path, in two admission states:
//
//   today      production now: the three Pine flags on (objects-only, runtime pane, strategy broker, as the
//              production build arms them), capability admission on and the server's verdict "not admitted" for the
//              source (`strategy-decl` has no registry row): the member reads what the door gives without the broker;
//   admitted   the runtime lane's admission granted (`__allowEveryRuntimeScriptForTests`): the broker document runs.
//
// Each state answers the SET of plots and paints the member sees drawn, BY IDENTITY: a plot by its document key and
// label, a paint by its kind and ordinal; drawn = shown (not hidden, not withheld) with a value on some bar (a paint
// with a constant colour is drawn as shown). The acceptance is a SUPERSET BY IDENTITY: admitted ⊇ today for every
// row, listed per script. A row whose `missing` is not empty stops the admission.
//
// Env: STRATEGY_SUPERSET_INPUT (json {rows: [{key, kind: 'source' | 'capture', path, population}]}),
//      STRATEGY_SUPERSET_OUT (jsonl, rewritten). A `source` row runs on two reference charts (NYSE:RDDT daily from
//      its listing; AMEX:SPY daily, its most recent 1,800 bars, not from the listing); a `capture` row on its own
//      bars and chart. The output holds identifiers and counts only (no source text).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission, latchRuntimeLists,
  latchRuntimeAdmission, runtimeSourceHash,
} from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../runtimeColumns'
import { runtimeStrategyOf } from '../strategyRecord'
import { columnErrors } from '../../astColumns'
import { isStrategyWindowDefinition } from '../../strategyWindow'
import { loadCapture } from '../../__tests__/vendorHarness/harness.js'
import { toProductBars } from '../../__tests__/vendorHarness/ourSide.js'
import { storeExchangeOfCapture } from '../../__tests__/vendorHarness/storeExchange.js'
import { historyWindowBarsOf } from './strategyArmed.js'

const INPUT = process.env.STRATEGY_SUPERSET_INPUT
const OUT = process.env.STRATEGY_SUPERSET_OUT
const RUN = !!(INPUT && OUT)
const ROOT = path.resolve(process.cwd(), '..')
const WINDOW = historyWindowBarsOf(ROOT)
const GATE = (f) => fs.readFileSync(path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8')
const FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js']
  .map((f) => (GATE(f).match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1])
const DEF_ID = 'u_strategy-disarm-superset'
const REFERENCES = [
  ['RDDT 1D from listing', 'tests/fixtures/vendor/harness/k-clustering-rddt-1d-2026-09-28.json'],
  ['SPY 1D not from listing', 'tests/fixtures/vendor/harness/supertrend-strategy-spy-1d-2026-10-02.json'],
]

const asList = (col) => (Array.isArray(col) || ArrayBuffer.isView(col) ? Array.from(col) : null)
const holds = (col) => { const l = asList(col); return !!l && l.some((v) => Number.isFinite(v)) }
const short = (s, n = 200) => (s == null ? null : String(s).slice(0, n))

/** the chart's timeframe code as a member's chart names it (`1D` -> `D`; an intraday capture keeps its minutes) */
const tfOf = (t) => ({ '1D': 'D', D: 'D', '1W': 'W', W: 'W', '1M': 'M', M: 'M' })[String(t)] || String(t)

function chartOf(capture) {
  return {
    bars: toProductBars(capture),
    ctx: {
      tf: tfOf(capture.timeframe),
      symbol: { ticker: capture.symbol.name, exchange: storeExchangeOfCapture(capture, capture.symbol.exchange) || capture.symbol.exchange },
      newestBarIsForming: false,
      historyFromListing: !!(capture.history && capture.history.startsAtBar0 === true),
      historyWindowBars: WINDOW,
    },
  }
}

/** What the member sees drawn for `source` on `chart` in one admission state: the plot and paint identities. */
function seen(source, chart, admitted) {
  for (const f of FLAGS) vi.stubEnv(f, '1')
  __permitRuntimePaneForTests()
  if (admitted) __allowEveryRuntimeScriptForTests()
  else {
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    latchRuntimeLists({ kill: [], allow: [], capability_admission: true })
    latchRuntimeAdmission(runtimeSourceHash(source), { admitted: false })
  }
  const out = { ok: false, lane: null, broker: false, drawn: [], styled: [], withheld: [], refusal: null, stop: null }
  let installedOk = false
  try {
    const d = memberPaneDefinition({ source, id: DEF_ID, name: 'superset' })
    out.ok = !!d.ok
    if (!d.ok) { out.stop = `door:${d.guard || 'refused'}`; return out }
    const def = d.definition
    out.lane = d.lane || (def.compute && def.compute.kind) || null
    out.broker = isStrategyWindowDefinition(def)
    const { installed, errors } = registry.installUserDefinitions([def])
    if (!installed || !installed[0]) { out.stop = `install:${short((errors || []).join(' | '), 80)}`; return out }
    installedOk = true
    let cols
    try {
      cols = def.compute && def.compute.kind === 'runtime' ? computeRuntimeColumns(installed[0], chart.bars, chart.ctx)
        : registry.computeFor(installed[0], chart.bars, undefined, chart.ctx)
    } catch (e) {
      out.stop = `run:${(e && (e.guard || e.code)) || 'error'}:${(e && (e.rule || e.probe || e.capture)) || ''}`
      return out
    }
    // two identities for a plot: its document key and label, and (a cross-check that no renumbering between the
    // lanes can hide a loss) its style and ordinal among the shown plots of that style
    const styleOrdinal = {}
    for (const p of def.plots || []) {
      if (!p || p.hidden === true) continue
      const style = p.style || 'line'
      const n = (styleOrdinal[style] = (styleOrdinal[style] || 0) + 1)
      if (holds(cols[p.key])) {
        out.drawn.push(`plot:${p.key}|${p.label || ''}`)
        out.styled.push(`plot:${style}#${n}`)
      }
    }
    const ordinal = {}
    for (const p of def.paints || []) {
      if (!p) continue
      const n = (ordinal[p.kind] = (ordinal[p.kind] || 0) + 1)
      if (p.withheld || p.hidden || p.na) continue
      const m = /^column:(.+)$/.exec(String(p.colorMode || ''))
      if (!m || holds(cols[m[1]])) { out.drawn.push(`paint:${p.kind}#${n}`); out.styled.push(`paint:${p.kind}#${n}`) }
    }
    out.withheld = Object.keys(columnErrors(cols)).sort()
    const rec = runtimeStrategyOf(cols)
    if (rec && rec.refusals && rec.refusals.length) out.refusal = `${rec.refusals[0].guard}:${rec.refusals[0].rule || ''}`
    return out
  } catch (e) {
    out.stop = `threw:${short((e && e.message) || e, 120)}`
    return out
  } finally {
    if (installedOk) { try { registry.uninstallUserDefinition(DEF_ID) } catch { /* nothing installed */ } }
    vi.unstubAllEnvs()
    __allowEveryRuntimeScriptForTests()
    __resetRuntimeAdmission()
  }
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe.skipIf(!RUN)('a strategy admission takes nothing away: admitted ⊇ today, by identity (measurement only)', () => {
  it('measures every row on a member\'s daily bars', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in this measurement')))
    for (const f of FLAGS) expect(f).toMatch(/^VITE_/)
    const input = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
    const refs = REFERENCES.map(([name, rel]) => ({ name, chart: chartOf(loadCapture(path.join(ROOT, rel)).capture) }))
    const lines = []
    for (const row of input.rows) {
      let source
      let charts
      if (row.kind === 'capture') {
        const cap = loadCapture(row.path).capture
        source = cap && cap.source && cap.source.text
        charts = [{ name: `${cap.symbol.name} ${cap.timeframe} (its own)`, chart: chartOf(cap) }]
      } else {
        source = fs.readFileSync(row.path, 'utf8')
        charts = refs
      }
      if (typeof source !== 'string' || !source) { lines.push({ key: row.key, error: 'no source' }); continue }
      for (const c of charts) {
        const today = seen(source, c.chart, false)
        const admitted = seen(source, c.chart, true)
        const a = new Set(admitted.drawn)
        const t = new Set(today.drawn)
        lines.push({
          key: row.key, population: row.population || row.kind, chart: c.name,
          today: { lane: today.lane, broker: today.broker, stop: today.stop, drawn: today.drawn },
          admitted: { lane: admitted.lane, broker: admitted.broker, stop: admitted.stop, refusal: admitted.refusal,
            withheld: admitted.withheld, drawn: admitted.drawn },
          missing: today.drawn.filter((x) => !a.has(x)),
          added: admitted.drawn.filter((x) => !t.has(x)),
          missingStyled: today.styled.filter((x) => !admitted.styled.includes(x)),
        })
      }
    }
    fs.writeFileSync(OUT, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    expect(lines.length).toBeGreaterThan(0)
  }, 3600000)
})
