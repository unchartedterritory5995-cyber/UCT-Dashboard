// ── BREADTH HISTORY: when did a breadth condition hold? (UCT's FINALIZED daily history) ─────────────
//
// "When was the last time US:A200 was below 10%?", "When did Nasdaq:A50 last cross above 50%?",
// "How many times has it fallen below 20% since 2010?", "How long did the last episode last?"
//
// ⛔ ONE DETECTOR. The search runs in Market Intelligence's `breadth_events` (the Slice 2 condition
// core over `breadth_reads.sealed_series` — the same finalized series the breadth charts draw). The
// Agent only PLANS validated args; the browser asks the admin-only /api/agent/breadth/history route
// and shows UCT's deterministic answer. Like breadth.show it is `localOnly`: dates and values never go
// back to a model (turn.LOCAL_ONLY_ACTIONS; the history note is rebuilt from validated args only).
//
// Follow-ups are deterministic where the wording is obvious: "that" / "it" = the measure and universe
// of the member's last breadth request (breadth.js remembers the SUBJECT — names, never a value);
// "same thing for Nasdaq" and "what about last year?" re-run the last search with one thing changed.

import { registerCapability } from '../capabilities'
import { BREADTH_UNIVERSES, BREADTH_METRICS, UCT_UNIVERSE_ANSWER, AGENT_UNIVERSES, lastBreadthSubject, rememberBreadthSubject, breadthToday, UNI_SWITCH_RE } from './breadth'

export const HISTORY_OPS = ['below', 'at_or_below', 'above', 'at_or_above', 'crosses_below', 'crosses_above']
export const HISTORY_FINDS = ['last', 'first', 'count', 'episodes', 'longest', 'last_episode']
//: Daily finalized sessions now; "weekly" is reserved in Market Intelligence's interface (refused there).
export const HISTORY_AGGREGATIONS = ['daily']

async function answerHistory(args) {
  if (args?.universe === 'uct') return { text: UCT_UNIVERSE_ANSWER, link: { href: '/breadth', label: 'Open Breadth' } }
  rememberBreadthSubject({ kind: 'history', universe: args?.universe, metric: args?.metric, history: args })
  let r
  try {
    r = await fetch('/api/agent/breadth/history', {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(args || {}),
    })
  } catch (e) {
    return `I couldn't reach UCT's breadth history right now (${e?.message || 'network error'}). Nothing was searched.`
  }
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    return `I couldn't search UCT's breadth history right now (${b.detail || `HTTP ${r.status}`}).`
  }
  let b
  try { b = await r.json() } catch { return "UCT's breadth history answer came back unreadable, so nothing is shown." }
  if (!b || typeof b.text !== 'string') return "UCT's breadth history answer came back unreadable, so nothing is shown."
  const t = b.table
  const table = t && Array.isArray(t.columns) && Array.isArray(t.rows) ? { columns: t.columns, rows: t.rows } : null
  const present = b.present && typeof b.present === 'object' ? b.present : null
  return { text: b.text, table, ...(present ? { present } : {}) }
}

