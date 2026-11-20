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
//   production  the admission production latches: capability admission ON and the server's verdict for each source
//               (`SERVER_ADMITS`, held to the server by `tests/test_strategy_serve_arming.py`). ⚰️ Until 2026-11-18 that
//               was "not admitted" for every strategy (`strategy-decl` had no registry row) and NOTHING was served.
//               Since `strategy-decl` is admitted (Q-SD1 / Q-SD2, supertrend-strategy, MATCH runtime-on), 17 of the 25
//               were admitted, and since `request-other` is admitted (2026-11-19, #2016, closed-bar history) 22 are;
//               the three the granted state serves are served; every other one is refused by name, an admitted
//               strategy whose backtest rests on an unpinned rule included.
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
// Re-latched 2026-11-19 after #2016 admitted `request-other` (the five REQUEST_OTHER_ADMITS below), mutants by hand,
// each restored from a saved copy (recorded in the PR):
//   C-e drop take-profit-multi-timeframe from `SERVER_ADMITS`  -> the five-admits rail RED, the count RED, and
//       tests/test_strategy_serve_arming.py::test_the_server_admits_exactly_the_census_list RED;
//   C-f hold pmax-explorer's kill (`status: "pending"` in the kill list) -> the five-admits rail RED (its backtest note
//       names `runtime:function-global-state`, no longer the kill).
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
// the ONE pin reader production's broker run reads (`vm.js` `ledgerPinned`, `brokerPins.resolved.json`)
import { pinned } from '../brokerPins.js'
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

/** ⭐⭐ (2026-11-18, `strategy-decl` admitted) THE COMMITTED STRATEGIES THE SERVER ADMITS BY CAPABILITY: every capability
 *  each source uses has a conformant registry row (`api/data/pine_runtime_allowlist.json`), `strategy-decl` among them.
 *  ONE LIST: `tests/test_strategy_serve_arming.py::test_the_server_admits_exactly_the_census_list` PARSES it and holds
 *  it to the server's own verdict (`runtime_definitions.capability_admitted`, admission ON) for every committed
 *  strategy, both ways. The other 3 are withheld by capabilities that have no row (a library version, `enum`).
 *  ⭐ (2026-11-19, #2016) `request-other` admitted for closed-bar history: five more (REQUEST_OTHER_ADMITS). */
const SERVER_ADMITS = Object.freeze([
  '72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt',
  'ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48',
  'atr-god-strategy-by-tradesmart__4369755a29',
  'atr-trailing-stoploss-strategy__oayb1wVXkZ',
  'buy-monday-exit-tuesday__8f2f69cc99',
  'flawless-victory-strategy__1BVZuaaWOU',
  'highlow-channel-swing__e3692e253c',
  'inside-bar-strategy-w-sl__b39f395d5d',
  'linear-regression-channel-breakout-strategy__3a1cf28800',
  'macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99',
  'multi-timeframe-rsi-buy-sell-strategy-tradedots__1375ad2640',
  'optimized-keltner-channels-sltp-strategy-for-btc__48bc69cf84',
  'optimized-trend-tracker__ZhWiFvtpwE',
  'pmax-explorer__jN9HBNhynF',
  'rsi-vwap-indicator__pTI5ZVw9n4',
  'scalping-strategy-with-williams-r-macd-and-sma-1-minute-only__e247952471',
  'stop-loss-and-take-profit-in-example__YlblCbts4x',
  'supertrend-strategy__rcRbtoBiKG',
  'take-profit-multi-timeframe__8c16588ae9',
  'tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto__EqnpYOP7hy',
  'tradingview-alerts-to-mt4-mt5-strategy-example__LclqojYSOA',
  'vwap-fibo-dev-extensions-strategy__mR2vfyGjUv',
])

