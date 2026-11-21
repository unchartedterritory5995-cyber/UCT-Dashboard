// ─── ⭐⭐ RS RATING (2026-11-19, the e85 live capture) — THE OWN DAILY READ ON A CHART THAT STARTS AT THE LISTING ───
//
// ⚰️ CAPTURED on the served build 36b7887430 (engine e85, smoke@, RDDT 1h, 10,358 rows, the runtime worker's own reply):
// Fred RS's run half was refused in every reply: "a `request.security` (line 187) cannot be read on every bar —
// `this symbol's daily bars` has no bar on 1711040400, after its history began, so what the request reads there is not
// known". Line 187 is `closeDa = request.security(syminfo.tickerid, 'D', close)` (the chart's OWN symbol at D, look-ahead
// off, above an intraday chart: `OWN_DAILY_KEY`). Production `/api/bars` (smoke@): RDDT tf=D first row `2024-03-21`
// (RDDT's listing day), tf=60 first row 1711038600 (2024-03-21 16:30Z); 1711040400 is the listing day's second hourly
// bar, before that day's daily bar has closed.
// TradingView's witness (local capture, never committed): `history.startsAtBar0: true`, its first plot row 1711040400
// with the RS line 32.286, two labels ["                RS Rating", ""]. It DRAWS Fred RS on RDDT 1h from the listing:
// before the first daily close there is no earlier day, so the look-ahead-off read is na, not unknown.
// These rails, on the product path (the member door's install of the real source, the REAL runtime worker):
//   1. SERVED: a 1h chart whose first bars are on the own daily series' first row's session (SP:SPX deeper);
//   2. ⛔ CONTROL: the same chart with an own daily row missing in the MIDDLE (a hole after the series began) refuses;
//   3. ⛔ CONTROL: a chart whose history does not start at that first row is answered as before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import {
  resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner, onRuntimeColumnsLanded,
} from './runtime/runtimeColumns'
import { runtimeRequestSupply, LISTING_DATE_WAITING } from './runtime/requestSupply'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from './ast/pineRuntimeClock.js'
import { workerRunner, resetRuntimeAsync } from './runtime/runtimeAsync'
import { runHalfOf, runtimeObjectsOf } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { OWN_DAILY_KEY } from './otherSymbols'
import { clearSecondaryBars } from './secondaryBars'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'

vi.setConfig({ testTimeout: 300000 })

const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED = 'SEED_FRED6725_RS_RATING:RSRATING@D'
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information',
  sector: 'Communication Services', securityType: 'Stock' })

// ── the live shape: RDDT listed 2024-03-21; every session of this fixture is under EDT (UTC-4) ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 4, mm) / 1000 }
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const sessionsFrom = (from, count) => {
  const out = []
  for (let d = from; out.length < count; d = isoPlus(d, 1)) if (isTradingDay(d)) out.push(d)
  return out
}
const LISTING = '2024-03-21'
const SESS = sessionsFrom(LISTING, 15)                       // the chart's sessions (Good Friday 2024-03-29 is not one)
const BEFORE = sessionsFrom('2024-03-14', 5)                 // SP:SPX's sessions before RDDT's listing
const bar = (t, c) => ({ t, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 })
// the chart, as the store serves RDDT 60m: the listing session from its first bar (12:30 ET, 1711038600), then on the
// hour to 19:00; every later session 04:00..19:00 ET on the hour
const hours = (day, h0) => Array.from({ length: 20 - h0 }, (_, k) => ET(day, h0 + k, 0))
const CHART_T = [ET(LISTING, 12, 30), ...hours(LISTING, 13), ...SESS.slice(1).flatMap((d) => hours(d, 4))]
const CHART = CHART_T.map((t, i) => bar(t, 40 + i * 0.05 + Math.sin(i / 5)))
// SP:SPX deeper than the chart: its 60m bars (regular hours) and its daily rows from five sessions before the listing
const SPX_60 = [...BEFORE, ...SESS].flatMap((d, k) => Array.from({ length: 7 }, (_, j) => bar(ET(d, 9, 30) + j * 3600, 5100 + k * 3 + Math.cos(j))))
const SPX_D = [...BEFORE, ...SESS].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 5100 + k * 3, v: 1 }))
// this chart symbol's own daily rows (ISO days): from the listing, as `/api/bars?tf=D` serves RDDT (first row 2024-03-21)
const OWN_D = SESS.map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 40 + k * 0.8, v: 1 }))
const SEED_ROWS = []
for (let d = '2024-03-01', k = 0; d <= '2024-04-20'; d = isoPlus(d, 1), k += 1) {
  SEED_ROWS.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
}

