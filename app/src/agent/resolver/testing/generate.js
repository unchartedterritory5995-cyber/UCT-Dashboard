// ── D31 RESOLVER · the SEEDED in-house generator for the removal family (AUDIT R5: no new dependency, no fast-check) ─────────
// Expands the family's IMPORTED vocabularies into cases, each carrying its expected outcome from a small POLICY written here
// (independent of the resolver code: it never calls resolve or a resolver reader). Deterministic: a fixed seed → the same cases.
//   matrix      referring forms × world shapes × plan-target columns (correct · same-type other · two · other type)
//   metamorphic M1 verb swap · M2 filler / case / punctuation · M3 appositive · M4 a second same-ticker chart · M5 negation ·
//               M6 continuation · M7 relation anchor
//   sequences   model-based open / add / select / close / undo / ask→answer runs, the model's referent after each step
import { REMOVAL_PRONOUNS, removalPronouns, removalAskedFor } from '../../chartRail'
import { CLASS } from '../../stateRail'

/** mulberry32: a 32-bit seeded PRNG. */
export function prng(seed) {
  let a = seed >>> 0
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  return { next, int: (n) => Math.floor(next() * n), pick: (xs) => xs[Math.floor(next() * xs.length)], chance: (p) => next() < p }
}

// ── the family's vocabularies (each candidate is kept only when the live chartRail reader accepts it) ──
const VERB_CANDIDATES = ['close', 'remove', 'delete', 'drop', 'get rid of', 'clear']
export const VERBS = VERB_CANDIDATES.filter(v => removalAskedFor(`${v} the SPY chart`) && removalPronouns(`${v} it`).some(p => !p.cont))
export const PRONOUNS = REMOVAL_PRONOUNS.filter(p => !/^(?:them|those)$/.test(p))
export const PLURAL_PRONOUNS = REMOVAL_PRONOUNS.filter(p => /^(?:them|those)$/.test(p))
export const FILLERS = [(s) => `please ${s}`, (s) => `${s} please`, (s) => `${s} for me`, (s) => `${s} now`, (s) => `${s[0].toUpperCase()}${s.slice(1)}.`, (s) => `${s}!`, (s) => `${s} right now`]
export const CONTINUATIONS = ['to weekly', 'down a timeframe', 'of drawings', 'from the chart', 'into a line chart', 'by one timeframe']
// a thing noun of each class the state rail reads (indicator / drawing / list) and the alert / note words the containers use
export const THING_NOUNS = ['RSI', 'MACD', 'moving average', 'trendline', 'fib', 'alert', 'note', 'horizontal line'].filter(n => n === 'alert' || CLASS.indicator.test(n) || CLASS.drawing.test(n) || CLASS.watchlist.test(n))
export const THING_CONTAINERS = ['my watchlist', 'my notes', 'my alerts', 'my Tech list', 'my drawing board']
export const CHART_CONTAINERS = ['the board', 'the layout', 'my screen']
export const TICKER_POOL = ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT', 'DIA']

/** An abstract board of n charts in one row (the resolver's world shape; positions as the host words them for one row). */
export function boardWorld(syms, { selection = null, subject = null, previous = null, offers = null, indicators = [] } = {}) {
  const n = syms.length
  const pos = (i) => (n === 1 ? null : i === 0 ? 'left' : i === n - 1 ? 'right' : n === 3 ? 'middle' : null)
  const charts = syms.map((s, i) => ({ ref: `c${i + 1}`, symbol: s, position: pos(i), cell: { x: i * 6, y: 0, w: 6, h: 20 }, group: 'N', tf: 'D', label: `Chart c${i + 1}` }))
  return { charts, indicators, drawings: [], lists: [], alerts: [], selection, subject, previous, offers, picked: null }
}
const ord = ['first', 'second', 'third', 'fourth']

/**
 * The words × plan-target MATRIX. Each case: { id, words, world, plan: [typed ids], expect: 'resolved'|'ask'|'refuse', why }.
 * Policy (written here, independently): the words' referent set R (or ask / refuse); a plan inside R resolves; a plan target
 * outside R, of another type, or negated is refused; an unresolvable referent asks when the plan is among its candidates.
 */
