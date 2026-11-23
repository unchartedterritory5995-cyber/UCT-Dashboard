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
import {
  gradeStrategyCapture, strategyVerdictOf, runOurBroker, oursOf, STRATEGY_VERDICT_SCHEMA, declaredSlots, captureSlotsOf, valueSeriesOf,
  referenceTextsOf, engineSlotCallsOf, TV_SLOT_TYPE,
} from './strategyHarness.js'
import { RUNTIME_OUTPUT_CALLS } from '../../ast/pineRuntimeFrontend.js'
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
  // capture night 2026-11-16, closed bar, method (a) with the Strategy Tester report: the S1 shapes and
  // W9-D1 / W9-V-D11 / W9-MK1 re-taken under their own ids (-rpt: the morning captures, forming bar and
  // no report, are committed and evidence is appended, never replaced), W9-MK1 (run ac5), Q-S1i (ac8)
  'vw-s1-q-s1d-close-reverse-rpt-rddt-1d-2026-11-16': 'Q-S1d',
  'vw-s1-q-s1d-two-entries-rpt-rddt-1d-2026-11-16': 'Q-S1d',
  'vw-s1-q-s1d-two-stops-rpt-rddt-1d-2026-11-16': 'Q-S1d',
  'vw-s1-q-s1e-stop-past-rpt-rddt-1d-2026-11-16': 'Q-S1e',
  'vw-s1-q-s1g-blocked-stop-entry-rpt-rddt-1d-2026-11-16': 'Q-S1g',
  'vw-s1-q-s1h-fifo-exit-rpt-rddt-1d-2026-11-16': 'Q-S1h',
  'vw-s1-q-s1j-stop-limit-rpt-rddt-1d-2026-11-16': 'Q-S1j',
  'vw-s1-q-s1k-fractional-profit-rpt-rddt-1d-2026-11-16': 'Q-S1k',
  'vw-s1-q-s1k-na-modify-rpt-rddt-1d-2026-11-16': 'Q-S1k',
  'vw-s1-q-s1k-profit-and-limit-rpt-rddt-1d-2026-11-16': 'Q-S1k',
  'w9-d1-margin50-rpt-rddt-1d-2026-11-16': 'W9-D1',
  'w9-d11-late-first-use-rpt-rddt-1d-2026-11-16': 'W9-V-D11',
  'w9-mk1-markers-rddt-1d-2026-11-16': 'W9-MK1',
  'w9-mk1-markers-rpt-rddt-1d-2026-11-16': 'W9-MK1',
  'w9-q-s1i-short-v6-rddt-1d-2026-11-16': 'Q-S1i',
  // 2026-11-17 (the e73 filing): the run manifests' rows (capture-queue-2026-11-17-strategy-decl, -2026-11-05-w9)
  'w9-q-s1a-size-stop-v6-rddt-1d-2026-11-17': 'Q-S1a',
  'w9-q-s1b-v4-shape-a-rddt-1d-2026-11-17': 'Q-S1b',
  'w9-q-s1b-v4-shape-b-rddt-1d-2026-11-17': 'Q-S1b',
  'w9-q-s1i-funds-rddt-1d-2026-11-17': 'Q-S1i',
  // the community strategy (supertrend-strategy, corpus/committed, MPL-2.0), held out of the e73 filing while step 7
  // could not pair a source's bound plots (#1770), re-filed at the engine that draws its fill anchor (#1788)
  'supertrend-strategy-rddt-1d-2026-11-17': 'Q-SD1',
  'supertrend-strategy-alab-1d-2026-11-17': 'Q-SD2',
  // 2026-11-18 (run qs1p-is-2026-11-18, packet d64e34c28819): the two community strategies captured IN SESSION, the
  // newest daily bar forming, with their Strategy Tester reports: [B-EXEC], a strategy executes once per closed bar
  'supertrend-strategy-is-rddt-1d-2026-11-18': 'Q-S1p',
  'macd-shortlong-strategy-is-rddt-1d-2026-11-18': 'Q-S1p',
  // 2026-11-20 (PR #2146, the rig run): the community strategy on a DEEP daily chart, scrolled back to the listing,
  // with its Strategy Tester report (`settings.dateRange.backtest.from` = the listing): where TradingView starts a
  // backtest deeper than the shared window, [B-START-DEEP] (docs/pine/capture-queue-2026-11-19-strategy-unit.md, A)
  'supertrend-strategy-deep-spy-1d-2026-11-19': 'Q-SU-7',
  'supertrend-strategy-deep-aapl-1d-2026-11-19': 'Q-SU-8',
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
    table.push(`${now.verdict.padEnd(16)} step ${now.step} ${id} (${row}): ${now.reason}${now.first ? ` first ${JSON.stringify(now.first)}` : ''} | fills ${now.graded.fills} slots ${now.graded.slots} values ${now.graded.values} texts ${now.graded.texts}${now.ungradedTexts.length ? ` UNGRADED TEXTS ${JSON.stringify(now.ungradedTexts)}` : ''} | exercised ${now.rulesExercised.join(',')}`)
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
function mirrorRun(capture, { mutateFills = null, mutatePlots = null, mutateLabels = null, drawn = null, settings = null, ruleFirstTime = null, rulesUsed = null } = {}) {
  const ref = referenceOfCapture(capture)
  const fills = ref.fills.map((f) => ({ ...f }))
  if (mutateFills) mutateFills(fills)
  // TradingView's own plots, in the capture's order, and its own label texts: what a perfect run of ours emits
  // (every slot of s25 and of the SPY 15 capture is a `plot`; `mutatePlots` is handed the point lists)
  const pv = capture.plotValues
  const points = pv.fields.slice(1).map((_, k) => pv.rows.map((r) => ({ time: r[0], value: r[k + 1] === undefined ? null : r[k + 1] })))
  if (mutatePlots) mutatePlots(points)
  const plots = points.map((p) => ({ kind: 'plot', points: p }))
  const labels = referenceTextsOf(capture).labels.map((l) => ({ ...l }))
  if (mutateLabels) mutateLabels(labels)
  return () => ({
    ok: true,
    plots,
    drawn: drawn || { status: 'ok', labels },
    ...(ruleFirstTime ? { ruleFirstTime } : {}),
    record: {
      symbol: { mintick: 0.01, pointvalue: 1 },
      settings: settings || { initial_capital: 100000, pyramiding: 2, margin_long: 0, margin_short: 0, process_orders_on_close: false,
        calc_on_order_fills: false, calc_on_every_tick: false, slippage: 0, commission: { type: 'percent', value: 0 }, default_qty: null },
      rulesUsed: rulesUsed || ['B-MARKET'],
      trades: ref.trades.filter((t) => !t.open).map((t) => ({ n: t.n, dir: t.direction, entryTime: t.entryTime, exitTime: t.exitTime,
        entryPrice: t.entryPrice, exitPrice: t.exitPrice, qty: t.qty, entryRule: 'B-MARKET', open: false })),
      orders: fills.map((f) => ({ status: 'filled', fillTime: f.time, side: f.side, kind: f.role, opened: [], closed: [],
        fillPrice: f.price, fillQty: f.qty, id: f.id, rule: 'B-MARKET' })),
    },
    report: { metrics: {}, trades: { rows: ref.trades.map((t) => ({ n: t.n, profit: { status: 'served', value: t.profit } })) } },
  })
}

