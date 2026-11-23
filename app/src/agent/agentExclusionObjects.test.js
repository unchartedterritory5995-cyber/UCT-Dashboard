// EXCLUSION OBJECTS (pl-exclhole, AUDIT 11-23 T2). Two production holes in the exclusion readers:
//   (1) "set every chart to monthly but not the daily ones" (1 weekly + 3 daily, a plan on all 4) APPLIED to all 4 — the reader
//       read nothing for a DESCRIPTIVE exclusion ([], not UNPLACED); "leave the daily ones and the weekly one alone" the same;
//   (2) "set all to weekly except SPY, QQQ and NVDA" excluded only SPY (the keyword reader stopped at the comma) and the question
//       OFFERED QQQ and NVDA.
// spatialCheck.readExclusionObjects reads every exclusion cue's OBJECT as a list of items, each a description placed on the board's
// own state (timeframe, chart type, size, ticker) or a position (the legacy resolver) — exact when the board places it, UNPLACED
// (asked, the charts it may mean never offered) otherwise. Class-generated:
//   (1) EXACT / UNPLACED: board × cue form × described set (timeframes, chart types, sizes, tickers, positions; singular and
//       plural; present and absent on the board) × list (2–4 items with ", " / " and " / " or " / " & " / ", and ") × plan
//       (exactly the other charts, every chart, a subset with one excluded chart):
//         - a plan touching an excluded chart never passes the net (checkSpatialConstraints asks) and loses exactly those ops
//           (withoutExcludedCharts); a question never offers an excluded chart nor one an UNPLACED item may mean;
//         - exact: the plan on exactly the other charts passes untouched.
//   (2) NON-VACUITY (the invariant): every class reader switched off (opts.xoDisable) under every cue form → UNPLACED, never
//       "exclude nothing" (and with the reader on, the exact set — so the reader is what decides).
//   (3) CONTROLS: contrasts and values excluded nothing before and still exclude nothing ("weekly, not daily", "except volume",
//       "anything other than daily", "keep the daily ones" alone, "not the chart I meant").
//   (4) EVERY CHART-BACKED MUTATION FAMILY (registry-enumerated) × the two reported sentences and their classes.
// The expected set comes from the board's own construction (each chart's timeframe / type / cell / symbol), never from the
// reader. LOCAL (vitest, unit; no model).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { chartRefOf } from './deixis'
import { excludedCharts, checkSpatialConstraints, withoutExcludedCharts, UNPLACED } from './spatialCheck'

registerBuiltins()

// ── boards (the real fixture host): [id, x, y, w, h, symbol, tf, chartType] ──
function boardOf(name, cells) {
  const fb = makeBoard(cells.map(([id, x, y, w, h, , tf, type]) => ({
    id, type: 'chart', x, y, w, h, color: 'N',
    opts: { settings: mergeChartSettings(type ? { chartType: type } : null), ...(tf ? { tf } : {}) },
  })), Object.fromEntries(cells.map(([id, , , , , sym]) => [`N:${id}`, sym])))
  const host = { ...fb.host, charts: { ...fb.host.charts, selected: () => null, canManageIndicators: () => true, canCreateIndicator: () => true } }
  const meta = cells.map(([id, x, y, w, h, sym, tf, type]) => ({ ref: id, x, y, w, h, area: w * h, sym, tf: tf || 'D', type: type || 'candles' }))
  // board order (the host's: by row, then column) — "chart N"
  const order = [...meta].sort((a, b) => a.y - b.y || a.x - b.x).map(m => m.ref)
  return { name, host, meta, order, live: () => host.charts.list() }
}
const AUDIT = boardOf('2x2 audit (W D / D D)', [['TL', 0, 0, 12, 10, 'SPY', 'W'], ['TR', 12, 0, 12, 10, 'QQQ', 'D'], ['BL', 0, 10, 12, 10, 'NVDA', 'D'], ['BR', 12, 10, 12, 10, 'AAPL', 'D']])
const MIXED = boardOf('2x3 mixed', [
  ['c0', 0, 0, 8, 10, 'SPY', 'D'], ['c1', 8, 0, 8, 10, 'QQQ', 'W', 'line'], ['c2', 16, 0, 8, 10, 'NVDA', 'D'],
  ['c3', 0, 10, 8, 10, 'AMD', '60'], ['c4', 8, 10, 8, 10, 'MSFT', 'M', 'line'], ['c5', 16, 10, 8, 10, 'META', 'W', 'bars'],
])
const ROW = boardOf('1x3 (5m D D)', [['a', 0, 0, 8, 10, 'SPY', '5'], ['b', 8, 0, 8, 10, 'QQQ', 'D'], ['c', 16, 0, 8, 10, 'NVDA', 'D']])
const SIZED = boardOf('big top + 2 small', [['big', 0, 0, 24, 10, 'SPY', 'D'], ['s1', 0, 10, 12, 10, 'QQQ', 'W'], ['s2', 12, 10, 12, 10, 'NVDA', 'D', 'line']])
const DUP = boardOf('2x2 SPY twice', [['p', 0, 0, 12, 10, 'SPY', 'D'], ['q', 12, 0, 12, 10, 'QQQ', 'D'], ['r', 0, 10, 12, 10, 'SPY', 'W'], ['s', 12, 10, 12, 10, 'NVDA', 'W']])
const BOARDS = [AUDIT, MIXED, ROW, SIZED, DUP]