export function matrixCases(seed = 31, { per = 6 } = {}) {
  const r = prng(seed)
  const out = []
  let k = 0
  const add = (form, words, world, ref, columns) => {
    for (const [col, plan, expect] of columns) out.push({ id: `mx-${String(++k).padStart(4, '0')}`, form, col, words, world, plan, expect, why: ref })
  }
  for (let rep = 0; rep < per; rep++) {
    for (const n of [1, 2, 3, 4]) {
      const syms = [...TICKER_POOL].sort(() => r.next() - 0.5).slice(0, n)
      const all = syms.map((_, i) => `chart:c${i + 1}`)
      const ti = r.int(n), other = n > 1 ? (ti + 1 + r.int(n - 1)) % n : null
      const T = `chart:c${ti + 1}`, O = other != null ? `chart:c${other + 1}` : null
      const ind = { id: `ind:c${ti + 1}:rsi`, chart: `c${ti + 1}`, defId: 'rsi', inputs: { length: 14 }, label: 'RSI' }
      const V = r.pick(VERBS)
      const cols = (ok, { ambiguous = false } = {}) => [
        ['correct', [T], ok ? 'resolved' : ambiguous ? 'ask' : 'refuse'],
        ...(O ? [['other', [O], ambiguous ? 'ask' : 'refuse'], ['two', [T, O], ambiguous ? 'ask' : 'refuse']] : []),
        ['otherType', [ind.id], 'refuse'],
      ]
      // named by ticker
      add('named', `${V} the ${syms[ti]} chart`, boardWorld(syms, { selection: r.chance(0.5) && O ? O.slice(6) : null, indicators: [ind] }), T, cols(true))
      // named in lowercase (a board symbol in any casing)
      add('named-lower', `${V} the ${syms[ti].toLowerCase()} chart`, boardWorld(syms, { indicators: [ind] }), T, cols(true))
      // ordinal: "chart N" / "the Nth chart"
      add('ordinal', r.chance(0.5) ? `${V} chart ${ti + 1}` : `${V} the ${ord[ti]} chart`, boardWorld(syms, { indicators: [ind] }), T, cols(true))
      // a position phrase AFTER the noun ("the chart on the right") — capreg shadow replay A case, 11-16
      if (n >= 2 && (ti === 0 || ti === n - 1)) add('position-after', `${V} the chart on the ${ti === 0 ? 'left' : 'right'}`, boardWorld(syms, { indicators: [ind] }), T, cols(true))
      // pointer: a bare pronoun with the chart clicked
      const P = r.pick(PRONOUNS)
      add('pointer', `${V} ${P}`, boardWorld(syms, { selection: `c${ti + 1}`, indicators: [ind] }), T, cols(true))
      // the conversation's chart (no click)
      add('subject', `${V} ${P}`, boardWorld(syms, { subject: `c${ti + 1}`, indicators: [ind] }), T, cols(true))
      // nothing resolves the pronoun: 2+ charts → asked; one chart → it
      add('none', `${V} ${P}`, boardWorld(syms, { indicators: [ind] }), n === 1 ? T : null, n === 1 ? cols(true) : cols(false, { ambiguous: true }))
      // appositive after the pronoun: a chart (outranks the click) / a thing (never a chart)
      add('appos-chart', `${V} ${P}, the ${syms[ti]} chart I mean`, boardWorld(syms, { selection: O ? O.slice(6) : null, indicators: [ind] }), T, cols(true))
      const noun = r.pick(THING_NOUNS)
      add('appos-thing', `${V} ${P}, the ${noun} I mean`, boardWorld(syms, { selection: `c${ti + 1}` }), null, [['correct', [T], 'refuse'], ...(O ? [['other', [O], 'refuse']] : [])])
      // a thing container: never a chart / the board container: a chart by the pointer order
      add('container-thing', `${V} ${P} from ${r.pick(THING_CONTAINERS)}`, boardWorld(syms, { selection: `c${ti + 1}` }), null, [['correct', [T], 'refuse']])
      add('container-chart', `${V} ${P} from ${r.pick(CHART_CONTAINERS)}`, boardWorld(syms, { selection: `c${ti + 1}`, indicators: [ind] }), T, cols(true))
      // a continuation: the pronoun's clause goes on — no chart removal
      add('continuation', `${V} ${P} ${r.pick(CONTINUATIONS)}`, boardWorld(syms, { selection: `c${ti + 1}` }), null, [['correct', [T], 'refuse']])
      // negation: everything except the named one
      if (n >= 2) {
        const rest = all.filter(x => x !== T)
        add('negated', `${V} all my charts except the ${syms[ti]} chart`, boardWorld(syms), rest, [['kept', [T], 'refuse'], ['rest', rest, 'resolved'], ['restAndKept', [...rest, T], 'refuse']])
      }
      // plural pronoun: the click + the conversation chart; neither → asked
      if (n >= 2 && O) add('plural', `${V} ${r.pick(PLURAL_PRONOUNS)}`, boardWorld(syms, { selection: `c${ti + 1}`, subject: O.slice(6) }), [T, O], [['set', [T, O], 'resolved'], ['one', [T], 'resolved'], ...(n > 2 ? [['outside', [all.find(x => x !== T && x !== O)], 'refuse']] : [])])
      // words that ask to destroy nothing never license a plan
      add('plan-only', r.pick(['do it', 'go ahead', 'sure, that works', 'make it so']), boardWorld(syms, { selection: `c${ti + 1}` }), null, [['correct', [T], 'refuse']])
    }
  }
  return out
}