// ── deterministic wording ─────────────────────────────────────────────────────────────────────────
const UNI = '(us|u\\.s\\.|nyse|nasdaq|uct)'
const MA_PERIODS = new Set([5, 10, 20, 40, 50, 100, 150, 200])
// the measure: "US:A200", "nasdaq a50", "us 200sma", "% above the 200-day", or "that / it / this"
const MEASURE = `(?:(?:${UNI}\\s*:?\\s*)?a(\\d+)|(?:the )?(?:${UNI} )?(?:% (?:of stocks )?above (?:the |their )?)?(\\d+)[\\s-]*(?:day|d)?[\\s-]*(?:sma|dma|ma|moving average)(?: on the ${UNI})?|(that|it|this|the reading))`
const LEVEL = '(\\d+(?:\\.\\d+)?)\\s*%?'
const SIDE = { below: 'below', under: 'below', above: 'above', over: 'above' }
const FIRST_LAST = `(?:when (?:was|did) )`
// "when was the last time <m> was below 10%", "when was <m> last below 10%", "when was the first time …"
const LAST_RE = new RegExp(`^${FIRST_LAST}?(?:the )?(last|first|most recent) time (?:that )?${MEASURE} (?:was|went|fell|dropped|got|closed) (at or below|at or above|below|under|above|over) ${LEVEL}$`)
const LAST_RE2 = new RegExp(`^when (?:was|did) ${MEASURE} (?:last|most recently) (?:be |go |close |fall |drop )?(below|under|above|over) ${LEVEL}$`)
// "when did <m> last cross above 50%"
const CROSS_RE = new RegExp(`^when did ${MEASURE} (last|first) cross (above|over|below|under) ${LEVEL}$`)
// "how many times has <m> fallen below 20% since 2010"
const COUNT_RE = new RegExp(`^how (?:many times|often) (?:has|did|have) ${MEASURE} (?:fallen|dropped|gone|been|closed|fell|dropped) (below|under|above|over) ${LEVEL}(?: since (\\d{4}))?$`)
// "how long did the last below-10% episode last"
const EPISODE_RE = new RegExp(`^how long did the (last|longest) (below|under|above|over)[\\s-]*${LEVEL}[\\s-]*(?:episode|stretch|streak|run|period) last$`)
const SAME_RE = new RegExp(`^(?:and )?(?:the )?same (?:thing |question |search )?(?:for|on) (?:the )?${UNI}(?: stocks)?$`)
const LASTYEAR_RE = /^(?:and |ok,? )?what about (last year|this year|(?:in )?(\d{4}))$/
// ── post-release 2026-10-13 ("how long did it stay below 10%?" reached the model) ──
// the episode follow-up: "how long did it stay below 10%", "how long did that last", "how long was it under 10%"
const STAY_RE = new RegExp(`^(?:and |so |ok,? )?(?:how long|for how long|how many (?:sessions|days|trading days)) (?:did|was|has|had) (?:it|that|this|the reading|(?:that|the) (?:episode|stretch|streak|run|period))(?: (?:stay|stayed|remain|remained|last|lasted|been|go on))?(?: (?:there|down there|up there))?(?: (below|under|above|over) ${LEVEL})?(?: for)?$`)
// counted wording: "when was the last time fewer than 10% (of US stocks) were above (the 200sma | it)",
// "... more than 90% were below the 50-day"
const QUANT = '(more than|over|greater than|at least|fewer than|less than|under|at most|no more than)'
const QUANT_RE = new RegExp(`^(?:when (?:was|is) )?(?:the )?(last|first|most recent) time (?:that )?${QUANT} ${LEVEL} (?:of )?(?:${UNI} )?(?:stocks |names )?(?:were|was|closed) (above|over|below|under) ?(?:(?:the |their )?(\\d+)[\\s-]*(?:day|d)?[\\s-]*(?:sma|dma|ma|moving average)?|it|that)?(?: (?:on|for|in) the ${UNI})?$`)
const Q_OP = { 'more than': 'above', over: 'above', 'greater than': 'above', 'at least': 'at_or_above',
  'fewer than': 'below', 'less than': 'below', under: 'below', 'at most': 'at_or_below', 'no more than': 'at_or_below' }
// a condition on the share AT OR BELOW the MA (= 100 − the share above, the stored measure) as the same
// condition on the stored measure: below% > X ⇔ above < 100 − X; ≥ ⇔ ≤; crossings swap direction
const INVERT = { below: 'above', above: 'below', at_or_below: 'at_or_above', at_or_above: 'at_or_below',
  crosses_below: 'crosses_above', crosses_above: 'crosses_below' }
const inverted = (op, level) => ({ op: INVERT[op], level: Number((100 - level).toFixed(4)) })
// the condition of a remembered search, as a plain side (an episode is a run of sessions on one side)
const sideOfOp = (op) => (op === 'crosses_below' ? 'below' : op === 'crosses_above' ? 'above' : op)