// ── the described sets: { x: words, exact: [refs] } | { x, unplaced: true, may: [refs never offered] } — from the board's meta ──
const TFS = [['daily', 'D', 'dailies'], ['weekly', 'W', 'weeklies'], ['monthly', 'M', 'monthlies'], ['hourly', '60', null], ['5 minute', '5', null]]
const TYPES = [['line', 'line'], ['bar', 'bars'], ['candlestick', 'candles']]
const pick = (hits, plural) => (hits.length && (plural || hits.length === 1) ? { exact: hits } : { unplaced: true, may: hits.length > 1 ? hits : [] })
function described(b) {
  const out = []
  const add = (cls, x, v) => out.push({ cls, x, ...v })
  for (const [w, code, pl] of TFS) {
    const hits = b.meta.filter(m => m.tf === code).map(m => m.ref)
    for (const x of [`the ${w} ones`, `the ${w} charts`, `the ones on ${w}`, `all the ${w} charts`, `the charts set to ${w}`, ...(pl ? [`the ${pl}`] : [])]) add('timeframe', x, pick(hits, true))
    for (const x of [`the ${w} one`, `the ${w} chart`]) add('timeframe', x, pick(hits, false))
  }
  for (const [w, t] of TYPES) {
    const hits = b.meta.filter(m => m.type === t).map(m => m.ref)
    for (const x of [`the ${w} charts`, `the ${w} ones`]) add('type', x, pick(hits, true))
    add('type', `the ${w} chart`, pick(hits, false))
  }
  const areas = b.meta.map(m => m.area), hi = Math.max(...areas), lo = Math.min(...areas)
  const big = b.meta.filter(m => m.area === hi).map(m => m.ref), small = b.meta.filter(m => m.area === lo).map(m => m.ref)
  const same = hi === lo
  for (const x of ['the big chart', 'the biggest one', 'the large chart']) add('size', x, same ? { unplaced: true, may: b.meta.map(m => m.ref) } : pick(big, false))
  add('size', 'the small ones', same ? { unplaced: true, may: b.meta.map(m => m.ref) } : pick(small, true))
  const bySym = {}
  for (const m of b.meta) (bySym[m.sym] = bySym[m.sym] || []).push(m.ref)
  for (const [sym, refs] of Object.entries(bySym)) {
    for (const x of [sym, `${sym}'s chart`, `the ${sym} chart`]) add('ticker', x, pick(refs, false))
    if (refs.length > 1) for (const x of [`the ${sym} charts`, `both ${sym} charts`]) add('ticker', x, pick(refs, true))
  }
  const rows = [...new Set(b.meta.map(m => m.y))].sort((p, q) => p - q)
  if (rows.length === 2 && b.meta.every(m => b.meta.filter(o => o.y === m.y).length > 1)) {
    add('position', 'the top row', { exact: b.meta.filter(m => m.y === rows[0]).map(m => m.ref) })
    add('position', 'the bottom row', { exact: b.meta.filter(m => m.y === rows[1]).map(m => m.ref) })
  }
  for (let k = 1; k <= b.order.length; k++) add('position', `chart ${k}`, { exact: [b.order[k - 1]] })
  return out
}
// ── the cue forms (X = the object) and the quantified changes ──
const FORMS = {
  'but not X': (x) => ` but not ${x}`,
  'except X': (x) => ` except ${x}`,
  'except for X': (x) => ` except for ${x}`,
  'other than X': (x) => ` other than ${x}`,
  'apart from X': (x) => ` apart from ${x}`,
  'aside from X': (x) => ` aside from ${x}`,
  'excluding X': (x) => ` excluding ${x}`,
  'but leave X alone': (x) => ` but leave ${x} alone`,
  'leave X as is': (x) => `, leave ${x} as is`,
  'skip X': (x) => `, skip ${x}`,
  "don't touch X": (x) => `, but don't touch ${x}`,
  'ignore X': (x) => `, ignore ${x}`,
  'keep X the same': (x) => ` but keep ${x} the same`,
  'not X': (x) => `, not ${x}`,
}
const CHANGES = ['set every chart to monthly', 'set all to monthly', 'add RSI to every chart', 'make everything monthly', 'switch all of them to 1h']
const SEPS2 = [' and ', ' or ', ', ', ' & ', ', and ']
const join = (xs, i) => (xs.length === 2 ? xs.join(SEPS2[i % SEPS2.length]) : `${xs.slice(0, -1).join(', ')}${[' and ', ' or ', ' & ', ', and '][i % 4]}${xs[xs.length - 1]}`)