/** METAMORPHIC relations over seed cases on a 3-chart board: [{ id, rel, words, world, plan, expect }]. */
export function metamorphicCases(seed = 32, { per = 40 } = {}) {
  const r = prng(seed)
  const out = []
  let k = 0
  const push = (rel, words, world, plan, expect) => out.push({ id: `mm-${rel}-${String(++k).padStart(4, '0')}`, rel, words, world, plan, expect })
  for (let i = 0; i < per; i++) {
    const syms = [...TICKER_POOL].sort(() => r.next() - 0.5).slice(0, 3)
    const ti = r.int(3), oi = (ti + 1 + r.int(2)) % 3
    const T = `chart:c${ti + 1}`, O = `chart:c${oi + 1}`
    const V1 = r.pick(VERBS), V2 = r.pick(VERBS)
    const seedW = `${V1} the ${syms[ti]} chart`
    // M1 verb swap: same verdict
    push('M1', `${V2} the ${syms[ti]} chart`, boardWorld(syms), [T], 'resolved')
    push('M1', `${V2} the ${syms[ti]} chart`, boardWorld(syms), [O], 'refuse')
    // M2 filler / case / punctuation: same verdict
    const f = r.pick(FILLERS)
    push('M2', f(seedW), boardWorld(syms), [T], 'resolved')
    push('M2', f(seedW), boardWorld(syms), [O], 'refuse')
    push('M2', f(`${V1} ${r.pick(PRONOUNS)}`), boardWorld(syms), [T], 'ask')
    // M3 an appositive of type T: the verdict becomes T's resolution
    push('M3', `${V1} it, the ${syms[ti]} chart I mean`, boardWorld(syms, { selection: `c${oi + 1}` }), [T], 'resolved')
    push('M3', `${V1} it, the ${r.pick(THING_NOUNS)} I mean`, boardWorld(syms, { selection: `c${ti + 1}` }), [T], 'refuse')
    // M4 a second chart of the same ticker, no discriminator: resolved → asked
    const dup = [...syms]; dup[oi] = syms[ti]
    push('M4', seedW, boardWorld(dup), [T], 'ask')
    push('M4', `${V1} both ${syms[ti]} charts`, boardWorld(dup), [T, O], 'resolved')
    // M5 negate the mention: it drops out
    push('M5', `${V1} everything except the ${syms[ti]} chart`, boardWorld(syms), [T], 'refuse')
    push('M5', `${V1} everything except the ${syms[ti]} chart`, boardWorld(syms), [O], 'resolved')
    // M6 a continuation: the pronoun is no removal object
    push('M6', `${V1} it ${r.pick(CONTINUATIONS)}`, boardWorld(syms, { selection: `c${ti + 1}` }), [T], 'refuse')
    // M7 a relation word + the click as anchor: the anchor is excluded, the neighbour is the referent
    const w7 = boardWorld(syms, { selection: 'c2' })
    const side = r.chance(0.5) ? ['right', 'chart:c3'] : ['left', 'chart:c1']
    push('M7', `${V1} the chart to the ${side[0]} of this one`, w7, ['chart:c2'], 'refuse')
    push('M7', `${V1} the chart to the ${side[0]} of this one`, w7, [side[1]], 'resolved')
  }
  return out
}

/**
 * MODEL-BASED SEQUENCES. A reference model holds the charts, the indicators made, the click, the conversation's previous
 * object and the Agent's open offers; commands are drawn from { open, add RSI, select, deselect, close it, undo, ask→answer }.
 * After each "close it" / answer step the model's expected referent decides the verdict for a correct and a wrong plan target.
 * → [{ seed, steps: [{ cmd, words?, world?, plan?, expect? }] }]
 */
