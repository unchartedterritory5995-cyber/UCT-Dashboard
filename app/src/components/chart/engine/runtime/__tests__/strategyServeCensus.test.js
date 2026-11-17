// app/src/components/chart/engine/runtime/__tests__/strategyServeCensus.test.js
//
// ─── THE SERVE CENSUS OVER THE COMMITTED STRATEGY CORPUS: SERVED, OR REFUSED BY NAME, NOTHING ELSE ──────
//
// Owner ruling 2026-11-17 (delegated to the coordinator): the Strategy Tester report is served for a Pine strategy only
// where every broker rule its backtest rests on is pinned by a MATCHing TradingView capture (`brokerPins.resolved.json`);
// every other strategy is refused by name with the open question it hits. This rail holds that, with the strategy
// broker gate ON, for every strategy in `corpus/committed` (the committed half of the coverage map's 70; the built-in
// and reference sources live only in the local sample cache, measured by `strategyServeAudit.measure.test.js`).
//
// Each script goes through the member's product path (`strategyServe.js::strategyServeOutcome`): the member door, the
// broker run on NYSE:RDDT 1D from the listing, the report, and the panel a member reads, every served number re-checked
// against the committed ledger. Two admission states:
//
//   granted     the runtime lane's admission granted (`__allowEveryRuntimeScriptForTests`), the armed census's own
//               condition: exactly the committed strategies the 2026-11-17 coverage map counts `wouldTransferIfArmed`
//               are served, every other one is refused by name;
//   production  the admission production latches: capability admission ON and the server's verdict for each source,
//               which today is "not admitted" for every strategy (`strategy-decl` has no registry row;
//               `tests/test_strategy_serve_arming.py::test_the_server_admits_no_strategy_today` holds that): NOTHING
//               is served, every strategy is refused by name.
//
//   granted, a member's daily bars   the granted state again on the reference bars in the shape a member's DAILY chart
//               hands the run (`ourSide.js::toProductBars`, `/api/bars`'s ISO date keys): the same answer, script by
//               script, as on epoch seconds (2026-11-17, strategy-epoch-bar-times).
//
// ⛔ In neither state is there a third: a report showing a number an unpinned rule computed, a refusal with no sentence,
// an empty cell, a guard id on screen, or a strategy whose backtest is silently absent.
//
// Mutation proofs (by hand, each restored from a saved copy; run 2026-11-17, recorded in
// docs/pine/evidence/2026-11-17-serve-witnessed-strategies/EVIDENCE.md):
//   C-a `memberPaneDefinition.js`: drop the runtime lane's `notes.push(strategyBacktestNote(...))`  -> granted RED
//       (flawless-victory: a runtime document without the broker, nothing names the backtest);
//   C-b `strategyServe.js::rulesBehind`: an unpinned rule (B-EXEC) behind every served metric        -> granted RED
//       (every served metric and trade profit of the 3 served reports named);
//   C-c `StrategyReportPanel.jsx::memberSentence` answers ''                                         -> granted RED
//       (the refused cells a member reads come out empty);
//   C-d `memberPaneDefinition.js`: skip the runtime lane's not-graded admission                      -> production RED
//       (the served strategies reach the broker without admission).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission, latchRuntimeLists,
  latchRuntimeAdmission, runtimeSourceHash,
} from '../../runtimeKill'
import { loadCapture } from '../../__tests__/vendorHarness/harness.js'
import { barsOfCapture } from '../../__tests__/vendorHarness/strategyHarness.js'
import { toProductBars } from '../../__tests__/vendorHarness/ourSide.js'
import { historyWindowBarsOf, STRATEGY_DECLARATION } from './strategyArmed.js'
import { strategyServeOutcome } from './strategyServe.js'
import StrategyReportPanel from '../../../pane/StrategyReportPanel'

vi.setConfig({ testTimeout: 600000, hookTimeout: 600000 })