describe('U14 (b) our broker on s25, graded fill by fill', () => {
  it('today our broker builds the probe and stops at RUN by name (two orders on one opening tick, Q-S1d): DIVERGE at step 1', () => {
    // ⭐ a refusal against a TradingView value is a DIVERGE (design T2 step 1); the verdict file pins it.
    // ⚰️ Before the value read-backs unit it refused at BUILD (`runtime:call-undeclared-builtin-state`, the value
    // build's `math.round_to_mintick`): the build that draws, the member door's own for this script, serves it.
    expect(S25).toMatchObject({ verdict: 'DIVERGE', step: 1, referenceTrades: 47, rulesExercised: [] })
    expect(S25.rule).toBe('runtime:strategy-unsettled')
  })

  it('CONTROL: a run that answers exactly TradingView\'s trades, fills, plots and label texts MATCHes through step 8', () => {
    const g = gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) })
    expect(g).toMatchObject({ verdict: 'MATCH', step: 8, graded: { trades: true, fills: true, slots: 0, values: 50, texts: 47 } })
    expect(g.rulesExercised).toEqual(['B-MARKET'])
    expect(g.ungradedTexts).toBeUndefined()
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

// ─── value read-backs: step 7 (every plot, bar by bar) and step 8 (the label texts), on the real capture ─────
describe('value read-backs (step 7): the capture\'s plots against ours, paired fail-closed', () => {
  const grade = (opts, capture = CAPTURE) => gradeStrategyCapture(capture, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE, opts) })

  it('the source\'s plots are read in order, with their titles and whether each reads the broker', () => {
    const r = declaredSlots(CAPTURE.source.text)
    expect(r.ok).toBe(true)
    const d = r.slots
    expect(d).toHaveLength(50)
    expect(d.every((p) => p.kind === 'plot')).toBe(true)
    expect(d[0]).toMatchObject({ title: 'N01_bar_index_CONTROL', readsBroker: false })
    expect(d[1]).toMatchObject({ title: 'N02_position_size', readsBroker: true })
    // a ternary whose comma-separated call arguments sit inside parentheses is ONE argument
    expect(d.find((p) => p.title === 'N13_last_exit_price')).toMatchObject({ title: 'N13_last_exit_price', readsBroker: true })
    expect(d.filter((p) => !p.readsBroker).map((p) => p.title)).toEqual(['N01_bar_index_CONTROL', 'S01_time_CONTROL', 'S02_bar_index_CONTROL'])
    // every title the source declares is the capture's own style title at that position
    const styles = CAPTURE.study.styles
    expect(d.map((p) => p.title)).toEqual(CAPTURE.plotValues.fields.slice(1).map((f) => styles[f].title))
    // controls: `title =` by name, a call with no title, and a string holding a comma and a parenthesis
    expect(declaredSlots('plot(close, title = "a, (b")\nplot(x)\nplot(series = y, color = c)\n').slots.map(({ title, readsBroker }) => ({ title, readsBroker })))
      .toEqual([{ title: 'a, (b', readsBroker: false }, { title: null, readsBroker: false }, { title: null, readsBroker: false }])
  })

  it('⛔ ONE value of ONE series off by a tick-size amount on ONE bar is DIVERGE at step 7, naming the plot and the bar', () => {
    const g = grade({ mutatePlots: (p) => { p[6][300] = { ...p[6][300], value: p[6][300].value + 0.01 } } })
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 7, graded: { fills: true, values: 0 } })
    expect(g.reason).toMatch(/^value series N07_equity differs at \d+ \(reference [\d.]+, ours [\d.]+\)$/)
    expect(g.first).toEqual({ time: CAPTURE.plotValues.rows[300][0], rule: 'B-VAL' })
  })

  it('⛔ `na` only equals `na`: a number where TradingView plots na (and na where it plots a number) is DIVERGE', () => {
    // N03_position_avg_price is na while flat (bar 0)
    expect(CAPTURE.plotValues.rows[0][3]).toBeNull()
    expect(grade({ mutatePlots: (p) => { p[2][0] = { ...p[2][0], value: 0 } } })).toMatchObject({ verdict: 'DIVERGE', step: 7 })
    expect(grade({ mutatePlots: (p) => { p[1][100] = { ...p[1][100], value: null } } })).toMatchObject({ verdict: 'DIVERGE', step: 7 })
  })

  it('⛔ THE SWAP: two of our plots in each other\'s place is DIVERGE (a pairing by position is graded, never trusted)', () => {
    // N04_opentrades and N05_closedtrades: both counts, both plotted on every bar
    const g = grade({ mutatePlots: (p) => { const t = p[3]; p[3] = p[4]; p[4] = t } })
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 7 })
    expect(g.reason).toMatch(/value series N04_opentrades differs/)
  })

  it('⛔ a different plot count on our side is INCONCLUSIVE, never paired anyway', () => {
    const g = grade({ mutatePlots: (p) => { p.pop() } })
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 7 })
    expect(g.reason).toMatch(/our run emitted 49 value output\(s\) and the capture holds 50/)
  })

  it('⛔ a style title that contradicts the pairing is INCONCLUSIVE (the capture\'s plot order is not the source\'s)', () => {
    const c = clone(CAPTURE)
    const a = c.study.styles.plot_3.title
    c.study.styles.plot_3.title = c.study.styles.plot_4.title
    c.study.styles.plot_4.title = a
    const g = grade({}, c)
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 7 })
    expect(g.reason).toMatch(/plot_3 is titled "N05_closedtrades" in the capture and "N04_opentrades" in the source/)
    // and a capture whose plot has no title at all cannot be paired either
    const n = clone(CAPTURE)
    delete n.study.styles.plot_0.title
    expect(grade({}, n)).toMatchObject({ verdict: 'INCONCLUSIVE', step: 7 })
    // and a source that declares another number of plots than the capture holds
    const m = clone(CAPTURE)
    m.source = { ...m.source, text: `${m.source.text}plot(close, "EXTRA")\n` }
    expect(valueSeriesOf(m, mirrorRun(CAPTURE)().plots)).toEqual({ status: 'unpaired', reason: expect.stringMatching(/^the source declares more plot slots than the capture holds \(50\): `plot` at line \d+ has none$/) })
  })

  it('⛔ a run on another tick than the capture\'s is INCONCLUSIVE at step 2 (the tick is the capture\'s own)', () => {
    const run = mirrorRun(CAPTURE)
    const off = () => { const r = run(); return { ...r, record: { ...r.record, symbol: { mintick: 0.05, pointvalue: 1 } } } }
    const g = gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP, run: off })
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 2 })
    expect(g.reason).toMatch(/syminfo\.mintick/)
  })
})

