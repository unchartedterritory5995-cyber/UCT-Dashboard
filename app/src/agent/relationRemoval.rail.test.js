// ── RELATION-WORD REMOVALS at the RAIL (chartRail relationWordRefusal · D31 P2 shadow report, AUDIT 11-17) ─────────────────
// Generated families, never single phrases: paraphrase × board shape (2–4 charts, a linked pair) × anchor kind (the click · the
// conversation chart · the previous chart · a kept chart · a named chart · none) × plan column, run through the REAL chart rail
// (planOps on the board kind → chartRailRefusal), the way useAgent.railOf calls it. The expected outcome is a small reference
// MODEL written here (objects, anchors, board order) — independent of the rail code.
//   SAFETY (asserted): the rail never APPLIES a plan the model blocks — no anchor, no pick from several, no chart outside.
//   Over-asks (the model resolves, the rail blocks) are counted and capped at the locked baseline below (ratchet down only).
import { describe, it, expect, afterAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { planOps, collectTargets, prepareOps } from './executor'
import { buildContext } from './capabilities'
import { chartRailRefusal } from './chartRail'

registerBuiltins()

const POOL = ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT', 'DIA']
const VERBS = ['close', 'remove', 'delete', 'get rid of', 'drop']
const PARA = {
  complementOne: ['the other one', 'the other chart', 'that other chart', 'the other panel'],
  complementSet: ['the others', 'the other charts', 'the rest', 'all the others', 'all the other charts', 'the other ones'],
  complementN: [(n) => `the other ${['', '', 'two', 'three', 'four'][n]}`, (n) => `the other ${n} charts`],
  everyOther: ['every other chart', 'every other one'],
  both: ['both of them', 'both of those', 'both of these'],
  bothCharts: ['both charts', 'both the charts'],
  order: [['after', 'the chart after'], ['after', 'the one following'], ['before', 'the chart before'], ['before', 'the one preceding']],
}
const SHAPES = [{ shape: 'two', n: 2 }, { shape: 'three', n: 3 }, { shape: 'four', n: 4 }, { shape: 'three-linked', n: 3, link: [1, 2] }, { shape: 'four-linked', n: 4, link: [2, 3] }]

// ── the board (makeBoard: a linked pair shares link color 'L' and its symbol) ──
function boardOf(syms, link, selected) {
  const cw = syms.length > 3 ? 6 : 8
  const widgets = syms.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * cw, y: 0, w: cw, h: 20, color: link && link.includes(i) ? 'L' : 'N', opts: { settings: mergeChartSettings(null) } }))
  const g = {}
  syms.forEach((s, i) => { if (link && link.includes(i)) g.L = syms[link[0]]; else g[`N:c${i + 1}`] = s })
  const b = makeBoard(widgets, g)
  return { ...b.host, charts: { ...b.host.charts, selected: () => selected } }
}
async function railOf(host, refs, ctx) {
  const ops = refs.map(r => ({ action: 'widget.remove', target: 'board', args: { widget: r } }))
  buildContext(host, { surface: 'charts' })
  const plan = await planOps(collectTargets(host, ['board']), ops, { ...(await prepareOps(ops)), boundDrawingIds: new Set(), boundAlerts: [] }, { surface: 'charts' })
  if (!plan.ok) return { verdict: 'unbuilt' }
  const text = chartRailRefusal(plan, { words: ctx.words, host, mode: 'apply', subject: ctx.subject, picked: null, previous: ctx.previous, previousLabel: null })
  return { verdict: text == null ? 'resolved' : 'blocked', text }
}