/** ⭐⭐ (2026-11-19, the re-latch after #2016) THE FIVE `request-other` ADMITS AND WHAT A MEMBER GETS, MEASURED in the
 *  production state below (closed newest bar; the same with the server's `historyOnly` latched, on a closed, forming and
 *  unknown newest bar, and the same, row for row and sentence for sentence, as master's latch with the five NOT
 *  admitted). None is served; each is refused BY NAME:
 *    door        the member door refuses the script (nothing drawn, no backtest): the host lane's sentence, the runtime
 *                lane's own reason beside it (`runtimeDeclined`, given here);
 *    no-backtest the host lane draws it and the backtest is refused by name.
 *  Committed captures: multi-timeframe-rsi (SPY) and take-profit (RDDT, SPY) grade INCONCLUSIVE on both lanes (refused
 *  on our side); ai-supertrend and optimized-trend-tracker have none; pmax-explorer's RDDT and SPY captures grade
 *  DIVERGE on both lanes, so its source is KILLED (`pine_runtime_killlist.json`, the DRAW-1 rule, #2016) and the kill
 *  is what its backtest note names; on the host lane only its drawing differs, withheld by name
 *  (`pine:object-ops-refused`; host_divergence: not listed), its Moving Avg Line and PMax plots MATCH. The server's
 *  `capability_admitted` (what `SERVER_ADMITS` latches) admits pmax-explorer by capability; its verdict door answers
 *  "not admitted" for a killed source, and the client's kill check comes first either way. */
const REQUEST_OTHER_ADMITS = Object.freeze({
  // runtime lane: `pine:request` (its request arguments do not fold to one symbol and one servable timeframe)
  'ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48': { at: 'door', guard: 'pine:request' },
  // runtime lane: `lower-tf:store-unmeasured` (a `5` timeframe, below the daily chart's, reads unmeasured intraday bars)
  'multi-timeframe-rsi-buy-sell-strategy-tradedots__1375ad2640': { at: 'door', guard: 'pine:request' },
  // runtime lane: `runtime:call-undeclared-builtin-state`
  'optimized-trend-tracker__ZhWiFvtpwE': { at: 'door', guard: 'pine:function-def' },
  // killed on the runtime lane by source hash; drawn by the host lane, its backtest refused by name (the kill named)
  'pmax-explorer__jN9HBNhynF': { at: 'no-backtest', guard: null, says: /runtime kill list/ },
  // runtime lane: `runtime:strategy-repaint` (a higher-timeframe value in a strategy whose trades the broker computes)
  'take-profit-multi-timeframe__8c16588ae9': { at: 'door', guard: 'pine:request' },
})

/** the server's kill-list read payload, from the committed lists (Railway's variables are not in the repo) */
function productionLists() {
  const allow = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8')).scripts.map((s) => s.sha256)
  const killDoc = JSON.parse(fs.readFileSync(KILLLIST, 'utf8'))
  // ⭐ (2026-11-18) a HELD kill (`status: 'pending'`) kills nothing: the server's ONE rule
  // (`runtime_definitions.kill_entry_is_served`; `tests/test_pine_coverage_ratchet.py` holds this spelling to it)
  const kill = (killDoc.entries || killDoc.scripts || []).filter((e) => typeof e === 'string' || e.status !== 'pending')
    .map((e) => (typeof e === 'string' ? e : e.sha256 || e.id)).filter(Boolean)
  return { kill, allow, capability_admission: true }
}

const scripts = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  .map((f) => ({ key: f.replace(/\.pine$/, ''), source: fs.readFileSync(path.join(CORPUS, f), 'utf8') }))
  .filter((s) => STRATEGY_DECLARATION.test(s.source))

let bars
let dailyBars
let ctx
const results = { granted: [], production: [], grantedDaily: [], grantedInSession: [], grantedUnknown: [] }

