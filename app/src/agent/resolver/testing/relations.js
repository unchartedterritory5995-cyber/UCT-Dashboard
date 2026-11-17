// ── D31 RESOLVER P2 · the GENERATED RELATION FAMILIES (paraphrase × target shape × anchor × ambiguity × confirm / undo) ─────
// Each family is generated, never listed: a paraphrase vocabulary × board shapes (2–4 charts in one row, optionally a linked pair)
// × anchor kinds (the click · the conversation chart · the previous chart · a negated chart · none) × plan columns. The EXPECTED
// outcome comes from a small reference MODEL written here (objects, anchors, board order) — it never calls the resolver or a
// resolver reader, so a resolver change cannot move its own goalposts. Deterministic: a fixed seed → the same cases.
//   complement   "the other one", "the others", "the other two", "the rest", "every other chart" — the board minus the anchor
//   both         "both of them / those / these" — the pointer set when it is two objects, else a two-object board, else asked
//   order        "the chart after / before <the SYM chart | this one | it>" — the reading-order neighbour, never the anchor
//   neighbour    "next to / beside / to the right of / to its left <anchor>" (deixis' P1 relations, re-protected as a family)
// Each case: { id, family, words, world, plan: [typed ids], expect: 'resolved'|'ask'|'refuse', col, shape, anchorKind }.
// Follow-ups (confirmation / undo): an ASKED case offers its candidates; answering by number resolves that offer, a bare
// confirm over 2+ offers is asked again, over one offer resolves it; an UNDO of the anchor-making step drops the anchor → asked.
import { prng, VERBS, TICKER_POOL } from './generate'

const NUM = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth' }
export const PARAPHRASES = Object.freeze({
  complementOne: ['the other one', 'the other chart', 'that other chart', 'the other panel'],
  complementSet: ['the others', 'the other charts', 'the rest', 'all the others', 'every other chart', 'all the other charts', 'the other ones'],
  complementN: [(n) => `the other ${n === 2 ? 'two' : n === 3 ? 'three' : n}`, (n) => `the other ${n} charts`],
  both: ['both of them', 'both of those', 'both of these'],
  order: [['after', 'the chart after'], ['after', 'the one following'], ['before', 'the chart before'], ['before', 'the one preceding']],
  neighbour: [['next', 'the chart next to'], ['next', 'the one beside'], ['right', 'the chart to the right of'], ['left', 'the chart to the left of']],
})

/** A board of n charts in one row; `link` = [i, j] makes charts i and j one linked object (group 'L1'). */
export function shapeWorld(syms, { link = null, selection = null, subject = null, previous = null } = {}) {
  const n = syms.length
  const pos = (i) => (n === 1 ? null : i === 0 ? 'left' : i === n - 1 ? 'right' : n === 3 ? 'middle' : null)
  const charts = syms.map((s, i) => ({ ref: `c${i + 1}`, symbol: s, position: pos(i), cell: { x: i * 6, y: 0, w: 6, h: 20 }, group: link && link.includes(i) ? 'L1' : 'N', tf: 'D', label: `Chart c${i + 1}` }))
  return { charts, indicators: [{ id: 'ind:c1:rsi', chart: 'c1', defId: 'rsi', inputs: { length: 14 }, label: 'RSI' }], drawings: [], lists: [], alerts: [], selection, subject, previous, offers: null, picked: null }
}

// ── the reference MODEL (objects = link groups; independent of the resolver) ──
const objOf = (w, ref) => { const c = w.charts.find(x => x.ref === ref); return c && c.group !== 'N' ? `g:${c.group}` : `c:${ref}` }
const expand = (w, refs) => w.charts.filter(c => refs.some(r => objOf(w, r) === objOf(w, c.ref))).map(c => c.ref)
const objects = (w, refs) => new Set(refs.map(r => objOf(w, r))).size
const pointerOf = (w) => { const p = w.previous && w.previous.startsWith('chart:') ? w.previous.slice(6) : null; const r = [w.selection, w.subject, p].find(x => x != null); return r != null ? expand(w, [r]) : [] }