// ── the reference MODEL (objects = link groups) ──
function model(fam, w, o = {}) {
  const all = w.refs
  const obj = (r) => (w.link && w.link.includes(all.indexOf(r)) ? 'g' : r)
  const expand = (rs) => all.filter(r => rs.some(x => obj(x) === obj(r)))
  const objects = (rs) => new Set(rs.map(obj)).size
  const prev = w.previous ? w.previous.slice(6) : null
  const pointer = () => { const r = [w.selection, w.subject, prev].find(x => x != null); return r != null ? expand([r]) : [] }
  if (fam === 'everyOther') return { block: true }
  if (fam === 'complement') {
    const anchor = o.kept ? expand([o.kept]) : pointer()
    const pool = all.filter(r => !anchor.includes(r))
    if (!anchor.length || !pool.length) return { block: true, anchor }
    const want = o.n ?? (o.plural ? null : 1)
    if (want != null && objects(pool) !== want) return { block: true, anchor }
    return { R: pool, anchor, plural: !!o.plural }
  }
  if (fam === 'both') {
    const set = o.pron ? [...new Set([...(w.selection ? expand([w.selection]) : []), ...([w.subject, prev].find(x => x != null) ? expand([[w.subject, prev].find(x => x != null)]) : [])])] : []
    if (set.length && objects(set) === 2) return { R: set, anchor: [], plural: true }
    if (objects(all) === 2) return { R: all, anchor: [], plural: true }
    return { block: true, anchor: [] }
  }
  if (fam === 'order') {
    const anchor = o.named ? expand([o.named]) : pointer()
    if (!anchor.length) return { block: true, anchor }
    const idx = anchor.map(r => all.indexOf(r))
    const t = all[o.side === 'after' ? Math.max(...idx) + 1 : Math.min(...idx) - 1]
    return t == null ? { block: true, anchor } : { R: expand([t]), anchor }
  }
  throw new Error(fam)
}
function columns(m, w) {
  const all = w.refs
  const cols = []
  if (m.R) {
    cols.push(['referent', m.R, 'resolved'])
    if (m.plural && m.R.length > 1) cols.push(['oneOfSet', [m.R[0]], 'resolved'])
  }
  for (const r of m.anchor || []) cols.push(['anchor', [r], 'blocked'])
  if (m.R && m.anchor?.length) cols.push(['referentAndAnchor', [...m.R, m.anchor[0]], 'blocked'])
  const outside = all.filter(r => !(m.R || []).includes(r) && !(m.anchor || []).includes(r))
  for (const r of outside) cols.push([m.R ? 'outside' : 'pick', [r], 'blocked'])
  if (!m.R && outside.length > 1) cols.push(['pickTwo', outside.slice(0, 2), 'blocked'])
  return cols
}