// ─── (2026-11-17, Q-SD1 / Q-SD2) what the source declares is read by the Pine parser: every slot, in TradingView's order ───
// supertrend-strategy (corpus/committed, MPL-2.0) binds its three plots (`upPlot = plot(…)`) for its two fills, and
// draws four plotshapes and a barcolor: ten TradingView slots. The committed capture of the same source
// (`supertrend-strategy-rddt-1d-2026-10-02`, sha 7e343cf8…) records them as Q-SD1 / Q-SD2 do. ⚰️ The line-start
// `plot(` scan read 0 of them: "the source declares 0 plot(s) and the capture holds 10".
describe('step 7 pairing: the source\'s output calls, read by the parser, take TradingView\'s plot slots in order', () => {
  const ST = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'supertrend-strategy-rddt-1d-2026-10-02.json'), 'utf8'))
  const ST_SRC = fs.readFileSync(path.join(REPO, 'corpus/committed/supertrend-strategy__rcRbtoBiKG.pine'), 'utf8').replace(/\r\n/g, '\n')
  const strip = (r) => r.slots.map(({ kind, title }) => [kind, title])
  // our broker runs a capture whose backtest start is known: this one holds RDDT's listing day (`history.startsAtBar0`),
  // which is method (a); taken before Strategy Tester reports were read, it states no grade method of its own
  const ST_RUN = { ...ST, provenance: { ...(ST.provenance || {}), gradeMethod: 'a' } }

  it('an ASSIGNED plot (`x = plot(…)`) is counted, with its title, where it stands', () => {
    expect(ST.source.text.replace(/\r\n/g, '\n')).toBe(ST_SRC)
    const r = declaredSlots(ST_SRC)
    expect(r.ok).toBe(true)
    expect(strip(r)).toEqual([
      ['plot', 'Up Trend'], ['plotshape', 'UpTrend Begins'], ['plotshape', 'Buy'],
      ['plot', 'Down Trend'], ['plotshape', 'DownTrend Begins'], ['plotshape', 'Sell'],
      ['plot', ''], ['fill', 'UpTrend Highligter'], ['fill', 'DownTrend Highligter'], ['barcolor', null],
    ])
    // the three plots are the bound ones: none of them starts its line
    for (const s of r.slots.filter((x) => x.kind === 'plot')) expect(ST_SRC.split('\n')[s.line - 1]).toMatch(/^\w+ = plot\(/)
    // controls: a `var`-typed binding, a statement, and a comma-joined line each count once
    expect(strip(declaredSlots('//@version=5\nindicator("t")\nfloat p = plot(close, "A")\nplot(open, "B")\nc = close > open ? 1 : 0, plot(high, "C")\n')))
      .toEqual([['plot', 'A'], ['plot', 'B'], ['plot', 'C']])
  })

  it('CODE, NEVER PROSE: a plot written in a comment is not counted', () => {
    expect(strip(declaredSlots('//@version=5\nindicator("t")\n// p = plot(close, "COMMENTED")\nplot(open, "O") // plot(high, "TRAILING")\n')))
      .toEqual([['plot', 'O']])
  })

  it('plotshape / fill / barcolor take their TradingView plot slots in order (a fill\'s colour and the paint are paired, not compared)', () => {
    const s = captureSlotsOf(ST)
    expect(s.status, s.reason).toBe('ok')
    expect(s.slots.map((x) => [x.id, x.kind, x.value])).toEqual([
      ['plot_0', 'plot', true], ['plot_1', 'plotshape', true], ['plot_2', 'plotshape', true],
      ['plot_3', 'plot', true], ['plot_4', 'plotshape', true], ['plot_5', 'plotshape', true],
      ['plot_6', 'plot', true], ['plot_7', 'fill', false], ['plot_8', 'fill', false], ['plot_9', 'barcolor', false],
    ])
    // the capture's own type of each slot is the one the call is filed as; a fill's slots name their area
    expect(ST.study.plots.map((p) => p.type)).toEqual(['line', 'shapes', 'shapes', 'line', 'shapes', 'shapes', 'line', 'colorer', 'colorer', 'bar_colorer'])
    expect(ST.study.plots.slice(7, 9).map((p) => p.target)).toEqual(['fill_0', 'fill_1'])
    // OUR broker's run of the same capture emits the seven value outputs in the same calls' order, and the pairing holds
    const run = runOurBroker(ST_RUN)
    expect(run.ok, run.refusal && run.refusal.message).toBe(true)
    expect(run.plots.map((p) => p.kind)).toEqual(['plot', 'plotshape', 'plotshape', 'plot', 'plotshape', 'plotshape', 'plot'])
    const v = valueSeriesOf(ST, run.plots)
    expect(v.status, v.reason).toBe('ok')
    expect(v.series.map((x) => x.title)).toEqual(['Up Trend', 'UpTrend Begins', 'Buy', 'Down Trend', 'DownTrend Begins', 'Sell', ''])
    expect(v.notCompared.map((x) => x.slot)).toEqual(['plot_7', 'plot_8', 'plot_9'])
  })

  it('⛔ a genuine count mismatch is still refused, by name (either side, and our run\'s value outputs too)', () => {
    const extra = clone(ST)
    extra.source = { ...extra.source, text: `${ST_SRC}\nplot(close, "EXTRA")\n` }
    expect(captureSlotsOf(extra)).toEqual({ status: 'unpaired', reason: expect.stringMatching(/^the source declares more plot slots than the capture holds \(10\): `plot` at line \d+ has none$/) })
    const short = clone(ST)
    short.source = { ...short.source, text: ST_SRC.replace(/^barcolor\(.*$/m, '') }
    expect(captureSlotsOf(short)).toEqual({ status: 'unpaired', reason: 'the source declares 9 plot slot(s) and the capture holds 10' })
    // a slot of another TYPE at a position is refused, never paired by count
    const typed = clone(ST)
    typed.study.plots[1].type = 'chars'
    expect(captureSlotsOf(typed)).toEqual({ status: 'unpaired', reason: expect.stringMatching(/^plot_1 is a "chars" slot in the capture and the source's `plotshape` at line \d+ is filed as "shapes"$/) })
    // a fill's slot that names an area the source does not declare (it has two fills) belongs to no call of it
    const area = clone(ST)
    area.study.plots[8].target = 'fill_2'
    expect(captureSlotsOf(area)).toEqual({ status: 'unpaired', reason: expect.stringMatching(/^plot_8 is a "colorer" slot in the capture and the source's `barcolor` at line \d+ is filed as "bar_colorer"$/) })
    // our run: one value output fewer, or the same count of other calls
    const run = runOurBroker(ST_RUN)
    expect(valueSeriesOf(ST, run.plots.slice(1))).toEqual({ status: 'unpaired', reason: 'our run emitted 6 value output(s) and the capture holds 7' })
    const swapped = run.plots.map((p, k) => (k === 1 ? { ...p, kind: 'plotchar' } : p))
    expect(valueSeriesOf(ST, swapped).status).toBe('unpaired')
  })

  it('⛔ a value output our side carried NO COLUMN for is INCONCLUSIVE at step 7, named, never a series of `na` (DIVERGE)', () => {
    // the strategy lane hands `{points: null, missing}` for a plot the member pane did not carry (`strategyLane.js::plotsOf`)
    const r = mirrorRun(CAPTURE)()
    r.plots[6] = { kind: 'plot', points: null, missing: 'the member pane did not carry this output (hidden helper)' }
    const g = gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP, run: () => r })
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 7, graded: { fills: true, values: 0 } })
    expect(g.reason).toMatch(/^the value series cannot be paired: our side carried no column for plot_6 \(`plot` at line \d+\): the member pane did not carry this output \(hidden helper\)$/)
    // control: the same run with the column carried MATCHes
    expect(gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) }).verdict).toBe('MATCH')
  })

  it('the parser\'s list IS the front end\'s registration: every committed strategy capture the value build builds', () => {
    let compared = 0
    const off = []
    for (const id of [...Object.keys(STRATEGY_CAPTURE_ROWS), 'supertrend-strategy-rddt-1d-2026-10-02', 'supertrend-strategy-spy-1d-2026-10-02']) {
      const c = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, `${id}.json`), 'utf8'))
      const e = engineSlotCallsOf(c)
      if (!e.ok) continue
      compared += 1
      const d = declaredSlots(c.source.text)
      if (!d.ok || d.slots.map((s) => s.kind).join(',') !== e.calls.join(',')) off.push(`${id}: [${d.ok ? d.slots.map((s) => s.kind) : d.reason}] vs [${e.calls}]`)
    }
    expect(off).toEqual([])
    // not vacuous: 49 of the 54 build today (2026-11-17, after #1760), the supertrend pair among them (measured over
    // the whole committed set the same day: every one of the 296 captures whose value build builds agrees)
    expect(compared).toBeGreaterThanOrEqual(40)
    expect(engineSlotCallsOf(ST)).toEqual({ ok: true, calls: ['plot', 'plotshape', 'plotshape', 'plot', 'plotshape', 'plotshape', 'plot', 'fill', 'fill', 'barcolor'] })
  })

  it('every output call the runtime front end registers is filed here: a slot type, a fill, a candle, or slotless (`hline`)', () => {
    for (const call of RUNTIME_OUTPUT_CALLS) expect(Object.hasOwn(TV_SLOT_TYPE, call) || call === 'hline', call).toBe(true)
    for (const call of Object.keys(TV_SLOT_TYPE)) expect(RUNTIME_OUTPUT_CALLS.has(call), call).toBe(true)
  })
})