// the expected verdict of a list: the union of its exact items; UNPLACED when any item is (its "may" never offered)
function verdictOf(items) {
  const ex = new Set(), may = new Set()
  let unplaced = false
  for (const d of items) { if (d.unplaced) { unplaced = true; for (const r of d.may) may.add(r) } else for (const r of d.exact) ex.add(r) }
  return { exact: [...ex].sort(), unplaced, may: [...may] }
}
const opsOn = (refs) => refs.map(r => ({ action: 'chart.setTimeframe', target: r, args: { timeframe: 'M' } }))
const deps = (b) => ({ host: b.host, getCapability, getTargetKind })
const read = (b, t, opts = {}) => {
  const e = excludedCharts(t, b.live(), null, opts)
  return { ex: [...e].filter(x => x !== UNPLACED).sort(), unplaced: e.has(UNPLACED), unoffered: [...(e.unoffered || [])] }
}
// the cue forms an object fits: "not X" reads only an object with a chart noun or a board ticker (a bare value is a contrast)
// ("not all the daily charts" may mean some of them: its own case below)
const fits = (form, x) => form !== 'not X' || (/\b(?:charts?|ones?|dailies|weeklies|monthlies)\b|^[A-Z]|\bchart \d/.test(x) && !/^all\b/.test(x))

// one row = one sentence, its board and its expected verdict
const ROWS = []
for (const b of BOARDS) {
  const ds = described(b)
  const forms = Object.keys(FORMS)
  ds.forEach((d, i) => {
    for (const f of forms) if (fits(f, d.x)) ROWS.push({ b, f, kind: `single ${d.cls}`, t: `${CHANGES[(i + f.length) % CHANGES.length]}${FORMS[f](d.x)}`, v: verdictOf([d]) })
  })
  // lists of 2–4 items, mixed classes, every separator (deterministic sampling)
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i < ds.length; i += n + 1) {
      const items = []
      for (let k = 0; items.length < n && k < ds.length; k++) { const d = ds[(i + k * 7) % ds.length]; if (!items.some(o => o.x === d.x)) items.push(d) }
      if (items.length < n) continue
      const x = join(items.map(d => d.x), i)
      const f = forms[(i + n) % forms.length]
      if (fits(f, x)) ROWS.push({ b, f, kind: `list of ${n}`, t: `${CHANGES[i % CHANGES.length]}${FORMS[f](x)}`, v: verdictOf(items) })
    }
  }
}

