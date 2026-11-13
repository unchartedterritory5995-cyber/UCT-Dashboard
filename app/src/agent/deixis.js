// ── UCT Agent DEIXIS: "this chart" / "this stock" → the chart the member last CLICKED ─────────
//
// Context & Awareness, Slice 1B. Pure: no state of its own, no feature knowledge beyond "a target
// kind is chart-backed". The workspace records the last chart the member explicitly clicked
// (ChartsWorkspace → host.charts.selected(); hover never counts); this module decides when the
// member's words point at it, and asks otherwise. It never guesses: with several charts, a
// deictic word and no live selection → a question with the charts as choices.
//
// Precedence: an explicit position ("the left one") or a named symbol ("this NVDA chart") beats
// the selection; a single-chart board needs no selection at all.

import { addableRows } from './capabilities/indicatorEdits'
import { resolvedTicker, isReservedWord } from './nl/tickers'
import { sanitizeChartTabs } from '../pages/charts/chartTabs'
import { CLICK_ACT_NP } from './clickRef'
import { namedAnchorRelation, wholeLinesNamed, clickLineMatch, clickLineHits, activeText, relationAnchor, blankStated, negatedClick, withoutExclusions, excludedCharts } from './spatialCheck'

// Words that point at "the chart in front of me". "it" counts only for a CHART-kind op ("make it
// weekly"), never on its own ("put it in Momentum", "what is it" are not about a chart).
const POINTS = /\b(?:(?:this|that|the|my|current|active|selected|focused)\s+(?:current\s+|active\s+|selected\s+)?(?:chart|stock|ticker|symbol|name)|this\s+one|(?:on|in)\s+here|right\s+here)\b/i
const IT = /\bit\b/i
// "this NVDA chart" — a ticker between the pointer word and "chart" (never a position or ordinal word)
const NAMED = /\b(?:this|that|the)\s+(?!(?:left|right|top|bottom|upper|lower|middle|center|centre|other|first|second|third|last|main|new|old|big|small|current|active|selected|focused|same|whole|entire)\s)([a-z]{1,6}(?:[.-][a-z]{1,2})?)\s+(?:chart|tab)\b/i

// NL (2026-10-12): "the 5 minute chart", "the daily chart" — a chart named by its TIMEFRAME
const TF_NAMED = /\b(?:this|that|the)\s+(\d{1,3}\s*(?:m|min|mins|minute|minutes|h|hr|hour|hours)|1h|hourly|daily|weekly|monthly)\s+chart\b/i
// a chart named by its STATE (a Multi Chart cell with no ticker yet) or by an INDICATOR it carries
const STATE_NAMED = /\b(?:this|that|the|my)\s+(empty|blank|unused|vacant)\s+(?:chart|cell|slot|spot|pane|panel|one)\b/i
const TAB_NAMED = /\b(?:this|that|the)\s+([a-z]{1,6}(?:[.-][a-z]{1,2})?)\s+tab\b/i
const WITH_NAMED = /\b(?:this|that|the)\s+(?:chart|one)\s+(?:with|that has|showing)\s+(?:the\s+|an?\s+)?([a-z]{2,8})\b/i
// ⭐ A chart named RELATIVE to the clicked one: "the one above this", "the chart to the left of this one", "the cell under it",
// "the one next to this". The click is the ANCHOR here, never the target: the chart meant is the clicked chart's neighbour on that
// side, read from where the charts sit (`cell`). No click, no neighbour on that side, or two that fit → no single chart: asked.
// ⛔ AUDIT R1/R2 (2026-11-07): the rule is the RELATION, not the noun before it. A spatial relation word followed by an ANCHOR makes
// the click the anchor, whatever names the chart meant ("the chart that is above this one", "the ticker below this one", "the stock
// sitting above it", "the chart above the one I clicked"). An anchor is "this/that" (alone, or on a chart word), "it", "the
// selected/clicked/current … one/chart", or "the one I clicked/selected". Only an adverb (right, just, directly…) may stand between
// the relation and the anchor, so "under 30 on this chart" is no relation ("this chart" there is the click itself). "this/that" on
// another noun ("under this candle") is no anchor. A bare "this" with no relation word still binds to the click.
const REL_ANCHOR_NOUN = '(?:chart|one|cell|pane|panel|ticker|stock|symbol|graph|name)'
// ⛔ no lookbehind (iOS 16 floor — this string is compiled into RELATIVE; agentNoLookbehindStrings.test.js): "this/that, then a
// word that is NOT one of these" is a lookahead on the word itself (that word is the whole letter run, so the two agree)
const REL_ANCHOR = `(?:(?:this|that)(?:\\s+${REL_ANCHOR_NOUN}\\b|(?![\\s-]+(?!(?:to|on|in|and|then|please|for|with|as|into|onto|now|weekly|daily|monthly|hourly|intraday|instead|too|also|here)\\b)[a-z]+\\b)\\b)`
  + `|it\\b|here\\b|the\\s+(?:selected|clicked|current|highlighted|active|focused)(?:\\s+${REL_ANCHOR_NOUN})?\\b`
  + `|the\\s+one\\s+(?:that\\s+)?(?:i|you)(?:'ve|\\s+have|\\s+just)?\\s*(?:clicked|selected|picked|chose|chosen|highlighted|tapped)(?:\\s+on)?\\b)`
export const RELATIVE = new RegExp(`\\b(?:(?:right|just|directly|immediately|exactly)\\s+)?(?:(above|over|below|under|underneath|beneath)|(?:to\\s+the\\s+|on\\s+the\\s+)?(left|right)\\s+of|(next\\s+(?:door\\s+)?to|beside|alongside)|(adjacent\\s+to|near|nearest(?:\\s+to)?|closest\\s+to))\\s+(?:(?:right|just|directly|immediately)\\s+)?${REL_ANCHOR}`, 'i')
// …and it is about a CHART: the anchor itself names one ("this one", "the selected chart", "the one I clicked"), or the thing
// meant is named before the relation ("the chart / the one / the ticker / whatever … above it"). "alert above it" and "a line
// under it" relate a price or a drawing to "it", not a chart to the click: no relation here.
const REL_CHART_ANCHOR = new RegExp(`(?:this|that)\\s+${REL_ANCHOR_NOUN}\\b|\\bthe\\s+(?:selected|clicked|current|highlighted|active|focused)\\b|\\bthe\\s+one\\s`, 'i')
const REL_MEANT = new RegExp(`\\b(?:the|which|whichever|any)\\s+(?:[a-z]+\\s+)?${REL_ANCHOR_NOUN}s?\\b|\\b(?:whatever|whichever)\\b`, 'i')
// ⭐ 2026-11-07 (pl-auto u5-relation-controls-02, revisited after the owner's conversational-targeting decision): an ANCHORLESS
// relation — "the chart above", "the one to the right", "the one to its left" — reads from the click (or the conversation's
// target, which stands in for it): with a click and no other context that is the natural reading. Only on a CHART noun, and never
// followed by "of …", a number or a price ("the one above 50" is a value). No click → no neighbour → asked, as before.
// Groups as RELATIVE's: 1 above/below, 2 left/right (3, 4 never match here).
const RELATIVE_BARE = /\b(?:the|that)\s+(?:(?:second|third|next[-\s]but[-\s]one)\s+)?(?:chart|one|cell|pane|panel|graph|neighbou?r)\s+(?:(?:one|two|three|four|five|[1-9])\s+(?:(?:charts?|cells?|panes?|panels?|places?|spots?|positions?|slots?|spaces?)\s+)?(?:over\s+(?=(?:to|on)\s))?)?(?:(?:right|just|directly|immediately)\s+)?(?:(above|over|below|under|underneath|beneath)|(?:to|on)\s+(?:the|its)\s+(left|right)(?:[-\s]+hand(?:\s+side)?)?)(?:(x(?!x)x)|(x(?!x)x))?\b(?!\s*(?:of\b|it\b|this\b|that\b|the\b|my\b|[$\d]))/i
// unseen9 P1: the DIAGONAL of the click — "diagonally opposite / across from this", "across the diagonal from this", "kitty-corner
// (catty-corner) from / to this" (a chart noun may sit between: "the kitty corner chart from this one"), "opposite this one".
// The click is the anchor, never the target. The match carries `diagonal` (relativeChart reads the cell from the grid).
const DIAG_WORD = `(?:corner\\s+(?:opposite|diagonal(?:ly)?)(?:\\s+(?:from|to))?|(?:in\\s+the\\s+)?far\\s+corner\\s+(?:from|to)|diagonal(?:ly)?\\s+(?:opposite|across)(?:\\s+(?:from|to))?|across\\s+the\\s+diagonal\\s+(?:from|to)|(?:kitty|catty|cater)[-\\s]?corner(?:ed)?(?:\\s+(?:${REL_ANCHOR_NOUN})s?)?\\s+(?:from|to)|(?:in\\s+the\\s+)?opposite\\s+corner(?:\\s+(?:${REL_ANCHOR_NOUN})s?)?\\s+(?:from|to)|(?:directly\\s+)?across\\s+from|opposite(?:\\s+(?:from|to))?)`
export const DIAGONAL = new RegExp(`\\b${DIAG_WORD}\\s+${REL_ANCHOR}`, 'i')
// anchorless ("the chart diagonally opposite", "the one in the opposite corner"): the click is the anchor, as RELATIVE_BARE
const DIAGONAL_BARE = /\b(?:the|that)\s+(?:chart|one|cell|pane|panel|graph)\s+(?:(?:diagonally|directly)\s+(?:opposite|across)|(?:kitty|catty|cater)[-\s]?corner(?:ed)?|in\s+the\s+opposite\s+corner)\b(?!\s*(?:from|to|of)\b)/i
// AUDIT #988: the relation as a MODIFIER before the chart noun ("the opposite-corner chart", "the diagonal one", "the kitty corner
// cell", "the far-corner panel"), hyphenated or not: anchorless, so the click is the anchor
const DIAGONAL_PRE = /\b(?:the|that)\s+(?:opposite[-\s]+corner(?:ed)?|diagonal(?:ly[-\s]+opposite)?|(?:kitty|catty|cater)[-\s]?corner(?:ed)?|far[-\s]+corner)\s+(?:chart|one|cell|pane|panel|graph)\b/i
// AUDIT GO (2): a relation word UCT cannot place on the grid ("facing this one", "on the far side of this chart"), anchored on the
// click: the click is still only the ANCHOR, so the reference resolves to no chart (asked with the real names), never the click
const UNPLACED_RELATION = new RegExp(`\\b(?:facing|mirroring|(?:on\\s+)?the\\s+(?:far|other)\\s+side\\s+of|opposite|across|diagonal(?:ly)?|corner(?:ed)?)\\s+(?:(?:from|to|of)\\s+)?${REL_ANCHOR}`, 'i')
const chartWordIn = (s) => /\b(?:chart|one|cell|pane|panel|graph|corner)\b/i.test(s)
// unseen10: a TWO-AXIS diagonal step ("diagonally up and to the left of this one") and the FAR END of the click's line ("the chart
// at the far end from this one")
const DIAG_STEP = new RegExp(`\\bdiagonally\\s+(up|down|above|below)\\s+(?:and\\s+)?(?:to\\s+the\\s+)?(left|right)(?:\\s+of)?\\s+${REL_ANCHOR}`, 'i')
const FAR_END = new RegExp(`\\b(?:at\\s+)?the\\s+(?:far(?:thest)?|other|opposite)\\s+end\\s+(?:(?:of\\s+the\\s+(?:row|column)\\s+)?from|of)\\s+${REL_ANCHOR}`, 'i')
// AUDIT condition on the STRUCTURAL rule: a CHART reference ("the one / chart / cell / panel … <spatial word> … <anchor>", "both
// neighbours of this one", "<spatial word> … this one / this chart") with ANY spatial word never resolves to the click; it is only
// the anchor. A relation word on a non-chart noun (a line, a level, an MA, a price, an alert) is not this rule.
// (relational words only: a verb particle — "pull UP nvidia on this one", "switch OVER" — or a time word — "the PAST year on this
// chart" — is not one; "far / other" only with end / side / corner, "row / column" only as "same / next row")
const SPATIAL_WORD = '(?:left|right|above|below|under(?:neath)?|beneath|next\\s+(?:to|door)|beside|adjacent|neighbou?rs?|corner|opposite|diagonal\\w*|across|facing|beyond|behind|(?:far|farthest|furthest|other)\\s+(?:end|side|corner)|(?:same|next)\\s+(?:row|column)|past(?=\\s+(?:this|that|it|here)\\b))'
const SPATIAL_VALUE = new RegExp(`\\b${SPATIAL_WORD}\\s+(?:the\\s+)?\\$?\\d`, 'i')     // "above the 20", "under 30", "over $150"
const STRUCT_CHART = new RegExp(`\\b(?:the|that|which|any|both|all|either)\\s+(?:[a-z-]+\\s+){0,3}?(?:chart|one|cell|pane|panel|graph|neighbou?rs?)s?\\b[^.;,]{0,40}?\\b${SPATIAL_WORD}\\b[^.;,]{0,30}?\\b(?:this|that|here|it|the\\s+(?:selected|clicked|current|highlighted|active|focused)|the\\s+one\\s+(?:that\\s+)?(?:i|you))\\b`, 'i')
const STRUCT_NEIGHBOURS = new RegExp(`\\b(?:both|all|either|the|its|my)\\s+(?:two\\s+)?neighbou?rs?\\s+(?:of|to|beside)\\s+(?:this|that|here|it|the\\s+(?:selected|clicked|current|highlighted|active|focused)|the\\s+one\\s+(?:that\\s+)?(?:i|you))\\b`, 'i')
const STRUCT_TAIL = new RegExp(`\\b${SPATIAL_WORD}\\b[^.;,]{0,24}?\\b(?:this|that)\\s+(?:one|chart|cell|pane|panel|graph)\\b`, 'i')
// AUDIT #988 (belt and braces): a COUNT with a DIRECTION anywhere in the words ("2 spaces left of here", "a couple over to the
// right", "3 over") is a relation from the click even when its shape is not one UCT can place: the click is its anchor, so it is
// never applied and never offered (the reference resolves to no chart and is asked about without the anchor)
const COUNT_DIRECTION = /\b(?:two|three|four|five|six|[2-9]|second|third|2nd|3rd|a\s+couple(?:\s+of)?|next[-\s]but[-\s]one)\s+(?:(?:charts?|cells?|panes?|panels?|places?|spots?|positions?|slots?|spaces?|ones?)\s+)?(?:(?:over|across)\b|(?:(?:to|on)\s+the\s+)?(?:left|right)\b|above\b|below\b|under\b|beneath\b)/i
// AUDIT #988 (possessive anchor): "its / it's / this one's / this chart's / the selected one's" before a RELATIONAL noun or phrase
// makes the click a REFERENCE POINT, as R1: "the neighbour on its left" = the cell to the click's left, "its right neighbour", "its
// diagonal", "its row's far end", "both of its neighbours". Rewritten to the anchored phrase the readers below already resolve; a
// possessive on any other relational word is still a relation UCT cannot place (asked without the anchor). "its" on a THING ("its
// level", "its signal line", "its price scale on the right") is no relation.
const POSS = "(?:its|it['’]s|(?:this|that)\\s+(?:one|chart)['’]s|the\\s+(?:selected|clicked|current|highlighted|active|focused)\\s+(?:one|chart)['’]s)"
const POSS_SIDE = new RegExp(`\\b(on|to)\\s+${POSS}\\s+(left|right)(?:[-\\s]+hand)?(?:[-\\s]+side)?\\b`, 'gi')
const POSS_SIDE_NB = new RegExp(`\\b${POSS}\\s+(left|right)(?:[-\\s]+hand)?(?:[-\\s]+side)?\\s+(?:neighbou?r|chart|one|cell|pane|panel)\\b`, 'gi')
const POSS_NBS = new RegExp(`\\b(?:(?:both|all|each|either)\\s+(?:of\\s+)?)?${POSS}\\s+(?:two\\s+)?neighbou?rs\\b`, 'gi')
const POSS_FAR = new RegExp(`\\b(?:the\\s+(?:chart|one|cell)\\s+at\\s+)?(?:${POSS}\\s+(row|column)['’]s\\s+(?:far(?:thest)?|other|opposite)\\s+end|the\\s+(?:far(?:thest)?|other|opposite)\\s+end\\s+of\\s+${POSS}\\s+(row|column))\\b`, 'gi')
const POSS_DIAG = new RegExp(`\\b${POSS}\\s+(?:diagonal(?:ly\\s+opposite)?|opposite\\s+corner|far\\s+corner|(?:kitty|catty|cater)[-\\s]?corner)(?:\\s+(?:chart|one|cell|pane|panel|neighbou?r))?\\b`, 'gi')
const POSS_REL = new RegExp(`\\b${POSS}\\s+(?:[a-z-]+\\s+)?(?:(?:left|right)(?=[-\\s]+(?:hand|side|neighbou?r|chart|one|cell))|sides?|neighbou?rs?|corner|diagonal|(?:far|other|opposite)\\s+end|row|column)\\b`, 'i')
/** The words with a possessive anchor on a relation rewritten to the phrase the readers resolve: a SIDE to the canonical "its" form
 *  RELATIVE_BARE reads from the click ("this chart's right side" → "its right": no second "this one", so a two-target clause
 *  "this one and the one to its left" keeps both), the rest to the anchored phrase. Idempotent; no possessive → unchanged. */