describe('value read-backs (step 8): the label texts, by bar', () => {
  const grade = (opts) => gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE, opts) })

  it('the capture\'s labels are read with their bar times (47 closes, each `entry_id>exit_id:exit_comment`)', () => {
    const t = referenceTextsOf(CAPTURE)
    expect(t.status).toBe('ok')
    expect(t.labels).toHaveLength(47)
    const bars = new Set(CAPTURE.bars.rows.map((r) => r[0]))
    for (const l of t.labels) { expect(bars.has(l.time)).toBe(true); expect(l.text).toMatch(/^[LS]>.+:.+$/) }
    expect(new Set(t.labels.map((l) => l.text))).toEqual(new Set(['L>XL:XL', 'S>XS:XS', 'L>Close position order:Close position order', 'S>L:L', 'L>S:S']))
  })

  it.each([
    ['one text differing', (l) => { l[5].text = 'L>XL:other' }],
    ['a text on another bar', (l) => { l[5].time = CAPTURE.bars.rows[3][0] }],
    ['a missing label', (l) => { l.splice(9, 1) }],
    ['an extra label', (l) => { l.push({ ...l[0] }) }],
  ])('⛔ %s is DIVERGE at step 8 (values graded, texts not)', (_n, mutateLabels) => {
    const g = grade({ mutateLabels })
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 8, graded: { values: 50, texts: 0 } })
    expect(g.reason).toMatch(/^the drawn texts at \d+ differ/)
  })

  it('texts our run could not draw are listed UNGRADED with the reason, never dropped and never a MATCH on texts', () => {
    const g = grade({ drawn: { status: 'ungraded', reason: 'the build that draws refused (runtime:x)' } })
    expect(g).toMatchObject({ verdict: 'MATCH', step: 7, graded: { values: 50, texts: 0 } })
    expect(g.ungradedTexts).toEqual([{ what: 'labels (47)', why: 'the build that draws refused (runtime:x)' }])
  })

  it('⛔ a capture whose objects could not all be read is INCONCLUSIVE at step 8, not graded on a partial list', () => {
    const c = clone(CAPTURE)
    c.objects.unreadable = [{ family: 'label' }]
    expect(gradeStrategyCapture(c, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE) })).toMatchObject({ verdict: 'INCONCLUSIVE', step: 8 })
  })
})

