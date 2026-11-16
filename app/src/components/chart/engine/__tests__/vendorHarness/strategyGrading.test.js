// app/src/components/chart/engine/__tests__/vendorHarness/strategyGrading.test.js
//
// ─── U14: THE GRADING PLUMBING, RAILED ON A REAL CAPTURE ─────────────────────────
//
// The capture is `tests/fixtures/vendor/harness/s1-broker-core-rddt-1d-2026-11-15.json`: run
// s25-2026-11-15, our committed probe `tools/visual_conformance/probes/s1-broker-core.pine`
// (capture row Q-S1-core) on NYSE:RDDT 1D from the listing, with TradingView's Strategy Tester
// report (`_reportData`, 47 closed trades, 89 fills). Every number asserted below was read off
// that file; every perturbation is a copy of it.
//
// ⛔ THE VERDICT FILE IS KEPT CURRENT HERE. `docs/pine/vendor-harness/strategy-verdicts/<id>.json`
// is what `evidence_engine.py pins` resolves the ledger from. This file re-grades the capture at
// TODAY'S engine and asserts the committed verdict is exactly that grade, so an engine change that
// moves the verdict goes red here before a stale MATCH can keep a pin.
//   UPDATE_STRATEGY_VERDICTS=1 rewrites it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { REPO, HARNESS_DIR } from './harness'
import { gradeStrategyCapture, strategyVerdictOf, runOurBroker, oursOf, STRATEGY_VERDICT_SCHEMA } from './strategyHarness.js'
import {
  referenceOfReport, referenceOfCapture, PROPERTY_DEPENDENTS, REPORT_UNITS, unreadDependedOn, effectiveSettingsDisagreements,
} from '../../../../../../../tools/vendor_harness/strategy_reference.mjs'
import { PROPERTY_TABLE, extractReportFields, REPORT_SLOTS } from '../../../../../../../tools/vendor_harness/strategy_capture.mjs'
import { STRATEGY_FLOOR } from '../../../../../../../tools/vendor_harness/compare.mjs'

