// ── ⛔ NEW-CHARTS RAIL (2026-11-14, AUDIT review of #1251 item ii) ───────────────────────────────────────────────────────
//
// The H14 shape, for references: the member's words are about the charts UCT just CREATED ("make the new charts weekly", "add
// RSI to the new ones", "the charts you just added", "both new charts", "the new chart") but the plan — any reader's or the
// model's — writes a chart that was ALREADY on the board. A DETERMINISTIC check (code, never model instructions) on every planned
// change, beside the chart rail (useAgent railOf), before anything is written or proposed, on every path (instant, model,
// approved card):
//
//   KNOWN SET   the created set (useAgent newSetRef: the charts the latest creating request made, still on this board) — a
//               plan that writes a chart outside it is REFUSED (nothing written, no card), the charts named.
//   NO SET      no created set is known (none made here, a layout switched, they were closed) — the plan is never proposed
//               or applied: the member is ASKED which charts they mean.
//   EXEMPT      an old chart the SAME words address outright — by its ticker ("… and also the SPY one", "and NVDA") or its
//               position ("and the top left one") — or every old chart at once ("… and the other charts too", "all my charts").
//
// WHAT "WRITES A CHART" MEANS (by target kind, never by action name): a changed, non-virtual plan target whose snapshot maps to
// a chart (deixis.chartRefOf — the chart itself, its indicators, its drawings…), plus the board / grid / layout effects the
// chart rail already reads (chartRail.chartEffects: a chart removed, re-symbolled, or replaced by another layout). A target the
// plan itself creates (virtual) is new by definition. Moving / resizing on the board is not a write of a chart's content.
//
// Pure: reads the plan, the words, the created set and the live board through `host`; never writes.
import { getTargetKind } from './capabilities'
import { chartRefOf } from './deixis'
import { chartEffects } from './chartRail'
import { tickersIn } from './multiChart'
import { matchPosition } from './fastPath'

export const NEW_CHARTS_MARK = 'new-charts-rail'