const clean = (raw) => String(raw || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[?.!]+$/g, '').replace(/\s+/g, ' ').trim()
const uniOf = (w) => (!w ? null : w === 'u.s.' ? 'us' : w)

/** The measure + universe a clause names, or the remembered subject for "that / it". null = unknown. */
function measureOf(m, offset) {
  const [uA, nA, uB, nB, uC, pronoun] = m.slice(offset, offset + 6)
  const subj = lastBreadthSubject()
  if (pronoun) {
    if (!subj?.metric || !BREADTH_UNIVERSES.concat('uct').includes(subj.universe)) return null
    return { universe: subj.universe, metric: subj.metric, below: subj.kind === 'show' && subj.show?.side === 'below' }
  }
  const n = Number(nA || nB)
  if (!MA_PERIODS.has(n)) return null
  const metric = `pct_above_${n}sma`
  if (!BREADTH_METRICS.includes(metric)) return null
  return { universe: uniOf(uA || uB || uC) || subj?.universe || 'us', metric }
}

const base = (universe, metric) => ({ universe, metric, aggregation: 'daily', start: null, end: null })
const cond = (s, op, level) => (s?.below ? inverted(op, level) : { op, level })

export function breadthHistoryFast(raw) {
  const t = clean(raw)
  if (!t || t.length > 160) return null
  let m = LAST_RE.exec(t)
  if (m) {
    const s = measureOf(m, 2); if (!s) return null
    const side = m[8]
    const op = side.startsWith('at or') ? side.replace(/ /g, '_').replace('at_or_', 'at_or_') : SIDE[side]
    return { ...base(s.universe, s.metric), ...cond(s, op, Number(m[9])), find: m[1] === 'first' ? 'first' : 'last' }
  }
  m = LAST_RE2.exec(t)
  if (m) {
    const s = measureOf(m, 1); if (!s) return null
    return { ...base(s.universe, s.metric), ...cond(s, SIDE[m[7]], Number(m[8])), find: 'last' }
  }
  m = CROSS_RE.exec(t)
  if (m) {
    const s = measureOf(m, 1); if (!s) return null
    return { ...base(s.universe, s.metric), ...cond(s, `crosses_${SIDE[m[8]]}`, Number(m[9])), find: m[7] === 'first' ? 'first' : 'last' }
  }
  m = COUNT_RE.exec(t)
  if (m) {
    const s = measureOf(m, 1); if (!s) return null
    return { ...base(s.universe, s.metric), ...cond(s, SIDE[m[7]], Number(m[8])), find: 'count', ...(m[9] ? { start: `${m[9]}-01-01` } : {}) }
  }
  m = EPISODE_RE.exec(t)
  if (m) {
    const subj = lastBreadthSubject()
    if (!subj?.metric) return null
    return { ...base(subj.universe, subj.metric), op: SIDE[m[2]], level: Number(m[3]), find: m[1] === 'longest' ? 'longest' : 'last_episode' }
  }
  m = QUANT_RE.exec(t)
  if (m) {
    // [1] last/first [2] quantifier [3] level [4] universe [5] above/below [6] MA period [7] universe
    const subj = lastBreadthSubject()
    const n = m[6] ? Number(m[6]) : null
    if (n != null && !MA_PERIODS.has(n)) return null
    const metric = n != null ? `pct_above_${n}sma` : subj?.metric
    if (!metric || !/^pct_above_\d+sma$/.test(metric) || !BREADTH_METRICS.includes(metric)) return null
    const universe = uniOf(m[4] || m[7]) || subj?.universe || 'us'
    const op = Q_OP[m[2]], level = Number(m[3])
    const c = SIDE[m[5]] === 'below' ? inverted(op, level) : { op, level }
    return { ...base(universe, metric), ...c, find: m[1] === 'first' ? 'first' : 'last' }
  }
  m = STAY_RE.exec(t)
  if (m) {
    // the run of sessions on one side: the remembered search's (its dates kept), or the side named here
    const subj = lastBreadthSubject()
    if (!subj?.metric || !BREADTH_UNIVERSES.concat('uct').includes(subj.universe)) return null
    const h = subj.kind === 'history' && subj.history ? subj.history : null
    let c = m[1] ? { op: SIDE[m[1]], level: Number(m[2]) } : h ? { op: sideOfOp(h.op), level: h.level } : null
    if (!c) return null                                              // "how long?" with no condition anywhere
    if (m[1] && subj.kind === 'show' && subj.show?.side === 'below') c = inverted(c.op, c.level)
    return { ...base(subj.universe, subj.metric), ...(h ? { start: h.start, end: h.end } : {}), ...c, find: 'last_episode' }
  }
  const subj = lastBreadthSubject()
  if (subj?.kind === 'history' && subj.history) {
    m = SAME_RE.exec(t) || UNI_SWITCH_RE.exec(t)
    if (m) return { ...subj.history, universe: uniOf(m[1]) }
    m = LASTYEAR_RE.exec(t)
    if (m) {
      const today = breadthToday() || new Date().toISOString().slice(0, 10)
      const y = m[1] === 'last year' ? Number(today.slice(0, 4)) - 1 : m[1] === 'this year' ? Number(today.slice(0, 4)) : Number(m[2])
      if (!(y >= 1990 && y <= Number(today.slice(0, 4)))) return null
      return { ...subj.history, start: `${y}-01-01`, end: y === Number(today.slice(0, 4)) ? null : `${y}-12-31` }
    }
  }
  return null
}