const ROOT = path.resolve(process.cwd(), '..')
const CORPUS = path.join(ROOT, 'corpus', 'committed')
const REFERENCE = path.join(ROOT, 'tests/fixtures/vendor/harness/k-clustering-rddt-1d-2026-09-28.json')
const ALLOWLIST = path.join(ROOT, 'api/data/pine_runtime_allowlist.json')
const KILLLIST = path.join(ROOT, 'api/data/pine_runtime_killlist.json')
const SYMBOL = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' })
const GATE = (f) => fs.readFileSync(path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8')
const flagOf = (src) => (src.match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js'].map((f) => flagOf(GATE(f)))

/** ⭐ DATED 2026-11-17: the committed rows the coverage map counts `wouldTransferIfArmed` (docs/pine/coverage-map.json
 *  of 2026-11-17, PR #1645; 7 of 70 over the whole sample, 3 of them committed). A change here is a re-measure. */
const ARMED_COMMITTED = Object.freeze([
  'buy-monday-exit-tuesday__8f2f69cc99',
  'scalping-strategy-with-williams-r-macd-and-sma-1-minute-only__e247952471',
  'supertrend-strategy__rcRbtoBiKG',
])

/** the server's kill-list read payload, from the committed lists (Railway's variables are not in the repo) */
function productionLists() {
  const allow = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8')).scripts.map((s) => s.sha256)
  const killDoc = JSON.parse(fs.readFileSync(KILLLIST, 'utf8'))
  const kill = (killDoc.entries || killDoc.scripts || []).map((e) => (typeof e === 'string' ? e : e.sha256 || e.id)).filter(Boolean)
  return { kill, allow, capability_admission: true }
}

const scripts = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  .map((f) => ({ key: f.replace(/\.pine$/, ''), source: fs.readFileSync(path.join(CORPUS, f), 'utf8') }))
  .filter((s) => STRATEGY_DECLARATION.test(s.source))

let bars
let dailyBars
let ctx
const results = { granted: [], production: [], grantedDaily: [] }

function runAll(mode, onBars = bars) {
  const out = []
  for (const s of scripts) {
    for (const f of FLAGS) vi.stubEnv(f, '1')
    __permitRuntimePaneForTests()
    if (mode === 'granted') {
      __allowEveryRuntimeScriptForTests()
    } else {
      __resetRuntimeAllowList()
      __resetRuntimeAdmission()
      latchRuntimeLists(productionLists())
      // the server's verdict for every committed strategy today (railed in Python): not admitted
      latchRuntimeAdmission(runtimeSourceHash(s.source), { admitted: false })
    }
    out.push({ key: s.key, ...strategyServeOutcome({ source: s.source, bars: onBars, ctx, Panel: StrategyReportPanel }) })
    vi.unstubAllEnvs()
  }
  __allowEveryRuntimeScriptForTests()
  __resetRuntimeAdmission()
  return out
}

beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in this rail')))
  const reference = loadCapture(REFERENCE).capture
  bars = barsOfCapture(reference)
  dailyBars = toProductBars(reference)
  ctx = { tf: 'D', symbol: SYMBOL, newestBarIsForming: false, historyFromListing: true, historyWindowBars: historyWindowBarsOf(ROOT) }
  results.granted = runAll('granted')
  results.production = runAll('production')
  results.grantedDaily = runAll('granted', dailyBars)
}, 600000)
afterAll(() => { vi.unstubAllGlobals() })

const thirds = (rows) => rows.filter((r) => r.state !== 'served' && r.state !== 'refused' || r.third.length)
  .map((r) => `${r.key}: ${r.third.join(' | ') || r.state}`)

describe('the serve census over corpus/committed, broker gate on', () => {
  it('reads the gate names off their modules and finds the committed strategies (non-vacuity)', () => {
    for (const f of FLAGS) expect(f).toMatch(/^VITE_/)
    expect(scripts.length).toBe(25)
    expect(bars.length).toBeGreaterThan(100)
  })

  it('granted admission: exactly the armed census\'s committed strategies are served, the rest refused by name', () => {
    const rows = results.granted
    expect(thirds(rows)).toEqual([])
    const served = rows.filter((r) => r.state === 'served').map((r) => r.key).sort()
    expect(served).toEqual([...ARMED_COMMITTED])
    const refused = rows.filter((r) => r.state === 'refused')
    expect(refused.length).toBe(scripts.length - ARMED_COMMITTED.length)
    for (const r of refused) {
      expect(['door', 'run', 'report', 'no-backtest'], r.key).toContain(r.at)
      expect(r.sentence, r.key).toBeTruthy()
    }
    // every served report: no number on an unpinned rule, the D2 sentence, and a panel a member reads in full
    for (const r of rows.filter((x) => x.state === 'served')) {
      expect(r.served.unpinnedServed, r.key).toEqual([])
      expect(r.served.panel.rows, r.key).toBeGreaterThan(0)
    }
  })

  it('production admission: nothing is served, every strategy is refused by name', () => {
    const rows = results.production
    expect(thirds(rows)).toEqual([])
    expect(rows.filter((r) => r.state === 'served').map((r) => r.key)).toEqual([])
    expect(rows.filter((r) => r.state === 'refused').length).toBe(scripts.length)
    // the three the granted state serves are drawn as plots with the backtest refused by name, never silently
    for (const k of ARMED_COMMITTED) {
      const r = rows.find((x) => x.key === k)
      expect(r.state, k).toBe('refused')
      expect(r.sentence, k).toBeTruthy()
    }
  })

  // ⭐⭐ (2026-11-17, strategy-epoch-bar-times) — THE MEMBER'S BAR SHAPE. A member's daily chart hands the run
  // `/api/bars`'s ISO date keys, not the capture's epoch seconds above; until a broker run was handed each bar's
  // opening instant (`runtimeColumns.js::brokerBarTimes`) every strategy that traded lost its report there (2 of these
  // 25 served, both with no trade). The same census on that shape now answers exactly as on epoch seconds.
  it('granted admission on a member\'s DAILY bars (ISO date keys): the same strategies served, with the same trades', () => {
    expect(dailyBars.every((b) => typeof b.t === 'string')).toBe(true)
    const rows = results.grantedDaily
    expect(thirds(rows)).toEqual([])
    expect(rows.filter((r) => r.state === 'served').map((r) => r.key).sort()).toEqual([...ARMED_COMMITTED])
    for (const r of rows) {
      const e = results.granted.find((x) => x.key === r.key)
      expect([r.state, r.at, r.guard], r.key).toEqual([e.state, e.at, e.guard])
      if (r.state === 'served') expect(r.served.trades, r.key).toBe(e.served.trades)
    }
    // non-vacuity: a served strategy on the member's bars traded
    expect(rows.some((r) => r.state === 'served' && r.served.trades > 5)).toBe(true)
  })
})