describe('(1) a described exclusion is exact or UNPLACED — never nothing; a plan touching it never passes, a question never offers it', () => {
  it('the class covers every board, cue form, description class and list length', () => {
    expect(ROWS.length).toBeGreaterThan(1500)
    for (const k of ['single timeframe', 'single type', 'single size', 'single ticker', 'single position', 'list of 2', 'list of 3', 'list of 4']) expect(ROWS.some(r => r.kind === k), k).toBe(true)
    for (const f of Object.keys(FORMS)) expect(ROWS.some(r => r.f === f), f).toBe(true)
    expect(ROWS.some(r => r.v.unplaced)).toBe(true)
    expect(ROWS.some(r => !r.v.unplaced && r.v.exact.length)).toBe(true)
  })
  it('the READER: exactly the described set, or UNPLACED with every chart it may mean unoffered', () => {
    const miss = []
    for (const { b, kind, t, v } of ROWS) {
      const r = read(b, t)
      if (!v.unplaced) {
        if (r.unplaced || JSON.stringify(r.ex) !== JSON.stringify(v.exact)) miss.push(`${b.name} · ${kind} · "${t}" → ${JSON.stringify(r)} (want ${v.exact})`)
      } else {
        if (!r.unplaced) miss.push(`${b.name} · ${kind} · "${t}" → NOT UNPLACED ${JSON.stringify(r)}`)
        for (const x of v.exact) if (!r.ex.includes(x)) miss.push(`${b.name} · "${t}" → ${x} not excluded`)
        for (const x of v.may) if (!r.unoffered.includes(x) && !r.ex.includes(x)) miss.push(`${b.name} · "${t}" → ${x} may be meant but is offered`)
      }
    }
    expect(miss.slice(0, 40), `${miss.length} misses of ${ROWS.length}`).toEqual([])
  })
  it('the NET: every plan that touches an excluded / uncertain chart is asked (never run) and the question never offers one', () => {
    const miss = []
    for (const { b, t, v } of ROWS) {
      const all = b.meta.map(m => m.ref)
      const never = new Set([...v.exact, ...v.may])
      const other = all.filter(r => !v.exact.includes(r))
      const plans = [['all', all]]
      if (v.exact.length && other.length) plans.push(['subset', [v.exact[0], other[0]]])
      for (const [pn, refs] of plans) {
        const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(refs), text: t })
        if (!k?.ask) { miss.push(`${b.name} · ${pn} · "${t}": RAN`); continue }
        for (const c of k.ask.choices) if (never.has(c.ref)) miss.push(`${b.name} · ${pn} · "${t}": OFFERED ${c.ref}`)
        // the apply gate: never an op on an excluded chart
        const g = withoutExcludedCharts(opsOn(refs), [t], deps(b))
        for (const o of g.ops) if (v.exact.includes(o.target)) miss.push(`${b.name} · ${pn} · "${t}": KEPT op on ${o.target}`)
      }
    }
    expect(miss.slice(0, 40), `${miss.length} misses`).toEqual([])
  })
  it('EXACT: a plan on exactly the other charts is honoured (passes the net, loses no op)', () => {
    const miss = []
    for (const { b, t, v } of ROWS) {
      if (v.unplaced || !v.exact.length) continue
      const other = b.meta.map(m => m.ref).filter(r => !v.exact.includes(r))
      if (!other.length) continue
      const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(other), text: t })
      const g = withoutExcludedCharts(opsOn(other), [t], deps(b))
      if (k || g.dropped) miss.push(`${b.name} · "${t}": ${k ? 'asked' : ''} ${g.dropped ? `dropped ${g.dropped}` : ''}`)
    }
    expect(miss.slice(0, 40), `${miss.length} misses`).toEqual([])
  })
})