describe('value read-backs: a reversal is ONE fill of both sizes (oursOf)', () => {
  const order = (over) => ({ status: 'filled', fillTime: 10, side: 'sell', kind: 'entry', id: 'S', fillPrice: 5, fillQty: 1, rule: 'B-MARKET', opened: [2], closed: [1], ...over })
  const record = (o) => ({ trades: [{ n: 1, qty: 3, open: false }, { n: 2, qty: 1, open: true }], orders: [o] })
  it('an entry that closed a trade of 3 and opened 1 is a fill of 4; one that only closed, or only opened, is its own size', () => {
    expect(oursOf(record(order()), null).fills[0].qty).toBe(4)
    expect(oursOf(record(order({ opened: [], fillQty: 3 })), null).fills[0].qty).toBe(3) // an allow_entry_in close
    expect(oursOf(record(order({ closed: [] })), null).fills[0].qty).toBe(1)
    // strategy.order never reverses (B-ORDER): its fill is its own size
    expect(oursOf(record(order({ kind: 'order' })), null).fills[0].qty).toBe(1)
  })
})

// ─── value read-backs on METHOD (b): a broker value is graded as a VALUE (step 7), a signal as a signal (step 3) ───
describe('value read-backs, method (b) (AMEX:SPY 15, w9-r1-risk-intraday-range): signals and values are told apart', () => {
  const SPY = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'w9-r1-risk-intraday-range-spy-15-2026-11-15.json'), 'utf8'))
  // the capture's own read-back (v6 defaults; the probe declares a fixed size of 1)
  const settings = { initial_capital: 100000, pyramiding: 1, margin_long: 100, margin_short: 100, process_orders_on_close: false,
    calc_on_order_fills: false, calc_on_every_tick: false, slippage: 0, commission: { type: 'percent', value: 0 }, default_qty: null }
  const grade = (opts = {}) => gradeStrategyCapture(SPY, { slotMap: SLOT_MAP, run: mirrorRun(SPY, { settings, ...opts }) })
  const gr = SPY.provenance.gradeRange
  // a bar inside [X, Y) on which the mirrored plots hold a number
  const inside = SPY.plotValues.rows.findIndex((r) => r[0] >= gr.fromTime && r[0] < gr.toTime) + 40
  const titles = SPY.plotValues.fields.slice(1).map((f) => SPY.study.styles[f].title)
  const control = titles.indexOf('S02_bar_index_CONTROL')
  const equity = titles.indexOf('S08_equity')

  it('CONTROL: the mirror of the capture MATCHes through step 8 on method (b)', () => {
    expect(SPY.provenance.gradeMethod).toBe('b')
    expect(control).toBeGreaterThanOrEqual(0)
    expect(equity).toBeGreaterThan(control)
    expect(SPY.plotValues.rows[inside][0]).toBeLessThan(gr.toTime)
    expect(grade()).toMatchObject({ verdict: 'MATCH', step: 8, graded: { fills: true, values: titles.length } })
  })

  it('⛔ a BROKER VALUE differing inside [X, Y) is DIVERGE at step 7, never "the warm-up has not converged"', () => {
    const g = grade({ mutatePlots: (p) => { p[equity][inside] = { ...p[equity][inside], value: p[equity][inside].value + 1 } } })
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 7 })
    expect(g.reason).toMatch(/^value series S08_equity differs at /)
  })

  it('a SIGNAL (a plot that reads no strategy.* value) differing inside [X, Y) is INCONCLUSIVE at step 3, as before', () => {
    const g = grade({ mutatePlots: (p) => { p[control][inside] = { ...p[control][inside], value: p[control][inside].value + 1 } } })
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 3 })
    expect(g.reason).toMatch(/warm-up has not converged: plot S02_bar_index_CONTROL differs/)
  })

  it('a value differing OUTSIDE [X, Y) is not graded on method (b) (only the graded range is)', () => {
    const before = SPY.plotValues.rows.findIndex((r) => r[0] >= gr.fromTime) - 5
    expect(before).toBeGreaterThan(0)
    expect(grade({ mutatePlots: (p) => { p[equity][before] = { ...p[equity][before], value: 1 } } }).verdict).toBe('MATCH')
  })
})

