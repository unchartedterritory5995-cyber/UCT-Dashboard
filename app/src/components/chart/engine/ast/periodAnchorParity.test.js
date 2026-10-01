// app/src/components/chart/engine/ast/periodAnchorParity.test.js
//
// ─── ⭐⭐ C36 — `time(<timeframe>)` WITHHELD THE SAME WAY IN BOTH LANES ─────────
//
// C30 served `time("W" / "M" / "3M" / "12M")` on a daily chart and withheld the
// first partial period — in the JS lanes only. The Python interpreter evaluated
// the same saved tree and read the anchor's `NaN` as Pine's `na`. That is not a
// hypothetical: three server consumers evaluate a member pane's saved document
// (a user-series alert, the scan sweep, the screen backtest), none of them
// supplies both a `tf` and an instant-readable `t`, and so the anchor was `NaN`
// on EVERY bar there: `na(time("W")) ? 111 : 222` answered a confident 111 and
// `ta.change(time("W")) != 0` a confident 0 on every bar.
//
// `api/services/ast_interpret.py::period_anchor_mask` is now the port of
// `interpret.js::periodAnchorMask`. This file and
// `tests/test_ast_period_anchor_parity.py` read ONE fixture
// (`tests/fixtures/ast/period_anchor_parity.json`), so a lane that drifts fails
// against the other lane's own output, never against a number retyped here.
//
// ⛔ THE TREES ARE THE MEMBER DOOR'S OWN. Each case's tree is what
// `translatePine(…, { strict: true })` writes for a line of Pine, and the first
// test below re-translates every one and compares — a fixture that drifted from
// the translator would be a parity proof about a tree nobody saves.
//
// To regenerate after a deliberate change (from `app/`):
//   PERIOD_ANCHOR_PARITY_WRITE=1 npx vitest run src/components/chart/engine/ast/periodAnchorParity.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { translatePine } from './pine.js'
import { interpret, CHART_CLOCK_WITHHELD } from './interpret.js'

const FIXTURE = '../tests/fixtures/ast/period_anchor_parity.json'
const WRITE = process.env.PERIOD_ANCHOR_PARITY_WRITE === '1'