describe('the two reported holes, exactly', () => {
  it('"…but not the daily ones" (1 weekly, 3 daily): the daily charts are excluded; a plan on all 4 is asked, only the weekly one offered', () => {
    for (const t of ['set every chart to monthly but not the daily ones', 'set every chart to monthly, but leave the daily ones and the weekly one alone']) {
      const r = read(AUDIT, t)
      const want = t.includes('weekly one') ? ['BL', 'BR', 'TL', 'TR'] : ['BL', 'BR', 'TR']
      expect(r, t).toEqual({ ex: want, unplaced: false, unoffered: [] })
      const k = checkSpatialConstraints({ ...deps(AUDIT), ops: opsOn(['TL', 'TR', 'BL', 'BR']), text: t })
      expect(k?.ask, t).toBeTruthy()
      expect(k.ask.choices.map(c => c.ref).filter(x => want.includes(x)), t).toEqual([])
    }
    expect(checkSpatialConstraints({ ...deps(AUDIT), ops: opsOn(['TL']), text: 'set every chart to monthly but not the daily ones' })).toBeNull()
  })
  it('"…except SPY, QQQ and NVDA": all three excluded; the question offers only AAPL', () => {
    for (const sep of [', QQQ and ', ', QQQ, and ', ', QQQ or ', ', QQQ & ', ' and QQQ and ', ', QQQ, ']) {
      const t = `set all to weekly except SPY${sep}NVDA`
      expect(read(AUDIT, t), t).toEqual({ ex: ['BL', 'TL', 'TR'], unplaced: false, unoffered: [] })
      const k = checkSpatialConstraints({ ...deps(AUDIT), ops: opsOn(['TL', 'TR', 'BL', 'BR']), text: t })
      expect(k.ask.choices.map(c => c.ref), t).toEqual(['BR'])
      expect(checkSpatialConstraints({ ...deps(AUDIT), ops: opsOn(['BR']), text: t }), t).toBeNull()
    }
  })
  it('subject position and a replacement value end the object; a narrowing never does', () => {
    expect(read(AUDIT, 'everything except the weekly one goes monthly')).toEqual({ ex: ['TL'], unplaced: false, unoffered: [] })
    expect(read(AUDIT, 'replace every chart except the daily ones with AMD')).toEqual({ ex: ['BL', 'BR', 'TR'], unplaced: false, unoffered: [] })
    for (const t of ['set all to monthly but leave the daily ones with RSI alone', 'set all to monthly except the daily ones in the top row']) {
      const r = read(AUDIT, t)
      expect(r.unplaced, t).toBe(true)
      for (const x of ['TR', 'BL', 'BR']) expect([...r.ex, ...r.unoffered], t).toContain(x)
    }
  })
  it('a mixed list — description + ticker + position ("the weekly one, AAPL and chart 3")', () => {
    expect(read(AUDIT, 'set all to monthly except the weekly one, AAPL and chart 3')).toEqual({ ex: ['BL', 'BR', 'TL'], unplaced: false, unoffered: [] })
    expect(read(MIXED, 'set all to monthly but leave the weekly ones, the line charts and AMD alone')).toEqual({ ex: ['c1', 'c3', 'c4', 'c5'], unplaced: false, unoffered: [] })
  })
  it('a description the reader cannot narrow ("the daily ones in the top row") is UNPLACED, every chart it may mean unoffered', () => {
    const r = read(AUDIT, 'set all to monthly except the daily ones in the top row')
    expect(r.unplaced).toBe(true)
    for (const x of ['TR', 'BL', 'BR']) expect(r.unoffered).toContain(x)
  })
})

describe('(2) NON-VACUITY: each class reader switched off → UNPLACED (never "exclude nothing"); on → the exact set', () => {
  const CLASS = [
    ['timeframe', AUDIT, 'the daily ones'], ['timeframe', AUDIT, 'the dailies'], ['timeframe', MIXED, 'the ones on weekly'],
    ['type', MIXED, 'the line charts'], ['size', SIZED, 'the big chart'], ['ticker', AUDIT, 'QQQ'], ['ticker', DUP, 'the SPY charts'],
    ['position', AUDIT, 'the top row'], ['position', MIXED, 'chart 4'], ['list', AUDIT, 'SPY, QQQ and NVDA'], ['list', MIXED, 'the dailies and the line charts'],
  ]
  const rows = []
  for (const [cls, b, x] of CLASS) for (const f of Object.keys(FORMS)) if (fits(f, x)) rows.push([cls, b, `set every chart to monthly${FORMS[f](x)}`])
  it(`${rows.length} sentences × the reader on / off`, () => {
    const miss = []
    for (const [cls, b, t] of rows) {
      const on = read(b, t)
      const off = read(b, t, { xoDisable: [cls] })
      if (on.unplaced || !on.ex.length) miss.push(`ON ${cls} "${t}" → ${JSON.stringify(on)}`)
      if (!off.unplaced) miss.push(`OFF ${cls} "${t}" → ${JSON.stringify(off)} (a silent run)`)
      // the net with the reader off: a plan on every chart is asked
      if (!checkSpatialConstraints({ ...deps(b), ops: opsOn(b.meta.map(m => m.ref)), text: t })?.ask) miss.push(`NET ${cls} "${t}": RAN`)
    }
    expect(miss, `${miss.length} misses`).toEqual([])
  })
  it('the stative keep and the negated imperative are read by the same class readers (off → UNPLACED)', () => {
    for (const [t, cls] of [['set all to monthly, the daily ones stay as they are', 'timeframe'], ['add RSI to every chart but never add it to the daily ones', 'timeframe'], ['set every chart to monthly; the line charts are fine', 'type']]) {
      const b = cls === 'type' ? MIXED : AUDIT
      expect(read(b, t, { xoDisable: [cls] }).unplaced, t).toBe(true)
      expect(read(b, t).ex.length, t).toBeGreaterThan(0)
    }
  })
})