const nullableDate = { type: ['string', 'null'] }
let registered = false
export function registerBreadthHistoryCapability() {
  if (registered) return
  registered = true
  registerCapability({
    name: 'breadth.history',
    surfaces: ['charts'],
    target: 'breadth', query: true,
    localOnly: true,                    // ⛔ shown to the member; never replayed to a model
    summary: 'Search UCT\'s finalized daily MARKET BREADTH history (US, NYSE, Nasdaq) for when a condition held: the last/first time a measure was below/above a level, crossings, how many times, episodes and how long they lasted. '
      + 'UCT computes it and shows the member; you never see figures. Never say UCT lacks historical breadth.',
    hints: 'target = breadth entry ref. universe us (default) | nyse | nasdaq | uct; metric = ONE key (same keys as breadth.show). '
      + 'op below | at_or_below | above | at_or_above (strict unless at_or) | crosses_below | crosses_above; level in the measure\'s unit (10 = 10%). '
      + 'find last | first (date of the most recent / earliest match) | count (sessions + episodes; crossings for crosses_*) | episodes | longest | last_episode (runs of consecutive sessions). '
      + 'start / end YYYY-MM-DD or null (all history). aggregation "daily". A follow-up "that" / "it" = the measure and universe of the member\'s last breadth request. '
      + 'Lowest / highest in a period: breadth.show mode series. reply: one short line, no figures.',
    args: {
      type: 'object',
      properties: {
        universe: { type: 'string', enum: AGENT_UNIVERSES },
        metric: { type: 'string', enum: BREADTH_METRICS },
        op: { type: 'string', enum: HISTORY_OPS },
        level: { type: 'number' },
        find: { type: 'string', enum: HISTORY_FINDS },
        start: nullableDate, end: nullableDate,
        aggregation: { type: 'string', enum: HISTORY_AGGREGATIONS },
      },
      required: ['universe', 'metric', 'op', 'level', 'find', 'start', 'end', 'aggregation'],
      additionalProperties: false,
    },
    fastWhole: true,
    fastCorrect: false,                 // a search is never run on a guessed spelling
    fast: ({ raw }) => breadthHistoryFast(raw),
    answer: (_snap, args) => answerHistory(args),
  })
}