// ─── rulings D11 and D12 (docs/pine/W9-DECISIONS-2026-11-07.md) ──────────────────────────────────────
describe('ruling D11: a DIVERGE records its first difference and its culprit set, mechanically', () => {
  const ref = referenceOfCapture(CAPTURE)
  const T = ref.fills[7].time
  const LATER = CAPTURE.bars.rows[CAPTURE.bars.rows.length - 1][0]
  const dropFill = (f) => { f.splice(7, 1) }
  const rulesUsed = ['B-BEFORE', 'B-AT', 'B-LATE', 'B-UNDATED', 'B-RUN']
  const ruleFirstTime = { 'B-BEFORE': CAPTURE.bars.rows[0][0], 'B-AT': T, 'B-LATE': LATER, 'B-RUN': null }
  const grade = (opts) => gradeStrategyCapture(CAPTURE, { slotMap: SLOT_MAP, run: mirrorRun(CAPTURE, { rulesUsed, ruleFirstTime, ...opts }) })

  it('the culprit set is the rules first exercised ON the differing bar; before it, nothing; after it, listed apart', () => {
    expect(T).toBeGreaterThan(CAPTURE.bars.rows[0][0])
    expect(T).toBeLessThan(LATER)
    const g = grade({ mutateFills: dropFill })
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 5 })
    expect(g.firstDifference).toEqual({ bar: T, step: 5 })
    expect(g.prefixExact).toBe(true)
    // B-UNDATED: a rule the broker did not date is treated as exercised AT the event, never excused
    expect(g.culprit).toEqual(['B-AT', 'B-UNDATED'])
    expect(g.afterDifference).toEqual(['B-LATE'])
    // B-BEFORE (an earlier bar) and B-RUN (asked before the first bar) are in neither list
  })

  it('⛔ an earlier VALUE difference moves the event (and the culprit set) to its own bar', () => {
    const early = CAPTURE.plotValues.rows[5][0]
    expect(early).toBeLessThan(T)
    const g = grade({ mutateFills: dropFill, mutatePlots: (p) => { p[0][5] = { ...p[0][5], value: -1 } }, ruleFirstTime: { ...ruleFirstTime, 'B-AT': early } })
    expect(g.firstDifference).toEqual({ bar: early, step: 7 })
    expect(g.culprit).toEqual(['B-AT', 'B-UNDATED'])
  })

  it('a MATCH, a refusal and a difference with no bar record no culprit set (the strict rule reads them)', () => {
    const ok = grade({})
    expect(ok.verdict).toBe('MATCH')
    expect(ok.culprit).toBeUndefined()
    expect(S25.culprit).toBeUndefined() // our own run of s25 refuses: there is no run to date
  })

  it('the verdict FILE carries the four fields, null unless the capture diverges on a bar', () => {
    for (const f of fs.readdirSync(VERDICT_DIR).filter((x) => x.endsWith('.json'))) {
      const v = JSON.parse(fs.readFileSync(path.join(VERDICT_DIR, f), 'utf8'))
      for (const k of ['firstDifference', 'prefixExact', 'culprit', 'afterDifference']) expect(Object.prototype.hasOwnProperty.call(v, k), `${f} ${k}`).toBe(true)
      if (v.verdict !== 'DIVERGE' || v.step === 1) expect([v.firstDifference, v.prefixExact, v.culprit, v.afterDifference], f).toEqual([null, null, null, null])
    }
  })
})