export function sequenceRuns(seed = 33, { runs = 60 } = {}) {
  const out = []
  for (let s = 0; s < runs; s++) {
    const r = prng(seed * 1000 + s)
    const m = { syms: [...TICKER_POOL].sort(() => r.next() - 0.5).slice(0, 2), selection: null, previous: null, made: [], offers: null, inds: [] }
    const steps = []
    const len = 3 + r.int(6)
    const world = () => boardWorld(m.syms, { selection: m.selection, previous: m.previous, offers: m.offers, indicators: m.inds.map(i => ({ ...i })) })
    for (let i = 0; i < len; i++) {
      const cmd = r.pick(['open', 'add', 'select', 'deselect', 'close', 'close', 'undo', 'answer'])
      const refs = m.syms.map((_, j) => `c${j + 1}`)
      if (cmd === 'open' && m.syms.length < 4) {
        const sym = TICKER_POOL.find(x => !m.syms.includes(x))
        m.syms.push(sym); m.previous = `chart:c${m.syms.length}`; m.made.push(m.previous); m.offers = null
        steps.push({ cmd: `open ${sym}` })
      } else if (cmd === 'add') {
        const c = r.pick(refs)
        const id = `ind:${c}:rsi${m.inds.length}`
        m.inds.push({ id, chart: c, defId: 'rsi', inputs: { length: 14 }, label: 'RSI' }); m.previous = id; m.made.push(id); m.offers = null
        steps.push({ cmd: `add RSI to ${c}` })
      } else if (cmd === 'select') { m.selection = r.pick(refs); m.offers = null; steps.push({ cmd: `select ${m.selection}` }) }
      else if (cmd === 'deselect') { m.selection = null; steps.push({ cmd: 'deselect' }) }
      else if (cmd === 'undo') {
        const last = m.made.pop()
        if (last?.startsWith('ind:')) m.inds = m.inds.filter(x => x.id !== last)
        if (last?.startsWith('chart:')) { m.syms.pop(); if (m.selection === last.slice(6)) m.selection = null }
        m.previous = null; m.offers = null
        steps.push({ cmd: 'undo' })
      } else if (cmd === 'close') {
        const w = world()
        const all = m.syms.map((_, j) => `chart:c${j + 1}`)
        let expectRef = null, verdict = null
        const pt = m.previous && !m.previous.startsWith('chart:') ? m.previous : null
        if (pt && m.selection) verdict = 'ask'
        else if (pt) expectRef = pt
        else if (m.selection) expectRef = `chart:${m.selection}`
        else if (m.previous?.startsWith('chart:') && all.includes(m.previous)) expectRef = m.previous
        else if (all.length === 1) expectRef = all[0]
        else verdict = 'ask'
        const words = `${r.pick(VERBS)} ${r.pick(PRONOUNS)}`
        const right = expectRef || (pt || `chart:${m.selection || 'c1'}`)
        const wrong = right.startsWith('chart:') ? all.find(x => x !== right) || null : `chart:${m.selection || 'c1'}`
        steps.push({ cmd: 'close it', words, world: w, plan: [right], expect: verdict || 'resolved' })
        if (wrong) steps.push({ cmd: 'close it (wrong target)', words, world: w, plan: [wrong], expect: verdict === 'ask' ? 'ask' : 'refuse' })
        // the Agent asked: its choices stay live for ONE turn
        if (verdict === 'ask' && !pt) m.offers = { refs: m.syms.map((_, j) => `c${j + 1}`), stale: false, carried: words }
      } else if (cmd === 'answer') {
        if (m.offers && !m.offers.stale) {
          const n = 1 + r.int(m.offers.refs.length)
          const w = world()
          const right = `chart:${m.offers.refs[n - 1]}`
          const wrong = m.offers.refs.map(x => `chart:${x}`).find(x => x !== right)
          steps.push({ cmd: `answer ${n}`, words: String(n), carried: m.offers.carried, world: w, plan: [right], expect: 'resolved' })
          if (wrong) steps.push({ cmd: `answer ${n} (wrong target)`, words: String(n), carried: m.offers.carried, world: w, plan: [wrong], expect: 'refuse' })
          m.offers = null
        } else {
          // I9: no live offer (expired, or never asked) — a bare number asks to destroy nothing
          const w = world()
          if (m.offers) w.offers = { ...m.offers, stale: true }
          steps.push({ cmd: 'answer (no live offer)', words: String(1 + r.int(2)), world: w, plan: ['chart:c1'], expect: 'refuse' })
        }
      }
      if (m.offers && cmd !== 'close' && cmd !== 'answer') m.offers = { ...m.offers, stale: true }
    }
    out.push({ seed: seed * 1000 + s, steps })
  }
  return out
}