export function possessiveAnchor(text) {
  const s = String(text || '')
  if (!/['’]s\b|\bits\b/i.test(s)) return s
  return s.replace(POSS_FAR, (m, r1, r2) => `the chart at the far end of the ${(r1 || r2).toLowerCase()} from this one`)
    .replace(POSS_DIAG, 'the chart diagonally opposite this one')
    .replace(POSS_NBS, 'both neighbours of this one')
    .replace(POSS_SIDE_NB, (m, side) => `the one to its ${side.toLowerCase()}`)
    .replace(POSS_SIDE, (m, pre, side) => `${pre} its ${side.toLowerCase()}`)
}
const FAR_LINE = /\bthe\s+(row|column)\s+from\s+this\s+one\b/i
// relrefs-steps (#988): a WALK from the click, the click being its anchor whether it is named or not (AUDIT's R3) — N rows up /
// down ("one row up from this one", "up one row", "a row below"), N over / columns to the left / right ("two over to the left",
// "one column left of this one"; "two over" alone: whichever side is that deep), the OTHER SIDE of its row / column, and a CORNER
// on the same side / row / column. Read from where the charts sit (relativeChart): one chart → it; none or several → asked with the
// real candidates, never the click. Units are grid units only: "two bars to the left", "one pane up" are no walk.
const MOVE_VERB = /\b(?:move|moving|shift|drag|slide|push|nudge|swap|scroll|pan)\b/i
// a COUNT, never a pronoun: "a / an / one" only after a chart noun or a verb particle ("the chart one over", "up one row", "the one
// one over") — not "the top one over", "the next-but-one chart"; 2–4 never inside a hyphenated word.
// ⛔ NO LOOKBEHIND (iOS 16.0–16.3, #988 AUDIT L1): the word BEFORE the count is checked in code (countOk), on the text before
// the match — a rejected count retries one character on, as the regex engine would (walkExec)
const N_WORD = '(a|an|one|two|three|four|[1-4])'
const COUNT_ARTICLE_AFTER = /\b(?:chart|charts|one|cell|cells|pane|panel|graph|neighbou?r|up|down|it|just|only|exactly|by|is|sits?)\s$/i
const countOk = (before, w) => (/^(?:a|an|one)$/i.test(w) ? COUNT_ARTICLE_AFTER.test(before) : !/[-\w]$/.test(before))
/** The first match of a walk regex whose count (group `g`, starting `lead(m)` characters into the match) passes countOk. */
function walkExec(re, s, g = 1, lead = () => 0) {
  const r = new RegExp(re.source, `${re.flags}g`)
  for (let m; (m = r.exec(s));) {
    if (countOk(s.slice(0, m.index + lead(m)), m[g])) return m
    r.lastIndex = m.index + 1
  }
  return null
}
const V2_LEAD = (m) => /^(?:up|down)\s+/i.exec(m[0])[0].length
// the walk's own anchor, when the words name it ("one row up FROM THIS ONE"): part of the walk, not another pointer at the click
const WALK_FROM = `(?:\\s+(?:(?:away\\s+)?(?:from|of|to|than|as)\\s+)?(?:this|that|here|it|the\\s+(?:selected|clicked|current|highlighted|active|focused)(?:\\s+(?:chart|one))?|the\\s+one\\s+(?:that\\s+)?(?:i|you)(?:'ve|\\s+have|\\s+just)?\\s*(?:clicked|selected|picked|chose|chosen|highlighted|tapped)(?:\\s+on)?)(?:\\s+(?:chart|one|cell|pane|panel))?\\b)?`
const N_OF = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 }
const GRID_UNIT = '(?:columns?|charts?|cells?|spots?|places?|positions?|slots?|spaces?)'
const WALK_V1 = new RegExp(`\\b${N_WORD}\\s+rows?\\s+(up|down|higher|lower|above|below)\\b${WALK_FROM}`, 'i')
const WALK_V2 = new RegExp(`\\b(up|down)\\s+${N_WORD}\\s+rows?\\b${WALK_FROM}`, 'i')
const WALK_H1 = new RegExp(`\\b${N_WORD}\\s+(?:${GRID_UNIT}\\s+)?(?:over\\s+)?(?:(?:to|on)\\s+the\\s+)?(left|right)\\b(?!\\s+(?:above|below|under|over|beneath)\\b)${WALK_FROM}`, 'i')
const WALK_H2 = new RegExp(`\\b${N_WORD}\\s+(?:${GRID_UNIT}\\s+)?over\\b${WALK_FROM}`, 'i')
/** (test hook) the walk regexes' first match on `s` — the #988 no-lookbehind equivalence rail compares it with the old forms */
export const _walkExec = (kind, s) => ({ V1: () => walkExec(WALK_V1, s), V2: () => walkExec(WALK_V2, s, 2, V2_LEAD), H1: () => walkExec(WALK_H1, s), H2: () => walkExec(WALK_H2, s) })[kind]()
const OTHER_SIDE = /\b(?:the\s+other\s+side\s+of|across)\s+the\s+(row|column)\b/i
const SAME_CORNER = new RegExp(`\\bcorner\\s+(?:on|in|along|at)\\s+the\\s+same\\s+(side|row|column)\\b${WALK_FROM}`, 'i')
// AUDIT probe-16 shapes (#988): "the <ordinal / position> chart in / of / on <a row or column>" and "same <axis> but the other <axis>".
// "this / that row" is the CLICK's line (a relation: the click is a reference, the target only when the ordinal lands on it);
// "the top / bottom / left / right / middle / first / last … row" is ABSOLUTE (ordinalChart: no click needed).
const LINE_POS = '(first|second|third|last|middle|cent(?:er|re)|left(?:most)?|right(?:most)?|top(?:most)?|bottom(?:most)?|upper(?:most)?|lower(?:most)?)'
const LINE_WHICH = '(top|bottom|upper|lower|middle|cent(?:er|re)|first|second|third|last|left|right)'
export const LINE_REF = new RegExp(`\\b(?:the\\s+)?${LINE_POS}\\s+(?:chart|one|cell|pane|panel|graph)\\s+(?:in|of|on|along|from)\\s+(?:(this|that)|the|my)\\s+(?:${LINE_WHICH}\\s+)?(row|column)\\b`, 'i')
// ...and with the line FIRST, as a possessive: "the top row's middle chart", "this column's last one" (same groups as LINE_REF)
const LINE_REF_POSS = new RegExp(`\\b(?:(this|that)|the|my)\\s+(?:${LINE_WHICH}\\s+)?(row|column)['’]s\\s+${LINE_POS}\\s+(?:chart|one|cell|pane|panel|graph)\\b`, 'i')
/** A line reference in either order → a match whose groups are LINE_REF's ([1] place, [2] this/that, [3] which line, [4] axis). */
function lineRefExec(s) {
  const a = LINE_REF.exec(s)
  if (a) return a
  const b = LINE_REF_POSS.exec(s)
  if (!b) return null
  const m = [b[0], b[4], b[1], b[2], b[3]]
  m.index = b.index
  m.input = b.input
  return m
}
const SAME_BUT = /\bsame\s+(row|column)\s*,?\s*(?:but|and)?\s+(?:the\s+other|a\s+different|another|the\s+opposite)\s+(row|column)\b/i
const ORD_AT = { first: 0, second: 1, third: 2 }
/** The chart at `pos` in `line` (sorted along it) → the chart, or null (no such place in that line). */
function atPos(line, pos, axis) {
  const p = String(pos).toLowerCase().replace(/most$/, '')
  const n = line.length
  if (p in ORD_AT) return line[ORD_AT[p]] || null
  if (p === 'last') return line[n - 1] || null
  if (/^(?:middle|cent(?:er|re))$/.test(p)) return n >= 3 && n % 2 === 1 ? line[(n - 1) / 2] : null
  const start = axis === 'row' ? ['left'] : ['top', 'upper'], end = axis === 'row' ? ['right'] : ['bottom', 'lower']
  if (start.includes(p)) return line[0] || null
  if (end.includes(p)) return line[n - 1] || null
  return null                                                   // "the top chart in a row": no such place
}
/** The charts of one row / column, in order along it: the line through `through`, or the absolute one `which` names. */
function lineOf(charts, axis, { through = null, which = null } = {}) {
  const all = charts.filter(c => c.cell)
  const along = (c) => (axis === 'row' ? c.cell.x : c.cell.y)
  if (through) return all.filter(c => (axis === 'row' ? yOverlap(c, through) : xOverlap(c, through))).sort((a, b) => along(a) - along(b))
  // the board's lines across the other axis, in order
  const key = (c) => (axis === 'row' ? c.cell.y : c.cell.x)
  const keys = [...new Set(all.map(key))].sort((a, b) => a - b)
  const w = String(which || '').toLowerCase()
  const i = /^(?:top|upper|first|left)$/.test(w) ? 0 : /^(?:bottom|lower|last|right)$/.test(w) ? keys.length - 1
    : w in ORD_AT ? ORD_AT[w] : /^(?:middle|cent(?:er|re))$/.test(w) && keys.length % 2 === 1 ? (keys.length - 1) / 2 : -1
  if ((axis === 'row' && /^(?:left|right)$/.test(w)) || (axis === 'column' && /^(?:top|upper|bottom|lower)$/.test(w))) return null
  if (i < 0 || i >= keys.length) return null
  return all.filter(c => key(c) === keys[i]).sort((a, b) => along(a) - along(b))
}
/** An ABSOLUTE line reference ("the last one in the bottom row") → { ref } | { ask } | null (not one). */
export function absoluteLineChart(text, charts = []) {
  const m = lineRefExec(String(text || ''))
  if (!m || m[2] || !m[3]) return null
  const line = lineOf(charts, m[4].toLowerCase(), { which: m[3] })
  const hit = line ? atPos(line, m[1], m[4].toLowerCase()) : null
  return hit ? { ref: hit.ref, word: m[1].toLowerCase(), match: m, line: true }
    : { ask: { text: 'Which chart do you mean? Pick one:', choices: charts.map(c => ({ ref: c.ref, label: c.label })) }, match: m, line: true }
}
function walkMatch(s) {
  const at = (m, set) => { if (!m || placesNonChart(s.slice(0, m.index), m[0])) return null; Object.assign(m, set); return m }
  const n = (w) => N_OF[String(w).toLowerCase()] || Number(w)
  const vDir = (w) => (/^(up|higher|above)$/i.test(w) ? 'above' : 'below')
  let m = _walkExec('V1', s)
  if (m) return at(m, { walk: { dirs: [vDir(m[2])], n: n(m[1]) } })
  m = _walkExec('V2', s)
  if (m) return at(m, { walk: { dirs: [vDir(m[1])], n: n(m[2]) } })
  m = _walkExec('H1', s)
  if (m) return at(m, { walk: { dirs: [m[2].toLowerCase()], n: n(m[1]) } })
  m = _walkExec('H2', s)
  if (m) return at(m, { walk: { dirs: ['left', 'right'], n: n(m[1]) } })
  m = lineRefExec(s)
  if (m && m[2]) return at(m, { line: { axis: m[4].toLowerCase(), pos: m[1] } })
  m = SAME_BUT.exec(s)
  if (m && m[1].toLowerCase() !== m[2].toLowerCase()) return at(m, { sameBut: m[1].toLowerCase() })
  m = OTHER_SIDE.exec(s)
  if (m) return at(m, { farLine: m[1].toLowerCase() })
  m = SAME_CORNER.exec(s)
  if (m) return at(m, { corner: m[1].toLowerCase() })
  return null
}
// AUDIT probe 17 negatives (#988): a relation span never runs across into the NEXT clause's own command ("leave the left column
// alone AND PUT this chart on weekly" is no relation from the click: "left" belongs to the first clause, "this chart" to the second)
const CROSS_CLAUSE = /(?:[,;]\s*|\s+)(?:and|then|but)\s+(?:put|make|set|switch|change|add|move|turn|show|hide|remove|give|apply|take|drop|flip)\b/i
/** The relation match, or null when the words relate nothing to the clicked CHART. */
export function relationMatch(text0) {
  // (H5, probe 19) a clause that says a chart already is so relates nothing (blanked: positions kept)
  // (AUDIT probe 3) an imperative negation of the click relates nothing either: blanked (the click is excluded by the check)
  const text = blankStated(negatedClick(text0).text)
  const r0 = relationMatchIn(text)
  // pl-auto unseen12 (#988): the click's own line said as a relation ("the rest of this row", "same column, other row", "same row, far
  // end", "one column right from this chart", "this one, the first chart in its row") — read where the relation readers find
  // nothing they can place, or only an unordered corner pair (spatialCheck.clickLineMatch / clickLineHits)
  const cl0 = clickLineMatch(possessiveAnchor(text)) || clickLineMatch(text)
  const cl = cl0 && !(cl0.clickLine.kind === 'step' && MOVE_VERB.test(String(text || ''))) ? cl0 : null   // a move of the click names its destination
  const r = cl && (!r0 || r0.unplaced || (cl.clickLine.kind === 'corner' && r0.corner) || ['appos', 'counted', 'lineRel', 'diag2'].includes(cl.clickLine.kind) || (cl.clickLine.kind === 'rest' && cl.clickLine.n != null)) ? cl : r0
  if (!r) return null
  const x = CROSS_CLAUSE.exec(r[0])
  if (!x) return r
  // the relation, if any, is in the clause that starts at that command: read again from there (index kept on the whole text)
  const s = possessiveAnchor(text)
  const start = r.index + x.index + x[0].search(/(?:and|then|but)\s/i)
  const rest = relationMatch(s.slice(start))
  if (!rest) return null
  rest.index += start
  return rest
}
function relationMatchIn(text) {
  const s = possessiveAnchor(text)
  // a MOVE of the click ("move this one up one row", "shift this chart two over") names where it goes, not another chart
  const moving = MOVE_VERB.test(s)
  const w = moving ? null : walkMatch(s)
  if (w) return w
  const r = relationMatchOf(s)
  if (r) return r
  const c = moving ? null : COUNT_DIRECTION.exec(s)
  if (c) { c.unplaced = true; return c }
  // the STRUCTURAL rule: a spatial word on a CHART reference anchored on the click (not on a non-chart noun: placesNonChart, and a
  // bare "one" that stands for a thing, S2-B) → a relation UCT may not place: the click is only its anchor
  const chartRef = (x) => !!x && !placesNonChart(s.slice(0, x.index), x[0]) && !(/^\s*(?:the|that)\s+one\b/i.test(x[0]) && oneStandsForAThing(s.slice(0, x.index)))
    && !PLACED_IN.test(x[0]) && !x[0].toLowerCase().split(/[^a-z0-9%]+/).some(w => w && !SPAN_STOP.has(w) && (PLACED.test(w) || isIndicatorWord(w)))
    // (#988, AUDIT on the #1022 baseline diff) a spatial word on a VALUE ("crosses above the 20 on this chart", "closes under 30 on
    // this one"): a level or an average's period on the click, never a chart relation
    && !SPATIAL_VALUE.test(x[0])
  // plurals: "both neighbours of this one", "both charts on either side of this one" — the set on both sides of the click
  const nb = STRUCT_NEIGHBOURS.exec(s) || EITHER_SIDE.exec(s)
  if (nb && chartRef(nb)) { nb.neighbours = true; return nb }
  const sm = STRUCT_CHART.exec(s) || STRUCT_TAIL.exec(s)
  if (chartRef(sm)) { sm.unplaced = true; return sm }
  // R1 (grammatical): the anchor as the OBJECT of a preposition / relational head after a chart reference ("the chart furthest FROM
  // this one", "the chart around this one", "the same row AS this one") is a REFERENCE POINT: never the target, never offered
  const pp = REF_POINT.exec(s)
  if (chartRef(pp)) { pp.unplaced = true; return pp }
  // R3: an ANCHORLESS relation on a chart reference with no target deictic ("the chart next door", "the other end of the row"):
  // the click is the implicit anchor
  if (!/\b(?:this|it|here)\b/i.test(s)) {
    const ia = IMPLICIT_NEIGHBOUR.exec(s)
    if (chartRef(ia)) { ia.neighbours = 'one'; return ia }
    const ie = IMPLICIT_FAR_END.exec(s)
    if (chartRef(ie)) { ie.farEnd = true; return ie }
  }
  // a possessive on a relational word the rewrite could not place ("its upper side"): the click is only the anchor
  const pr = POSS_REL.exec(s)
  if (pr && !placesNonChart(s.slice(0, pr.index), pr[0])) { pr.unplaced = true; return pr }
  return null
}
// grammar words inside a span are never an indicator's name ("from", "the", "one" appear in indicator titles)
const SPAN_STOP = new Set(['the', 'a', 'an', 'from', 'of', 'to', 'on', 'in', 'at', 'by', 'with', 'and', 'or', 'as', 'than', 'this', 'that', 'it', 'here',
  'one', 'ones', 'chart', 'charts', 'cell', 'cells', 'pane', 'panel', 'graph', 'side', 'sides', 'end', 'corner', 'row', 'column', 'board', 'up', 'down',
  'over', 'away', 'across', 'out', 'selected', 'clicked', 'current', 'i', 'you', 'directly', 'just', 'right', 'left', 'two', 'three', 'same', 'other'])
const ANCHOR_OBJ = '(?:this|that|here|it|the\\s+(?:selected|clicked|current|highlighted|active|focused)(?:\\s+(?:chart|one))?|the\\s+one\\s+(?:that\\s+)?(?:i|you))'
// R2: the anchor as the object of a preposition / relational head, wherever it sits (no chart reference needed): a plan is never
// redirected onto the click then
const REF_PP_ANY = new RegExp(`\\b(?:(?:away|up|down|over|across|out)\\s+from|from|than|as|beside|opposite|across|next\\s+to|near|nearest\\s+to|closest\\s+to|beyond|past|around|below|above|under|over|behind)\\s+${ANCHOR_OBJ}\\b`, 'i')
// …unless what stands before it is a placed thing ("stick the stochastic below this one": a pane on the click, AUDIT's rule)
const refPointAny = (t) => { const s = possessiveAnchor(t); const m = REF_PP_ANY.exec(s); return !!m && !placesNonChart(s.slice(0, m.index), m[0]) }
const EITHER_SIDE = new RegExp(`\\b(?:both|the|the\\s+two)\\s+(?:charts?|ones|cells|panels)\\s+(?:on\\s+)?(?:either|each|both)\\s+sides?\\s+of\\s+${ANCHOR_OBJ}\\b`, 'i')
const REF_POINT = new RegExp(`\\b(?:the|that|which|any|both|all|either)\\s+(?:[a-z-]+\\s+){0,4}?(?:chart|one|cell|pane|panel|graph|side|end|corner)s?\\b[^.;,]{0,40}?\\b(?:(?:away|up|down|over|across|out)\\s+from|from|of|than|as|beside|opposite|across|next\\s+to|near|nearest\\s+to|closest\\s+to|beyond|past|around|below|above|under|over|behind)\\s+${ANCHOR_OBJ}\\b`, 'i')
const IMPLICIT_NEIGHBOUR = /\b(?:the|that)\s+(?:(?:next[-\s]door|neighbou?ring|adjacent|nearby)\s+(?:chart|one|cell|pane|panel)|(?:chart|one|cell|pane|panel)\s+next\s+door)\b/i
const IMPLICIT_FAR_END = /\b(?:the\s+(?:other|far(?:thest)?|opposite)\s+end\s+of\s+the\s+(?:row|board)|(?:the|that)\s+(?:chart|one|cell|pane|panel)\s+at\s+the\s+(?:far|other)\s+end(?:\s+of\s+the\s+(?:row|board))?)\b/i
// a non-chart noun inside the matched span ("the one with the line above it", "the chart where the MA is below this") makes it no
// chart relation either
const PLACED_IN = /\b(?:lines?|levels?|indicators?|studies|study|volume|alerts?|labels?|markers?|notes?|drawings?|bands?|overlays?|averages?|ma|ema|sma|50-day|200-day|price|prices|trendlines?|candles?|bars?)\b/i
function relationMatchOf(text) {
  const s = String(text || '')
  const aboutChart = (x) => !placesNonChart(s.slice(0, x.index), x[0]) && (REL_CHART_ANCHOR.test(x[0]) || placementNP(s.slice(0, x.index), x[0]) || REL_MEANT.test(s.slice(0, x.index)) || chartWordIn(x[0]))
  const st = DIAG_STEP.exec(s)
  if (st && aboutChart(st)) { st.step = { v: /^(up|above)$/i.test(st[1]) ? 'above' : 'below', h: st[2].toLowerCase() }; return st }
  const fe = FAR_END.exec(s)
  if (fe && aboutChart(fe)) { fe.farEnd = true; return fe }
  const d = DIAGONAL.exec(s) || DIAGONAL_BARE.exec(s) || DIAGONAL_PRE.exec(s)
  if (d && aboutChart(d)) { d.diagonal = true; return d }
  const m = RELATIVE.exec(s)
  // ⛔ AUDIT S2-B: the same rule for an anchored relation — "the alert and the one above it": a bare "one" coordinated with a
  // non-chart noun stands for that thing, so no chart relation (the click is read as it would be without one)
  if (m) { const pre = /\b(?:the|that)\s+one\s*$/i.exec(s.slice(0, m.index)); if (pre && oneStandsForAThing(s.slice(0, pre.index))) return null }
  if (m && !placesNonChart(s.slice(0, m.index), m[0]) && (REL_CHART_ANCHOR.test(m[0]) || REL_MEANT.test(s.slice(0, m.index)))) return m
  if (m) return null
  const u = UNPLACED_RELATION.exec(s)
  if (u && aboutChart(u)) { u.unplaced = true; return u }
  const b = RELATIVE_BARE.exec(s)
  if (!b) return null
  // its noun IS the chart related ("a macd on the chart above" puts the MACD on that chart), so nothing placed before it counts —
  // ⛔ AUDIT S2-A: except a bare "one", which stands for the nearest noun before it: "delete the line and the one below", "move the
  // alert to the one below", "the level I drew and the one above" relate a line, an alert, a level — not a chart. "chart / cell /
  // pane / panel / graph" stays unconditional.
  if (/\bone\b/i.test(b[0]) && oneStandsForAThing(s.slice(0, b.index))) return null
  return b
}
// ⛔ AUDIT S2-B (round 2): a bare "one" stands for a THING only when it is COORDINATED with that thing in the same noun phrase
// ("the line and the one below", "the level I drew and the one above"). After a preposition (to / on / onto / in / into / for /
// at / from / over) "the one <relation>" is the PLACE: a chart ("add RSI to the one below"). A word separated from "one" by a
// verb or a preposition is never its antecedent ("the rsi looks good here, now make the one below weekly": a chart).
const ONE_THING = /^(?:orders?|positions?|trades?|tickets?|emas?|smas?|mas|setups?|zones?|supports?|resistances?|signals?|bars?|candles?)$/
const ONE_PREP = /\b(?:to|on|onto|in|into|for|at|from|over)\s*$/i
const ONE_COORD = /(?:,|\b(?:and|or))\s*$/i
// the few words a noun phrase may carry between its noun and the "and": a short relative clause ("the level I drew"), adjectives
const NP_FILLER = /^(?:i|we|you|just|already|drew|drawn|made|added|put|placed|set|have|had|the|a|an|my|that|this|new|old|first|second|last|top|bottom|upper|lower|red|green|blue|yellow|orange|purple|white|black)$/
function oneStandsForAThing(before) {
  const s = String(before || '')
  if (ONE_PREP.test(s) || !ONE_COORD.test(s)) return false
  const words = s.replace(ONE_COORD, ' ').toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean)
  for (let i = words.length - 1, n = 0; i >= 0 && n < 5; i--, n++) {
    const w = words[i]
    if (CHARTISH.test(w)) return false
    if (PLACED.test(w) || ONE_THING.test(w) || isIndicatorWord(w)) return true
    if (!NP_FILLER.test(w)) return false                     // a verb, a preposition or anything else ends the noun phrase
  }
  return false
}
// pl-auto indicator-add-02: "MACD under this chart", "volume beneath this one", "a line above this chart" place an indicator, a pane,
// a line, a level — not a chart ("the pane left of it" IS a chart: a pane alone is a chart's cell, an indicator's pane is named by
// the indicator). The thing placed is what the words right before the relation name (the last three, in its own
// clause): an indicator (by its id or a word of its name, from the live catalog) or a chart-surface noun, with no chart word
// after it. Then the relation is no chart relation and the click is read as a bare pointer would be.
const PLACED = /^(?:lines?|levels?|indicators?|studies|study|volume|alerts?|labels?|markers?|notes?|drawings?|bands?|overlays?|oscillators?|averages?|histograms?|trendlines?|rays?|arrows?|boxes?|rectangles?|texts?|fibs?|fibonacci|channels?)$/
const CHARTISH = /^(?:charts?|ones?|cells?|panels?|tickers?|stocks?|symbols?|graphs?|names?)$/
let indicatorWords = null
function isIndicatorWord(w) {
  if (!indicatorWords) {
    indicatorWords = new Set()
    try {
      for (const r of addableRows()) {
        indicatorWords.add(String(r.defId).toLowerCase())
        for (const x of String(r.name || '').toLowerCase().split(/[^a-z0-9%]+/)) if (x.length >= 3) indicatorWords.add(x)
      }
    } catch { indicatorWords = null; return false }
  }
  return indicatorWords.has(w)
}
// pl-auto u12 (#988): the chart a PLACEMENT preposition (on / onto / to / into / for) introduces is the TARGET noun phrase; a thing
// named BEFORE that preposition ("put RSI on …", "add an alert to …") is what is placed, never part of the chart reference. So the
// words from that preposition to the relation are read as the chart reference, whatever its head noun ("the corner opposite here",
// "its left neighbour"). Not when that phrase itself names a placed thing: then the thing is placed on the click, as before.
const PLACE_NP = /\b(?:on|onto|to|into|for)\s+((?:(?:the|that|which|any|both|all|either|its|my)\b[^,;.!?]*)?)$/i
/** Do the words from the clause's last placement preposition through `span` form the chart reference that preposition introduces? */
function placementNP(before, span = '') {
  const pp = PLACE_NP.exec(String(before || '').split(CLAUSE_SPLIT_LOCAL).pop())
  if (!pp) return false
  const np = `${pp[1]}${span}`
  const words = pp[1].toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean)
  return /^\s*(?:the|that|which|any|both|all|either|its|my)\b/i.test(np) && words.length <= 4
    && !words.some(w => !SPAN_STOP.has(w) && (PLACED.test(w) || isIndicatorWord(w)))
}
function placesNonChart(before, span = '') {
  if (placementNP(before, span)) return false
  const clause = String(before || '').split(CLAUSE_SPLIT_LOCAL).pop()
  const words = clause.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean).slice(-3)
  for (let i = words.length - 1; i >= 0; i--) {
    if (CHARTISH.test(words[i])) return false
    if (PLACED.test(words[i]) || isIndicatorWord(words[i])) return true
  }
  return false
}
const CLAUSE_SPLIT_LOCAL = /[,;.!?]|\b(?:and|then|but|while|also|plus)\b/i
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1
function sideOf(charts, s, side) {
  const o = charts.filter(c => c.ref !== s.ref && c.cell)
  const pick = (list, edge, best) => { if (!list.length) return []; const e = best(...list.map(edge)); return list.filter(c => edge(c) === e) }
  const xo = (c) => overlaps(c.cell.x, c.cell.x + c.cell.w, s.cell.x, s.cell.x + s.cell.w)
  const yo = (c) => overlaps(c.cell.y, c.cell.y + c.cell.h, s.cell.y, s.cell.y + s.cell.h)
  if (side === 'above') return pick(o.filter(c => xo(c) && c.cell.y + c.cell.h <= s.cell.y), c => c.cell.y + c.cell.h, Math.max)
  if (side === 'below') return pick(o.filter(c => xo(c) && c.cell.y >= s.cell.y + s.cell.h), c => c.cell.y, Math.min)
  if (side === 'left') return pick(o.filter(c => yo(c) && c.cell.x + c.cell.w <= s.cell.x), c => c.cell.x + c.cell.w, Math.max)
  return pick(o.filter(c => yo(c) && c.cell.x >= s.cell.x + s.cell.w), c => c.cell.x, Math.min)
}
// unseen9 P1: the charts on the click's DIAGONAL (sharing neither a column nor a row with it). One → that chart. Several (a
// 3×3 grid) → the one at the click's mirror point through the board's centre, when exactly one is there; otherwise all of them,
// so the caller asks with their names. None (one row of charts) → none: the caller asks, never the click.
const xOverlap = (a, b) => overlaps(a.cell.x, a.cell.x + a.cell.w, b.cell.x, b.cell.x + b.cell.w)
const yOverlap = (a, b) => overlaps(a.cell.y, a.cell.y + a.cell.h, b.cell.y, b.cell.y + b.cell.h)
/** The board's CORNER charts: a chart that touches both a left / right edge and a top / bottom edge of the whole board. */
function cornersOf(charts) {
  const all = charts.filter(c => c.cell)
  if (!all.length) return []
  const x0 = Math.min(...all.map(c => c.cell.x)), x1 = Math.max(...all.map(c => c.cell.x + c.cell.w))
  const y0 = Math.min(...all.map(c => c.cell.y)), y1 = Math.max(...all.map(c => c.cell.y + c.cell.h))
  return all.filter(c => (c.cell.x === x0 || c.cell.x + c.cell.w === x1) && (c.cell.y === y0 || c.cell.y + c.cell.h === y1))
}
function diagonalOf(charts, s) {
  const o = charts.filter(c => c.ref !== s.ref && c.cell)
  const diag = o.filter(c => !overlaps(c.cell.x, c.cell.x + c.cell.w, s.cell.x, s.cell.x + s.cell.w) && !overlaps(c.cell.y, c.cell.y + c.cell.h, s.cell.y, s.cell.y + s.cell.h))
  if (diag.length <= 1) return diag
  const all = charts.filter(c => c.cell)
  const x0 = Math.min(...all.map(c => c.cell.x)), x1 = Math.max(...all.map(c => c.cell.x + c.cell.w))
  const y0 = Math.min(...all.map(c => c.cell.y)), y1 = Math.max(...all.map(c => c.cell.y + c.cell.h))
  const mx = x0 + x1 - (s.cell.x + s.cell.w / 2), my = y0 + y1 - (s.cell.y + s.cell.h / 2)
  const at = diag.filter(c => mx > c.cell.x && mx < c.cell.x + c.cell.w && my > c.cell.y && my < c.cell.y + c.cell.h)
  return at.length === 1 ? at : diag
}
// ⛔ AUDIT R5 (2026-11-07): a relation is one chart reference among the sentence's others. Read per CLAUSE (split at , ; . and
// and / then / but / while / also):
//   NEGATED  — the relation's own clause carries a negation (not, never, n't, except, besides, without, other than, apart from,
//              leave …) → the chart it names is NEVER a target (`excluded`); it is not the chart meant either.
//   ALSO THE CLICK — another clause points at the click itself (this chart / this one / this / it / the selected one) → two
//              chart references. With an affirmative relation the request is asked about (a plan never runs on a guess between
//              them); with a negated one the affirmative clause's chart, the click, is the one meant.
const CLAUSE_SPLIT = /[,;.!?]|\b(?:and|then|but|while|also|plus)\b/gi
const NEGATION = /\b(?:not|never|except|besides|without|other\s+than|apart\s+from|leave|leaving|ignore|skip|exclude|excluding|don'?t|do\s+not|doesn'?t|won'?t)\b|n't\b/i
const CLICK_POINTER = /\b(?:this|it|the\s+(?:selected|clicked|current|highlighted|active|focused)\s+(?:chart|one))\b(?!\s+(?:candle|candles|bar|bars|line|lines|level|levels|price|drawing|alert|trendline|zone|support|resistance)\b)/i
function clauseAt(s, at) {
  let start = 0, end = s.length
  for (const c of s.matchAll(CLAUSE_SPLIT)) { if (c.index <= at) start = c.index + c[0].length; else { end = c.index; break } }
  return [start, end]
}
/** How the relation sits in the sentence: { negated, alsoClick }. */
export function relationRole(text, m) {
  const s = String(text || '')
  const [a, b] = clauseAt(s, m.index)
  const negated = NEGATION.test(s.slice(a, b))
  const outside = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`
  return { negated, alsoClick: CLICK_POINTER.test(outside) }
}
/** → { hits: [chart snapshots], match, negated, alsoClick, excluded } when the words name a chart relative to the clicked one
 *  (hits may be 0 or several), else null. `hits` is what the relation makes the TARGET: none when it is negated or when another
 *  clause points at the click too; `excluded` is what a negated relation names, which nothing may touch. */
export function relativeChart(text, charts = [], sel = null) {
  // (AUDIT probe 3) the relation's ROLE is read without the click's own negation: "leave this alone and make the one under it
  // weekly" — "this" there is the excluded click, never a second target (alsoClick)
  text = possessiveAnchor(blankStated(negatedClick(text).text))
  const m = relationMatch(text)
  if (!m) return null
  const role = relationRole(text, m)
  const s = sel ? charts.find(c => c.ref === sel && c.cell) : null
  if (!s) return { hits: [], match: m, ...role, excluded: [] }
  if (m.clickLine) {
    const h = clickLineHits(m, charts, s)
    // an appositive that describes the click IS the click ("also" the target); every other click-line relation is anchored on it
    return { hits: h.hits, match: m, ...role, alsoClick: h.onClick, negated: false, excluded: [], plural: h.plural }
  }
  if (m.unplaced) return { hits: [], match: m, ...role, excluded: [] }       // a relation, but no cell UCT can place: asked
  if (m.walk || m.farLine || m.corner || m.line || m.sameBut) {
    let hits = []
    if (m.line) {
      // the click's own row / column; the ordinal may land on the click (then it is the chart meant)
      const hit = atPos(lineOf(charts, m.line.axis, { through: s }), m.line.pos, m.line.axis)
      hits = hit ? [hit] : []
    } else if (m.sameBut) {
      hits = charts.filter(c => c.cell && c.ref !== s.ref && (m.sameBut === 'column' ? xOverlap(c, s) && !yOverlap(c, s) : yOverlap(c, s) && !xOverlap(c, s)))
    } else if (m.walk) {
      // each direction walked N unique steps; the directions that get there are the candidates
      for (const dir of m.walk.dirs) {
        let cur = s
        for (let i = 0; cur && i < m.walk.n; i++) { const nx = sideOf(charts, cur, dir); cur = nx.length === 1 ? nx[0] : null }
        if (cur) hits.push(cur)
      }
    } else if (m.farLine) {
      const far = (dir) => { let at = s, last = null; for (let i = 0; i < charts.length; i++) { const nx = sideOf(charts, at, dir); if (nx.length !== 1) break; last = at = nx[0] } return last }
      hits = (m.farLine === 'row' ? [far('left'), far('right')] : [far('above'), far('below')]).filter(Boolean)
    } else {
      hits = cornersOf(charts).filter(c => c.ref !== s.ref && (m.corner !== 'column' && yOverlap(c, s) || m.corner !== 'row' && xOverlap(c, s)))
    }
    if (role.negated) return { hits: [], match: m, ...role, excluded: hits }
    if (role.alsoClick) return { hits: [], match: m, ...role, excluded: [] }
    return { hits, match: m, ...role, excluded: [] }
  }
  if (m.neighbours) {
    // the click's neighbours in its row: "both neighbours / either side" = the SET (plural); an implicit "the chart next door" =
    // the one neighbour, when there is exactly one (else asked)
    const set = [...sideOf(charts, s, 'left'), ...sideOf(charts, s, 'right')]
    if (role.negated) return { hits: [], match: m, ...role, excluded: set }
    if (m.neighbours === 'one') return { hits: set.length === 1 ? set : [], match: m, ...role, excluded: [] }
    return { hits: set.length === 2 ? set : [], match: m, ...role, excluded: [], plural: set.length === 2 }
  }
  if (m.step || m.farEnd) {
    // a two-axis step: one cell vertically, then one horizontally (each a unique neighbour); the far end: the farthest chart in the
    // click's row, else its column (both, or neither → no chart: asked)
    let hits = []
    if (m.step) { const v = sideOf(charts, s, m.step.v); const h = v.length === 1 ? sideOf(charts, v[0], m.step.h) : []; hits = h.length === 1 ? h : [] }
    else {
      const far = (dir) => { let at = s, last = null; for (let i = 0; i < charts.length; i++) { const n = sideOf(charts, at, dir); if (n.length !== 1) break; last = at = n[0] } return last }
      const row = [far('left'), far('right')].filter(Boolean), col = [far('above'), far('below')].filter(Boolean)
      const line = FAR_LINE.exec(m[0])?.[1]?.toLowerCase()
      hits = line === 'row' ? (row.length === 1 ? row : []) : line === 'column' ? (col.length === 1 ? col : [])
        : row.length === 1 && !col.length ? row : col.length === 1 && !row.length ? col : []
    }
    if (role.negated) return { hits: [], match: m, ...role, excluded: hits }
    if (role.alsoClick) return { hits: [], match: m, ...role, excluded: [] }
    return { hits, match: m, ...role, excluded: [] }
  }
  if (m.diagonal) {
    const hits = diagonalOf(charts, s)
    if (role.negated) return { hits: [], match: m, ...role, excluded: hits }
    if (role.alsoClick) return { hits: [], match: m, ...role, excluded: [] }
    return { hits, match: m, ...role, excluded: [] }
  }
  const v = m[1] && m[1].toLowerCase()
  const side = v ? (['above', 'over'].includes(v) ? 'above' : 'below') : m[2] ? m[2].toLowerCase() : null
  // "next to / beside": either side; "adjacent to / near": any side. More than one fits → asked (the caller), never a guess
  let hits = side ? sideOf(charts, s, side)
    : m[4] ? ['above', 'below', 'left', 'right'].flatMap(x => sideOf(charts, s, x))
      : [...sideOf(charts, s, 'left'), ...sideOf(charts, s, 'right')]
  // ported from r8-integration 7e3e9bb6a6 (counted part only): a COUNTED relation ("the chart two to the left", "the second chart
  // to the right of this", "the next-but-one chart below") walks that many cells in the one direction, one unique neighbour at a
  // time; none, or a fork, → no chart (asked). Never the anchor.
  const count = side ? relationCount(String(text || ''), m) : 1
  // ported from r8-integration 7e3e9bb6a6 (plural part): "both charts to the right of this one" = every chart on that side in line
  const plural = side ? relationPlural(String(text || ''), m) : false
  if (side && plural) hits = lineFrom(charts, s, side)
  else if (side && count > 1) hits = stepFrom(charts, s, side, count)
  if (role.negated) return { hits: [], match: m, ...role, excluded: hits }
  if (role.alsoClick) return { hits: [], match: m, ...role, excluded: [] }
  return { hits, match: m, ...role, excluded: [], plural: !!(side && plural) }
}
const relationPlural = (s, m) => /\b(?:both|all(?:\s+(?:of\s+)?the)?|every|the\s+(?:two|three|four|[2-4]))\s+(?:charts|ones|cells|panes|panels|graphs)\s*$/i.test(s.slice(0, m.index))
function lineFrom(charts, s, side) {
  const out = []
  let at = s
  for (let i = 0; i < charts.length; i++) { const next = sideOf(charts, at, side); if (next.length !== 1) break; out.push(next[0]); at = next[0] }
  return side === 'left' || side === 'above' ? out.reverse() : out
}
const NUM_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, second: 2, third: 3 }
const COUNT_NOUN = '(?:chart|one|cell|pane|panel|graph)'
// AUDIT #988 probe 13: the unit a count may carry ("two PLACES to the left", "2 charts over to the right")
const COUNT_UNIT = '(?:charts?|cells?|panes?|panels?|places?|spots?|positions?|slots?|spaces?)'
// the count a relation carries: inside a bare match ("the chart two to the left"), or right before the relation ("the chart two
// above this", "the second chart to the right of this", "the next-but-one chart below this")
function relationCount(s, m) {
  const scope = `${s.slice(0, m.index)}${m[0]}`
  const at = (re) => re.exec(scope)
  const c = at(new RegExp(`\\b${COUNT_NOUN}\\s+(one|two|three|four|five|[1-9])\\s+(?:${COUNT_UNIT}\\s+)?(?:over\\s+)?(?:(?:right|just|directly|immediately)\\s+)?(?:above|over|below|under|underneath|beneath|to|on)\\b`, 'i'))
    || at(new RegExp(`\\b(second|third)\\s+${COUNT_NOUN}\\s+(?:(?:right|just|directly|immediately)\\s+)?(?:above|over|below|under|underneath|beneath|to|on)\\b`, 'i'))
    // unseen10: the count with its unit and no noun before it ("the chart two charts below this one")
    || at(new RegExp(`\\b(two|three|four|five|[2-9])\\s+${COUNT_UNIT}\\s+(?:over\\s+)?(?:(?:right|just|directly|immediately)\\s+)?(?:above|over|below|under|underneath|beneath|to|on)\\b`, 'i'))
  if (c) return NUM_WORD[c[1].toLowerCase()] || 1
  return at(new RegExp(`\\bnext[-\\s]but[-\\s]one\\s+${COUNT_NOUN}\\b`, 'i')) ? 2 : 1
}
function stepFrom(charts, s, side, n) {
  let at = s
  for (let i = 0; i < n; i++) { const next = sideOf(charts, at, side); if (next.length !== 1) return []; at = next[0] }
  return [at]
}
const knownIndicator =(word) => { try { return addableRows().some(r => String(r.defId).toLowerCase() === String(word).toLowerCase()) } catch { return false } }
const carries = (c, word) => (c?.cs?.indicatorInstances || []).some(i => i && !i.deleted && String(i.defId || '').toLowerCase() === String(word).toLowerCase())
function tfOfWord(w) {
  const s = String(w || '').toLowerCase().trim()
  if (s === 'daily') return 'D'
  if (s === 'weekly') return 'W'
  if (s === 'monthly') return 'M'
  if (s === 'hourly' || s === '1h') return '60'
  const m = /^(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hour|hours)$/.exec(s)
  if (!m) return null
  return /^h/.test(m[2]) ? String(Number(m[1]) * 60) : String(Number(m[1]))
}

/**
 * "the AMD chart" / "the 5 minute chart" / "the empty chart" / "the chart with RSI" — a chart named by what it IS right
 * now: the SYMBOL or TIMEFRAME it shows, its STATE, an INDICATOR on it (autotest multi-chart-04: every word the board can
 * answer for names a chart; "which chart?" is for words it can't).
 * → { match, word, hits: [chart snapshots] } | null. Only live charts count: a word that names no
 * chart on this board is not a qualifier (the fast path then leaves the sentence as it was).
 */
export function chartQualifier(text, charts = []) {
  const s = String(text || '')
  const st = STATE_NAMED.exec(s)
  if (st) {
    const hits = charts.filter(c => !String(c.symbol || '').trim())
    if (hits.length) return { match: withPrep(s, st), word: st[1], hits }
  }
  const tf = TF_NAMED.exec(s)
  if (tf) {
    const code = tfOfWord(tf[1])
    const hits = charts.filter(c => String(c.tf) === code)
    if (hits.length) return { match: withPrep(s, tf), word: tf[1], hits }
  }
  const nm = NAMED.exec(s)
  if (nm) {
    // (a company's name, once the ticker search has answered for it: chartNameWord)
    const sym = resolvedTicker(nm[1])
    const hits = charts.filter(c => String(c.symbol || '').toUpperCase() === sym)
    if (hits.length) return { match: withPrep(s, nm), word: nm[1], hits }
    const shown = charts.filter(c => carries(c, nm[1]))
    if (shown.length) return { match: withPrep(s, nm), word: nm[1], hits: shown }
  }
  const wi = WITH_NAMED.exec(s)
  if (wi) {
    const sym = wi[1].toUpperCase()
    const onIt = charts.filter(c => String(c.symbol || '').toUpperCase() === sym)
    const hits = onIt.length ? onIt : charts.filter(c => carries(c, wi[1]))
    if (hits.length) return { match: withPrep(s, wi), word: wi[1], hits }
  }
  return null
}
// widen a qualifier match to the preposition before it ("… to the AMD chart")
function withPrep(s, m) {
  const before = s.slice(0, m.index)
  const p = /\s+(?:on|to|onto|in|from|off|for|of)\s*$/i.exec(before)
  return p ? { index: p.index, 0: s.slice(p.index, m.index + m[0].length) } : { index: m.index, 0: m[0] }
}

/** "the nvidia chart": the word in a chart's place that no chart answers to yet. Worth one ticker search before a gate reads it. */
export function chartNameWord(text, charts = []) {
  const s = String(text || '')
  const nm = NAMED.exec(s)
  return nm && !chartQualifier(s, charts) && !STATE_NAMED.test(s) ? nm[1] : null
}

/**
 * The charts the member's words DESCRIBE, read from the board as it is: [chart snapshots], possibly none ("the empty chart" with
 * no empty chart), or null when the words describe nothing. ⛔ A description decides the target: no other chart stands in for it.
 */
export function describedCharts(text, charts = []) {
  const s = String(text || '')
  const q = chartQualifier(s, charts)
  if (q) return q.hits
  if (STATE_NAMED.test(s)) return []
  const wi = WITH_NAMED.exec(s)
  return wi && knownIndicator(wi[1]) ? [] : null
}

/** Does the member's text point at one chart without naming it? (With the board's `charts`: also a chart it describes.) */
export function pointsAtChart(text, { chartOp = false, charts = null } = {}) {
  const s = String(text || '')
  return !!relationMatch(s) || POINTS.test(s) || NAMED.test(s) || TF_NAMED.test(s) || (chartOp && IT.test(s)) || (!!charts && describedCharts(s, charts) != null)
    // AUDIT probe 18 (G1): a relation from a chart named by its SYMBOL ("the one next to the SPY one") points at a chart too
    || (!!charts && !!namedAnchorRelation(s, charts))
}

/** The chart ref behind a target of any chart-backed kind (chart itself, a chart's indicators…). */
export function chartRefOf(kind, snap) {
  if (!kind || !snap) return null
  if (kind.name === 'chart') return snap.ref
  if (snap.chartRef) return snap.chartRef
  const g = typeof kind.groupOf === 'function' ? kind.groupOf(snap.ref) : null
  return g && g !== snap.ref ? g : null
}

// (#988 follow-up) THE CHARTS THE WORDS LEAVE OUT — "…, not the NVDA chart", "… except the left one", "… but not on NVDA", "leave
// this one alone": never the chart meant, whatever else the words describe or the click says. When they leave exactly ONE chart
// of the candidates, that chart is the one meant (two charts, "hide volume, not the NVDA chart" → the other one). The exclusions
// are the constraint check's own (spatialCheck.excludedCharts); one it cannot place (UNPLACED) is asked there, whatever this infers.
export const leftOut = (text, charts, sel) => excludedCharts(text, charts, sel)
// ⛔ (11-13) …but never when the CHANGE words name a ticker the board does not show ("change AMD to 1-hour, leave my NVDA alone"
// with SPY and NVDA): the chart they mean is not here, so the one left is no stand-in for it — asked, as with no exclusion at all
const NOT_TICKER_CAPS = new Set(['I', 'A', 'UCT', 'ETF', 'ADR', 'RS', 'RSI', 'MACD', 'EMA', 'SMA', 'WMA', 'ATR', 'VWAP', 'AVWAP', 'ET', 'AM', 'PM', 'OK', 'US',
  'NYSE', 'HLC', 'OHLC', 'MA', 'D', 'W', 'M', 'H', 'AND', 'VS', 'ADX', 'OBV', 'CCI', 'EPS', 'PE', 'BB', 'VCP', 'ATH', 'YTD', 'NOT', 'DONT', 'TF'])
export function offBoardTicker(text, charts = []) {
  const on = new Set(charts.map(c => String(c?.symbol || '').toUpperCase()).filter(Boolean))
  const words = withoutExclusions(text)
  if (!/[a-z]/.test(words)) return null                              // typed in capitals: no word stands out as a ticker
  for (const m of words.matchAll(/(?:^|[\s,;(])\$?([A-Z][A-Z0-9]{0,4}(?:\.[A-Z])?)(?=$|[\s,;.!?)'’])/g)) {
    const t = m[1].toUpperCase()
    if (!on.has(t) && !NOT_TICKER_CAPS.has(t) && !isReservedWord(t)) return t
  }
  return null
}
function theOneLeft(ex, backed, text = '', charts = []) {
  if (!ex.size || offBoardTicker(text, charts)) return null
  const rest = backed.filter(b => !ex.has(b.chart))
  return rest.length === 1 ? rest[0] : null
}

// ⭐ PRODUCTION 11-13 (owner): "Change SPY to the 1-hour timeframe, add a 20 EMA to it, but leave my NVDA chart alone" ASKED.
// "it" made the request deictic, and the deictic reader took a chart from a click, a relation, a place or "the SPY chart" — never
// from the bare ticker the same words had just named, so with no click it asked (the same words without "it" ran).
// ANAPHORA: an "it" / "that chart" / "that one" whose ANTECEDENT is the one chart a ticker named EARLIER in the words names.
// It is that chart only when ALL hold (anything else falls through to the readers below, unchanged):
//   · nothing else in the words points at a chart ("this", "the chart", a relation, a place …)
//   · every anaphor sits in a CHANGE clause — never in a keep / negated one ("leave it there", "don't touch it")
//   · outside the exclusions, the words name exactly ONE chart by symbol (a ticker on two charts names none), it comes before the
//     first anaphor, and it is not a chart the words leave out
//   · no click, or the click IS that chart (a click elsewhere is never silently overruled: asked, as before)
const ANAPHOR = /\b(?:it|that\s+(?:chart|one|ticker|stock|symbol|name))\b/gi
const ANA_SPLIT = /[,;.!?—–]|\b(?:but|and then|then|and)\b/gi
const KEEP_CLAUSE = /^\s*(?:please\s+)?(?:leave|keep|let|don['’]?t|do\s+not|never|not|stop|skip|ignore|exclude|avoid|hands\s+off)\b|\b(?:not|never|no)\b|n['’]t\b/i
const STAYS_CLAUSE = /\b(?:stays?|remains?)\b|\b(?:is|['’]s)\s+(?:(?:just|already)\s+)?(?:fine|good|ok(?:ay)?|perfect|alright)\b|\bas\s+(?:it\s+)?is\b|\b(?:untouched|unchanged|alone)\b/i
export function tickerAntecedent(text, charts = [], sel = null, ex = new Set()) {
  const s = String(text || '')
  const hits = [...s.matchAll(ANAPHOR)]
  if (!hits.length) return null
  if (pointsAtChart(s.replace(ANAPHOR, (m) => ' '.repeat(m.length)), { chartOp: true, charts })) return null
  const cuts = [0, ...[...s.matchAll(ANA_SPLIT)].flatMap(m => [m.index, m.index + m[0].length]), s.length].sort((a, b) => a - b)
  const clauseAt = (i) => { let a = 0, b = s.length; for (const c of cuts) { if (c <= i) a = c; else { b = c; break } } return s.slice(a, b) }
  if (hits.some(h => KEEP_CLAUSE.test(clauseAt(h.index)))) return null
  // the CHANGE clauses only: a keep / negated clause ("leave my NVDA chart alone", "NVDA stays as is") names no antecedent
  let change = '', kept = ''
  for (let i = 0; i < cuts.length - 1; i++) {
    const part = s.slice(cuts[i], cuts[i + 1])
    const keep = KEEP_CLAUSE.test(part) || STAYS_CLAUSE.test(part)
    change += keep ? ' '.repeat(part.length) : part
    kept += keep ? part : ' '.repeat(part.length)
  }
  const named = (t) => [...chartsNamedBySymbol(withoutExclusions(t), charts)].filter(r => !ex.has(r))
  const all = named(change)
  const before = named(change.slice(0, hits[0].index))
  if (all.length !== 1 || before.length !== 1 || before[0] !== all[0]) return null
  // ⛔ a chart a keep clause names is never the antecedent ("change SPY …, add a 20 EMA to it, but leave my SPY alone": asked)
  if (chartsNamedBySymbol(kept, charts).has(all[0])) return null
  if (sel && sel !== all[0]) return null
  return all[0]
}

// ⭐ AUDIT RULING (11-13): A TICKER NAMED AS THE TARGET outranks every stand-in. When the change words name a ticker as the chart
// being changed ("Change AMD to the 1-hour timeframe", "add a 20 EMA to AMD", "the AMD chart") and a chart the plan WRITES shows
// a different symbol, nothing runs: asked. That covers a one-chart board ("the only chart"), the click, and "the one left".
// ⛔ CARVE-OUT: a ticker that is a VALUE of the plan (a symbol it sets, compares, adds — any argument of an op) is no target:
// "change this chart to AMD", "switch to AMD", "put AMD on this chart", "replace SPY with AMD", "show AMD instead", "change SPY to
// AMD" (SPY is the target there, AMD the value) all run as before. Deictic words with no target ticker keep the click rule.
// A target is read only where a ticker stands for a chart: after a change verb, as the object of to / on / for, or "AMD's" / "the
// AMD chart"; never in an exclusion or a keep clause, never an indicator acronym, never in words typed in capitals.
// the verb and determiner in either case ("Change …" opens a sentence); the TICKER keeps its capitals
const TGT_VERB = /\b(?:[Cc]hange|[Ss]witch|[Ss]et|[Mm]ake|[Pp]ut|[Tt]urn|[Ff]lip|[Mm]ove|[Cc]onvert|[Gg]ive|[Zz]oom|[Rr]eset|[Ss]croll)\s+(?:[Tt]he\s+|[Mm]y\s+)?(\$?[A-Z][A-Z0-9]{0,4}(?:\.[A-Z])?)(?=\s+(?:to|on|onto|into|in|at|from|with|over|back|and|chart|one|graph|weekly|daily|monthly|hourly)\b|['’]s\b|\s*[,.;!?]|\s*$)/g
const TGT_PREP = /\b(?:to|on|onto|for|of|in)\s+(?:[Tt]he\s+|[Mm]y\s+)?(\$?[A-Z][A-Z0-9]{0,4}(?:\.[A-Z])?)(?=\s+(?:chart|one|graph|and|but|too|please|as\s+well)\b|['’]s\b|\s*[,.;!?]|\s*$)/g
const TGT_NOUN = /(?:^|[\s(])(\$?[A-Z][A-Z0-9]{0,4}(?:\.[A-Z])?)(?:['’]s)?\s+(?:chart|one|graph)\b/g
function changeWords(text) {
  const s = String(text || '')
  const cuts = [0, ...[...s.matchAll(ANA_SPLIT)].flatMap(m => [m.index, m.index + m[0].length]), s.length].sort((a, b) => a - b)
  let change = ''
  for (let i = 0; i < cuts.length - 1; i++) {
    const part = s.slice(cuts[i], cuts[i + 1])
    change += KEEP_CLAUSE.test(part) || STAYS_CLAUSE.test(part) ? ' '.repeat(part.length) : part
  }
  return withoutExclusions(change)
}
/** The tickers the change words name as the chart being changed (never a value position like "switch to AMD" — see the carve-out). */
export function targetTickers(text) {
  const w = changeWords(text)
  if (!/[a-z]/.test(w)) return []
  const out = []
  for (const re of [TGT_VERB, TGT_PREP, TGT_NOUN]) for (const m of w.matchAll(re)) {
    const t = m[1].replace(/^\$/, '').toUpperCase()
    if (NOT_TICKER_CAPS.has(t) || (!m[1].startsWith('$') && isReservedWord(t)) || out.includes(t)) continue
    out.push(t)
  }
  return out
}
const valuesOf = (ops) => {
  const out = new Set()
  const walk = (v) => {
    if (typeof v === 'string') { const t = v.trim().replace(/^\$/, ''); if (/^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(t)) out.add(t.toUpperCase()) } else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  for (const o of ops || []) walk(o?.args)
  return out
}
/** → { ask: { text }, ticker, shown } when a chart the plan writes shows a symbol other than the TARGET ticker the words name. */
export function targetTickerConflict({ host, ops, text, pickedRefs = [], getTargetKind, getCapability }) {
  try {
    const charts = host?.charts?.list?.() || []
    if (!charts.length || (pickedRefs || []).some(Boolean)) return null
    const values = valuesOf(ops)
    const targets = targetTickers(text).filter(t => !values.has(t))
    if (!targets.length) return null
    // a chart the words identify by place / order / relation (not by symbol) is named there in its own right
    const w = changeWords(text)
    const bySym = chartsNamedBySymbol(w, charts)
    const other = new Set([...chartsNamedBy(w, charts, selectedChart(host))].filter(r => !bySym.has(r)))
    const aliases = new Set((ops || []).map(o => o?.args?.as).filter(a => typeof a === 'string' && a))
    for (const o of ops || []) {
      const cap = getCapability(o?.action)
      const kind = cap ? getTargetKind(cap.target) : null
      if (!kind || cap.query || aliases.has(o.target)) continue
      const snap = (kind.list(host) || []).find(x => x.ref === o.target)
      const chart = snap ? chartRefOf(kind, snap) : null
      if (!chart || other.has(chart)) continue
      const c = charts.find(x => x.ref === chart)
      const shown = String(c?.symbol || '').toUpperCase()
      if (targets.includes(shown)) continue
      const t = targets[0]
      const where = charts.some(x => String(x.symbol || '').toUpperCase() === t) ? '' : ` ${t} isn't on a chart here.`
      return { ticker: t, shown, ask: { text: `You named ${t}, but ${c?.label || 'that chart'} shows ${shown || 'something else'}.${where} Which chart do you mean? Nothing has changed yet.` } }
    }
    return null
  } catch { return null }
}

