// ── UCT Agent REFERENCES: follow-ups that point at what the conversation showed or did (Gate C) ──────
//
//   "open the third one" / "pull up #3" / "what about the last one"   → that row of the latest results,
//                                                                         on the chart in front of the member
//   "compare it to the others" / "… to the top 5"                     → overlay the rest of the results
//   "do the same on the right one" / "same thing for the other chart"  → repeat the last change there
//   "put a 20 EMA on it" (several charts, no click)                   → `it` = the chart the conversation
//                                                                         last changed (subjectTarget)
//
// Resolved ONLY from session memory (agent/memory.js, written by UCT) and the LIVE board. Every reference
// is re-validated here: the set must be fresh, the index must exist, a chart must still be on the board in
// the same layout. Anything that does not hold → a plain sentence (`say`) or null (the model path, which
// sees the same memory and asks). The ops produced are the SAME registry ops a typed command produces and
// go through the same planner, policy, runtime and Undo — there is no second path.
//
// Returns null | { kind: 'ops', ops, target, ref } | { kind: 'say', text }

import { getCapability, getTargetKind } from './capabilities'
import { canon, matchPosition } from './fastPath'
import { updateOfSubject } from './capabilities/indicatorEdits'

const ORD = { first: 1, top: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1, bottom: -1 }
const ORD_WORD = Object.keys(ORD).join('|')
// "the third one", "#3", "number 3", "the 3rd", "the 3rd result", "the last one", "the top one"
const ORDINAL = `(?:the )?(?:(${ORD_WORD})|(\\d{1,2})(?:st|nd|rd|th)|#\\s?(\\d{1,2})|(?:number|no\\.?) (\\d{1,2}))(?: (?:one|result|stock|name|ticker|pick|row|symbol)s?)?(?: (?:on|in|from) (?:the|that|this) (?:list|screen|results?))?`
const OPEN_VERB = '(?:open|show(?: me)?|chart|pull up|bring up|load|go to|switch to|put up|look at|let me see|lemme see|what about|how about)'
const OPEN_RE = new RegExp(`^${OPEN_VERB} ${ORDINAL}(?: (?:on|in) the chart)?$`)
const COMPARE_RE = /^compare (?:it|this|that|this one|that one|this chart|the chart) (?:to|with|against|vs\.?) (?:(the others|the rest|the other ones|all the others|them|all of them)|the (?:top|first) (\d{1,2})(?: of them| others)?)$/
const SAME_RE = /^(?:(?:do|apply|use|make) )?(?:the )?same(?: thing| settings| change| again)?(?: (?:on|for|to|with|in)) (?:the )?(top-left|top-right|bottom-left|bottom-right|left|right|top|bottom|upper|lower|other)(?: (?:one|chart|side))?(?: too| as well)?$/
const NORM_POS = { upper: 'top', lower: 'bottom' }
// "make it a 9", "change that to an EMA" — an EDIT of the indicator this chat last touched
const EDIT_IT = /^(?:make|change|set|switch|turn|bump) (?:it|that|this|that one|this one) (?:to |into |up to |down to )?(?:an? |the )?(.+)$/
const MAX_COMPARE = 10                            // chart.compare's own limit (10 overlays per chart)

const chartsOf = (host) => { try { return getTargetKind('chart')?.list(host) || [] } catch { return [] } }

function ordinalOf(m, offset) {
  const [w, nth, hash, num] = [m[offset], m[offset + 1], m[offset + 2], m[offset + 3]]
  if (w) return ORD[w]
  const n = Number(nth || hash || num)
  return n > 0 ? n : null
}

/** The chart a follow-up means, from the live board: one chart → it; else the conversation's subject chart
 *  if it is still on THIS board; else the chart the member clicked; else null (the panel asks). */
export function subjectChart(host, memory, epoch) {
  const charts = chartsOf(host)
  if (charts.length === 1) return charts[0]
  const s = memory?.subject('chart', epoch)
  if (s) { const hit = charts.find(c => c.ref === s.ref); if (hit) return hit }
  try { const sel = host?.charts?.selected?.(); const hit = charts.find(c => c.ref === sel); if (hit) return hit } catch { /* no selection */ }
  return null
}