describe('(3) controls: a contrast or a value is no chart set (as before)', () => {
  it.each([
    'make everything weekly, not daily', 'set all to monthly except volume', 'set every chart to anything other than daily',
    'add RSI to every chart except on Fridays', 'keep the daily ones', 'set all to weekly, not the chart I meant', 'remove all indicators except RSI',
    'set the timeframe to something other than weekly',
  ])('"%s" excludes nothing', (t) => {
    expect(read(AUDIT, t)).toEqual({ ex: [], unplaced: false, unoffered: [] })
  })
  it('a ticker the board does not show excludes nothing (master policy); its possessive is UNPLACED', () => {
    expect(read(AUDIT, 'set all to weekly except TSLA')).toEqual({ ex: [], unplaced: false, unoffered: [] })
    expect(read(AUDIT, 'set all to weekly except TSLA and QQQ')).toEqual({ ex: ['TR'], unplaced: false, unoffered: [] })
    expect(read(AUDIT, "set all to weekly except Apple's").unplaced).toBe(true)
  })
})

// ── (4) every chart-backed mutation family on the AUDIT board ──
const IDS = ['TL', 'TR', 'BL', 'BR']
const FAMILIES = allCapabilityNames().map(name => {
  const c = getCapability(name)
  if (!c || c.query) return null
  const kind = getTargetKind(c.target)
  if (!kind) return null
  let list = []
  try { list = kind.list(AUDIT.host) || [] } catch { return null }
  const byChart = Object.fromEntries(IDS.map(id => [id, list.find(s => chartRefOf(kind, s) === id)]))
  return IDS.every(id => byChart[id]) ? { name, kind, byChart } : null
}).filter(Boolean)
const famOps = (f, ids) => ids.map(id => ({ action: f.name, target: f.byChart[id].ref, args: {} }))
const WORDS = [
  ['do it on every chart but not the daily ones', ['TR', 'BL', 'BR']],
  ['do it on all, but leave the daily ones and the weekly one alone', IDS],
  ['do it on all except SPY, QQQ and NVDA', ['TL', 'TR', 'BL']],
  ['do it on everything apart from the dailies', ['TR', 'BL', 'BR']],
  ['do it on every chart, skip the weekly one or AAPL', ['TL', 'BR']],
  ["do it on all of them, but don't touch QQQ, NVDA & AAPL", ['TR', 'BL', 'BR']],
]
describe('(4) every mutation family the targeting layer serves (registry-enumerated)', () => {
  it('the registry yields the chart-backed families', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(20)
    for (const n of ['indicator.add', 'chart.setTimeframe']) expect(FAMILIES.map(f => f.name)).toContain(n)
  })
  it.each(FAMILIES.flatMap(f => WORDS.map(([t, ex]) => [f.name, t, ex, f])))('%s — "%s": never acted on an excluded chart, never offered', (_n, t, ex, f) => {
    const d = deps(AUDIT)
    const k = checkSpatialConstraints({ ...d, ops: famOps(f, IDS), text: t })
    expect(k?.ask).toBeTruthy()
    for (const c of k.ask.choices) expect(ex).not.toContain(chartRefOf(f.kind, f.kind.list(AUDIT.host).find(s => s.ref === c.ref)))
    const g = withoutExcludedCharts(famOps(f, IDS), [t], d)
    for (const o of g.ops) expect(ex).not.toContain(chartRefOf(f.kind, f.kind.list(AUDIT.host).find(s => s.ref === o.target)))
    const rest = IDS.filter(id => !ex.includes(id))
    if (rest.length) expect(checkSpatialConstraints({ ...d, ops: famOps(f, rest), text: t })).toBeNull()
  })
})