// the LISTING fact: the symbol's first trade day as `/api/ticker-ipo` answers it (live RDDT: first_trade_date 2024-03-21,
// first_trade_final true), carried on the chart's symbol (StockChart `symbolMeta.firstTradeDate`)
// ⭐⭐ (e91, coordinator ruling 2026-11-20) a bar reading a session BEFORE the own daily rows' first is DEPTH: the run starts
// at `knownFrom`, the first bar every read of which is held (the held first session's LAST bar, which reads its own row)
const lastBarOf = (rows, day) => rows.reduce((k, b, i) => (b.t >= ET(day, 0, 0) && b.t < ET(isoPlus(day, 1), 0, 0) ? i : k), -1)
const DEPTH_SAYS = /this chart's history reaches \d+, and the `this symbol's daily bars` bars we hold begin at \d{4}-\d{2}-\d{2}/
const ctxOf = (own = OWN_D, firstTrade = LISTING) => ({ tf: '60', newestBarIsForming: false, historyFromListing: false,
  symbol: { ...RDDT, ...(firstTrade ? { firstTradeDate: firstTrade } : {}) },
  secondary: new Map([['SPX', { bars: SPX_60, status: 'available' }], ['SPX@D', { bars: SPX_D, status: 'available' }],
    [OWN_DAILY_KEY, { bars: own, status: 'available' }], [SEED, { bars: SEED_ROWS, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })

// ── the REAL runtime worker, its replies recorded (the live capture is the worker's own reply) ──
const SELF = { postMessage: (m) => SELF.out.push(m), out: [] }
const replies = []
const requests = []
async function realWorkerFactory() {
  vi.stubGlobal('self', SELF)
  await import('./runtime/runtimeWorker.js')
  return () => ({
    postMessage(msg) {
      if (msg && msg.ctx) requests.push(structuredClone(msg))
      queueMicrotask(() => {
        SELF.out.length = 0
        SELF.onmessage({ data: structuredClone(msg) })
        const reply = structuredClone(SELF.out[0])
        replies.push(reply)
        this.onmessage({ data: reply })
      })
    },
    terminate() {},
  })
}

let def = null
beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_listing-fred' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  def = installed[0]
  replies.length = 0
  requests.length = 0
})
afterEach(() => {
  if (def) registry.uninstallUserDefinition(def.id)
  setRuntimeRunner(null); resetRuntimeAsync(); setRunHalfObjectEvidence([]); setRuntimeKillList([])
  resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

/** Fred RS's run half on these bars through the real worker, until no reply lands: the states and the worker's refusals. */
async function runHalfOn(rows, ctx) {
  setRuntimeRunner(workerRunner(await realWorkerFactory()))
  let cols = null
  const states = []
  for (let pass = 0; pass < 8; pass += 1) {
    let landed = false
    const off = onRuntimeColumnsLanded(() => { landed = true })
    cols = registry.computeFor(def, rows, {}, ctx)
    const rh = runHalfOf(cols)
    states.push(rh ? `${rh.state}:${rh.code}` : 'none')
    for (let i = 0; i < 400 && !landed; i += 1) await new Promise((r) => setTimeout(r, 0))
    off()
    if (!landed) break
  }
  const refusals = replies.filter((m) => m && m.ok === false).map((m) => String((m.error && m.error.message) || ''))
  return { cols, states, refusals, said: `${states.join(' > ')} || worker refusals: ${[...new Set(refusals)].join(' | ') || 'none'}` }
}
const newestLabels = (cols, n) => runtimeObjectsOf(cols).live.filter((o) => o.family === 'label' && o.createdBar === n - 1)
  .map((o) => o.props.text)

/** The run's own supply over the requests a real build of Fred RS makes, on these bars. */
function supplyOn(rows, ctx) {
  const built = buildRuntimeIr(RS, { bars: rows, inputs: {}, objectsInRun: true, pane: true, plotColours: true,
    basePeriod: '60', tf: '60', symbol: RDDT, ...runtimeClockOpts(false, { tf: '60' }) })
  expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  const requests = built.ir.requests || []
  const own = requests.findIndex((r) => r && r.target && r.target.above === true && !r.target.ticker)
  expect(own, 'Fred RS reads its own symbol at D (line 187)').toBeGreaterThanOrEqual(0)
  return { sup: runtimeRequestSupply(requests, rows, ctx), own }
}

describe('the fixture is the live shape', () => {
  it('the chart opens on the listing session at 1711038600, its second bar 1711040400; the own daily rows begin that day', () => {
    expect(CHART[0].t).toBe(1711038600)
    expect(CHART[1].t).toBe(1711040400)
    expect(OWN_D[0].t).toBe(LISTING)
    expect(SPX_60[0].t).toBeLessThan(CHART[0].t)
    expect(SPX_D[0].t).toBeLessThan(Date.parse(`${LISTING}T00:00:00Z`) / 1000)
  })
})

describe('1. SERVED: a 1h chart that starts on the own daily series\' first session (RDDT from its listing)', () => {
  // the store's first 60m row (1711038600), and the bar the captured refusal named (1711040400) as a chart's first
  // (the store's FIRST 60m bar, 1711038600, as a chart's first: this fixture's SP:SPX 60m grid refuses it at line 89, which
  // the live capture did NOT (live refused only at line 187, 1711040400), so the rails start on the bar the capture named)
  for (const [name, rows] of [['from the listing session\'s second bar (the bar the live refusal named)', CHART.slice(1)]]) {
    it(`${name}: the run half reaches served:null and draws "RS Rating" on the newest bar`, async () => {
      const { cols, states, said } = await runHalfOn(rows, ctxOf())
      expect(states[states.length - 1], said).toBe('served:null')
      expect(newestLabels(cols, rows.length)).toEqual(['                RS Rating', ''])
    })
  }
  it('the supply: the listing session\'s bars before its daily close read na (known), its last bar the listing row', () => {
    const C = CHART.slice(1)
    const { sup, own } = supplyOn(C, ctxOf())
    expect(sup.refusal && sup.refusal.message, 'nothing withheld before the newest bar').toBeFalsy()
    const listingBars = C.map((b, i) => i).filter((i) => C[i].t < ET(SESS[1], 0, 0))
    const last = listingBars[listingBars.length - 1]
    for (const i of listingBars.slice(0, -1)) expect(sup.supply[own].index[i], `bar ${C[i].t} reads na`).toBe(-1)
    expect(sup.supply[own].runBars[sup.supply[own].index[last]].t, 'the session\'s last bar reads its own row').toBe(LISTING)
    // the next session's first bar reads the listing row (the previous session's)
    expect(sup.supply[own].runBars[sup.supply[own].index[last + 1]].t).toBe(LISTING)
  })
})

describe('2. ⛔ CONTROL: an own daily row missing AFTER the series began still refuses', () => {
  const HOLE = SESS[7]
  const holed = OWN_D.filter((r) => r.t !== HOLE)
  it('the supply names the hole ("has no bar on")', () => {
    const { sup } = supplyOn(CHART, ctxOf(holed))
    expect(sup.refusal, 'a hole after the series began is not known').not.toBeNull()
    expect(sup.refusal.message).toMatch(/has no bar on/)
    expect(sup.refusal.knownFrom).toBeUndefined()
  })
  it('the run half is refused (runtime:request), the worker saying "has no bar on"', async () => {
    const { states, refusals, said } = await runHalfOn(CHART, ctxOf(holed))
    expect(states[states.length - 1], said).toBe('refused:runtime:request')
    expect(refusals.some((m) => /has no bar on/.test(m)), said).toBe(true)
  })
})

describe('3. ⛔ CONTROL: a chart whose history does not start at the own daily series\' first row is answered as before', () => {
  it('a chart starting sessions AFTER the first own row: every bar reads a held row, served', async () => {
    const rows = CHART.filter((b) => b.t >= ET(SESS[2], 0, 0))
    const { sup, own } = supplyOn(rows, ctxOf())
    expect(sup.refusal && sup.refusal.message).toBeFalsy()
    for (let i = 0; i < rows.length; i += 1) expect(sup.supply[own].index[i], `bar ${rows[i].t}`).toBeGreaterThanOrEqual(0)
    const { cols, states, said } = await runHalfOn(rows, ctxOf())
    expect(states[states.length - 1], said).toBe('served:null')
    expect(newestLabels(cols, rows.length)).toEqual(['                RS Rating', ''])
  })
  // ⚰️ (e91) this case was REFUSED whole ("has no bar on <its first bar>, after its history began"); the e88 in-session
  // capture (RDDT 5m, own rows 7 sessions short of the chart) blanked that pane all session. RULED (coordinator,
  // 2026-11-20): a bar reading a session before the held rows' first is DEPTH: the run starts where every read is known.
  // ⚠️ `CHART.slice(1)`: the fixture's first bar (12:30, the listing day's open) is OFF the 60m grid, so SP:SPX's read
  // (line 89) refuses it before the own read is asked. ⚰️ The case this replaces matched THAT refusal ("has no bar on
  // <CHART[0]>", the adjacent site) and never tested the own read at all.
  it('a chart reaching sessions BEFORE the first own row: DEPTH, the run starts at the first bar every read of which is held', async () => {
    const late = OWN_D.slice(2)
    const C = CHART.slice(1)
    const { sup } = supplyOn(C, ctxOf(late))
    expect(sup.refusal, 'a depth gap is answered with where the run starts').not.toBeNull()
    expect(sup.refusal.message).not.toMatch(/has no bar on/)
    expect(sup.refusal.message).toMatch(DEPTH_SAYS)
    expect(sup.refusal.knownFrom).toBe(lastBarOf(C, SESS[2]))
    const { states, said } = await runHalfOn(C, ctxOf(late))
    expect(states[states.length - 1], said).not.toBe('refused:runtime:request')
  })
})

describe('4. ⛔ CONTROL: the SAME shape WITHOUT a listing fact is DEPTH, never na (a first held row is not a listing)', () => {
  it('no firstTradeDate on the symbol: the listing session pre-close bars are UNKNOWN (depth), never na by history', async () => {
    const C = CHART.slice(1)
    const { sup } = supplyOn(C, ctxOf(OWN_D, null))
    expect(sup.refusal, 'no listing is claimed without the fact').not.toBeNull()
    expect(sup.refusal.message).not.toMatch(/has no bar on/)
    expect(sup.refusal.knownFrom, 'the bars before the first own close are unknown, not na').toBe(lastBarOf(C, LISTING))
    const { states, said } = await runHalfOn(C, ctxOf(OWN_D, null))
    expect(states[states.length - 1], said).not.toBe('refused:runtime:request')
  })
  it('⛔ a CAPPED store with an OLDER listing (the IBM / KO shape, measured): DEPTH, never na-by-history', async () => {
    // the store's first daily row is not the symbol's first trade: /api/bars/IBM?tf=D serves from 1962-01-02 while IBM
    // listed 1949-01-28 (smoke@ GETs, 2026-11-19); here the rows start on the chart's first day, the listing years before
    const C = CHART.slice(1)
    const { sup } = supplyOn(C, ctxOf(OWN_D, '2020-01-02'))
    expect(sup.refusal, 'an earlier real daily bar exists; reading na would be a wrong value').not.toBeNull()
    expect(sup.refusal.message).not.toMatch(/has no bar on/)
    expect(sup.refusal.knownFrom, 'unknown before the first held close: depth, never na by history').toBe(lastBarOf(C, LISTING))
    const { states, said } = await runHalfOn(C, ctxOf(OWN_D, '2020-01-02'))
    expect(states[states.length - 1], said).not.toBe('refused:runtime:request')
  })
})

describe('5. the listing fact reaches the WORKER (its request carries the symbol\'s firstTradeDate)', () => {
  it('every worker request of the served run names firstTradeDate = the listing', async () => {
    const C = CHART.slice(1)
    await runHalfOn(C, ctxOf())
    expect(requests.length, 'the worker was asked').toBeGreaterThan(0)
    for (const m of requests) expect(m.ctx && m.ctx.symbol && m.ctx.symbol.firstTradeDate).toBe(LISTING)
  })
})


// ─── ⭐⭐ (coordinator ruling 2026-11-20) THE LISTING DATE IN FLIGHT: A WAIT, NEVER A REFUSAL, AND NEVER STICKY ──────────
// ⚰️ CAPTURED on production e87 (ipocold-bgin, smoke@, /api/ticker-ipo/BGIN held 25 s with the rig's cached answer removed):
// NASDAQ:BGIN 1h's worker requests 10-12 carried firstTradeDate null and came back REFUSED ("`this symbol's daily bars`
// has no bar on 1761055200, after its history began"); NO run was asked after the date landed, and the pane read refused
// for the whole minute (the run's memo key did not carry the date).
const ctxPending = () => ({ ...ctxOf(OWN_D, null), symbol: { ...RDDT, firstTradeDatePending: true } })