export function railRelationCases(seed = 7) {
  let a = seed >>> 0
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
  const out = []
  let k = 0
  const push = (fam, words, w, m, meta) => { for (const [col, plan, expect] of columns(m, w)) out.push({ id: `rr-${fam}-${String(++k).padStart(4, '0')}`, fam, words, w, plan, expect, col, ...meta }) }
  for (const sh of SHAPES) {
    const syms = [...POOL].sort(() => rnd() - 0.5).slice(0, sh.n)
    const refs = syms.map((_, i) => `c${i + 1}`)
    for (let i = 0; i < sh.n; i++) {
      for (const [anchorKind, ctx] of [['click', { selection: refs[i] }], ['subject', { subject: refs[i] }], ['previous', { previous: `chart:${refs[i]}` }], ['none', {}]]) {
        if (anchorKind === 'none' && i > 0) continue
        const w = { syms, refs, link: sh.link || null, selection: null, subject: null, previous: null, ...ctx }
        const meta = { shape: sh.shape, anchorKind }
        const V = () => pick(VERBS)
        for (const p of PARA.complementOne) push('complement', `${V()} ${p}`, w, model('complement', w), meta)
        for (const p of PARA.complementSet) push('complement', `${V()} ${p}`, w, model('complement', w, { plural: true }), meta)
        for (const n of [2, 3]) push('complement', `${V()} ${pick(PARA.complementN)(n)}`, w, model('complement', w, { n, plural: true }), meta)
        for (const p of PARA.everyOther) push('everyOther', `${V()} ${p}`, w, model('everyOther', w), meta)
        const wb = anchorKind === 'click' ? { ...w, subject: refs[(i + 1) % sh.n] } : w
        for (const p of PARA.both) push('both', `${V()} ${p}`, wb, model('both', wb, { pron: true }), meta)
        if (anchorKind === 'none') for (const p of PARA.bothCharts) push('both', `${V()} ${p}`, w, model('both', w), meta)
        for (const [side, p] of PARA.order) push('order', `${V()} ${p} ${pick(['this one', 'it', 'this chart'])}`, w, model('order', w, { side }), meta)
        if (anchorKind === 'none' && !sh.link) {
          for (let x = 0; x < sh.n; x++) { const [side, p] = pick(PARA.order); push('order', `${V()} ${p} the ${syms[x]} chart`, w, model('order', w, { side, named: refs[x] }), { ...meta, anchorKind: 'named' }) }
          for (let x = 0; x < sh.n; x++) push('complement', `keep the ${syms[x]} chart, ${V()} ${pick(PARA.complementOne)}`, w, model('complement', w, { kept: refs[x] }), { ...meta, anchorKind: 'kept' })
        }
      }
    }
  }
  // ── THING-ABOUT (AUDIT 11-17 mutant: thingAbout pinned false): a generic "the other one / the others / both of them" said about a
  // THING — the previous target was a thing, or the words name a thing noun — is no chart: every chart close is blocked ──
  const THING_PREV = ['ind:c1:rsi', 'draw:SPY:dr-1', 'list:wl1', 'alert:a1']
  const THING_NOUN = ['RSI', 'trendline', 'MACD', 'fib', 'alert', 'moving average', 'horizontal line']
  const generic = [...PARA.complementOne.filter(p => !/chart|panel/.test(p)), ...PARA.complementSet.filter(p => !/charts/.test(p)), ...PARA.both]
  // the ORDER branch's generic form ("the one after it / before that / following this one")
  const ORDER_GENERIC = ['the one after', 'the one before', 'the one following', 'the one preceding']
  const ORDER_ANCHOR = ['it', 'that', 'this one']
  for (const sh of SHAPES.filter(s => !s.link)) {
    const syms = [...POOL].sort(() => rnd() - 0.5).slice(0, sh.n)
    const refs = syms.map((_, i) => `c${i + 1}`)
    const pushAll = (words, w, kind) => {
      const fam = /^order/.test(kind) ? 'thingAboutOrder' : 'thingAbout'
      for (const [col, plan] of [...refs.map(r => ['chart', [r]]), ['allCharts', [...refs]]]) out.push({ id: `rr-thing-${String(++k).padStart(4, '0')}`, fam, words, w, plan, expect: 'blocked', col, shape: sh.shape, anchorKind: kind })
    }
    for (let i = 0; i < sh.n; i++) {
      for (const p of ORDER_GENERIC) {
        const words = `${p} ${pick(ORDER_ANCHOR)}`
        pushAll(`${pick(VERBS)} ${words}`, { syms, refs, link: null, selection: refs[i], subject: refs[(i + 1) % sh.n], previous: pick(THING_PREV) }, 'orderPreviousThing')
        pushAll(`the ${pick(THING_NOUN)} is wrong, ${pick(VERBS)} ${words}`, { syms, refs, link: null, selection: refs[i], subject: refs[(i + 1) % sh.n], previous: null }, 'orderThingWords')
        // the order form WITH a chart noun and a bare pronoun anchor that points at a thing — "delete the chart before that"
        for (const [col, plan] of refs.map(r => ['chart', [r]])) {
          out.push({ id: `rr-ordn-${String(++k).padStart(4, '0')}`, fam: 'orderChartNoun', words: `${pick(VERBS)} the chart ${pick(['before', 'after', 'following', 'preceding'])} ${pick(ORDER_ANCHOR)}`, w: { syms, refs, link: null, selection: refs[i], subject: null, previous: pick(THING_PREV) }, plan, expect: 'blocked', col, shape: sh.shape, anchorKind: 'previousThing' })
          out.push({ id: `rr-ordn-${String(++k).padStart(4, '0')}`, fam: 'orderChartNoun', words: `the ${pick(THING_NOUN)} is wrong, ${pick(VERBS)} the chart ${pick(['before', 'after'])} ${pick(ORDER_ANCHOR)}`, w: { syms, refs, link: null, selection: refs[i], subject: null, previous: null }, plan, expect: 'blocked', col, shape: sh.shape, anchorKind: 'thingWords' })
        }
      }
      for (const p of generic) {
        // (a1) the previous target was a thing; the click / the conversation chart would otherwise anchor the relation
        pushAll(`${pick(VERBS)} ${p}`, { syms, refs, link: null, selection: refs[i], subject: refs[(i + 1) % sh.n], previous: pick(THING_PREV) }, 'previousThing')
        // (a2) the words name a thing noun before the generic relation
        pushAll(`the ${pick(THING_NOUN)} is wrong, ${pick(VERBS)} ${p}`, { syms, refs, link: null, selection: refs[i], subject: refs[(i + 1) % sh.n], previous: null }, 'thingWords')
      }
    }
  }
  // ── CONTROLS (AUDIT 11-17): "both charts" (an explicit chart noun) stays a chart reading with a THING as the previous target; "both
  // of them" with a CHART as the previous target still resolves — no over-ask ──
  for (let rep = 0; rep < 6; rep++) {
    const s2 = [...POOL].sort(() => rnd() - 0.5).slice(0, 2)
    for (const both of ['both charts', 'both the charts', 'both of the charts']) {
      out.push({ id: `rr-ctl-${String(++k).padStart(4, '0')}`, fam: 'thingControl', words: `${pick(VERBS)} ${both}`, w: { syms: s2, refs: ['c1', 'c2'], link: null, selection: null, subject: null, previous: pick(THING_PREV) }, plan: ['c1', 'c2'], expect: 'resolved', col: 'pair', shape: 'two', anchorKind: 'previousThing' })
    }
    for (const p of PARA.both) {
      // two charts, the previous target a chart: "both of them" = the board
      out.push({ id: `rr-ctl-${String(++k).padStart(4, '0')}`, fam: 'thingControl', words: `${pick(VERBS)} ${p}`, w: { syms: s2, refs: ['c1', 'c2'], link: null, selection: null, subject: null, previous: `chart:c${1 + (rep % 2)}` }, plan: ['c1', 'c2'], expect: 'resolved', col: 'pair', shape: 'two', anchorKind: 'previousChart' })
      // three charts: the click + the previous chart
      const s3 = [...POOL].sort(() => rnd() - 0.5).slice(0, 3)
      const [a, b] = [['c1', 'c3'], ['c2', 'c3'], ['c1', 'c2'], ['c3', 'c1']][rep % 4]
      out.push({ id: `rr-ctl-${String(++k).padStart(4, '0')}`, fam: 'thingControl', words: `${pick(VERBS)} ${p}`, w: { syms: s3, refs: ['c1', 'c2', 'c3'], link: null, selection: a, subject: null, previous: `chart:${b}` }, plan: [a, b], expect: 'resolved', col: 'pair', shape: 'three', anchorKind: 'previousChart' })
    }
  }
  // (order controls: a CHART anchor — a named chart, or "this chart" with the click — still resolves with a thing as the previous target)
  for (const n of [2, 3, 4]) {
    const sy = [...POOL].sort(() => rnd() - 0.5).slice(0, n)
    const rf = sy.map((_, i) => `c${i + 1}`)
    for (let a = 0; a < n; a++) for (const [side, d] of [['after', 1], ['before', -1]]) {
      const t = rf[a + d]
      if (!t) continue
      const w0 = { syms: sy, refs: rf, link: null, selection: null, subject: null, previous: pick(THING_PREV) }
      out.push({ id: `rr-ctl-${String(++k).padStart(4, '0')}`, fam: 'thingControl', words: `${pick(VERBS)} the chart ${side} the ${sy[a]} chart`, w: w0, plan: [t], expect: 'resolved', col: 'orderNamed', shape: String(n), anchorKind: 'previousThing' })
      out.push({ id: `rr-ctl-${String(++k).padStart(4, '0')}`, fam: 'thingControl', words: `${pick(VERBS)} the chart ${side} this chart`, w: { ...w0, selection: rf[a] }, plan: [t], expect: 'resolved', col: 'orderThisChart', shape: String(n), anchorKind: 'previousThing' })
    }
  }
  // ── BOTH + EXCEPTION (AUDIT 11-17 mutant: the excluded guard dropped from `relWord === OK && …`): "both" resolved to a pair with
  // one chart of it excepted — the excepted chart is never removed ──
  const EXCEPT = [(s) => `except the ${s} chart`, (s) => `except ${s}`, (s) => `but not the ${s} one`, (s) => `other than ${s}`, (s) => `excluding the ${s} chart`]
  const pushX = (words, w, x, pair, shape) => {
    for (const [col, plan] of [['excepted', [x]], ['pairWithExcepted', pair]]) out.push({ id: `rr-bothx-${String(++k).padStart(4, '0')}`, fam: 'bothExcept', words, w, plan, expect: 'blocked', col, shape, anchorKind: 'except' })
  }
  for (let rep = 0; rep < 3; rep++) {
    // a two-chart board: "both charts" / "both of them" = the board
    const s2 = [...POOL].sort(() => rnd() - 0.5).slice(0, 2)
    for (const x of [0, 1]) for (const ex of EXCEPT) for (const both of ['both charts', 'both of them', 'both the charts']) {
      pushX(`${pick(VERBS)} ${both} ${ex(s2[x])}`, { syms: s2, refs: ['c1', 'c2'], link: null, selection: null, subject: null, previous: null }, `c${x + 1}`, ['c1', 'c2'], 'two')
    }
    // a three-chart board: "both of them" = the click + the conversation chart
    const s3 = [...POOL].sort(() => rnd() - 0.5).slice(0, 3)
    for (const [a, b] of [['c1', 'c3'], ['c2', 'c3'], ['c1', 'c2']]) for (const x of [a, b]) for (const ex of EXCEPT) {
      pushX(`${pick(VERBS)} both of them ${ex(s3[Number(x.slice(1)) - 1])}`, { syms: s3, refs: ['c1', 'c2', 'c3'], link: null, selection: a, subject: b, previous: null }, x, [a, b], 'three')
    }
  }
  return out
}

