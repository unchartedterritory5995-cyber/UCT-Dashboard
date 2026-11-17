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
  for (const fam of ['complement', 'everyOther', 'both', 'order']) {
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