// ⚰️ Until ruling D12b (2026-11-17) both v4 captures were EXPECTED refusals about the setting. D12b: the capture wins
// where it witnesses the RUN, for exactly its declaration shape; the two now run at the read-back margin 0 and MATCH.
describe('ruling D12b: the two Pine v4 captures run at the margin TradingView read back (0), for their exact declaration shape', () => {
  it.each(['w9-q-s1a-size-v4-rddt-1d-2026-11-15', 'w9-q-s1b-defaults-v4-rddt-1d-2026-11-15'])('%s', (id) => {
    const capture = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, `${id}.json`), 'utf8'))
    // TradingView read both margins back as 0, and the source states neither: its strategy() is a title and overlay
    const props = Object.fromEntries(capture.provenance.strategySettings.properties.map((p) => [p.name, p.value]))
    expect([props['Margin Long'], props['Margin Short']]).toEqual([0, 0])
    expect(capture.source.text).not.toMatch(/margin_(long|short)/)
    expect(capture.source.text).toMatch(/^strategy\(title="[^"]*", overlay=false\)$/m)
    const run = runOurBroker(capture)
    expect(run.ok, run.refusal && run.refusal.message).toBe(true)
    expect(run.record.settings).toMatchObject({ margin_long: 0, margin_short: 0 })
    const g = gradeStrategyCapture(capture, { slotMap: SLOT_MAP })
    // step 7 is the last step these captures hold: neither draws a label, so there is no text for step 8 to grade
    expect(g).toMatchObject({ verdict: 'MATCH', step: 7, graded: { trades: true, fills: true, texts: 0 } })
    expect(g.rulesExercised).toContain('B-V4-MARGIN0')
  })
  it('⛔ any other broker refusal against a TradingView value is still a DIVERGE (only a SETTING is expected)', () => {
    expect(S25.verdict === 'DIVERGE' ? S25.rule : 'runtime:strategy-unsettled').toBe('runtime:strategy-unsettled')
    const x = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'w9-q-s1j-stop-limit-rddt-1d-2026-11-15.json'), 'utf8'))
    const run = runOurBroker(x)
    expect(run.refusal).toMatchObject({ guard: 'runtime:strategy-unsettled', expected: false })
  })
  // ⭐ (2026-11-23) RULING D12 STILL HOLDS for every v4 declaration shape no capture settles: the run stops at bind on
  // the SETTING (`BrokerRefusal.setting`, `V4_MARGIN_DEFAULT_SETTING`), and that refusal is EXPECTED, never a DIVERGE.
  // ⚰️ Once D12b ran both committed v4 captures, no committed capture refused on a setting, and mutant D3
  // (ci/mutants/strategy-readbacks-b.json: the setting clause of `runOurBroker`'s `expected` removed) stayed green.
  // The case: a committed v4 capture with one more declaration argument, a shape `V4_MARGIN0_SHAPES` does not hold.
  it('a v4 declaration shape no capture settles stops on the SETTING, graded EXPECTED-REFUSAL, never a DIVERGE (ruling D12)', () => {
    const capture = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'w9-q-s1a-size-v4-rddt-1d-2026-11-15.json'), 'utf8'))
    const text = capture.source.text.replace(/^(strategy\(title="[^"]*", overlay=false)\)$/m, '$1, pyramiding=1)')
    expect(text).not.toBe(capture.source.text)
    expect(text).not.toMatch(/margin_(long|short)/)
    const unsettled = { ...capture, source: { ...capture.source, text } }
    const run = runOurBroker(unsettled)
    expect(run.ok).toBe(false)
    expect(run.refusal).toMatchObject({ guard: 'runtime:strategy-unsettled', expected: true })
    expect(run.refusal.message).toMatch(/states no `margin_long` \/ `margin_short`/)
    expect(gradeStrategyCapture(unsettled, { slotMap: SLOT_MAP })).toMatchObject({ verdict: 'EXPECTED-REFUSAL', step: 1 })
  })
})
