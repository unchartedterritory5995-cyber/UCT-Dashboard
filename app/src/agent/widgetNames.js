// ── The names a person calls a widget ON THIS BOARD by, for routing and for the widgetControls section ──
// Execution family W (pl-exec): a request that names a widget on the board ("the theme tracker", "the options flow", "the
// market map") is about that widget, so its one-control action (widget.setOption, routing group boardEdit) is in front of the
// model on the FIRST call, with that widget's controls — not only after a need_groups reroute. The names are the registry's
// own labels (header, Widgets menu, tab), so there is no phrase list here. A label that is a chart-surface word ("Volume", the
// Volume Surge tab) is not a widget's name: those words already mean the chart. Pure: the caller passes the board's types.
import { WIDGET_REGISTRY } from '../widgets/registry'
import { widgetControls } from '../widgets/widgetControls'

export const normName = (s) => ` ${String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
// ── Names are compared as WORDS, never as strings: punctuation is a space, a connector (and, or, of, the, vs…) is no word, a plural
// is its singular. A label's words must all appear in the message in order, at most one other word between two of them — so
// "New Highs / Lows" is "new highs lows", "new highs and new lows", "new-highs/new-lows"; "Indexes" is "index levels". ──
const CONNECTORS = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'vs', 'versus', 'n', 'amp'])
const stem = (w) => (/(?:x|s|z|ch|sh)es$/.test(w) && w.length > 4 ? w.slice(0, -2) : /s$/.test(w) && !/ss$/.test(w) && w.length > 4 ? w.slice(0, -1) : w)
export const nameWords = (s) => normName(s).trim().split(' ').filter(w => w && !CONNECTORS.has(w)).map(stem)
const GAP = 1
function saysName(words, name) {
  if (!name.length) return false
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== name[0]) continue
    let at = i, ok = true
    for (let k = 1; k < name.length && ok; k++) {
      let hit = -1
      for (let j = at + 1; j <= Math.min(words.length - 1, at + 1 + GAP); j++) if (words[j] === name[k]) { hit = j; break }
      if (hit < 0) ok = false; else at = hit
    }
    if (ok) return true
  }
  return false
}
const MEMO = new Map()
/** A type's names (each a word list): its labels, less a one-word label that names the chart surface (`surfaceWord`). */
export function widgetNamesOf(type, surfaceWord = () => false) {
  if (MEMO.has(type)) return MEMO.get(type)
  const labels = Object.values(WIDGET_REGISTRY[type]?.labels || {})
  const seen = new Set()
  const names = labels.map(nameWords).filter(n => n.length && !(n.length === 1 && (n[0].length < 3 || surfaceWord(n[0]) || surfaceWord(`${n[0]}s`))))
    .filter(n => { const k = n.join(' '); if (seen.has(k)) return false; seen.add(k); return true })
  MEMO.set(type, names)
  return names
}
/** The types on the board, with controls, that the message names. */
export function namedWidgetTypes(message, types, surfaceWord) {
  const words = nameWords(message)
  return [...new Set(types)].filter(t => widgetControls(t).length && widgetNamesOf(t, surfaceWord).some(n => saysName(words, n)))
}