const ID = 's1-broker-core-rddt-1d-2026-11-15'
const CAPTURE_FILE = path.join(HARNESS_DIR, `${ID}.json`)
const VERDICT_DIR = path.join(REPO, 'docs/pine/vendor-harness/strategy-verdicts')
const SLOT_MAP = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/vendor_harness/strategy_report_slots.json'), 'utf8'))
const BYTES = fs.readFileSync(CAPTURE_FILE)
const CAPTURE = JSON.parse(BYTES.toString('utf8'))
const TREE = CAPTURE.provenance.report.tree
const clone = (x) => JSON.parse(JSON.stringify(x))
/** sha256 over the file's LF form (an autocrlf checkout hashes the same) */
const captureSha = (b) => crypto.createHash('sha256').update(Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex')

describe('U14 (a) the adapter: report trades -> the grade reference (s25)', () => {
  const ref = referenceOfReport(TREE)

  it('reads every trade and every fill', () => {
    expect(ref.ok).toBe(true)
    expect(ref.trades).toHaveLength(47)
    expect(ref.fills).toHaveLength(89)
    expect(ref.openTrades).toBe(0)
  })

  it('maps e -> entry and x -> exit, ms -> s, for EVERY trade (the swap mutant goes red here)', () => {
    for (const [i, t] of ref.trades.entries()) {
      const raw = TREE.trades[i]
      expect(t.entryTime * 1000).toBe(raw.e.tm)
      expect(t.exitTime * 1000).toBe(raw.x.tm)
      expect(t.entryPrice).toBe(raw.e.p)
      expect(t.exitPrice).toBe(raw.x.p)
      expect(t.entryLabel).toBe(raw.e.c)
      expect(t.exitLabel).toBe(raw.x.c)
      expect(t.open).toBe(false)
      expect(t.qty).toBe(raw.q)
      expect(t.profit).toBe(raw.tp.v)
      expect(t.direction).toBe(raw.e.tp === 'le' ? 'long' : 'short')
      expect(t.exitTime).toBeGreaterThanOrEqual(t.entryTime)
    }
    // the first trade, by hand from the file: L @ 45.47 on bar 27 (2024-04-30 13:30 UTC) -> XL @ 55 on bar 33
    expect(ref.trades[0]).toMatchObject({ n: 1, direction: 'long', entryLabel: 'L', exitLabel: 'XL', entryTime: 1714483800,
      exitTime: 1715175000, entryPrice: 45.47, exitPrice: 55, entryBar: 27, exitBar: 33, qty: 3, profit: 28.59 })
    // and its entry precedes its exit in the BARS too: a swapped adapter puts 33 first
    expect(ref.trades[0].entryBar).toBeLessThan(ref.trades[0].exitBar)
    // both directions occur, so a direction table that answered one constant would go red
    expect(new Set(ref.trades.map((t) => t.direction))).toEqual(new Set(['long', 'short']))
  })

  it('places every fill on a bar time: on s25, ordinal k is the k-th distinct trade event bar', () => {
    expect(ref.fillsTimed).toBe(true)
    expect(ref.fillsReason).toBeNull()
    const times = [...new Set(ref.trades.flatMap((t) => [t.entryTime, t.exitTime]))].sort((a, b) => a - b)
    expect(times).toHaveLength(82)
    for (const f of ref.fills) expect(f.time).toBe(times[f.ordinal])
    expect(ref.fills[0]).toMatchObject({ ordinal: 0, id: 'L', side: 'buy', role: 'entry', price: 45.47, qty: 3, type: 'MARKET', time: 1714483800 })
    // a close-all is logged ONCE for two trades (qty 6); a bracket once PER trade (two of 3)
    expect(ref.fills.filter((f) => f.ordinal === 2).map((f) => [f.id, f.qty])).toEqual([['XL', 3], ['XL', 3]])
    expect(ref.fills.find((f) => f.ordinal === 16)).toMatchObject({ id: 'Close position order', role: 'exit', qty: 6 })
  })

  it.each([
    ['an entry time that is not whole-second ms', (t) => { t.trades[3].e.tm += 1 }, /trades\[3\]\.e\.tm/],
    ['an exit that closes the other direction', (t) => { t.trades[0].x.tp = 'sx' }, /does not close a long trade/],
    ['an unknown entry code', (t) => { t.trades[0].e.tp = 'lx' }, /is not le \| se/],
    ['a missing profit', (t) => { delete t.trades[5].tp }, /trades\[5\]\.tp\.v/],
    ['an exit before its entry', (t) => { t.trades[1].x.tm = t.trades[1].e.tm - 86_400_000 }, /exits before it enters/],
    ['a fill of an unknown type', (t) => { t.filledOrders[0].tp = 'TRAILING' }, /filledOrders\[0\]\.tp/],
    ['a fill whose e is not true / false / null', (t) => { t.filledOrders[0].e = 'yes' }, /filledOrders\[0\]\.e must be/],
    ['no fill list', (t) => { delete t.filledOrders }, /no filledOrders list/],
  ])('⛔ %s refuses the WHOLE reference by name', (_n, mutate, rx) => {
    const t = clone(TREE)
    mutate(t)
    const r = referenceOfReport(t)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(rx)
  })

  it('⛔ fills that cannot be placed in time are UNTIMED, named (a fill no trade explains; a bar no fill reaches)', () => {
    const stray = clone(TREE)
    stray.filledOrders[10].p += 0.01
    const r = referenceOfReport(stray)
    expect(r).toMatchObject({ ok: true, fillsTimed: false })
    expect(r.fills.every((f) => f.time === null)).toBe(true)
    expect(r.fillsReason).toMatch(/^fill ordinal \d+ \(sell 3 @ \d+\.\d+\) is no trade event at bar time \d+/)
    const missing = clone(TREE)
    missing.filledOrders = missing.filledOrders.filter((f) => f.tm !== 81)
    expect(referenceOfReport(missing).fillsReason).toMatch(/reach 81 of the trades' 82 event bar/)
    const late = clone(TREE)
    late.filledOrders.push({ ...late.filledOrders[0], tm: 99 })
    expect(referenceOfReport(late).fillsTimed).toBe(false)
  })

  it('⛔ an OPEN trade is listed last with an empty exit text: it is marked open, and only those are', () => {
    const t = clone(TREE)
    t.performance.all.totalOpenTrades = 1
    const last = t.trades[t.trades.length - 1]
    // the last listed trade of s25 is closed by XS: as an "open" trade its exit text must be ""
    expect(referenceOfReport(t)).toMatchObject({ ok: false, reason: expect.stringMatching(/exit text is "XS", not ""/) })
    last.x.c = ''
    const r = referenceOfReport(t)
    expect(r.ok).toBe(true)
    expect(r.trades.filter((x) => x.open).map((x) => x.n)).toEqual([47])
    expect(r.trades[46]).toMatchObject({ exitTime: null, exitPrice: null, profit: null })
    const bad = clone(TREE)
    bad.performance.all.totalOpenTrades = 48
    expect(referenceOfReport(bad).reason).toMatch(/is not a count of the listed trades/)
  })

  it('a capture whose report is not ok has no reference', () => {
    const c = clone(CAPTURE)
    c.provenance.report = { status: 'partial', reason: 'x' }
    expect(referenceOfCapture(c)).toEqual({ ok: false, reason: 'strategy-reference: the report is partial' })
  })
})

describe('U14 the report slot map, read off the committed capture (W9-C0)', () => {
  const f = extractReportFields(TREE, SLOT_MAP.slots)

  it('every slot resolves to a finite number in the captured tree', () => {
    expect(SLOT_MAP.capturedFrom).toBe(ID)
    expect(Object.keys(f)).toEqual([...REPORT_SLOTS])
    for (const [slot, v] of Object.entries(f)) expect(v.status, slot).toBe('ok')
  })

  it('the values are the tree\'s own, with the measured units (fractions; losses as positive magnitudes)', () => {
    expect(f.totalClosedTrades.value).toBe(47)
    expect(f.numberWinningTrades.value + f.numberLosingTrades.value).toBe(47)
    expect(f.netProfit.value).toBeCloseTo(f.grossProfit.value - f.grossLoss.value, 9)
    expect(f.percentProfitable.value).toBeCloseTo(21 / 47, 12)
    expect(REPORT_UNITS.percentProfitable).toBe('fraction')
    for (const k of ['grossLoss', 'avgLosingTrade', 'largestLosingTrade']) {
      expect(REPORT_UNITS[k]).toBe('positive-magnitude')
      expect(f[k].value).toBeGreaterThan(0)
    }
    expect(f.profitFactor.value).toBeCloseTo(f.grossProfit.value / f.grossLoss.value, 12)
  })
})

describe('U14 what each Properties input is depended on by', () => {
  it('every Properties key has a dependents entry, and only those', () => {
    expect(Object.keys(PROPERTY_DEPENDENTS).sort()).toEqual(PROPERTY_TABLE.map((p) => p.key).sort())
  })
  it('effective settings: pyramiding 0 and 1 are one setting (TradingView reads the v4 default as 1); 2 is not; cash = cash_per_order', () => {
    expect(effectiveSettingsDisagreements({ pyramiding: { value: 1 } }, { pyramiding: 0 })).toEqual([])
    expect(effectiveSettingsDisagreements({ pyramiding: { value: 2 } }, { pyramiding: 0 })).toEqual([{ key: 'pyramiding', ours: 0, readBack: 2 }])
    expect(effectiveSettingsDisagreements({ margin_long: { value: 0 } }, { margin_long: 100 })).toEqual([{ key: 'margin_long', ours: 100, readBack: 0 }])
    expect(effectiveSettingsDisagreements({ default_qty_type: { value: 'cash_per_order' } }, { default_qty: { type: 'cash', value: 1 } })).toEqual([])
  })
  it('a fill-moving input always matters; risk_free_rate only when a Sharpe / Sortino slot is read', () => {
    expect(unreadDependedOn(['property:process_orders_on_close'], [])).toEqual(['property:process_orders_on_close'])
    expect(unreadDependedOn(['property:risk_free_rate'], ['B-MARKET', 'report:netProfit'])).toEqual([])
    expect(unreadDependedOn(['property:risk_free_rate'], ['report:sharpeRatio'])).toEqual(['property:risk_free_rate'])
    expect(unreadDependedOn(['property:not_a_key'], [])).toEqual(['property:not_a_key'])
    expect(unreadDependedOn(['chartData:dividendAdjustment'], [])).toEqual([])
  })
})

// ─── (c) every committed strategy capture with a report: its verdict file, kept current ─────
//
// The capture row each committed report capture answers (the run manifests' units: s25 U14-Q-S1-core,
// s26 U14-<row>). A committed strategy capture WITH a report that is not here fails the first rail,
// so a capture cannot land without its verdict.
const STRATEGY_CAPTURE_ROWS = Object.freeze({
  's1-broker-core-rddt-1d-2026-11-15': 'Q-S1-core',
  'w9-q-s1p-when-rddt-1d-2026-11-15': 'Q-S1p',
  'w9-q-s1a-size-v5cash-rddt-1d-2026-11-15': 'Q-S1a',
  'w9-q-s1a-size-v5pct-rddt-1d-2026-11-15': 'Q-S1a',
  'w9-q-s1a-size-v6-rddt-1d-2026-11-15': 'Q-S1a',
  'w9-q-s1b-defaults-v5-rddt-1d-2026-11-15': 'Q-S1b',
  'w9-q-s1b-defaults-v6-rddt-1d-2026-11-15': 'Q-S1b',
  'w9-q-s1e-live-past-rddt-1d-2026-11-15': 'Q-S1e',
  'w9-q-s1j-stop-limit-rddt-1d-2026-11-15': 'Q-S1j',
  'w9-q-s1k-exit-levels-rddt-1d-2026-11-15': 'Q-S1k',
  'w9-q-s1k-exit-levels-v6-rddt-1d-2026-11-15': 'Q-S1k',
  'w9-x1-trail-rddt-1d-2026-11-15': 'W9-X1',
  'w9-x2-partial-rddt-1d-2026-11-15': 'W9-X2',
  'w9-x3-oca-rddt-1d-2026-11-15': 'W9-X3',
  'w9-x4-order-rddt-1d-2026-11-15': 'W9-X4',
  'w9-x5-cancel-rddt-1d-2026-11-15': 'W9-X5',
  'w9-k1-commission-pct-rddt-1d-2026-11-15': 'W9-K1',
  'w9-k2-commission-contract-rddt-1d-2026-11-15': 'W9-K2',
  'w9-k3-commission-order-rddt-1d-2026-11-15': 'W9-K3',
  'w9-k4-slippage-rddt-1d-2026-11-15': 'W9-K4',
  'w9-p1-on-close-rddt-1d-2026-11-15': 'W9-P1',
  'w9-p1b-on-close-fills-rddt-1d-2026-11-15': 'W9-P1b',
  'w9-p1b-on-close-fills-nv-rddt-1d-2026-11-15': 'W9-P1b',
  'w9-p2-order-fills-rddt-1d-2026-11-15': 'W9-P2',
  'w9-p2-order-fills-nv-rddt-1d-2026-11-15': 'W9-P2',
  'w9-p3-every-tick-history-rddt-1d-2026-11-15': 'W9-P3',
  'w9-r1-risk-allow-rddt-1d-2026-11-15': 'W9-R1',
  'w9-r1-risk-ddown-rddt-1d-2026-11-15': 'W9-R1',
  // re-verified after U14 G1 (the v2 / v4 Properties sets): s26 payloads clip-2 / 3 / 7, s27 clip-1
  'w9-q-s1a-size-v2-rddt-1d-2026-11-15': 'Q-S1a',
  'w9-q-s1a-size-v4-rddt-1d-2026-11-15': 'Q-S1a',
  'w9-q-s1b-defaults-v4-rddt-1d-2026-11-15': 'Q-S1b',
  'w9-g1-v3-properties-rddt-1d-2026-11-15': 'W9-G1',
  // s27, method (b) on AMEX:SPY 15
  'w9-r1-risk-intraday-range-spy-15-2026-11-15': 'W9-R1i',
})

function committedReportCaptures() {
  const out = []
  for (const f of fs.readdirSync(HARNESS_DIR)) {
    if (!f.endsWith('.json')) continue
    let c
    try { c = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, f), 'utf8')) } catch { continue }
    const r = c && c.provenance && c.provenance.report
    if (c && c.study && /^StrategyScript\$/.test(String(c.study.id || '')) && r && r.status === 'ok') out.push(c.id)
  }
  return out.sort()
}