/**
 * Narrow `candidates` (snapshots of one chart-backed kind) using the member's words and the
 * selection. → { ref } (exactly one meant) | { ask } (several and nothing reliable) | null (the
 * words don't point at a chart: the caller's own rule decides, unchanged).
 */
export function resolveDeictic({ host, kind, candidates, text, chartOp = false }) {
  if (!Array.isArray(candidates) || !candidates.length) return null
  const backed = candidates.map(c => ({ c, chart: chartRefOf(kind, c) }))
  if (backed.some(b => !b.chart)) return null                         // not a chart-backed kind
  const live = host?.charts?.list?.() || []
  if (!pointsAtChart(text, { chartOp, charts: live })) {
    // OWNER DECISION (2026-10-12): a BARE chart command ("switch to weekly", "add rsi") on a board of
    // several charts goes to the chart the member explicitly CLICKED — only while that selection is
    // valid (still on this board, same layout: host.charts.selected()). No selection, a stale one or a
    // closed chart → null, and the caller asks "Which chart?" exactly as before. Never a guess.
    if (!chartOp || candidates.length < 2) return null
    const sel = selectedChart(host)
    const hit = sel ? backed.filter(b => b.chart === sel) : []
    return hit.length === 1 ? { ref: hit[0].c.ref, implicit: true } : null
  }
  if (candidates.length === 1) return { ref: candidates[0].ref }
  // "the one above this": the clicked chart's neighbour on that side, and only it. ⛔ The click is the anchor, never the target.
  // (G4, AUDIT probe 18) "the SPY chart …, and the one to its right": the relation is read from the chart the words named before it
  const anc = relationAnchor(text, live, selectedChart(host))
  const rel = relativeChart(text, live, anc)
  // ...and that named chart is a TARGET too (its own clause says the change): the words name the SET of it and its neighbour
  if (anc && anc !== selectedChart(host) && rel?.hits?.length && !rel.negated) {
    const set = new Set([anc, ...rel.hits.map(c => c.ref)])
    const fits = backed.filter(b => set.has(b.chart))
    if (fits.length > 1) return { refs: fits.map(b => b.c.ref) }
    if (fits.length === 1) return { ref: fits[0].c.ref }
  }
  // a NEGATED relation beside a clause that points at the click ("this one weekly, leave the one below it alone"): the click is
  // the chart meant, and the chart the negated clause names is never it
  if (rel?.negated && rel.alsoClick) {
    const sel = selectedChart(host)
    const hit = sel && !rel.excluded.some(c => c.ref === sel) ? backed.filter(b => b.chart === sel) : []
    if (hit.length === 1) return { ref: hit[0].c.ref }
  }
  if (rel) {
    const refs = new Set(rel.hits.map(c => c.ref))
    const fits = backed.filter(b => refs.has(b.chart))
    // a PLURAL relation names a SET: { refs } (a plan whose targets are all in it stands; anything else is asked)
    if (rel.plural && fits.length > 1) return { refs: fits.map(b => b.c.ref) }
    if (fits.length === 1) return { ref: fits[0].c.ref }
    // AUDIT (#988): the click is the relation's ANCHOR, so it is never offered as the chart meant
    const anchor = selectedChart(host)
    const pool = fits.length ? fits : backed.filter(b => !anchor || b.chart !== anchor)
    return { ask: { text: rel.hits.length || anchor ? 'Which chart do you mean?' : 'Which chart do you mean? Click a chart to select it, or pick one:',
      choices: pool.map(b => b.c).map(c => ({ ref: c.ref, label: c.label })) } }
  }
  // AUDIT probe 17 (F-b, #988): a relation from a NAMED anchor ("the chart beside the top-left one", "the one above the
  // bottom-middle chart") — R1 with the anchor named by position, order or symbol: the anchor is never the target (whether or
  // not it is the click). One neighbour on that side → it; several or none → asked, without the anchor.
  const nar = namedAnchorRelation(text, live)
  if (nar) {
    const fits = backed.filter(b => nar.hits.includes(b.chart))
    if (fits.length === 1) return { ref: fits[0].c.ref }
    const pool = fits.length ? fits : backed.filter(b => b.chart !== nar.anchor)
    return { ask: { text: 'Which chart do you mean?', choices: pool.map(b => b.c).map(c => ({ ref: c.ref, label: c.label })) } }
  }
  // "this NVDA chart" / "the 5 minute chart" / "the empty one": the charts the words describe. One → it. Several → the clicked
  // one only if it is among them. ⛔ Otherwise the member picks from those: the clicked chart never stands in for a description.
  // (G5, AUDIT probe 18) a clause that says a chart is fine names no target: "this one …, the QQQ chart next to SPY is fine"
  const ex = leftOut(text, live, selectedChart(host))
  // (#988 follow-up) a chart described only to be LEFT OUT ("hide volume except the NVDA chart") is no description of the target
  const said0 = describedCharts(activeText(text) || text, live)
  const said = said0?.length && ex.size ? (said0.some(c => !ex.has(c.ref)) ? said0.filter(c => !ex.has(c.ref)) : null) : said0
  const sel = selectedChart(host)
  if (said) {
    const refs = new Set(said.map(c => c.ref))
    const fits = backed.filter(b => refs.has(b.chart))
    if (fits.length === 1) return { ref: fits[0].c.ref }
    const clicked = fits.filter(b => b.chart === sel)
    if (clicked.length === 1) return { ref: clicked[0].c.ref }
    const choices = fits.length ? fits.map(b => b.c) : candidates
    return { ask: { text: 'Which chart do you mean?', choices: choices.map(c => ({ ref: c.ref, label: c.label })) } }
  }
  // "Change SPY to the 1-hour timeframe, add a 20 EMA to it": "it" refers back to the ticker the same words named (tickerAntecedent)
  const ante = tickerAntecedent(text, live, sel, ex)
  if (ante) {
    const fits = backed.filter(b => b.chart === ante)
    if (fits.length === 1) return { ref: fits[0].c.ref }
  }
  const hit = sel && !ex.has(sel) ? backed.filter(b => b.chart === sel) : []
  if (hit.length === 1) return { ref: hit[0].c.ref }
  const one = theOneLeft(ex, backed, text, live)
  if (one) return { ref: one.c.ref }
  return { ask: { text: sel ? 'Which chart do you mean?' : 'Which chart do you mean? Click a chart to select it, or pick one:', choices: candidates.map(c => ({ ref: c.ref, label: c.label })) } }
}