describe('6. the listing date in flight: the run WAITS for it, and the answer re-asks the run', () => {
  it('the supply: PENDING, waiting for this symbol\'s listing date (never "has no bar on")', () => {
    const { sup } = supplyOn(CHART.slice(1), ctxPending())
    expect(sup.refusal).toBeNull()
    expect(sup.pending).toBe(true)
    expect(sup.waiting && sup.waiting.sentence).toBe(LISTING_DATE_WAITING)
    expect(LISTING_DATE_WAITING).toMatch(/waiting for this symbol's listing date/)
    expect(LISTING_DATE_WAITING).not.toMatch(/has no bar on/)
  })
  it('the run half is pending through the real worker, and no reply refuses', async () => {
    const { states, refusals, said } = await runHalfOn(CHART.slice(1), ctxPending())
    expect(states[states.length - 1], said).toMatch(/^pending/)
    expect(refusals.filter((m) => /has no bar on/.test(m)), said).toEqual([])
    for (const m of requests) expect(m.ctx.symbol.firstTradeDatePending).toBe(true)
  })
  // ⭐ (e91 ruling) without the date the listing session's pre-close bars are DEPTH (unknown: the run starts after them),
  // no longer a whole-run refusal. NEVER STICKY still holds: the date's arrival asks the run again, and it serves from it.
  it('⛔⛔ NEVER STICKY: WITHOUT the date (depth, never a whole-run refusal), then the date lands: the run is asked again and SERVED', async () => {
    const C = CHART.slice(1)
    const cold = await runHalfOn(C, ctxOf(OWN_D, null))
    expect(cold.states[cold.states.length - 1], cold.said).not.toBe('refused:runtime:request')
    const asked = requests.length
    const warm = await runHalfOn(C, ctxOf())
    expect(warm.states[warm.states.length - 1], warm.said).toBe('served:null')
    expect(requests.length, 'the worker was asked again once the date landed').toBeGreaterThan(asked)
    expect(requests[requests.length - 1].ctx.symbol.firstTradeDate).toBe(LISTING)
  })
  it('pending, then the date lands: served', async () => {
    const C = CHART.slice(1)
    const waiting = await runHalfOn(C, ctxPending())
    expect(waiting.states[waiting.states.length - 1], waiting.said).toMatch(/^pending/)
    const landed = await runHalfOn(C, ctxOf())
    expect(landed.states[landed.states.length - 1], landed.said).toBe('served:null')
  })
  it('⛔ ANOTHER SYMBOL\'s date never unlocks this chart (and a wrong date is no wait): refused, "has no bar on"', async () => {
    const C = CHART.slice(1)
    const agl = { ...ctxOf(OWN_D, '2021-04-15'), symbol: { ...RDDT, firstTradeDate: '2021-04-15', firstTradeDatePending: true } }
    const { sup } = supplyOn(C, agl)
    expect(sup.pending).toBe(false)
    // ⭐ (e91 ruling) the wrong date unlocks nothing: the listing session's pre-close bars stay unknown (DEPTH), never na
    expect(sup.refusal && sup.refusal.message).not.toMatch(/has no bar on/)
    expect(sup.refusal && sup.refusal.knownFrom, 'unknown before the first own close').toBe(lastBarOf(C, LISTING))
    const { states, said } = await runHalfOn(C, agl)
    expect(states[states.length - 1], said).not.toBe('refused:runtime:request')
  })
  it('⛔ CONTROL: a chart that does not start on the own rows\' first session never waits on the date', () => {
    const rows = CHART.filter((b) => b.t >= ET(SESS[2], 0, 0))
    const { sup } = supplyOn(rows, ctxPending())
    expect(sup.pending).toBe(false)
    expect(sup.refusal && sup.refusal.message).toBeFalsy()
  })
})