const iso = (d) => d.toISOString().slice(0, 10)
/** `n` daily bars from a UTC date, weekdays only unless `weekends`. */
function dailyBars(start, n, { weekends = false, ints = false } = {}) {
  const out = []
  const d = new Date(Date.UTC(...start))
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (weekends || (dow !== 0 && dow !== 6)) {
      const i = out.length
      const c = 100 + Math.sin(i / 7) * 6 + i * 0.05
      const t = ints ? Number(iso(d).replace(/-/g, '')) : iso(d)
      out.push({ t, o: c - 0.4, h: c + 0.9, l: c - 0.9, c, v: 1000 + i })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
/** `n` hourly bars (unix seconds) from 2025-01-08 14:30 UTC — 09:30 New York. */
function hourlyBars(n) {
  const t0 = Date.UTC(2025, 0, 8, 14, 30) / 1000
  return Array.from({ length: n }, (_, i) => {
    const c = 50 + Math.cos(i / 5) * 2
    return { t: t0 + i * 3600, o: c, h: c + 0.5, l: c - 0.5, c, v: 10 }
  })
}

const BARSETS = {
  // 300 weekday sessions from Thu 2024-10-10: crosses a month, a quarter and a year
  weekdays: () => dailyBars([2024, 9, 10], 300),
  // 60 calendar days — Saturdays and Sundays included (a symbol that trades every day)
  everyDay: () => dailyBars([2025, 0, 8], 60, { weekends: true }),
  // the screen's stored key: a YYYYMMDD int, which the clock's unit gate refuses
  dateInts: () => dailyBars([2025, 0, 8], 30, { ints: true }),
  hourly: () => hourlyBars(40),
}

const PINE = {
  W: 'plot(time("W"))',
  M: 'plot(time("M"))',
  Q: 'plot(time("3M"))',
  Y: 'plot(time("12M"))',
  'na(W)': 'plot(na(time("W")) ? 111 : 222)',
  'change(W)': 'plot(ta.change(time("W")) != 0 ? 1 : 0)',
  'change(M)': 'plot(ta.change(time("M")) != 0 ? 1 : 0)',
  own: 'plot(time(timeframe.period))',
  sixty: 'plot(time("60"))',
  'na(own)': 'plot(na(time(timeframe.period)) ? 111 : 222)',
}
const treeOf = (key) => {
  const t = translatePine(`//@version=6\nindicator("p")\n${PINE[key]}\n`, { strict: true })
  if (!t.ok) throw new Error(`${key}: ${t.refusal && t.refusal.message}`)
  return t.outputs[t.selected].ast
}

/** [name, tree key, barset, opts] — every context a consumer can hand the tree. */
const CASES = [
  ...['W', 'M', 'Q', 'Y', 'na(W)', 'change(W)', 'change(M)'].map((k) => [`${k} · weekdays · D`, k, 'weekdays', { tf: 'D' }]),
  // the three server consumers' shapes, measured before this port: 111 / 0 on every bar
  ['na(W) · ISO dates · no tf (the screen backtest)', 'na(W)', 'weekdays', null],
  ['na(W) · date ints · D (the scan sweep)', 'na(W)', 'dateInts', { tf: 'D' }],
  ['na(W) · date ints · no tf (a user-series alert)', 'na(W)', 'dateInts', null],
  ['change(W) · date ints · D (the scan sweep)', 'change(W)', 'dateInts', { tf: 'D' }],
  ['change(W) · hourly · 60', 'change(W)', 'hourly', { tf: '60' }],
  // weekend bars: all four periods, every bar
  ...['W', 'M', 'Q', 'Y', 'na(W)'].map((k) => [`${k} · every day · D`, k, 'everyDay', { tf: 'D' }]),
  // time(timeframe.period) / time("60"): the two measured chart timeframes, and one that is not
  ['own · weekdays · D', 'own', 'weekdays', { tf: 'D' }],
  ['sixty · weekdays · D', 'sixty', 'weekdays', { tf: 'D' }],
  ['own · hourly · 60', 'own', 'hourly', { tf: '60' }],
  ['own · every day · D', 'own', 'everyDay', { tf: 'D' }],
  ['own · hourly · 5 (unmeasured)', 'own', 'hourly', { tf: '5' }],
  ['na(own) · hourly · 5 (unmeasured)', 'na(own)', 'hourly', { tf: '5' }],
  ['na(own) · weekdays · no tf', 'na(own)', 'weekdays', null],
]

function evaluate(ast, bars, opts) {
  const sink = new Map()
  const col = Array.from(interpret(ast, bars, {}, undefined, undefined, { ...(opts || {}), chartClockSink: sink }))
    .map((x) => (Number.isNaN(x) ? null : x))
  return { expected: col, codes: [...sink.keys()].sort() }
}

if (WRITE) {
  const bars = Object.fromEntries(Object.entries(BARSETS).map(([k, f]) => [k, f()]))
  const doc = {
    _: 'C36 — time(<timeframe>) withheld the same way in both lanes. Written by '
      + 'app/src/components/chart/engine/ast/periodAnchorParity.test.js (PERIOD_ANCHOR_PARITY_WRITE=1); '
      + 'read by that file and by tests/test_ast_period_anchor_parity.py. `expected` is the JS lane\'s own '
      + 'output (null = withheld / not computable); `codes` are the whole-series withholding codes '
      + '(interpret.js::CHART_CLOCK_WITHHELD) the mask named.',
    pine: PINE,
    bars,
    cases: CASES.map(([name, key, set, opts]) => ({
      name, pine: key, bars: set, ...(opts ? { opts } : {}), ast: treeOf(key), ...evaluate(treeOf(key), bars[set], opts),
    })),
  }
  writeFileSync(FIXTURE, `${JSON.stringify(doc)}\n`)
}

const PARITY = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const byName = new Map(PARITY.cases.map((c) => [c.name, c]))

describe('C36 · the fixture is the member door\'s own trees over the bars this file builds', () => {
  it('every case tree is what the translator writes today for its line of Pine', () => {
    expect(PARITY.cases.map((c) => c.name)).toEqual(CASES.map((c) => c[0]))
    for (const c of PARITY.cases) expect(c.ast, c.name).toEqual(treeOf(c.pine))
  })
  it('every barset is the one this file builds', () => {
    for (const [k, f] of Object.entries(BARSETS)) expect(PARITY.bars[k], k).toEqual(f())
  })
})

describe('C36 · parity with the Python lane — one fixture, both lanes', () => {
  it.each(PARITY.cases.map((c) => [c.name, c]))('⭐ %s — this lane reproduces the fixture', (_name, c) => {
    const got = evaluate(c.ast, PARITY.bars[c.bars], c.opts)
    expect(got.expected).toEqual(c.expected)
    expect(got.codes).toEqual(c.codes)
  })

  it('every code the fixture names is one `CHART_CLOCK_WITHHELD` holds a sentence for', () => {
    const codes = new Set(PARITY.cases.flatMap((c) => c.codes))
    expect([...codes].sort()).toEqual(['time-anchor:not-daily', 'time-anchor:weekend-bars', 'time-own:chart-unwitnessed'])
    for (const code of codes) expect(typeof CHART_CLOCK_WITHHELD[code]('5')).toBe('string')
  })
})

describe('C36 · the fixture is not vacuous', () => {
  const col = (name) => byName.get(name).expected
  const nulls = (name) => col(name).filter((v) => v === null).length

  it('on weekday daily bars the four periods are SERVED after their first partial period: 2 / 16 / 59 / 59 withheld', () => {
    // Thu 2024-10-10 → the first Monday (10-14), 16 weekdays to November, 59 to 2025 (quarter and year)
    expect(['W', 'M', 'Q', 'Y'].map((k) => nulls(`${k} · weekdays · D`))).toEqual([2, 16, 59, 59])
    for (const k of ['W', 'M', 'Q', 'Y']) expect(byName.get(`${k} · weekdays · D`).codes).toEqual([])
    // and the value is a real opening instant: Monday 2024-10-14 09:30 New York, in ms
    expect(col('W · weekdays · D')[2]).toBe(Date.UTC(2024, 9, 14, 13, 30))
  })

  it('`na(time("W"))` reads a KNOWN false where the anchor is known, and nothing where it is not', () => {
    const c = col('na(W) · weekdays · D')
    expect(c.slice(0, 2)).toEqual([null, null])
    expect(new Set(c.slice(2))).toEqual(new Set([222]))
  })

  it('⛔ the three server contexts answer NOTHING — never the confident 111 / 0 they answered before the port', () => {
    for (const name of ['na(W) · ISO dates · no tf (the screen backtest)', 'na(W) · date ints · D (the scan sweep)',
      'na(W) · date ints · no tf (a user-series alert)', 'change(W) · date ints · D (the scan sweep)']) {
      expect(col(name).every((v) => v === null), name).toBe(true)
    }
  })

  it('the new-week event holds both answers, and withholds the boundary bar that reads the partial week', () => {
    const c = col('change(W) · weekdays · D')
    expect(c.slice(0, 3)).toEqual([null, null, null])
    expect(c.slice(3)).toContain(1)
    expect(c.slice(3)).toContain(0)
  })

  it('weekend bars: every bar of all four periods withheld, and named', () => {
    for (const k of ['W', 'M', 'Q', 'Y', 'na(W)']) {
      const c = byName.get(`${k} · every day · D`)
      expect(c.expected.every((v) => v === null), k).toBe(true)
      expect(c.codes, k).toEqual(['time-anchor:weekend-bars'])
    }
  })

  it('`time(timeframe.period)` / `time("60")` are the bar\'s own time on 1D and 60m, withheld and named on 5m', () => {
    expect(col('own · weekdays · D')[0]).toBe(Date.UTC(2024, 9, 10, 13, 30))
    expect(col('sixty · weekdays · D')).toEqual(col('own · weekdays · D'))
    expect(col('own · hourly · 60')[0]).toBe(Date.UTC(2025, 0, 8, 14, 30))
    expect(nulls('own · weekdays · D') + nulls('own · hourly · 60') + nulls('own · every day · D')).toBe(0)
    for (const name of ['own · hourly · 5 (unmeasured)', 'na(own) · hourly · 5 (unmeasured)', 'na(own) · weekdays · no tf']) {
      expect(col(name).every((v) => v === null), name).toBe(true)
      expect(byName.get(name).codes, name).toEqual(['time-own:chart-unwitnessed'])
    }
  })
})