// ── P2-B (owner decision 7, 2026-10-25): every chart a MODEL plan changes must be one the member's
// own words, click or answer identified — on a board of several charts, never the model's guess ──
const POS_WORDS = /\b(top-left|top-right|bottom-left|bottom-right|top left|top right|bottom left|bottom right|left|right|top|bottom|upper|lower)\b/gi
// "both", "all (four) charts", "every chart", "all of them" — a SET of charts (never "remove all comparisons")
// (probe 19) "everything (but / except …)", "all of these": the whole board, an exclusion taken out by the constraint check
const MANY_COUNT = /\b(?:(both)\b|(?:all|every|each)(?:\s+(?:the|of the))?(?:\s+(two|three|four|five|six|seven|eight|nine|ten|\d{1,2}))?\s+(?:charts?|of them|ones)\b|everything\b(?!\s+(?:else\s+)?(?:in|on|along)\s+(?:this|that|its|my)\b)|all\s+of\s+(?:these|them)\b)/i
const OTHER_CHARTS = /\b(?:(?:my|the|all(?: my| the)?|every) )?other charts\b/i
const REST_OF_BOARD = /\b(?:(?:all\s+)?the\s+(?:rest|others|other\s+ones)|everything\s+else|all\s+(?:the\s+)?others|every\s+other\s+(?:one|chart))\b/i
const OTHER_CHART = /\b(?:my|the|that|this) other (?:chart|one)\b/i
// …and "a different chart", "another chart", "some other chart": a chart that is NOT the clicked one, not yet which
const DIFFERENT_CHART = /\b(?:a|another|some|any)\s+(?:different|other)\s+(?:chart|one)\b|\banother\s+(?:chart|one)\b|\bone\s+other\b/i
/** "the other chart" / "a different chart": the words mean a chart that is NOT the clicked one (pl-teach round 6 / AUDIT T1b:
 *  the guide reads it here, never a copy). One other chart on the board → that one; several → which one is asked.
 *  ⛔ AUDIT T1c/T1d/T1e (2026-11-07), matching execution's OTHER_CHART:
 *   • DEFINITE "the / my / that other one" is the other chart, as execution reads it — unless the sentence names another thing
 *     the "one" can stand for (a drawing, an indicator, an alert…: "two lines … delete the other one").
 *   • INDEFINITE "another one" / "one other" / "a different one" names a chart only beside a chart word in its own clause that is
 *     NOT the click itself: "another one of my charts" counts; "draw another one on this chart" is another drawing on the click. */