describe('U14 (c) every committed report capture carries a current verdict file', () => {
  it('the committed report captures are exactly the rows table, and every verdict file is one of them', () => {
    expect(committedReportCaptures()).toEqual(Object.keys(STRATEGY_CAPTURE_ROWS).sort())
    if (process.env.UPDATE_STRATEGY_VERDICTS === '1') return
    const files = fs.existsSync(VERDICT_DIR) ? fs.readdirSync(VERDICT_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : []
    expect(files).toEqual(Object.keys(STRATEGY_CAPTURE_ROWS).sort())
  })

  const table = []
  it.each(Object.entries(STRATEGY_CAPTURE_ROWS))('%s (%s): the committed verdict is exactly today\'s grade', (id, row) => {
    const bytes = fs.readFileSync(path.join(HARNESS_DIR, `${id}.json`))
    const capture = JSON.parse(bytes.toString('utf8'))
    const now = strategyVerdictOf(capture, { captureSha256: captureSha(bytes), queueTargetId: row, slotMap: SLOT_MAP })
    expect(now.schema).toBe(STRATEGY_VERDICT_SCHEMA)
    expect(JSON.stringify(now)).not.toContain(capture.source.text.slice(0, 60)) // the source never enters it
    table.push(`${now.verdict.padEnd(16)} step ${now.step} ${id} (${row}): ${now.reason}${now.first ? ` first ${JSON.stringify(now.first)}` : ''} | fills ${now.graded.fills} slots ${now.graded.slots} | exercised ${now.rulesExercised.join(',')}`)
    const text = JSON.stringify(now, null, 1) + '\n'
    const out = path.join(VERDICT_DIR, `${id}.json`)
    if (process.env.UPDATE_STRATEGY_VERDICTS === '1') {
      fs.mkdirSync(VERDICT_DIR, { recursive: true })
      fs.writeFileSync(out, text)
    }
    expect(fs.existsSync(out), `no verdict file for ${id} (UPDATE_STRATEGY_VERDICTS=1 writes it)`).toBe(true)
    expect(fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n')).toBe(text)
  })
  it('(the verdict table, printed with STRATEGY_VERDICT_TABLE=1)', () => {
    if (process.env.STRATEGY_VERDICT_TABLE === '1') console.log(`\n${table.join('\n')}\n`)
  })
})

// ─── (b) the harness: our broker on the capture, graded ──────────────────────────
const S25 = gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP })

/** A run of OURS that answers exactly what TradingView reported, built from the capture's own report (the
 *  record shape `oursOf` reads). It makes the harness's later steps testable on REAL data while our broker
 *  refuses this probe at build: graded against it, s25 must MATCH, and every perturbation below must not. */
function mirrorRun(capture, { mutateFills = null } = {}) {
  const ref = referenceOfCapture(capture)
  const fills = ref.fills.map((f) => ({ ...f }))
  if (mutateFills) mutateFills(fills)
  return () => ({
    ok: true,
    record: {
      settings: { initial_capital: 100000, pyramiding: 2, margin_long: 0, margin_short: 0, process_orders_on_close: false,
        calc_on_order_fills: false, calc_on_every_tick: false, slippage: 0, commission: { type: 'percent', value: 0 }, default_qty: null },
      rulesUsed: ['B-MARKET'],
      trades: ref.trades.filter((t) => !t.open).map((t) => ({ n: t.n, dir: t.direction, entryTime: t.entryTime, exitTime: t.exitTime,
        entryPrice: t.entryPrice, exitPrice: t.exitPrice, qty: t.qty, entryRule: 'B-MARKET', open: false })),
      orders: fills.map((f) => ({ status: 'filled', fillTime: f.time, side: f.side, kind: f.role, opened: [], closed: [],
        fillPrice: f.price, fillQty: f.qty, id: f.id, rule: 'B-MARKET' })),
    },
    report: { metrics: {}, trades: { rows: ref.trades.map((t) => ({ n: t.n, profit: { status: 'served', value: t.profit } })) } },
    signals: {},
  })
}