/** The model's referent: { R: refs } (resolved), or { C: candidate refs } (asked); `anchor` refs are refused as the target. */
export function modelReferent(family, w, { n = null, plural = false, side = null, anchorRefs = null, negated = [] } = {}) {
  const all = w.charts.map(c => c.ref)
  if (family === 'complement') {
    const anchor = negated.length ? expand(w, negated) : pointerOf(w)
    const pool = all.filter(r => !anchor.includes(r))
    const out = { anchor: negated.length ? [] : anchor, negated: negated.length ? anchor : [] }
    if (!anchor.length || !pool.length) return { ...out, C: pool.length ? pool : all }
    const want = n ?? (plural ? null : 1)
    if (want != null && objects(w, pool) !== want) return { ...out, C: pool }
    return { ...out, R: pool, plural }
  }
  if (family === 'both') {
    const sel = w.selection ? expand(w, [w.selection]) : []
    const sub = pointerOf({ ...w, selection: null })
    const set = [...new Set([...sel, ...sub])]
    if (set.length && objects(w, set) === 2) return { anchor: [], R: set, plural: true }
    if (objects(w, all) === 2) return { anchor: [], R: all, plural: true }
    return { anchor: [], C: all }
  }
  if (family === 'order') {
    const anchor = anchorRefs ? expand(w, anchorRefs) : pointerOf(w)
    if (!anchor.length) return { anchor: [], C: all }
    const idx = anchor.map(r => all.indexOf(r))
    const t = all[side === 'after' ? Math.max(...idx) + 1 : Math.min(...idx) - 1]
    return t == null ? { anchor, C: all.filter(r => !anchor.includes(r)) } : { anchor, R: expand(w, [t]) }
  }
  if (family === 'neighbour') {
    const anchor = anchorRefs ? expand(w, anchorRefs) : (w.selection ? expand(w, [w.selection]) : [])
    if (!anchor.length) return { anchor: [], C: all }
    const idx = anchor.map(r => all.indexOf(r))
    const L = all[Math.min(...idx) - 1], Rr = all[Math.max(...idx) + 1]
    const hits = side === 'left' ? [L] : side === 'right' ? [Rr] : [L, Rr]
    const h = hits.filter(Boolean)
    return objects(w, h) === 1 ? { anchor, R: expand(w, h) } : { anchor, C: all.filter(r => !anchor.includes(r)) }
  }
  throw new Error(`model: unknown family ${family}`)
}

/** The plan columns and the policy verdict for each, from the model's referent (I1 / I2 / I5 / I6 / I3). */
export function columnsOf(m, w) {
  const all = w.charts.map(c => c.ref)
  const id = (r) => `chart:${r}`
  const cols = []
  const bad = [...m.anchor, ...(m.negated || [])]
  if (m.R) {
    cols.push(['referent', m.R.map(id), 'resolved'])
    if (m.plural && objects(w, m.R) > 1) cols.push(['oneOfSet', [id(m.R[0])], 'resolved'])
    const out = all.find(r => !m.R.includes(r) && !bad.includes(r))
    if (out) cols.push(['outside', [id(out)], 'refuse'])
    if (bad.length) cols.push(['anchor', [id(bad[0])], 'refuse'], ['referentAndAnchor', [...m.R.map(id), id(bad[0])], 'refuse'])
  } else {
    cols.push(['candidate', [id(m.C[0])], 'ask'])
    if (m.C.length > 1) cols.push(['twoCandidates', [id(m.C[0]), id(m.C[m.C.length - 1])], 'ask'])
    if (bad.length) cols.push(['anchor', [id(bad[0])], 'refuse'])
    const out = all.find(r => !m.C.includes(r) && !bad.includes(r))
    if (out) cols.push(['outside', [id(out)], 'refuse'])
  }
  cols.push(['otherType', ['ind:c1:rsi'], 'refuse'])
  return cols
}