// words that refer to the charts UCT created — STRUCTURAL, so an unseen phrasing of the same shape is read too (AUDIT #1247
// heads-up: a rule that fires only on listed phrases is bypassed by the next one):
//   A  determiner + [count] + a freshness word + up to 3 modifiers + a chart noun  "the new charts", "those 2 fresh AAPL and MSFT
//      panes", "all of the newest ones", "each recent chart", "the brand-new daily charts", "my newly added charts"
//   B  determiner + [modifiers] + a chart noun + [that/which] + [you / you've] + [just] + a making verb   "the charts you just
//      added", "those ones you pulled up", "the panels that you set up", "both graphs you just opened"
//   C  "what you just added / opened / made …"     D  "the charts from your last step / request / answer"
// A determiner (or "what you…") is required, so "add a new chart" / "add two new charts" (creations) are never references; the
// member's OWN additions ("the charts I just added") are not UCT's and are not read. Anything this reads with no known created
// set is ASKED (fail closed), never planned on the board's charts.
const DET = String.raw`(?:the|those|these|that|this|both(?:\s+of)?(?:\s+the)?|all(?:\s+of)?(?:\s+the|\s+those|\s+these)?|each(?:\s+of)?(?:\s+the)?|every(?:\s+one\s+of)?(?:\s+the)?|my|your)`
const COUNT_W = String.raw`(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+)?`
const FRESH = String.raw`(?:brand[\s-]+new|newly[\s-]+(?:added|made|created|opened|built)|just[\s-]+(?:added|made|created|opened)|new|newer|newest|fresh|latest|recent)`
const MODS = String.raw`(?:[\w$.&'’-]+\s+){0,3}?`
const NOUN = String.raw`(?:charts?|ones?|panels?|panes?|cells?|graphs?|windows?|tiles?)`
const MADE = String.raw`(?:added|made|created|opened|built|set\s+up|put\s+up|pulled\s+up|brought\s+up|loaded|launched|spun\s+up|popped\s+up|threw\s+up|plotted|drew|generated|gave\s+me|made\s+me)`
const YOU = String.raw`(?:(?:that|which)\s+)?(?:you(?:['’]ve|\s+have)?\s+|u\s+)?(?:just\s+|recently\s+|already\s+|earlier\s+)?`
const NEW_REF = new RegExp([
  String.raw`\b${DET}\s+${COUNT_W}${FRESH}\s+${MODS}${NOUN}\b`,
  String.raw`\b${DET}\s+${COUNT_W}${MODS}${NOUN}\s+${YOU}${MADE}\b`,
  String.raw`\bwhat(?:ever)?\s+you(?:['’]ve|\s+have)?\s+(?:just\s+|recently\s+)?${MADE}\b`,
  String.raw`\b(?:the\s+)?${NOUN}\s+(?:from|of)\s+(?:your|the|that)\s+(?:last|previous|earlier)\s+(?:step|request|change|answer|turn|reply|message)\b`,
].join('|'), 'gi')
// every old chart, said outright alongside the new ones
const ALL_OLD = /\b(?:the\s+)?(?:old|other|existing|original|previous|remaining)\s+(?:charts?|ones?)\b|\bthe\s+(?:rest|others)\b|\b(?:all|every|each)(?:\s+of)?\s+(?:my|the)?\s*charts?\b|\beverything\b/i
const POS = /\b(top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|left|right|top|bottom|upper|lower)\b/gi
const normPos = (w) => w.toLowerCase().replace(/\s/, '-').replace('upper', 'top').replace('lower', 'bottom')
// a lowercase symbol counts only as "<sym> chart" / "<sym> one" ("the spy one") — never a bare word ("on", "all", "it")
const SYM_CHART = /\$?([a-z][a-z0-9.]{0,9})(?:['’]s)?\s+(?:chart|one)s?\b/gi
const up = (s) => String(s || '').trim().toUpperCase()

/** Do the words refer to the charts UCT created? */
export function refersToNewCharts(words) {
  NEW_REF.lastIndex = 0
  const hit = NEW_REF.test(String(words || ''))
  NEW_REF.lastIndex = 0
  return hit
}

/** The charts already on the board that this plan writes: [{ ref, symbol, position, label }]. */
export function writtenCharts(plan, host) {
  let live = []
  try { live = host?.charts?.list?.() || [] } catch { live = [] }
  const byRef = new Map(live.map(c => [String(c.ref), c]))
  const out = new Map()
  const add = (ref) => { const c = byRef.get(String(ref)); if (c && !out.has(c.ref)) out.set(c.ref, c) }
  for (const p of plan?.plans || []) {
    if (!p?.changed || p.virtual) continue
    let ref = null
    try { ref = chartRefOf(getTargetKind(p.kind), p.snap) } catch { ref = null }
    if (ref) add(ref)
  }
  for (const e of chartEffects(plan, host)) add(e.ref)
  return [...out.values()]
}

const listOf = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const nameOf = (c) => c.label || (c.symbol ? `the ${c.symbol} chart` : 'a chart')

/** Is this old chart addressed outright by the words left once the "new charts" phrases are taken out? */
function addressed(rest, c, symbols) {
  if (ALL_OLD.test(rest)) return true
  const sym = up(c.symbol)
  if (sym && symbols.has(sym)) return true
  if (c.position) for (const pm of rest.matchAll(POS)) if (matchPosition([{ position: c.position }], normPos(pm[1])).length) return true
  return false
}

/**
 * → null (the words are not about the new charts, or the plan writes only those / charts the words also address) | a sentence
 * (refused or asked: nothing is written or proposed). `created`: the created set's chart refs (useAgent newSetRef).
 */
export function newChartsRefusal(plan, { words = '', host = null, created = [] } = {}) {
  if (!plan?.ok) return null
  const w = String(words || '')
  if (!refersToNewCharts(w)) return null
  let live = []
  try { live = host?.charts?.list?.() || [] } catch { live = [] }
  const liveRefs = new Set(live.map(c => String(c.ref)))
  const set = [...new Set((created || []).map(String))].filter(r => liveRefs.has(r))
  const old = writtenCharts(plan, host).filter(c => !set.includes(String(c.ref)))
  if (!old.length) return null
  const rest = w.replace(NEW_REF, ' ')
  NEW_REF.lastIndex = 0
  const syms = new Set(live.map(c => up(c.symbol)).filter(Boolean))
  const said = new Set([...tickersIn(rest).filter(t => syms.has(t)), ...[...rest.matchAll(SYM_CHART)].map(m => up(m[1])).filter(t => syms.has(t))])
  const bad = old.filter(c => !addressed(rest, c, said))
  if (!bad.length) return null
  if (!set.length) {
    return 'Which charts do you mean by “the new charts”? I don’t have charts I just created on this board, so I didn’t change anything — name them (for example “the AAPL and MSFT charts”) or say where they are.'
  }
  const made = set.map(r => live.find(c => String(c.ref) === r)).filter(Boolean)
  const were = bad.length === 1 ? 'was' : 'were'
  return `I didn’t change anything: you asked about the new charts (${listOf(made.map(nameOf))}), but this would also have changed ${listOf(bad.map(nameOf))}, which ${were} already on your board. To change ${bad.length === 1 ? 'it' : 'them'} too, name ${bad.length === 1 ? 'it' : 'them'} — for example “… and the ${bad[0].symbol || 'other'} one”.`
}