function runAll(mode, onBars = bars, onCtx = null) {
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
      // the server's own verdict for this source (railed in Python against `capability_admitted`)
      latchRuntimeAdmission(runtimeSourceHash(s.source), { admitted: SERVER_ADMITS.includes(s.key) })
    }
    out.push({ key: s.key, ...strategyServeOutcome({ source: s.source, bars: onBars, ctx: onCtx || ctx, Panel: StrategyReportPanel }) })
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
  // ⭐ (2026-11-18 live check) the member's chart IN SESSION: the same daily bars, the newest one still forming
  results.grantedInSession = runAll('granted', dailyBars, { ...ctx, newestBarIsForming: true })
  // ⭐ (2026-11-18 post-close check) the chart that LOST the route's flag: the same closed bars, the newest UNKNOWN
  results.grantedUnknown = runAll('granted', dailyBars, { ...ctx, newestBarIsForming: null })
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

  it('production admission (`strategy-decl` admitted): the armed strategies the server admits are served, the rest refused by name', () => {
    const rows = results.production
    expect(thirds(rows)).toEqual([])
    const served = rows.filter((r) => r.state === 'served').map((r) => r.key).sort()
    // all three the granted state serves are admitted by the server, and nothing else is served
    expect(ARMED_COMMITTED.every((k) => SERVER_ADMITS.includes(k))).toBe(true)
    expect(served).toEqual([...ARMED_COMMITTED])
    expect(rows.filter((r) => r.state === 'refused').length).toBe(scripts.length - served.length)
    for (const r of rows.filter((x) => x.state === 'refused')) expect(r.sentence, r.key).toBeTruthy()
    for (const r of rows.filter((x) => x.state === 'served')) {
      expect(r.served.unpinnedServed, r.key).toEqual([])
      expect(r.served.panel.rows, r.key).toBeGreaterThan(0)
    }
    // ⛔ CONTROL: admission is a door, not a pin. A strategy the SERVER ADMITS whose backtest rests on a broker rule no
    // MATCHing capture pins (B-EXIT-NA, not in brokerPins.resolved.json) is still refused BY NAME, by the same guard
    // and rule, at one of two places (engine 76 #1803, engine 77 #1833 fix/strategy-disarmed-taint):
    //   macd-shortlong   its backtest ALONE, at the report: its six MACD plots read no broker value (its ORDER logic
    //                    reads `strategy.position_size`), so they are drawn beside the refused backtest;
    //   stop-loss-and-take-profit   at its run: its three plots all draw broker values (`strategy.position_avg_price`),
    //                    so a stand-in would draw nothing and the broker's refusal stands, as before.
    for (const [k, at] of [['macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99', 'report'],
      ['stop-loss-and-take-profit-in-example__YlblCbts4x', 'run']]) {
      expect(SERVER_ADMITS, k).toContain(k)
      expect(rows.find((r) => r.key === k), k).toMatchObject({ state: 'refused', at, guard: 'runtime:strategy-unpinned', rule: 'B-EXIT-NA' })
    }
    expect(rows.find((r) => r.key === 'macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99').plotsDrawn).toBe(6)
    // ⛔ CONTROL: a strategy the server does NOT admit is never served (3 of 25: a capability with no registry row;
    // 8 until #2016 admitted `request-other`)
    expect(rows.filter((r) => !SERVER_ADMITS.includes(r.key)).map((r) => r.state).filter((s) => s !== 'refused')).toEqual([])
    expect(scripts.length - SERVER_ADMITS.length).toBe(3)
  })

  // ⭐⭐ (2026-11-19, the re-latch after #2016) — THE FIVE `request-other` ADMITS, EACH AT ITS MEASURED PLACE. Admitted by
  // the server, none is served: each is refused by name where it was measured (REQUEST_OTHER_ADMITS). A verdict that
  // moves (an engine change draws one on the runtime lane, a kill lifted) turns this red by name: re-measure it.
  it('production admission: the five strategies `request-other` admits are each refused by name, where measured', () => {
    const rows = results.production
    const keys = Object.keys(REQUEST_OTHER_ADMITS)
    expect(keys.length).toBe(5)
    for (const k of keys) {
      const want = REQUEST_OTHER_ADMITS[k]
      expect(SERVER_ADMITS, k).toContain(k)
      const r = rows.find((x) => x.key === k)
      expect(r, k).toMatchObject({ state: 'refused', at: want.at, guard: want.guard })
      expect(r.sentence, k).toBeTruthy()
      if (want.says) expect(r.sentence, k).toMatch(want.says)
    }
  })

  // ⭐⭐ (2026-11-17, strategy-epoch-bar-times) — THE MEMBER'S BAR SHAPE. A member's daily chart hands the run
  // `/api/bars`'s ISO date keys, not the capture's epoch seconds above; until a broker run was handed each bar's
  // opening instant (`runtimeColumns.js::brokerBarTimes`) every strategy that traded lost its report there (2 of these
  // 25 served, both with no trade). The same census on that shape now answers exactly as on epoch seconds.
  // ⭐⭐ (2026-11-18, the production live check) — THE MEMBER'S CHART IN SESSION. The census above measures charts whose
  // newest bar is CLOSED; for most of the trading day a member's newest daily bar is FORMING, and a default strategy
  // executes once per closed bar ([B-EXEC], `vm.js`: the broker run then leaves the forming bar out). That rule is a
  // pin like any other (capture row Q-S1p, `brokerRules.js`): unpinned, every backtest on an in-session chart is
  // refused by name at its report (the plots stay, `disarmedAfter`). ⚰️ The census measured only closed charts and
  // counted supertrend-strategy SERVED while production refused it at 19:59Z. The expectation is DERIVED from the
  // ledger production reads (`brokerPins.js::pinned`), so the day a capture pins B-EXEC this rail expects the armed
  // strategies served in session too, without an edit.
  it('the member\'s IN-SESSION chart (newest daily bar forming): served exactly when [B-EXEC] is pinned, else refused by name', () => {
    const rows = results.grantedInSession
    expect(thirds(rows)).toEqual([])
    const execPinned = pinned('B-EXEC')
    const served = rows.filter((r) => r.state === 'served').map((r) => r.key).sort()
    expect(served).toEqual(execPinned ? [...ARMED_COMMITTED] : [])
    if (!execPinned) {
      // by name, the rule named: at the report when its plots stand in (supertrend-strategy's seven), at its run when
      // it draws nothing a stand-in could keep (buy-monday-exit-tuesday places orders only)
      for (const k of ARMED_COMMITTED) {
        const r = rows.find((x) => x.key === k)
        expect(r, k).toMatchObject({ state: 'refused', guard: 'runtime:strategy-unpinned', rule: 'B-EXEC' })
        expect(['report', 'run'], k).toContain(r.at)
      }
      expect(rows.find((x) => x.key === 'supertrend-strategy__rcRbtoBiKG')).toMatchObject({ at: 'report' })
    }
    // ⭐ NOTHING TAKEN AWAY (owner rule): in session every strategy draws exactly the plots it draws on the closed chart,
    // whether its backtest is served there or refused by name with its plots kept
    for (const r of rows) {
      expect(r.plotsDrawn, r.key).toBe(results.grantedDaily.find((x) => x.key === r.key).plotsDrawn)
    }
    // CONTROL: the same bars CLOSED serve them, so the forming bar alone moves them
    expect(results.grantedDaily.filter((r) => r.state === 'served').map((r) => r.key).sort()).toEqual([...ARMED_COMMITTED])
  })

  // ⭐⭐ (2026-11-18, the post-close production check) — AFTER THE CLOSE THE REPORT IS AS OF THE NEWEST BAR. The route
  // says the newest daily bar is closed (`newest_bar_is_forming: false` from 21:00Z); a chart that hands its run that
  // flag gets a backtest as of that bar. A chart that LOST it hands "unknown", and a run fails closed: it reads the
  // newest bar as forming and leaves it out. Before engine 80 that was a refusal by name ([B-EXEC], the 22:05Z check
  // on RDDT 1D); from engine 80 it is a backtest ONE BAR STALE, served in silence. The as-of is what tells them
  // apart, so it is held here: the closed chart's report is as of its newest bar, and the unknown chart's is the bar
  // before it (the stale picture the chart must never keep once the flag lands: `binderFormingFlagLands.test.js`).
  it('after the close the report is as of the NEWEST bar; a chart that lost the flag is one bar stale', () => {
    const newest = dailyBars[dailyBars.length - 1].t
    const before = dailyBars[dailyBars.length - 2].t
    const asDay = (t) => (typeof t === 'string' ? t.slice(0, 10) : new Date(t * 1000).toISOString().slice(0, 10))
    const closed = results.grantedDaily.filter((r) => r.state === 'served')
    expect(closed.map((r) => r.key).sort()).toEqual([...ARMED_COMMITTED])
    for (const r of closed) expect(asDay(r.asOf), r.key).toBe(asDay(newest))
    const unknown = results.grantedUnknown
    expect(thirds(unknown)).toEqual([])
    for (const k of ARMED_COMMITTED) {
      const r = unknown.find((x) => x.key === k)
      // served exactly when [B-EXEC] is pinned (as in session), and then one bar stale
      if (pinned('B-EXEC')) {
        expect(r.state, k).toBe('served')
        expect(asDay(r.asOf), k).toBe(asDay(before))
      } else {
        expect(r, k).toMatchObject({ state: 'refused', guard: 'runtime:strategy-unpinned', rule: 'B-EXEC' })
      }
    }
  })

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