const ONE_STANDS_FOR = /\b(?:drawings?|lines?|trend ?lines?|rays?|rectangles?|boxe?s?|circles?|arrows?|fibs?|fibonacci|channels?|notes?|labels?|indicators?|studies|study|alerts?|levels?|tabs?|layouts?|lists?|watchlists?|widgets?|templates?|panes?|colou?rs?)\b/i
const CLICK_CHART = /\b(?:this|that|the|my|current|selected|clicked|active|same)\s+(?:chart|one)\b(?!s)/gi
export function saysOtherChart(text) {
  const s = String(text || '')
  const definite = OTHER_CHART.exec(s)
  if (definite) {
    if (/chart/i.test(definite[0])) return true
    // ⛔ AUDIT T1f: after a preposition "the other one" is the LOCATION — the other chart, whatever the sentence adds there
    // ("add an indicator to the other one", "draw a trendline on the other one"). Only as the verb's OBJECT, with a thing of
    // that kind named BEFORE it ("I drew two lines, how do I delete the other one"), does "one" stand for that thing
    const before = s.slice(0, definite.index)
    if (/\b(?:on|to|onto|from|in|into|for|of|at|over)\s*$/i.test(before)) return true
    if (!ONE_STANDS_FOR.test(before)) return true
  }
  const m = DIFFERENT_CHART.exec(s)
  if (!m) return false
  if (/chart/i.test(m[0])) return true
  const [a, b] = clauseAt(s, m.index)
  const rest = (s.slice(a, m.index) + ' ' + s.slice(m.index + m[0].length, b)).replace(CLICK_CHART, ' ')
  return /\bcharts?\b/i.test(rest)
}
const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 }
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The answer to a question UCT asked, read against its choices: an exact label, "2", "the second (one)". */
export function pickedChoice(text, choices = []) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '')
  if (!t || !choices.length) return null
  const byLabel = choices.filter(c => c?.ref && String(c.label || '').trim().toLowerCase() === t)
  if (byLabel.length === 1) return byLabel[0].ref
  const m = /^(?:the\s+)?(\d|first|second|third|fourth|1st|2nd|3rd|4th)(?:\s+(?:one|chart))?$/.exec(t)
  const n = m ? (Number(m[1]) || ORDINAL[m[1]]) : 0
  return n >= 1 && n <= choices.length ? choices[n - 1]?.ref || null : null
}