describe('U14 (b) our broker on s25, graded fill by fill', () => {
  it('today our broker refuses the probe at BUILD, so s25 is DIVERGE at step 1 and exercises nothing', () => {
    // ⭐ a refusal against a TradingView value is a DIVERGE (design T2 step 1); the verdict file pins it
    expect(S25).toMatchObject({ verdict: 'DIVERGE', step: 1, referenceTrades: 47, rulesExercised: [] })
    expect(S25.rule).toBe('runtime:call-undeclared-builtin-state')
  })

  it('CONTROL: a run that answers exactly TradingView\'s trades and fills MATCHes, fill by fill', () => {
    const g = gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) })
    expect(g).toMatchObject({ verdict: 'MATCH', step: 6, graded: { trades: true, fills: true, slots: 0 } })
    expect(g.rulesExercised).toEqual(['B-MARKET'])
  })

  it.each([
    ['a quantity', (f) => { f[0].qty += 1 }],
    ['a price a tick off', (f) => { f[5].price = Math.round((f[5].price + 0.01) * 100) / 100 }],
    ['a side', (f) => { f[3].side = f[3].side === 'buy' ? 'sell' : 'buy' }],
    ['an id', (f) => { f[0].id = 'NOT-L' }],
    ['a dropped fill', (f) => { f.splice(7, 1) }],
  ])('⛔ the same trades with %s differing in the fills is DIVERGE at step 5 (the grade reads fills)', (_n, mutateFills) => {
    expect(gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE, { mutateFills }) }))
      .toMatchObject({ verdict: 'DIVERGE', step: 5 })
  })

  it('⛔ the floor reads TradingView alone: s25 cut to 4 trades is UNGRADABLE and our broker never runs', () => {
    const c = clone(CAPTURE)
    c.provenance.report.tree.trades = c.provenance.report.tree.trades.slice(0, STRATEGY_FLOOR - 1)
    let runs = 0
    const g = gradeStrategyCapture(c, { slotMap: SLOT_MAP, run: (x) => { runs += 1; return runOurBroker(x) } })
    expect(g).toMatchObject({ verdict: 'UNGRADABLE', step: 0 })
    expect(runs).toBe(0)
    // control: at the floor exactly, the grade runs our broker
    const at = clone(CAPTURE)
    at.provenance.report.tree.trades = at.provenance.report.tree.trades.slice(0, STRATEGY_FLOOR)
    gradeStrategyCapture(at, { slotMap: SLOT_MAP, run: (x) => { runs += 1; return runOurBroker(x) } })
    expect(runs).toBe(1)
  })

  it('⛔ a read-back that disagrees with the declaration is INCONCLUSIVE, never a pass', () => {
    const c = clone(CAPTURE)
    c.provenance.strategySettings.properties.find((p) => p.name === 'pyramiding').value = 3
    expect(gradeStrategyCapture(c, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) })).toMatchObject({ verdict: 'INCONCLUSIVE', step: 2 })
  })

  it('⛔ a read-back that disagrees with what OUR run used (an undeclared default) is INCONCLUSIVE', () => {
    const c = clone(CAPTURE)
    c.provenance.strategySettings.properties.find((p) => p.name === 'Commission Value').value = 0.1
    const g = gradeStrategyCapture(c, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) })
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 2 })
    expect(g.reason).toMatch(/commission_value/)
  })

  it('⛔ an unread input a rule depends on is INCONCLUSIVE; one only an unserved slot reads is not', () => {
    const c = clone(CAPTURE)
    c.provenance.strategySettings.properties = c.provenance.strategySettings.properties.filter((p) => p.name !== 'Process orders on bar Close')
    const g = gradeStrategyCapture(c, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) })
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 2 })
    expect(g.reason).toMatch(/property:process_orders_on_close/)
    // control: risk_free_rate moves only Sharpe / Sortino, which the run's report does not serve
    const r = clone(CAPTURE)
    r.provenance.strategySettings.properties = r.provenance.strategySettings.properties.filter((p) => p.name !== 'risk_free_rate')
    expect(gradeStrategyCapture(r, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) }).verdict).toBe('MATCH')
  })

  it('⛔ fills that cannot be placed in time are INCONCLUSIVE at step 5, never skipped', () => {
    const c = clone(CAPTURE)
    c.provenance.report.tree.filledOrders[10].p += 0.01
    expect(gradeStrategyCapture(c, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) })).toMatchObject({ verdict: 'INCONCLUSIVE', step: 5 })
  })
})
