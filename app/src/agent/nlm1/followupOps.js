// ── NLM-1 D2/D3.1 · FOLLOW-UPS AS OPERATIONS (DARK: the NLM-1 two-key flag) ─────────────────────────────────────
//
// Mechanisms, not phrase templates (AUDIT 11-04, sealed-set categories b–f):
//
//   CHART REFERENT SETS   a target phrase → the charts it names, from the LIVE board's geometry and the conversation:
//                         positions ("the right one", "top left", "the bottom two", "the left two"), ordinals ("the
//                         first one": the charts the last request CREATED, in creation order, else board order),
//                         quantifiers ("the other three", "the other two on the bottom", "the others", "both",
//                         "all of them"), tickers ("NVDA") and lists of these ("the top right and bottom left").
//                         A count that does not match ("the other two" with three others) → no reading (never a guess).
//   REPEAT / ADDITIVE     the last committing request's ops (memory.lastTurn — what the runtime actually committed),
//                         re-aimed at each chart of the set ("now the bottom two", "put that on AMD as well"); an
//                         indicator phrase on its own ("and macd too", "and the 50 sma too") is ADDED to the charts the
//                         last request touched.
//   INVERSION             "back to daily", "go back to NVDA", "put the right one back to daily", "put the first one
//                         back", "back to the previous timeframe": a value said → that value; none / "previous" → the
//                         value the chart had BEFORE the last request (a per-turn snapshot of each chart's symbol and
//                         timeframe, taken when each member message starts) — only for what that request changed.
//   REMOVAL BY POSITION   "remove it from the right one", "take it off the bottom two": the indicator the conversation
//                         last added (memory.indicatorSet: what it IS — defId + length), found on each chart of the set.
//
// Output is ordinary registry ops for the ordinary execute (planner, policy — a removal is still a proposal —, runtime,
// receipts, grouped Undo). Anything uncertain → null (the message goes on as typed) or { say }. Pure but for `host` reads.

import { fastParse } from '../fastPath'
import { getCapability, getTargetKind } from '../capabilities'
import { indicatorEditsRef, indicatorRowsOf } from '../capabilities/indicatorEdits'
import { tickerWordsOf } from './capabilityIndex'
import { inplanOn } from './inplan'

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 }
const ORD = { first: 0, second: 1, third: 2, fourth: 3 }
const TF_ALT = 'daily|weekly|monthly|hourly|intraday|\\d+\\s?(?:m|min|mins|minute|minutes|h|hr|hour|hours)'
const TF_WORD = new RegExp(`\\b(${TF_ALT})\\b`, 'i')
const PREVIOUS = /\b(previous|prior|original|before|how it was|where it was|what it was|the way it was|last one)\b/i

// ── the board ─────────────────────────────────────────────────────────────────────────────────────────────────
export function boardCharts(host) {
  let list = []
  try { list = host?.charts?.list?.() || [] } catch { list = [] }
  return list.filter(c => c && c.ref != null).map(c => ({ ref: String(c.ref), symbol: String(c.symbol || '').toUpperCase(), tf: c.tf ?? null, cell: c.cell || { x: 0, y: 0, w: 0, h: 0 } }))
    .sort((a, b) => (a.cell.y - b.cell.y) || (a.cell.x - b.cell.x))
}
/** Each chart's place words from the board's geometry: top / bottom / left / right (only where the board has two rows / columns). */
function places(charts) {
  const ys = [...new Set(charts.map(c => c.cell.y))].sort((a, b) => a - b)
  const xs = [...new Set(charts.map(c => c.cell.x))].sort((a, b) => a - b)
  return new Map(charts.map(c => {
    const w = new Set()
    if (ys.length > 1) { if (c.cell.y === ys[0]) w.add('top'); if (c.cell.y === ys[ys.length - 1]) w.add('bottom') }
    if (xs.length > 1) { if (c.cell.x === xs[0]) w.add('left'); if (c.cell.x === xs[xs.length - 1]) w.add('right') }
    return [c.ref, w]
  }))
}
/** A snapshot of the board's charts (symbol, timeframe) — taken when a member message starts. */
export const snapshotOf = (host) => Object.fromEntries(boardCharts(host).map(c => [c.ref, { symbol: c.symbol, tf: c.tf }]))