// ── Charts operator P1: a chart named by its ORDER on the board ──
// "the second chart", "chart 3", "the 2nd one", "the last chart", "the middle chart". Reading order is the
// board's (top to bottom, then left to right — host.charts.list()). "middle" only when it is unambiguous:
// an odd number (3 or 5) of charts in ONE row or ONE column. → { ref, word } | { ask } | null (no such words).
const ORD_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6 }
// ("chart 5" is an ordinal only when no unit follows: "the chart 5 min" is a timeframe, never the fifth chart)
export const ORD_RE = /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th|last|middle|center|centre)\s+(?:chart|one)\b|\bchart\s+(?:#\s*)?([1-9])\b(?!\s*(?:(?:m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mo|months?|x)\b|[%.:/-]))/i
export function ordinalChart(text, charts = []) {
  const abs = absoluteLineChart(text, charts)
  if (abs) return abs
  const m = ORD_RE.exec(String(text || ''))
  if (!m) return null
  // "the second chart to the right of this": a COUNT of a relation from the click, not the board's second chart
  if (m[1] && /^\s+(?:(?:right|just|directly|immediately)\s+)?(?:to\s+the\s+(?:left|right)|on\s+the\s+(?:left|right)|above|over|below|under|underneath|beneath)\b/i.test(String(text).slice(m.index + m[0].length))) return null
  const n = charts.length
  const word = (m[1] || `chart ${m[2]}`).toLowerCase()
  if (!n) return { ask: { text: 'There are no charts on this board.', choices: [] }, match: m }
  let idx = null
  if (m[2]) idx = Number(m[2]) - 1
  else if (word === 'last') idx = n - 1
  else if (['middle', 'center', 'centre'].includes(word)) {
    const cells = charts.map(c => c.cell).filter(Boolean)
    // unseen9 P2 (pl-teach's trace): a ROW word ("the middle chart on the bottom row", "the bottom middle chart") or a COLUMN word
    // ("the middle one in the left column") names a line first; its middle is the chart meant when the line holds an odd number
    // (3 or more). Any other line → asked, as before. The guide's namedChart reads the same function.
    const t = String(text || '')
    const rowW = /\b(top|upper|bottom|lower)\b/i.exec(t)
    const colW = /\b(left|right)\s+(?:column|side)\b/i.exec(t)
    if (cells.length === n && (rowW || colW)) {
      const ask = { ask: { text: 'Which chart is the middle one here? Pick one:', choices: charts.map(c => ({ ref: c.ref, label: c.label })) }, match: m }
      let line
      if (colW) {
        const xs = charts.map(c => c.cell.x)
        const want = colW[1].toLowerCase() === 'left' ? Math.min(...xs) : Math.max(...xs)
        line = charts.filter(c => c.cell.x === want).sort((a, b) => a.cell.y - b.cell.y)
      } else {
        const ys = charts.map(c => c.cell.y)
        const want = /^(?:top|upper)$/i.test(rowW[1]) ? Math.min(...ys) : Math.max(...ys)
        line = charts.filter(c => c.cell.y === want).sort((a, b) => a.cell.x - b.cell.x)
      }
      return line.length >= 3 && line.length % 2 === 1 ? { ref: line[(line.length - 1) / 2].ref, word, match: m } : ask
    }
    const oneRow = cells.length === n && new Set(cells.map(c => c.y)).size === 1
    const oneCol = cells.length === n && new Set(cells.map(c => c.x)).size === 1
    idx = (n === 3 || n === 5) && (oneRow || oneCol) ? (n - 1) / 2 : null
    if (idx == null) return { ask: { text: 'Which chart is the middle one here? Pick one:', choices: charts.map(c => ({ ref: c.ref, label: c.label })) }, match: m }
  } else idx = ORD_WORDS[word] - 1
  if (idx < 0 || idx >= n) return { ask: { text: `There ${n === 1 ? 'is only one chart' : `are only ${n} charts`} here — which one do you mean?`, choices: charts.map(c => ({ ref: c.ref, label: c.label })) }, match: m }
  return { ref: charts[idx].ref, word, match: m }
}

/** The charts on this board the member's words NAME: a position word that fits exactly one chart, or a
 *  symbol exactly one chart shows ("put RSI on NVDA"). Short tickers count only as typed in capitals. */
export function chartsNamedBy(text, charts = [], sel = null) {
  const s = String(text || '')
  const named = new Set()
  const rel = relativeChart(s, charts, sel)
  if (rel?.hits.length === 1) named.add(rel.hits[0].ref)
  // P1: "the second chart", "chart 3", "the middle chart" — only with the word CHART ("the first one" is as often a
  // list item or a result as a chart, so it never identifies a chart for a model plan)
  const ord = ordinalChart(s, charts)
  // ⛔ an ABSOLUTE line place ("the middle one of the top row") names its cell whatever the noun: the row / column words make it
  // a chart reference, so the click never answers for it (AUDIT GO run 23b99fc0a1, 85/86)
  if (ord?.ref && (/chart/i.test(ord.match[0]) || ord.line)) named.add(ord.ref)
  // what the chart IS right now (chartQualifier), when that fits exactly one chart ("the empty one", "the one with RSI")
  const q = chartQualifier(s, charts)
  if (q?.hits.length === 1) named.add(q.hits[0].ref)
  for (const m of s.matchAll(POS_WORDS)) {
    const w = m[1].toLowerCase().replace(' ', '-').replace('upper', 'top').replace('lower', 'bottom')
    const parts = w.split('-')
    const hits = charts.filter(c => c.position && parts.every(p => c.position.split('-').includes(p)))
    if (hits.length === 1) named.add(hits[0].ref)
  }
  for (const r of chartsNamedBySymbol(s, charts)) named.add(r)
  return named
}

/** The charts the words name by a SYMBOL exactly one chart on the board shows ("put RSI on NVDA"); short tickers only in capitals. */
export function chartsNamedBySymbol(text, charts = []) {
  const s = String(text || '')
  const named = new Set()
  const bySym = new Map()
  for (const c of charts) { const k = String(c.symbol || '').toUpperCase(); if (k) bySym.set(k, [...(bySym.get(k) || []), c]) }
  for (const [sym, list] of bySym) {
    if (list.length !== 1) continue
    const re = new RegExp(`(?:^|[^A-Za-z0-9.])${escapeRe(sym)}(?![A-Za-z0-9])`, sym.length <= 2 ? '' : 'i')
    if (re.test(s)) named.add(list[0].ref)
  }
  return named
}

/**
 * A model plan on a board of several charts, for a request that does NOT point at a chart (pointing words
 * are screenDeicticOps'): each chart-backed change must land on a chart the member identified — named by
 * position or symbol, picked as an answer (`pickedRefs`), "all / every / both", or the chart they CLICKED
 * (the owner's bare-command rule, 2026-10-12). Otherwise:
 *   one chart changed      → { ask } "Which chart do you mean?" (nothing runs; their pick resumes the plan)
 *   several charts changed → { propose } the change is shown for approval, never applied at once
 * → null when every changed chart is identified (or the board has one chart).
 */
// a position word only where it stands for a chart: "the top one", "the chart in the bottom right". "the top was 150", "on top",
// "right now" and "the left shoulder" say nothing about a chart, so they never take the click's place
const CHART_POSITION = new RegExp(`${POS_WORDS.source}[\\s-]+(?:chart|one|cell|corner|pane)\\b|\\b(?:chart|one)\\s+(?:in|at|on)\\s+the\\s+${POS_WORDS.source}`, 'gi')
const chartPositions = (words) => [...String(words || '').matchAll(CHART_POSITION)].map(m => (m[1] || m[2]).toLowerCase().replace(' ', '-').replace('upper', 'top').replace('lower', 'bottom'))
function clickFits(said, charts, sel) {
  if (!said.length) return true
  return said.some(w => { const parts = w.split('-'); return charts.some(c => c.ref === sel && c.position && parts.every(p => c.position.split('-').includes(p))) })
}

export function screenUnnamedTargets({ host, ops, text, context = null, pickedRefs = [], getTargetKind, getCapability }) {
  if (pointsAtChart(text, { chartOp: true, charts: host?.charts?.list?.() || [] })) return null
  // an ANSWER to the model's question is read with the words that question was about (`context`)
  const words = context ? `${text} ${context}` : String(text || '')
  const charts = host?.charts?.list?.() || []
  if (charts.length < 2) return null
  const aliases = new Set((ops || []).map(o => o?.args?.as).filter(a => typeof a === 'string' && a))
  const targets = new Map()                                  // chart ref → the op kind's snapshots
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    if (!kind || cap.query || aliases.has(o.target)) continue
    const list = kind.list(host) || []
    const snap = list.find(s => s.ref === o.target)
    const chart = snap ? chartRefOf(kind, snap) : null
    if (chart) targets.set(chart, { list, action: o.action, kind })
  }
  if (!targets.size) return null
  // "all / every / both (four) charts": the member named the set — but a COUNT they said must match
  // the charts this plan changes ("both" = two), else it is only proposed
  // ⭐ P2: "copy these to my other charts" — with the chart the request is about, the member named every chart
  if (OTHER_CHARTS.test(words)) return null
  // ⭐ PACKAGE 3: "apply it to my other chart" on a board of TWO — the other chart is the one the plan does NOT read from
  // (a copy's `from`) and does not already carry what it adds; then the member named it
  if (targets.size === 1 && otherChartMeant(words, charts, [...targets.keys()][0], ops)) return null
  const many = MANY_COUNT.exec(words)
  if (many) {
    const count = many[1] ? 2 : many[2] ? (COUNT_WORDS[many[2].toLowerCase()] || Number(many[2])) : null
    return count && count !== targets.size
      ? { propose: true, note: `You said ${count} charts, and this changes ${targets.size} — check it first; nothing has changed yet.` }
      : null
  }
  const named = chartsNamedBy(words, charts)
  // a picked choice may be the chart itself or a chart-backed entry of it (`ixe:<chart>`)
  for (const r of pickedRefs || []) if (r) { named.add(r); named.add(String(r).replace(/^[a-z]+:/i, '')) }
  // ⛔ The click answers for a request that names no chart. Words that name one are not overruled by it: a plan on the clicked
  // chart there is unidentified like any other. A bare "this" still means the clicked chart, and a position word fitting several
  // charts counts the click only if it is one of them.
  const sel = selectedChart(host)
  // (#988 follow-up) when the words leave exactly one chart out of the board, that one is named; a chart named only to be LEFT
  // OUT ("…, not NVDA", "… except the first chart") is no chart named against the click (it still answers)
  const ex = leftOut(words, charts, sel)
  const left = ex.size ? charts.filter(c => !ex.has(c.ref)) : []
  if (left.length === 1 && !offBoardTicker(words, charts)) named.add(left[0].ref)
  const kept = withoutExclusions(words)
  // (#988) a position said only to EXCLUDE a chart ("log on the one I selected, not the left one") is no place the request names
  const said = chartPositions(withoutExclusions(words))
  const answered = (pickedRefs || []).some(Boolean)
  // ⛔ AUDIT (single clause): a plain "the other one / the other chart" on a board of TWO names the chart that is NOT the click,
  // and the click is EXCLUDED: a plan on the other chart runs, a plan on the click is asked (unless "this" names it too)
  const otherOne = !answered && sel && charts.length === 2 && otherOneIsChart(words) ? charts.find(c => c.ref !== sel)?.ref || null : null
  if (otherOne) named.add(otherOne)
  // ⛔ AUDIT GO run (23b99fc0a1): an ABSOLUTE line place ("the middle one of the top row", "the top row's middle chart") names one
  // cell with no anchor. Stripping its row / column words (below) must not turn it into a bare command the click answers: the
  // click counts only when it IS that cell (then it is already named).
  const absLine = ordinalChart(words, charts)
  // AUDIT probe 17 (F-a): a WHOLE absolute line ("the top row", "the left column") names every cell in it — a set, like "both
  // charts" — and, like a place, it is never a bare command the click answers
  const lineSet = wholeLinesNamed(words, charts)
  for (const r of lineSet) named.add(r)
  const lineNamed = !!absLine?.line || lineSet.size > 0
  // (#988, AUDIT probe 20 a) "other than the one I'm looking at, put THE REST on log": with the click negated, "the rest / the
  // others / everything else" names every chart but the click (a plan on the click is excluded by the negation screens)
  if (sel && !answered && REST_OF_BOARD.test(words) && negatedPointer(words)) for (const c of charts) if (c.ref !== sel) named.add(c.ref)
  if (sel && (/\bthis\b/i.test(otherOne ? words.replace(OTHER_CHART, ' ') : words) || (!otherOne && !answered && !lineNamed && !chartsNamedBy(`${kept.replace(POS_WORDS, ' ')} ${said.join(' ')}`, charts).size && clickFits(said, charts, sel)))) named.add(sel)
  const unnamed = [...targets.keys()].filter(c => !named.has(c))
  if (!unnamed.length) return null
  if (targets.size === 1) {
    const { list, action, kind } = targets.get(unnamed[0])
    // a line or a place the words name: only its cells are offered (AUDIT probe 17 F-a), never the whole board
    const offer = lineNamed ? list.filter(c => named.has(chartRefOf(kind, c))) : []
    return { ask: { text: offer.length ? 'Which chart do you mean?' : 'Which chart do you mean? Click a chart to select it, or pick one:', choices: (offer.length ? offer : list).map(c => ({ ref: c.ref, label: c.label })), action } }
  }
  const label = (ref) => charts.find(c => c.ref === ref)?.label || 'a chart'
  return { propose: true, note: `I wasn't sure you meant ${unnamed.map(label).join(' and ')}, so check this first — nothing has changed yet.` }
}