const SHAPES = [
  { shape: 'two', n: 2 }, { shape: 'three', n: 3 }, { shape: 'four', n: 4 }, { shape: 'three-linked', n: 3, link: [1, 2] }, { shape: 'four-linked', n: 4, link: [2, 3] },
]
/** Every relation-family case: paraphrase × shape × anchor kind × plan column. */
export function relationCases(seed = 41) {
  const r = prng(seed)
  const out = []
  let k = 0
  const push = (family, words, world, m, meta) => {
    for (const [col, plan, expect] of columnsOf(m, world)) out.push({ id: `rel-${family}-${String(++k).padStart(4, '0')}`, family, words, world, plan, expect, col, model: m, ...meta })
  }
  for (const sh of SHAPES) {
    const syms = [...TICKER_POOL].sort(() => r.next() - 0.5).slice(0, sh.n)
    const refs = syms.map((_, i) => `c${i + 1}`)
    const V = () => r.pick(VERBS)
    const anchors = (i) => [['click', { selection: refs[i] }], ['subject', { subject: refs[i] }], ['previous', { previous: `chart:${refs[i]}` }], ['none', {}]]
    for (let i = 0; i < sh.n; i++) {
      for (const [anchorKind, ctx] of anchors(i)) {
        if (anchorKind === 'none' && i > 0) continue
        const w = shapeWorld(syms, { link: sh.link, ...ctx })
        const meta = { shape: sh.shape, anchorKind }
        // complement: singular, set, counted
        push('complement', `${V()} ${r.pick(PARAPHRASES.complementOne)}`, w, modelReferent('complement', w), meta)
        push('complement', `${V()} ${r.pick(PARAPHRASES.complementSet)}`, w, modelReferent('complement', w, { plural: true }), meta)
        const cn = 2 + r.int(2)
        push('complement', `${V()} ${r.pick(PARAPHRASES.complementN)(cn)}`, w, modelReferent('complement', w, { n: cn, plural: true }), meta)
        // both: the pointer set (click + conversation chart) — the anchor kind adds the second member
        const wb = anchorKind === 'click' ? shapeWorld(syms, { link: sh.link, selection: refs[i], subject: refs[(i + 1) % sh.n] }) : w
        push('both', `${V()} ${r.pick(PARAPHRASES.both)}`, wb, modelReferent('both', wb), meta)
        // order: a pointer anchor ("this one" / "it") and a NAMED anchor
        const [side, phrase] = r.pick(PARAPHRASES.order)
        push('order', `${V()} ${phrase} ${r.pick(['this one', 'it', 'this chart'])}`, w, modelReferent('order', w, { side }), meta)
        if (anchorKind === 'none' && !sh.link) {
          for (let a = 0; a < sh.n; a++) {
            const [s2, p2] = r.pick(PARAPHRASES.order)
            push('order', `${V()} ${p2} the ${syms[a]} chart`, w, modelReferent('order', w, { side: s2, anchorRefs: [refs[a]] }), { ...meta, anchorKind: 'named' })
          }
        }
        // neighbour (P1 deixis relations): the click, or a named chart
        if (anchorKind === 'click' || anchorKind === 'none') {
          const [ns, np] = r.pick(PARAPHRASES.neighbour)
          push('neighbour', `${V()} ${np} this one`, w, modelReferent('neighbour', w, { side: ns }), meta)
        }
        // negation as the anchor: "leave the SYM chart, close the other one"
        if (anchorKind === 'none') {
          const a = r.int(sh.n)
          push('complement', `leave the ${syms[a]} chart, ${V()} ${r.pick(PARAPHRASES.complementOne)}`, w, modelReferent('complement', w, { negated: [refs[a]] }), { ...meta, anchorKind: 'negated' })
        }
      }
    }
  }
  return out
}