// ── chart referent sets ───────────────────────────────────────────────────────────────────────────────────────
const normPhrase = (p) => String(p || '').toLowerCase().replace(/[.!?]+$/, '').replace(/\bupper\b/g, 'top').replace(/\blower\b/g, 'bottom')
  .replace(/^(?:on|to|for|onto|from|off|in|with|of)\s+/, '').replace(/\b(?:the|my)\b/g, ' ').replace(/\b(?:charts?|ones?)\b/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The NUMBER a phrase says, read from the member's own words BEFORE normalising (which drops "one" / "chart"):
 * 'one' — "the other one", "one", "that chart", "it", "the other" (a single chart); 'many' — "the others", "both",
 * "the top two", "them", "all"; null — no number said (a place list, a ticker list: each part is checked on its own).
 * (#806 review: "and the other one" on a four-chart board switched THREE charts; "put one back" reverted BOTH.)
 */
export function numberOf(phraseRaw) {
  const w = String(phraseRaw || '').toLowerCase()
  if (/\b(?:ones|charts|others|rest|remaining|them|those|these|both|all|every|each|everything|two|three|four|five|six|seven|eight|nine)\b|\b[2-9]\b/.test(w)) return 'many'
  if (/\b(?:one|chart|it|that|this|other)\b/.test(w)) return 'one'
  return null
}

/**
 * The charts a phrase names → [ref…] | null. `last`: the charts the last request touched; `created`: the charts it created
 * (creation order). ⛔ The phrase's own NUMBER is kept: a singular phrase ("the other one", "one", "it") that resolves to
 * anything but exactly ONE chart is no reading (the message goes on as v1 reads it — to the model, which asks), and a
 * counted one ("the other two") must match its count. Never several charts for a phrase that names one.
 */
export function resolveCharts(phraseRaw, opts = {}) {
  const got = resolveChartsAny(phraseRaw, opts)
  if (got && numberOf(phraseRaw) === 'one' && got.length !== 1) return null
  return got
}
function resolveChartsAny(phraseRaw, { host, last = [], created = [] } = {}) {
  const charts = boardCharts(host)
  if (!charts.length) return null
  const P = places(charts)
  const refs = charts.map(c => c.ref)
  const raw = String(phraseRaw || '')
  // tickers (on the raw text: case matters)
  const ticks = tickerWordsOf(raw)
  const p = normPhrase(raw)
  if (ticks.length && p.split(' ').every(w => !w || ticks.map(t => t.toLowerCase()).includes(w) || w === 'and' || w === ',')) {
    const hit = ticks.map(t => charts.filter(c => c.symbol === t))
    return hit.every(h => h.length === 1) ? hit.map(h => h[0].ref) : null
  }
  if (!p || /^(?:it|that|this|them|those|these|same)$/.test(p)) return last.length ? [...last] : null
  if (/^(?:both|both of them|two|two of them)$/.test(p)) return charts.length === 2 ? refs : (last.length === 2 ? [...last] : null)
  if (/^(?:all|all of them|every|each|each of them|everything|every one)$/.test(p)) return refs
  // quantifiers over the REST: "other", "others", "rest", "other three", "other two on the bottom", "remaining"
  let m = /^(?:other|others|rest|remaining|everything else|the rest)(?: (one|two|three|four|five|six|\d))?(?: (?:on|at|in) (top|bottom|left|right))?$/.exec(p)
  if (m) {
    let rest = refs.filter(r => !last.includes(r))
    if (m[2]) rest = rest.filter(r => P.get(r).has(m[2]))
    if (m[1] && rest.length !== NUM[m[1]]) return null
    return rest.length ? rest : null
  }
  // "<place> two / three": that side of the board, with the count checked
  m = /^(top|bottom|left|right) (one|two|three|four|\d)$/.exec(p)
  if (m) {
    const side = refs.filter(r => P.get(r).has(m[1]))
    return side.length === NUM[m[2]] ? side : null
  }
  // ordinals: the last request's CREATED charts in creation order when it made two or more, else board order
  m = /^(first|second|third|fourth|last)$/.exec(p)
  if (m) {
    const order = created.filter(r => refs.includes(r)).length >= 2 ? created.filter(r => refs.includes(r)) : refs
    const i = m[1] === 'last' ? order.length - 1 : ORD[m[1]]
    return order[i] != null ? [order[i]] : null
  }
  // one or more places joined by "and" / ","
  const parts = p.split(/\s*(?:,|\band\b)\s*/).map(x => x.trim()).filter(Boolean)
  const out = []
  for (const part of parts) {
    const words = part.split(' ').filter(Boolean)
    if (!words.length || !words.every(w => ['top', 'bottom', 'left', 'right', 'middle'].includes(w))) return null
    const hit = refs.filter(r => words.every(w => P.get(r).has(w)))
    if (hit.length !== 1) return null
    out.push(hit[0])
  }
  return out.length ? out : null
}

// ── re-aiming the last request's ops ──────────────────────────────────────────────────────────────────────────
function aim(op, ref) {
  const cap = getCapability(op?.action)
  if (!cap) return null
  if (cap.target === 'chart') return { action: op.action, target: ref, args: op.args || {} }
  // an indicator op re-aims only when it names its indicator by what it IS (an add, or "#21:ema" — never another chart's id)
  if (cap.target === 'indicatorEdits' && (op.action === 'indicator.add' || op.args?.instance == null || String(op.args.instance).startsWith('#'))) {
    return { action: op.action, target: indicatorEditsRef(ref), args: op.args || {} }
  }
  return null
}

/** How the fast path names an added indicator: "the 21 ema", "rsi" — from the add's own args */
function describeAdd(op) {
  const a = op?.args || {}
  const inp = Object.fromEntries((Array.isArray(a.inputs) ? a.inputs : []).map(i => [i.key, i.value]))
  if (a.defId === 'movingAverage' && inp.period) return `the ${inp.period} ${String(inp.maType || 'sma')}`
  return a.defId ? `the ${a.defId}` : null
}
const STYLE_WORDS = /\b(?:red|green|blue|white|black|orange|yellow|purple|pink|teal|gr[ae]y|cyan|magenta|lime|gold|navy|maroon|thick|thicker|thin|thinner|bold|bolder|dashed|dotted|solid)\b/i
/**
 * STYLE THE INDICATOR JUST ADDED: "make it orange", "make that thicker", "turn the new one dashed" — the indicator the last
 * request (or the step before, inside one request) ADDED, named by what it is, styled on the chart it was added to.
 */
function styleLastAdded(s, last, host) {
  if (!inplanOn()) return null                    // style-last-added: dark behind the in-plan key (no sealed pass took it)
  const m =/^(?:make|turn|color|colour|paint|change|set)\s+(?:it|that|that one|this|this one|the new one|the (?:new )?(?:line|indicator|study))\s+(?:to\s+|into\s+)?(.+)$/i.exec(s)
  if (!m || !STYLE_WORDS.test(m[1])) return null
  const adds = (last?.ops || []).filter(o => o.action === 'indicator.add')
  const add = adds[adds.length - 1]
  const what = describeAdd(add)
  if (!add || !what) return null
  const f = fastParse(`make ${what} ${m[1]}`, { host })
  if (f?.kind !== 'ops' || !f.ops?.length || !f.ops.every(o => /^indicatorStyle\./.test(o.action))) return null
  const ops = f.ops.map(o => aim(o, String(add.target)))
  return ops.every(Boolean) ? { ops, rule: 'style-last-added' } : null
}
function repeatOn(lastOps0, refs) {
  // what the last request DID, once each ("make both charts weekly" committed one change per chart)
  const seen = new Set()
  const lastOps = (lastOps0 || []).filter(o => { const k = o.action + JSON.stringify(o.args || {}); if (seen.has(k)) return false; seen.add(k); return true })
  const out = []
  for (const ref of refs) for (const op of lastOps) { const a = aim(op, ref); if (!a) return null; out.push(a) }
  return out.length ? out : null
}
/** "add <words>" read by the fast path → its indicator.add ops (args only) | null */
function indicatorAdds(words, host) {
  const f = fastParse(`add ${words}`, { host })
  if (f?.kind !== 'ops' || !f.ops?.length || !f.ops.every(o => o.action === 'indicator.add')) return null
  return f.ops.map(o => ({ action: 'indicator.add', args: o.args || {} }))
}
/** "switch to <value>" read by the fast path → { action, args } of a chart timeframe / symbol change | null */
function valueOp(value, host) {
  const v = String(value || '').trim()
  if (!v) return null
  const tick = tickerWordsOf(v)
  if (tick.length === 1 && v.replace(/\$/, '').trim().toUpperCase() === tick[0]) return { action: 'chart.setSymbol', args: { symbol: tick[0] } }
  if (!TF_WORD.test(v)) return null
  const f = fastParse(`switch to ${v.replace(/^the /i, '')}`, { host })
  const op = f?.kind === 'ops' && f.ops.length === 1 ? f.ops[0] : null
  return op && op.action === 'chart.setTimeframe' ? { action: op.action, args: op.args || {} } : null
}

// ── a chart command aimed at a referent set ───────────────────────────────────────────────────────────────────
// inline sets: "make THE TOP TWO CHARTS weekly", "put BOTH CHARTS on weekly", "make SPY AND QQQ weekly"
const INLINE_SET = /^(\w+(?:\s+up)?)\s+((?:the\s+)?(?:top|bottom|left|right)\s+(?:two|three|four|\d)(?:\s+charts?)?|(?:the\s+)?(?:\$?[A-Z]{1,5})(?:(?:\s*,\s*|\s+and\s+)\$?[A-Z]{1,5})+(?:\s+charts?)?|(?:the\s+)?\$?[A-Z]{1,5}(?:\s+chart)?|the\s+other\s+(?:one|two|three)(?:\s+charts?)?|the\s+(?:others|rest))\s+(.+)$/
/** → { ops, rule } | null — only when every op the command makes is chart-scoped and the set resolves */
export function aimCommandAtSet(s, { host, sets }) {
  const tryRead = (command, phrase) => {
    const refs = sets(phrase)
    if (!refs) return null
    const f = fastParse(command, { host })
    if (f?.kind !== 'ops' || !f.ops?.length || f.ops.some(o => o.target)) return null
    const ops = refs.flatMap(ref => f.ops.map(o => aim(o, ref)))
    return ops.length && ops.every(Boolean) ? { ops, rule: 'command-at-set' } : null
  }
  // trailing: "<command> to|on|for|onto <set>" — split at each such word from the right
  const words = s.split(/\s+/)
  for (let i = words.length - 2; i >= 1; i--) {
    if (!/^(?:to|on|for|onto)$/i.test(words[i])) continue
    const r = tryRead(`${words.slice(0, i).join(' ')} on it`, words.slice(i + 1).join(' '))
    if (r) return r
  }
  // inline: "<verb> <set> <rest>"
  const m = INLINE_SET.exec(s)
  if (m) return tryRead(`${m[1]} it ${m[3]}`, m[2])
  return null
}

/** D3.3 swap → { ops, rule } | null (exactly two charts; their places, or their tickers when the words say tickers / symbols) */
export function swapOps(s, { host, sets }) {
  if (!inplanOn()) return null                    // swap-places / swap-tickers: dark behind the in-plan key (no sealed pass took them)
  const m =/^(?:swap|switch|flip|exchange|trade|reverse)\s+(?:the\s+)?(?:(tickers?|symbols?|stocks?)\s+(?:on|of|between|in)\s+)?(.+?)(?:\s+(?:around|over|places|positions))?$/i.exec(String(s || '').trim())
  if (!m) return null
  const phrase = m[2].replace(/^(?:places|positions)\s+(?:of\s+)?/i, '').trim()
  const charts = boardCharts(host)
  // "the two charts", "them", "both": the board's two charts when it has exactly two; anything else through the set resolver
  const pair = /^(?:them|those|these|both(?: of them| charts)?|(?:the\s+)?two(?:\s+charts)?|the\s+charts)$/i.test(phrase)
  const refs = pair ? (charts.length === 2 ? charts.map(c => c.ref) : null) : sets(phrase)
  if (!refs || refs.length !== 2) return null
  if (m[1]) {
    const [a, b] = refs.map(r => charts.find(c => c.ref === r))
    if (!a?.symbol || !b?.symbol) return null
    return { ops: [{ action: 'chart.setSymbol', target: a.ref, args: { symbol: b.symbol } }, { action: 'chart.setSymbol', target: b.ref, args: { symbol: a.symbol } }], rule: 'swap-tickers' }
  }
  const kind = getTargetKind(getCapability('board.swap')?.target)
  const board = (() => { try { return kind?.list?.(host) || [] } catch { return [] } })()
  if (board.length !== 1) return null
  return { ops: [{ action: 'board.swap', target: board[0].ref, args: { a: refs[0], b: refs[1] } }], rule: 'swap-places' }
}

/** The last request's ops with a timeframe or an indicator REPLACED ("same but monthly", "same but macd") | null */
function modify(lastOps, mod, host) {
  const v = valueOp(mod, host)
  if (v?.action === 'chart.setTimeframe') {
    if (!lastOps.some(o => o.action === 'chart.setTimeframe')) return [...lastOps, { action: v.action, args: v.args }]
    return lastOps.map(o => (o.action === 'chart.setTimeframe' ? { ...o, args: v.args } : o))
  }
  const adds = indicatorAdds(mod, host)
  const kinds = new Set(lastOps.filter(o => o.action === 'indicator.add').map(o => o.args?.defId))
  if (adds?.length === 1 && kinds.size === 1) return lastOps.map(o => (o.action === 'indicator.add' ? { ...o, args: adds[0].args } : o))
  return null
}

// ── ordinals over what was just made ─────────────────────────────────────────────────────────────────────────
const ORD_PHRASE = /\bthe (first|second|third|fourth|last) (?:one|chart|new one|new chart)\b/i
/**
 * "make the first one weekly" right after a request that CREATED two or more charts (or inside one, after its grid
 * step): the ordinal counts THOSE charts in the order they were made, not the board. `order`: their refs, in order.
 * The rest of the words are read by the fast path as about "it", and aimed at that one chart. → { ops, rule } | null
 */
export function rescopeOrdinal(text, { host, order = [] } = {}) {
  try {
    if (!inplanOn()) return null                  // ordinal-of-created / the nlm1:ordinal path: dark behind the in-plan key
    const m = ORD_PHRASE.exec(String(text || ''))
    const alive = (order || []).map(String).filter(r => boardCharts(host).some(c => c.ref === r))
    if (!m || alive.length < 2) return null
    const ref = m[1].toLowerCase() === 'last' ? alive[alive.length - 1] : alive[ORD[m[1].toLowerCase()]]
    if (!ref) return null
    const f = fastParse(String(text).replace(ORD_PHRASE, 'it'), { host })
    if (f?.kind !== 'ops' || !f.ops?.length) return null
    const ops = f.ops.map(o => aim(o, ref))
    return ops.every(Boolean) ? { ops, rule: 'ordinal-of-created' } : null
  } catch { return null }
}

// ── the reader ────────────────────────────────────────────────────────────────────────────────────────────────
const LEAD = /^(?:(?:and|now|ok|okay|also|then|so|cool|great|perfect|nice|alright|yeah)[,]?\s+)+/i
const TAIL = /(?:,?\s+(?:too|as well|also|please|pls|thanks|instead))+$/i
function clean(text) {
  let s = String(text || '').trim().replace(/[.!?]+$/, '').trim()
  const tail = TAIL.test(s)
  s = s.replace(LEAD, '').replace(TAIL, '').trim()
  return { s, tail }
}

/**
 * → { ops, rule } | { say, rule } | null.
 * ctx: { host, memory, epoch, created: [refs the last committing request created], before: snapshot taken before it }
 */
export function resolveFollowUpOps(text, { host, memory, epoch = null, created = [], before = null } = {}) {
  try {
    const last = memory?.lastTurn?.(epoch) || null
    const lastCharts = last ? [...new Set((last.charts || []).map(String))].filter(r => boardCharts(host).some(c => c.ref === r)) : []
    const { s, tail } = clean(text)
    const sets = (phrase) => resolveCharts(phrase, { host, last: lastCharts, created })
    let m

    // REMOVAL by position: "<remove> it|that|<indicator> <from|off> <charts>"
    m = /^(?:remove|delete|take|drop|get rid of|kill|pull)\s+(.+?)\s+(?:off(?: of)?|from|on)\s+(.+)$/i.exec(s)
    if (m) {
      const what = m[1].trim()
      const refs = sets(m[2])
      if (!refs) return null
      let want = null
      if (/^(?:it|that|this|them|those|the indicator|that indicator)$/i.test(what)) {
        const set = memory?.indicatorSet?.(epoch) || null
        const lastInd = set && set.length ? set[set.length - 1] : null
        const row = lastInd ? (() => { try { return indicatorRowsOf(host.charts.read(lastInd.chart)?.cs).find(r => String(r.instanceId) === String(lastInd.instanceId)) } catch { return null } })() : null
        if (!lastInd) return null
        want = { defId: lastInd.defId || row?.defId, period: row?.inputs?.period ?? null }
      } else {
        const adds = indicatorAdds(what, host)
        if (!adds || adds.length !== 1) return null
        const per = (adds[0].args.inputs || []).find(i => i.key === 'period')
        want = { defId: adds[0].args.defId, period: per ? per.value : null }
      }
      if (!want.defId) return null
      const ops = []
      for (const ref of refs) {
        let rows = []
        try { rows = indicatorRowsOf(host.charts.read(ref)?.cs) || [] } catch { rows = [] }
        const hits = rows.filter(r => r.defId === want.defId && (want.period == null || Number(r.inputs?.period) === Number(want.period)))
        if (hits.length > 1) return { say: 'That chart has more than one of those — say which one (its length) and ask again.', rule: 'remove-ambiguous' }
        if (!hits.length) {
          // said plainly, never a guess at another chart: the indicator meant is not on the chart named
          const label = (() => { try { return host.charts.read(ref)?.label || `the ${host.charts.read(ref)?.symbol} chart` } catch { return 'that chart' } })()
          return { say: `There's no ${want.period ? `${want.defId} ${want.period}` : want.defId} on ${label}, so nothing was removed.`.replace('movingAverage', 'moving average'), rule: 'remove-not-there' }
        }
        ops.push({ action: 'indicator.remove', target: indicatorEditsRef(ref), args: { instance: hits[0].instanceId } })
      }
      // remove-on-charts: a cross-turn behaviour, NOT gated (AUDIT 11-04) — indicator.remove is always a proposal the member
      // approves (the owner's confirmation rule); the refusal / question above answer when it cannot be certain
      return { ops, rule: 'remove-on-charts' }
    }

    // INVERSION: "[go|put|switch|set] [<charts>] back [to <value>]"
    m = /^(?:(?:go|switch|change|flip|put|set|turn|take|bring|move)\s+)?(?:(.+?)\s+)?back(?:\s+(?:to|on|onto|at|in)\s+(.+))?$/i.exec(s)
    if (m && last) {
      const refs = m[1] ? sets(m[1]) : (lastCharts.length ? lastCharts : null)
      if (!refs) return null
      const value = (m[2] || '').trim()
      if (value && !PREVIOUS.test(value)) {
        const op = valueOp(value, host)
        if (!op) return null
        return { ops: refs.map(ref => ({ action: op.action, target: ref, args: op.args })), rule: 'back-to-value' }
      }
      // the value each chart had BEFORE the last request — only the attributes that request changed
      // (back-to-before is dark behind the in-plan key: no sealed pass took it)
      if (!before || !inplanOn()) return null
      const attr = /\b(time ?frame|interval)\b/i.test(value) ? 'tf' : /\b(symbol|ticker|stock)\b/i.test(value) ? 'symbol' : null
      const changed = new Set((last.ops || []).map(o => (o.action === 'chart.setTimeframe' ? 'tf' : o.action === 'chart.setSymbol' ? 'symbol' : null)).filter(Boolean))
      const ops = []
      for (const ref of refs) {
        const was = before[ref]
        const now = boardCharts(host).find(c => c.ref === ref)
        if (!was || !now) return null
        if ((!attr || attr === 'tf') && changed.has('tf') && was.tf && was.tf !== now.tf) ops.push({ action: 'chart.setTimeframe', target: ref, args: { timeframe: was.tf } })
        if ((!attr || attr === 'symbol') && changed.has('symbol') && was.symbol && was.symbol !== now.symbol) ops.push({ action: 'chart.setSymbol', target: ref, args: { symbol: was.symbol } })
      }
      return ops.length ? { ops, rule: 'back-to-before' } : null
    }

    // A REFERENT + A VALUE, no verb: "and that one weekly", "the bottom two monthly", "NVDA weekly", "both daily"
    m = new RegExp(`^(.+?)\\s+(?:on |to |in )?(?:the )?(${TF_ALT})(?: chart| timeframe)?$`, 'i').exec(s)
    if (m && !/^(?:make|switch|change|set|put|turn|go|flip|show|open|add)\b/i.test(m[1])) {
      const refs = sets(m[1])
      const op = refs ? valueOp(m[2], host) : null
      if (refs && op) return { ops: refs.map(ref => ({ action: op.action, target: ref, args: op.args })), rule: 'referent-value' }
    }

    // D3.3 SWAP over a referent set of exactly TWO charts: "swap the two charts", "swap them", "swap the top two charts",
    // "swap the tickers on the two charts" — the charts' places (board.swap), or their tickers when the words say so
    const swapped = swapOps(s, { host, sets })
    if (swapped) return swapped

    // A CHART COMMAND AIMED AT A REFERENT SET (any turn, not only a follow-up): "add rsi to AMD", "add macd to SPY and QQQ",
    // "make the top two charts weekly", "put the 21 ema on the bottom two" — the set read by resolveCharts, the command by
    // the fast path as about "it", each chart-scoped op aimed at each chart of the set
    const aimed = aimCommandAtSet(s, { host, sets })
    if (aimed) return aimed

    if (!last?.ops?.length) return null
    // STYLE the indicator the last request added ("make it orange" after "…, add the 21 ema")
    const styled = styleLastAdded(s, last, host)
    if (styled) return styled
    // REPEAT WITH A MODIFICATION on a set: "same but monthly for the other two", "same for the other two but weekly",
    // "same but macd for the bottom two" — the last request's ops, the timeframe / indicator replaced, re-aimed
    m = /^(?:do |did )?(?:the )?same(?: thing)?\s+(?:but|except)\s+(?:with |on |in |the )?(.+?)\s+(?:for|on|to)\s+(.+)$/i.exec(s)
      || (() => { const x = /^(?:do |did )?(?:the )?same(?: thing)?\s+(?:for|on|to)\s+(.+?)\s+(?:but|except)\s+(?:with |on |in |the )?(.+)$/i.exec(s); return x ? [x[0], x[2], x[1]] : null })()
    if (m) {
      const refs = sets(m[2])
      const mod = modify(last.ops, m[1], host)
      if (refs && mod) { const ops = repeatOn(mod, refs); if (ops) return { ops, rule: 'repeat-modified' } }
      return null
    }
    // REPEAT on a set: "(put|do|apply|copy|add) (that|it|the same [thing]) (on|to|for|onto) <charts>"
    m = /^(?:put|do|apply|copy|add|same|repeat)\s+(?:that|it|this|the same(?: thing)?|same|them|those)?\s*(?:(?:on|to|for|onto|with)\s+(.+))?$/i.exec(s)
    if (m && m[1]) {
      const refs = sets(m[1])
      return refs ? (repeatOn(last.ops, refs) ? { ops: repeatOn(last.ops, refs), rule: 'repeat-on-set' } : null) : null
    }
    // ADDITIVE: an indicator phrase on its own ("macd", "the 50 sma") said as an addition → on the charts last touched
    const adds = (tail || /^(?:and|plus|also)\b/i.test(String(text).trim())) ? indicatorAdds(s.replace(/^(?:add|put|throw|slap)\s+/i, ''), host) : null
    if (adds && lastCharts.length) {
      return { ops: lastCharts.flatMap(ref => adds.map(a => ({ ...a, target: indicatorEditsRef(ref) }))), rule: 'additive' }
    }
    // REPEAT, the target said alone: "and the first one", "now the bottom two", "for the other one too",
    // "same for the other two on the bottom"
    const bare = s.replace(/^(?:(?:do |did )?(?:the )?same(?: thing)?|do (?:that|it|this))\s*/i, '').replace(/^(?:for|on|to|with)\s+/i, '')
    if (bare && bare.split(/\s+/).length <= 8) {
      const refs = sets(bare)
      if (refs) {
        const ops = repeatOn(last.ops, refs.filter(r => !lastCharts.includes(r) || refs.length === 1))
        return ops ? { ops, rule: 'repeat-on-set' } : null
      }
    }
    return null
  } catch { return null }
}