/** The member's selected chart ref (live, still on this board) or null. */
export function selectedChart(host) {
  try { return host?.charts?.selected?.() || null } catch { return null }
}

/**
 * The model planned ops on charts for a deictic request: every chart-kind op must target the
 * selected chart (or the chart a named symbol picks). Plan aliases (`as` refs made in this plan)
 * and single-chart boards pass. → { ask } | null.
 */
/** PACKAGE 3: "apply it to my other chart" on a board of TWO — `dest` is "the other chart" when the plan reads FROM the
 *  remaining chart (a copy's `from`) or adds what that chart already carries. ("it" there is the indicator, not a chart.) */
function otherChartMeant(text, charts, dest, ops) {
  if (!OTHER_CHART.test(String(text || '')) || charts.length !== 2 || !charts.some(c => c.ref === dest)) return false
  const other = charts.find(c => c.ref !== dest)
  const strip = (r) => String(r || '').replace(/^[a-z]+:/i, '')
  const fromOther = (ops || []).some(o => strip(o?.args?.from) === other?.ref)
  const hasDef = (ops || []).some(o => typeof o?.args?.defId === 'string' && (other?.cs?.indicatorInstances || []).some(i => i && !i.deleted && i.defId === o.args.defId))
  return fromOther || hasDef
}

/** "the / my / that other one" (OTHER_CHART) means the other CHART — as the guide reads it (pl-teach T1e/T1f): with a chart word,
 *  or after a preposition (the LOCATION: "add RSI to the other one"), or when nothing named before it is a thing the "one" can
 *  stand for. As the verb's object after such a thing ("I drew two lines, delete the other one") it is that thing, not a chart. */
const ONE_IS_A_THING = /\b(?:drawings?|lines?|trend ?lines?|rays?|rectangles?|boxe?s?|circles?|arrows?|fibs?|fibonacci|channels?|notes?|labels?|indicators?|studies|study|alerts?|levels?|tabs?|layouts?|lists?|watchlists?|widgets?|templates?|panes?|colou?rs?)\b/i
function otherOneIsChart(text) {
  const s = String(text || '')
  const m = OTHER_CHART.exec(s)
  if (!m) return false
  if (/chart/i.test(m[0])) return true
  const before = s.slice(0, m.index)
  return /\b(?:on|to|onto|from|in|into|for|of|at|over)\s*$/i.test(before) || !ONE_IS_A_THING.test(before)
}

// the word "this" on a chart or stock, and no position, ordinal, name or description that could be saying something else
const TRUE_POINTER = /\bthis\s+(?:chart|stock|ticker|symbol|one)\b/i
const ELSE_NAMED = /\b(?:of|showing)\s+[a-z$]/i
function onlyPointer(text, charts) {
  const s = String(text || '')
  return TRUE_POINTER.test(s) && !relationMatch(s) && !OTHER_IN_CLAUSE.test(s) && !s.match(POS_WORDS) && !ORD_RE.test(s) && !ELSE_NAMED.test(s) && describedCharts(s, charts) == null
    && !chartNameWord(s, charts) && !chartsNamedBy(s, charts).size
}

/** "the TSLA tab" when TSLA shows only on a tab that isn't open. → the ticker, or null. The Agent reaches a chart's open tab only. */
export function closedTabNamed(text, host) {
  const m = TAB_NAMED.exec(String(text || ''))
  if (!m) return null
  const sym = resolvedTicker(m[1])
  try {
    if ((host?.charts?.list?.() || []).some(c => String(c.symbol || '').toUpperCase() === sym)) return null
    const s = host?.widgets?.snapshot?.()
    const syms = s?.groupSyms || {}
    for (const w of s?.raw || []) {
      if (w.type !== 'chart') continue
      for (const t of sanitizeChartTabs(w.opts).tabs) if (String(syms[t.color] || '').toUpperCase() === sym) return sym
    }
  } catch { /* the board can't be read: the gates below decide */ }
  return null
}

// pl-auto u-target-05/08 (BROWSER-MOCK-MODEL): a NEGATED pointer — "everything except this one", "not this chart", "all but
// this one", "other than this" — EXCLUDES the clicked chart. It is never aimed at nor stood in for: a plan on the other charts
// runs where it is planned, and an op on the click itself is asked about.
// (#988, pl-grid / AUDIT probe 20) …and the click named by the ACT: "not the one I clicked", "instead of the chart I'm on", "other
// than the one I'm looking at" (clickRef.js CLICK_ACT_NP)
const NEG_POINTER = new RegExp('(?:\\b(?:except(?:\\s+for)?|not|other\\s+than|besides|apart\\s+from|aside\\s+from|excluding|minus|save\\s+for|instead\\s+of|rather\\s+than)'
  + '|\\b(?:all|every\\w*|them|others?|charts?|ones)\\s+but(?:\\s+not)?)\\s+(?:this|that|it|the\\s+(?:selected|clicked|current|highlighted|active|focused)\\s+(?:chart|one)|'
  + CLICK_ACT_NP + ')\\b', 'i')