/** CONFIRMATION follow-ups: an asked case's candidates are offered; the member answers this turn. → cases as relationCases. */
export function confirmationCases(cases) {
  const out = []
  let k = 0
  const seen = new Set()
  for (const c of cases) {
    if (c.expect !== 'ask' || c.col !== 'candidate' || !c.model.C || c.model.C.length < 1) continue
    // (one offer per distinct candidate set, the way the Agent offers the real choices)
    const key = JSON.stringify([c.world.charts.map(x => x.symbol + x.group), c.model.C])
    if (seen.has(key)) continue
    seen.add(key)
    // the Agent offers one choice per OBJECT (a linked pair is one choice: its first chart)
    const offers = [...new Map(c.model.C.map(r => [objOf(c.world, r), r])).values()]
    const w = { ...c.world, offers: { refs: offers, stale: false, carried: c.words } }
    const idx = 1 + (k % offers.length)
    const right = expand(c.world, [offers[idx - 1]]).map(r => `chart:${r}`)
    const wrong = c.world.charts.map(x => x.ref).find(r => !expand(c.world, [offers[idx - 1]]).includes(r))
    const base = { family: c.family, shape: c.shape, anchorKind: c.anchorKind, carried: c.words }
    out.push({ ...base, id: `cf-${String(++k).padStart(4, '0')}`, col: 'answerNumber', words: String(idx), world: w, plan: right, expect: 'resolved' })
    out.push({ ...base, id: `cf-${String(++k).padStart(4, '0')}`, col: 'answerOrdinal', words: `the ${NUM[idx]} one`, world: w, plan: right, expect: 'resolved' })
    if (wrong) out.push({ ...base, id: `cf-${String(++k).padStart(4, '0')}`, col: 'answerWrongPlan', words: String(idx), world: w, plan: [`chart:${wrong}`], expect: 'refuse' })
    out.push({ ...base, id: `cf-${String(++k).padStart(4, '0')}`, col: 'bareConfirm', words: 'yes', world: w, plan: right, expect: offers.length === 1 ? 'resolved' : 'ask' })
    // I9: the offer expired (a turn went by) — the answer alone asks to destroy nothing
    out.push({ ...base, id: `cf-${String(++k).padStart(4, '0')}`, col: 'staleAnswer', words: String(idx), world: { ...w, offers: { ...w.offers, stale: true } }, plan: right, expect: 'refuse' })
  }
  return out
}

/** UNDO follow-ups: the anchor came from the previous step (an opened chart); undo drops it → the relation has no anchor. */
export function undoCases(seed = 42) {
  const r = prng(seed)
  const out = []
  let k = 0
  for (const n of [2, 3, 4]) {
    const syms = [...TICKER_POOL].sort(() => r.next() - 0.5).slice(0, n)
    const opened = `c${n}`
    for (const [family, phrase, opts] of [['complement', r.pick(PARAPHRASES.complementOne), {}], ['complement', r.pick(PARAPHRASES.complementSet), { plural: true }], ['order', 'the chart before it', { side: 'before' }]]) {
      const V = r.pick(VERBS)
      // step 1: the chart just opened is the previous object — the anchor
      const w1 = shapeWorld(syms, { previous: `chart:${opened}` })
      for (const [col, plan, expect] of columnsOf(modelReferent(family, w1, opts), w1)) out.push({ id: `undo-${String(++k).padStart(4, '0')}`, family, step: 'afterOpen', words: `${V} ${phrase}`, world: w1, plan, expect, col })
      // step 2: undo — the opened chart is gone and nothing is previous: no anchor → asked
      const w2 = shapeWorld(syms.slice(0, -1))
      for (const [col, plan, expect] of columnsOf(modelReferent(family, w2, opts), w2)) out.push({ id: `undo-${String(++k).padStart(4, '0')}`, family, step: 'afterUndo', words: `${V} ${phrase}`, world: w2, plan, expect, col })
    }
  }
  return out
}