// locked over-ask baseline (the model resolves, the rail blocks) — ratchet DOWN only
const OVER_ASK_BASELINE = 0
const CASES = railRelationCases(7)
const T = { cases: 0, unbuilt: 0, wrongApply: [], overAsk: [], byFam: {} }
describe(`RELATION-WORD REMOVALS · the chart rail over generated families (${CASES.length} cases)`, () => {
  it('runs every case through the real rail', async () => {
    for (const c of CASES) {
      const host = boardOf(c.w.syms, c.w.link, c.w.selection)
      const r = await railOf(host, c.plan, { words: c.words, subject: c.w.subject, previous: c.w.previous })
      if (r.verdict === 'unbuilt') { T.unbuilt++; continue }
      T.cases++
      const f = (T.byFam[c.fam] ||= { cases: 0, wrongApply: 0, overAsk: 0 })
      f.cases++
      const line = `${c.id} [${c.fam}/${c.shape}/${c.anchorKind}/${c.col}] "${c.words}" sel ${c.w.selection} sub ${c.w.subject} prev ${c.w.previous} plan ${c.plan} → ${r.verdict}${r.text ? `: ${r.text.slice(0, 80)}` : ''}`
      if (r.verdict === 'resolved' && c.expect === 'blocked') { T.wrongApply.push(line); f.wrongApply++ }
      if (r.verdict === 'blocked' && c.expect === 'resolved') { T.overAsk.push(line); f.overAsk++ }
    }
    expect(T.cases).toBeGreaterThan(1000)
  }, 300000)
  for (const fam of ['complement', 'everyOther', 'both', 'order', 'thingAbout', 'thingAboutOrder', 'orderChartNoun', 'bothExcept', 'thingControl']) {
    it(`${fam}: the rail never applies what the model blocks (anchor · a pick · outside)`, () => {
      expect(T.byFam[fam]?.cases).toBeGreaterThan(40)
      expect(T.wrongApply.filter(x => x.includes(`[${fam}/`))).toEqual([])
    })
  }
  it('over-asks stay at or below the locked baseline', () => {
    expect(T.overAsk.length).toBeLessThanOrEqual(OVER_ASK_BASELINE)
  })
})
afterAll(() => {
  if (!globalThis.process?.env?.RAIL_REPORT) return
  console.log([`RAIL RELATIONS: cases ${T.cases} · unbuilt ${T.unbuilt} · wrong applies ${T.wrongApply.length} · over-asks ${T.overAsk.length}`,
    ...Object.entries(T.byFam).map(([k, v]) => `  ${k}: ${v.cases} cases · wrong applies ${v.wrongApply} · over-asks ${v.overAsk}`),
    'WRONG APPLY (first 15):', ...T.wrongApply.slice(0, 15).map(x => `  ${x}`), 'OVER-ASK (first 30):', ...T.overAsk.slice(0, 30).map(x => `  ${x}`)].join('\n'))
})