// (#988, AUDIT probe 2) the reply quotes a negation ("You said not …") only when the words HAVE one; a click excluded by a stative
// clause ("the one I selected stays daily") or an imperative ("leave this alone", "all but this one") is said as left out
const NEG_WORD = /\b(?:not|never|except|excluding|besides|minus|other\s+than|instead\s+of|rather\s+than|apart\s+from|aside\s+from|save\s+for)\b|n['’]t\b/i
export const negatedPointer = (text) => NEG_POINTER.exec(String(text || '')) || (negatedClick(text).excludes ? [String(text || '')] : null)
// ⭐ round 3 (pl-exec): PER-CLAUSE TARGETS — "make the NVDA chart weekly and this one log". A sentence of several clauses, each
// naming ONE chart (a description, a ticker, a position) or pointing at the click (this one / this chart / here / it), and each
// saying ONE change the capability's own instant reader recognises once the chart words are lifted off. Each op of the plan is
// matched to the one clause that says it (action and arguments); it runs only on that clause's chart. Affirmative clauses only:
// a negated clause's chart is never a target. Anything not certain — a clause naming two charts or none, an op no clause says,
// an op two clauses say — is not read here, and the gates below decide as before (they ask).
const OTHER_IN_CLAUSE = /\bthe other(?:\s+(?:one|chart|cell|pane|ticker|stock))?\b/i
const CLAUSE_POINTER = /\b(?:this|that)(?:\s+(?:one|chart|ticker|stock|symbol|graph|cell|pane))?\b|\bhere\b|\bit\b/i
const CHART_WORDS = new RegExp([
  String.raw`\b(?:on|to|for|in)\s+(?:the|this|that|my)\s+[a-z0-9.\-]+(?:\s+[a-z0-9.\-]+)?\s+(?:chart|one|cell|pane)\b`,
  String.raw`\b(?:the|this|that|my)\s+[a-z0-9.\-]+(?:\s+[a-z0-9.\-]+)?\s+(?:chart|one|cell|pane)\b`,
  String.raw`\b(?:on|to|for|in)\s+(?:this|that)(?:\s+(?:one|chart|ticker|stock|symbol|graph|cell|pane))?\b`,
  String.raw`\b(?:this|that)(?:\s+(?:one|chart|ticker|stock|symbol|graph|cell|pane))?\b`, String.raw`\bhere\b`, String.raw`\bit\b`,
].join('|'), 'gi')
const FILLER = /\b(?:make|set|put|switch|change|turn|flip|please|and|then|also|too|just|now|to|on|onto|with)\b/gi
function clauseReads(text, host, parse) {
  const s = String(text || '')
  // a negated pointer stays with the audited rules; a RELATION is read in its own clause (below)
  if (negatedPointer(s)) return null
  const parts = s.split(CLAUSE_SPLIT).map(x => x.trim()).filter(Boolean)
  if (parts.length < 2 || typeof parse !== 'function') return null
  const charts = host?.charts?.list?.() || []
  const sel = selectedChart(host)
  const relAnchor = relationAnchor(s, charts, sel)                       // (G4) "… and the one to its right"
  const out = []
  for (const part of parts) {
    const negated = NEGATION.test(part)
    // the clause's own chart, never two and never none:
    //   a relation in it ("the chart below it") → the single neighbour on that side of the click
    //   "the other one / chart" on a board of two with a click → the chart that is not the click
    //   a name (one) → that chart; a pointer alone (this one / here / it) → the click
    const rel = relationMatch(part) ? relativeChart(part, charts, /\b(?:its|it)\b/i.test(part) ? relAnchor : sel) : null
    const other = OTHER_IN_CLAUSE.test(part) ? (charts.length === 2 && sel ? charts.find(c => c.ref !== sel)?.ref || null : null) : undefined
    const named = [...chartsNamedBy(part, charts, sel)]
    const pointer = CLAUSE_POINTER.test(part)
    const chart = rel ? (rel.hits.length === 1 && !rel.negated ? rel.hits[0].ref : null)
      : other !== undefined ? other
        : named.length === 1 && !pointer ? named[0] : !named.length && pointer && sel ? sel : null
    // the change once the chart words are lifted off (a relation's own words, and the chart it names, too)
    const bare = rel ? part.replace(rel.match[0], ' ').replace(/\b(?:the|a)\s+(?:chart|one|cell|pane|panel|ticker|stock|symbol|graph)\b/gi, ' ') : part
    const core = bare.replace(OTHER_IN_CLAUSE, ' ').replace(CHART_WORDS, ' ').replace(FILLER, ' ').replace(/[:]/g, ' ').replace(/\s+/g, ' ').trim()
    let ops = null
    const read = (t) => { try { const r = t ? parse(t, { host }) : null; return r?.kind === 'ops' && !r.target ? r.ops : null } catch { return null } }
    // "to the hourly", "on the weekly": the article a chart word left behind is no part of the change
    ops = read(core) || read(core.replace(/^(?:the|a|an)\s+/i, '')) || read(bare.replace(OTHER_IN_CLAUSE, ' ').replace(CHART_WORDS, ' ').replace(/[:]/g, ' ').replace(/\s+/g, ' ').trim())
    out.push({ part, negated, chart, ops, core })
  }
  // pl-auto unseen12 (#988): "step one row down from this chart AND MAKE IT weekly" — a back-reference ("it", "that one", "that
  // chart", never "this") in a clause right after one that named a chart by a relation from the click, and said no change of its
  // own, is THAT chart: the click is only the relation's anchor
  for (let i = 1; i < out.length; i++) {
    const r = out[i], prev = out[i - 1]
    // (pl-auto V2 fb6170315e: "… and make THAT weekly", "… the one THERE" are the same back-reference)
    const back = /\b(?:it|that(?:\s+(?:one|chart))?|there)\b/i.test(r.part) && !/\bthis\b|\bhere\b/i.test(r.part)
    if (r.negated || prev.negated || !sel || !back || (r.chart !== sel && r.chart != null) || prev.ops?.length || !prev.chart || prev.chart === sel) continue
    if (relationMatch(prev.part)) r.chart = prev.chart
  }
  // ⭐ 2026-11-07 (pl-auto u4-clauses-04/06/08/10): ONE change said once for two charts — "the TSLA chart to the hourly and this one
  // too", "draw a line at 120 on this one and on the TSLA chart", "this one and the one to its left on the weekly". A clause that
  // names its chart and says NOTHING else (its words are only chart words and fillers) shares the change of the one other
  // affirmative clause that says one. Two clauses saying changes, or none, leave it unread (the gates decide, as before).
  const sayers = out.filter(r => !r.negated && r.ops?.length)
  if (sayers.length === 1) {
    for (const r of out) if (!r.negated && r.chart && !r.ops && !SHARED_LEFTOVER(r.core)) { r.ops = sayers[0].ops; r.shared = true }
  }
  return out
}
const SHARED_LEFTOVER = (core) => !!String(core || '').replace(/\b(?:as\s+well|both|same|the|a|one|ones|chart|charts|do|that|please)\b/gi, ' ').trim()
const sameOp = (a, b) => a.action === b.action && JSON.stringify(a.args || {}) === JSON.stringify(b.args || {})
/** → { ok: true } when every op is the change of exactly one affirmative clause, on that clause's chart; { ask } when an op
 *  lands on a chart its clause does not name (or a negated clause's chart); null when the sentence is not read this way. */
function clauseTargets({ host, ops, text, getTargetKind, getCapability, parse }) {
  const reads = clauseReads(text, host, parse)
  if (!reads) return null
  const excluded = new Set(reads.filter(r => r.negated && r.chart).map(r => r.chart))
  const affirm = reads.filter(r => !r.negated)
  // the family itself: one affirmative clause points at the click, another names a different chart
  const sel = selectedChart(host)
  if (!affirm.some(r => r.chart && r.chart === sel) || !affirm.some(r => r.chart && r.chart !== sel)) return null
  // ⛔ (pl-auto V2): no question ever NAMES the click when the words relate a chart to it (it is that relation's anchor): the
  // question is then asked without it
  const rc = sel ? relativeChart(String(text || ''), host?.charts?.list?.() || [], sel) : null
  const anchor = rc && !rc.alsoClick && !rc.negated ? sel : null
  const askMeant = (meant, list, kind, action) => (meant && anchor && chartRefOf(kind, meant) === anchor
    ? { ask: { text: 'Which chart do you mean?', choices: list.filter(c => chartRefOf(kind, c) !== anchor).map(c => ({ ref: c.ref, label: c.label })), action } }
    : { ask: { text: `Did you mean ${meant?.label || 'that chart'} for that change?`, choices: list.filter(c => !anchor || chartRefOf(kind, c) !== anchor).map(c => ({ ref: c.ref, label: c.label })), action } })
  let any = false
  const used = new Set()
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    const list = kind ? (kind.list(host) || []) : []
    const snap = list.find(x => x.ref === o.target)
    const chart = snap ? chartRefOf(kind, snap) : null
    if (!chart) continue
    if (excluded.has(chart)) return { ask: { text: 'You asked me to leave that chart alone. Which chart do you mean?', choices: list.filter(x => !excluded.has(chartRefOf(kind, x))).map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    const says = affirm.filter(r => (r.ops || []).some(x => sameOp(x, o)))
    // a shared change ("… and this one too") is said by each of its clauses: the op is the one whose chart it is on, each once
    const mine = says.length > 1 ? says.filter(r => r.chart === chart && !used.has(r)) : says
    if (says.length > 1 && mine.length !== 1) {
      if (says.some(r => !r.chart)) return null
      const meant = list.find(x => chartRefOf(kind, x) === says.find(r => !used.has(r))?.chart)
      return askMeant(meant, list, kind, o.action)
    }
    if (mine.length !== 1 || !mine[0].chart) return null                      // not certain: the gates below decide
    if (mine[0].chart !== chart) {
      const meant = list.find(x => chartRefOf(kind, x) === mine[0].chart)
      return askMeant(meant, list, kind, o.action)
    }
    any = true
    used.add(mine[0])
    o.__clause = mine[0]
  }
  // every affirmative clause that says a change has an op for it: a plan that does only part of the sentence is not read here
  // (the gates ask), so a one-op plan never runs beside a clause it left out
  const done = new Set((ops || []).map(o => o.__clause).filter(Boolean))
  for (const o of ops || []) delete o.__clause
  if (any && affirm.some(r => (r.ops || []).length && !done.has(r))) return null
  // a clause that names a chart but says no change of its own ("…and the one right of it as well") repeats another's: not certain
  if (any && affirm.some(r => r.chart && !(r.ops || []).length)) return null
  return any ? { ok: true } : null
}

export function screenDeicticOps({ host, ops, text, getTargetKind, getCapability, parse = null }) {
  if (!pointsAtChart(text, { chartOp: true, charts: host?.charts?.list?.() || [] })) return null
  {
    const per = clauseTargets({ host, ops, text, getTargetKind, getCapability, parse })
    if (per?.ask) return per
    if (per?.ok) return null
  }
  if (negatedPointer(text)) {
    const sel = selectedChart(host)
    for (const o of ops || []) {
      const cap = getCapability(o?.action)
      const kind = cap ? getTargetKind(cap.target) : null
      const list = kind ? (kind.list(host) || []) : []
      const snap = list.find(x => x.ref === o.target)
      if (snap && sel && chartRefOf(kind, snap) === sel) {
        const others = list.filter(x => chartRefOf(kind, x) && chartRefOf(kind, x) !== sel)
        return { ask: { text: NEG_WORD.test(String(text || '')) ? 'You said not the chart you clicked. Which chart do you mean?' : 'You asked me to leave out the chart you clicked. Which chart do you mean?', choices: others.map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
      }
    }
    return null
  }
  {
    // a chart-backed change aimed at a tab that isn't open would land on the open one: said, and nothing runs
    const shut = closedTabNamed(text, host)
    if (shut && (ops || []).some(o => { const cap = getCapability(o?.action); const kind = cap ? getTargetKind(cap.target) : null; return !!kind && !cap.query && !!chartRefOf(kind, (kind.list(host) || []).find(x => x.ref === o.target)) })) {
      return { refuse: `The ${shut} tab isn't the open tab on that chart, so I can't change it from here. Open that tab, then ask again.` }
    }
  }
  {
    // PACKAGE 3: "put it on the other chart" — every chart-backed op aims at the other chart of two
    const charts = host?.charts?.list?.() || []
    const dests = new Set()
    for (const o of ops || []) {
      const cap = getCapability(o?.action)
      const kind = cap ? getTargetKind(cap.target) : null
      const snap = kind ? (kind.list(host) || []).find(x => x.ref === o.target) : null
      const c = snap ? chartRefOf(kind, snap) : null
      if (c) dests.add(c)
    }
    if (dests.size === 1 && otherChartMeant(text, charts, [...dests][0], ops)) return null
  }
  const aliases = new Set((ops || []).map(o => o?.args?.as).filter(a => typeof a === 'string' && a))
  const aimed = new Map()
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    if (!kind || aliases.has(o.target)) continue
    const list = kind.list(host) || []
    const snap = list.find(s => s.ref === o.target)
    if (!snap || !chartRefOf(kind, snap) || list.length < 2) continue
    const r = resolveDeictic({ host, kind, candidates: list, text, chartOp: true })
    if (r?.ask) return { ask: { ...r.ask, action: o.action } }
    if (r?.refs) {
      // a PLURAL relation: the plan stands only when its charts are exactly that set (never one of it, never the anchor)
      const planned = new Set((ops || []).map(x => { const k = getTargetKind(getCapability(x?.action)?.target); return k ? chartRefOf(k, (k.list(host) || []).find(y => y.ref === x.target)) : null }).filter(Boolean))
      const set = new Set(r.refs.map(ref => chartRefOf(kind, list.find(y => y.ref === ref))))
      if ([...set].every(c => planned.has(c)) && [...planned].every(c => set.has(c))) continue
      return { ask: { text: 'Which chart do you mean? Your words name all of these:', choices: list.filter(y => set.has(chartRefOf(kind, y))).map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    }
    // "this chart" with a chart clicked is settled: the plan goes there, no question (production 11-05: "Did you mean" the right chart).
    // ⛔ Only then: anything else in the words may be naming another chart, so a plan that disagrees is still asked about.
    const onClicked = !!r?.ref && r.ref !== o.target && chartRefOf(kind, list.find(s => s.ref === r.ref)) === selectedChart(host)
    // R2 (AUDIT): NEVER REDIRECT a plan onto the click when the words relate a chart to it (the click is a reference point there)
    // (independent of any relation reader: the anchor as the object of a preposition anywhere in the words)
    const refPoint = !!relationMatch(text) || refPointAny(String(text || ''))
    if (onClicked && !refPoint && onlyPointer(text, host?.charts?.list?.() || [])) { aimed.set(o, r.ref); continue }
    if (onClicked && refPoint) {
      const anchor = selectedChart(host)
      return { ask: { text: 'Which chart do you mean?', choices: list.filter(y => chartRefOf(kind, y) !== anchor).map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    }
    if (r?.ref && r.ref !== o.target) {
      const meant = list.find(s => s.ref === r.ref)
      // AUDIT (#988): when the words relate a chart to the click, the click is the anchor and is never offered back as a choice
      // ...and when they relate it to a NAMED chart (AUDIT probe 17 F-b), that named anchor is never offered either
      const anchor = relationMatch(text) ? selectedChart(host) : (namedAnchorRelation(text, host?.charts?.list?.() || [])?.anchor ?? null)
      const offer = list.filter(c => !anchor || chartRefOf(kind, c) !== anchor)
      // AUDIT #988 (3): the headline never names the anchor either
      const namesAnchor = !!anchor && chartRefOf(kind, meant) === anchor
      return { ask: { text: namesAnchor ? 'Which chart do you mean?' : `Did you mean ${meant?.label || 'the selected chart'}?`, choices: offer.map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    }
  }
  return aimed.size ? { aim: ops.map(o => (aimed.has(o) ? { ...o, target: aimed.get(o) } : o)) } : null
}

/** round 3: do the sentence's clauses name DIFFERENT charts ("the TSLA chart … and this one …")? An instant reader that applies
 *  one target to the whole sentence must then not claim it: the model plans it and the per-clause gate checks each op. */
export function clausesNameDifferentCharts(text, host) {
  const reads = clauseReads(text, host, () => null)
  if (!reads) return false
  const named = new Set(reads.map(r => r.chart).filter(Boolean))
  return named.size > 1 || (named.size >= 1 && reads.some(r => !r.chart && (CLAUSE_POINTER.test(r.part) || chartsNamedBy(r.part, host?.charts?.list?.() || [], selectedChart(host)).size)))
}