export function resolveReference(text, { host, memory, epoch = null } = {}) {
  if (!memory) return null
  const lower = canon(text)
  if (!lower) return null

  // ── "open the third one" ──
  const open = OPEN_RE.exec(lower)
  if (open) {
    const set = memory.latestResults()
    if (!set) return null                                         // nothing shown recently → the model
    const n = ordinalOf(open, 1)
    if (n == null) return null
    const index = n === -1 ? set.symbols.length : n
    if (index < 1 || index > set.symbols.length) {
      return { kind: 'say', text: `${set.label ? `“${set.label}”` : 'The last results'} showed ${set.symbols.length} — pick a number from 1 to ${set.symbols.length}.` }
    }
    const symbol = set.symbols[index - 1]
    const chart = subjectChart(host, memory, epoch)
    // `trusted`: the ticker came from UCT's own results, not the member's typing (no ticker lookup)
    return { kind: 'ops', ops: [{ action: 'chart.setSymbol', args: { symbol }, trusted: true, ...(chart ? { target: chart.ref } : {}) }], target: null, ref: { set: set.id, index, symbol } }
  }

  // ── "compare it to the others" ──
  const cmp = COMPARE_RE.exec(lower)
  if (cmp) {
    const set = memory.latestResults()
    if (!set) return null
    const chart = subjectChart(host, memory, epoch)
    if (!chart) return null                                       // which chart is "it"? → the model asks
    const shown = String(chart.symbol || '').toUpperCase()
    const others = set.symbols.filter(s => s !== shown)
    const want = cmp[2] ? Math.min(Number(cmp[2]), others.length) : others.length
    if (want > MAX_COMPARE) {
      return { kind: 'say', text: `That's ${others.length} other results — a chart can overlay ${MAX_COMPARE} symbols at most. Try “compare it to the top 5”.` }
    }
    if (!want) return { kind: 'say', text: 'There are no other results to compare it with.' }
    return { kind: 'ops', ops: [{ action: 'chart.compare', args: { add: others.slice(0, want), remove: [], clear: false }, trusted: true, target: chart.ref }], target: null, ref: { set: set.id, count: want } }
  }

  // ── "make it a 9" / "change that to an EMA" — only while the conversation is about an indicator (the last
  // change was one), so "make it weekly" after a chart change is still the chart's timeframe ──
  const edit = EDIT_IT.exec(lower)
  if (edit) {
    const last = memory.lastChange(epoch)
    const subject = memory.subject('indicator', epoch)
    if (subject && last && last.ops.every(o => String(o.action).startsWith('indicator.'))) {
      const r = updateOfSubject(host, subject, edit[1])
      if (r?.say) return { kind: 'say', text: r.say }
      if (r?.op) return { kind: 'ops', ops: [r.op], target: null, ref: { indicator: subject.instanceId } }
    }
  }

  // ── "do the same on the right one" ──
  const same = SAME_RE.exec(lower)
  if (same) {
    const last = memory.lastChange(epoch)
    if (!last) return { kind: 'say', text: "I don't have a recent change to repeat — tell me what you'd like changed." }
    // Only plain, reversible, local changes repeat by reference; anything else is asked for in words.
    const ok = last.ops.every(o => { const c = getCapability(o.action); return c && (c.risk || 'local') === 'local' && c.reversible !== false && c.target })
    if (!ok) return null
    const kinds = [...new Set(last.ops.map(o => getCapability(o.action).target))]
    if (kinds.length !== 1) return null
    const kind = getTargetKind(kinds[0])
    const list = kind ? kind.list(host) : []
    const pos = NORM_POS[same[1]] || same[1]
    const before = new Set(last.ops.map(o => o.target))
    const hits = pos === 'other' ? list.filter(s => !before.has(s.ref)) : matchPosition(list, pos)
    if (hits.length !== 1) return pos === 'other' || !hits.length ? null : { kind: 'say', text: `More than one ${kind.noun || 'chart'} is on the ${pos} — which one?` }
    if (before.has(hits[0].ref)) return { kind: 'say', text: 'That change is already on that one.' }
    return { kind: 'ops', ops: last.ops.map(o => ({ action: o.action, args: o.args, target: hits[0].ref })), target: null, ref: { repeat: last.ops.map(o => o.action) } }
  }
  return null
}

/** "put a 20 EMA on it" with several charts and no click: `it` / `that chart` → the conversation's subject
 *  chart, if it is still on this board. Only fills a MISSING target of chart-backed ops; never overrides an
 *  explicit position, a named chart or a clicked chart (deixis keeps precedence there). */
const IT_WORDS = /\b(?:it|that chart|that one|the same chart)\b/i
export function subjectTarget(fast, text, { host, memory, epoch = null } = {}) {
  if (!memory || fast?.kind !== 'ops' || fast.target || !IT_WORDS.test(String(text || ''))) return fast
  if (fast.ops.some(o => o.target)) return fast
  const kinds = [...new Set(fast.ops.map(o => getCapability(o.action)?.target).filter(Boolean))]
  if (kinds.length !== 1) return fast
  const kind = getTargetKind(kinds[0])
  const list = kind ? kind.list(host) : []
  if (list.length < 2) return fast
  try { if (host?.charts?.selected?.()) return fast } catch { /* no selection */ }
  const s = memory.subject('chart', epoch)
  const hit = s && list.find(x => x.ref === s.ref || x.chart === s.ref || x.chartRef === s.ref)
  return hit ? { ...fast, ops: fast.ops.map(o => ({ ...o, target: hit.ref })) } : fast
}
