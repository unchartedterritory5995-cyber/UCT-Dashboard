// ── The names a person calls a widget ON THIS BOARD by, for routing and for the widgetControls section ──
// Execution family W (pl-exec): a request that names a widget on the board ("the theme tracker", "the options flow", "the
// market map") is about that widget, so its one-control action (widget.setOption, routing group boardEdit) is in front of the
// model on the FIRST call, with that widget's controls — not only after a need_groups reroute. The names are the registry's
// own labels (header, Widgets menu, tab), so there is no phrase list here. A label that is a chart-surface word ("Volume", the
// Volume Surge tab) is not a widget's name: those words already mean the chart. Pure: the caller passes the board's types.
import { WIDGET_REGISTRY } from '../widgets/registry'
import { widgetControls as registryControls } from '../widgets/widgetControls'
import { COMPANY_TABS, normalizeDock } from '../pages/charts/widgets/chartDock'
import { COMPANY_INFO, setFeatureOpen } from '../pages/charts/widgets/chartFeatures'

// every control a widget offers: the registry's rows (widgets/widgetControls.js), then the Agent's own over the product's writers
export const widgetControls = (type) => [...registryControls(type), ...(AGENT_CONTROLS[type] || [])]
export const allControls = widgetControls
// ── round 5 (pl-exec, C3-216 / C3-217): a chart widget's Company Info panel, as its own controls set it — the tab strip
// (ChartDetailDock setTab) and the collapse chevron / edge rail (setFeatureOpen) — both in the chart's opts.dock. Offered only
// while the chart HAS the panel (Add to Chart owns adding it); written by the product's own dock functions. ──
const DOCK_WHY = 'This chart has no Company Info panel. Add it from the chart’s Add to Chart menu first.'
// C3-219 (round 6): the chart's View Holdings button (ViewHoldingsControl), shown only for an ETF or a UCT index ($IDX:)
const HOLDINGS_WHY = 'This chart isn’t showing an ETF or a UCT index, so it has no View Holdings button.'
// the words a search box is used with (any widget's `text` control)
const SEARCH_WORDS = ['search', 'find', 'look', 'lookup', 'query', 'clear']
export const AGENT_CONTROLS = {
  // C3-138 (round 7): the News (Trade Exchange) widget's own "Search headlines" box, through its door (its own setQueryRaw)
  tradeExchangeNews: [{ key: 'search', type: 'text', door: true, default: '', max: 80, words: SEARCH_WORDS }],
  // C3-201: open one of the member's notes in a Notebook widget, as its own rows do (opts.noteId); the choices are the widget's own
  notebook: [{ key: 'note', type: 'enum', from: 'door', path: 'noteId' }],
  // C3-065 (round 6): a Watchlist widget on the member's Flagged list, as its picker's Flagged row sets it (watchKey 'flagged')
  watchlist: [{ key: 'source', type: 'enum', options: ['flagged'], path: 'watchKey',
    write: (opts) => ({ ...(opts || {}), watchKey: 'flagged', watchName: 'Flagged', watchTab: 'mine' }) }],
  chart: [
    { key: 'companyTab', type: 'enum', options: COMPANY_TABS.map(t => t.key), default: 'overview', path: 'dock.tab',
      when: (opts) => (normalizeDock(opts?.dock).company ? null : DOCK_WHY),
      write: (opts, v) => ({ ...(opts || {}), dock: { ...normalizeDock(opts?.dock), tab: v } }) },
    { key: 'holdingsOpen', type: 'boolean', default: false, door: true,
      when: (_opts, door) => (door && 'holdingsOpen' in door ? null : HOLDINGS_WHY) },
    { key: 'companyOpen', type: 'boolean', default: false, path: 'dock.open',
      when: (opts) => (normalizeDock(opts?.dock).company ? null : DOCK_WHY),
      write: (opts, v) => ({ ...(opts || {}), dock: setFeatureOpen(normalizeDock(opts?.dock), COMPANY_INFO, v) }) },
  ],
}

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

// ── Round 2 (pl-exec): the ROUTING gate is stricter than the name. Measured on the 693 corpus phrasings with every widget on the
// board, a name alone brought boardEdit (+3,671 manifest bytes) to 19 read questions ("any news on TSLA", "how's breadth today",
// "add the relative strength index"). A widget's name routes its control action only beside a word of ITS OWN controls: a
// control's key, a choice it offers (the registry's words, less the widget's own name), or one of the words every widget's
// control panel uses (CONTROL_WORDS). Data, not phrases; the context narrowing above still reads the name alone.
const CONTROL_WORDS = ['tab', 'axis', 'filter', 'sort', 'order', 'rank', 'view', 'only', 'hide', 'unhide', 'remove', 'drop', 'switch', 'flip',
  'set', 'turn', 'expand', 'collapse', 'follow', 'logo', 'label', 'period', 'universe', 'reading', 'watch', 'scan', 'group', 'grouped',
  'ascending', 'descending', 'worst', 'best', 'week', 'weekly', 'month', 'monthly', 'year', 'ytd', 'star',
  'size', 'color', 'plot', 'restore', 'lead', 'link', 'linked',
  // its Send to Journal door (widget.sendToJournal: where = note | newNote | inbox)
  'journal', 'notebook', 'note', 'inbox', 'send']
// a control that takes a DAY is named by the words a day is said in
const DAY_WORDS = ['today', 'tomorrow', 'yesterday', 'next', 'last', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'jump', 'go']
const camel = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2')
const VOCAB = new Map()
function controlVocab(type, surfaceWord) {
  if (VOCAB.has(type)) return VOCAB.get(type)
  const own = new Set(widgetNamesOf(type, surfaceWord).flat())
  const words = new Set([...CONTROL_WORDS, ...widgetControls(type).flatMap(f => [camel(f.key), ...(f.type === 'day' ? DAY_WORDS : []), ...(f.options || []).map(o => (o && typeof o === 'object' ? `${o.value} ${o.label}` : String(o))), ...Object.values(f.labels || {}), ...Object.values(f.also || {}).flat(), ...(f.words || [])])]
    .flatMap(nameWords).filter(w => w.length >= 2 && !own.has(w)))
  VOCAB.set(type, words)
  return words
}
/** The named types whose control vocabulary the message also uses: the ones a routed control action is for. */
export function controlledWidgetTypes(message, types, surfaceWord) {
  const said = new Set(nameWords(message))
  return namedWidgetTypes(message, types, surfaceWord).filter(t => [...controlVocab(t, surfaceWord)].some(w => said.has(w)))
}

// ── Round 4 (pl-exec): a widget's own LIST of the member's items (a Theme Tracker's theme sets), the one data source for the
// item control (capabilities/board.js) and for routing: an item named by its own name ("rename my Mine theme set") is about that
// widget even when the widget is not named. ──
export const ITEM_LISTS = {
  themes: [{ key: 'themeSets', noun: 'theme set', nouns: ['set', 'preset'], ops: ['rename', 'delete'] }],
  // C3-202: the Notebook widget's notes; its New control creates a blank one and opens it
  notebook: [{ key: 'notes', noun: 'note', nouns: ['note', 'notebook', 'blank', 'new'], ops: ['create'], blank: 'Untitled note' }],
}
/** The board's widgets that the message reaches by one of their OWN item names, beside an item word (set, preset, rename, delete). */
export function itemNamedTypes(message, items) {
  const words = nameWords(message)
  const said = new Set(words)
  const out = new Set()
  for (const { type, key, names } of items || []) {
    const l = (ITEM_LISTS[type] || []).find(x => x.key === key)
    if (!l || ![...l.nouns, ...l.ops].map(stem).some(w => said.has(w))) continue
    if ((names || []).some(n => { const nw = nameWords(n); return nw.length && nw.join(' ').length >= 3 && saysName(words, nw) })) out.add(type)
  }
  return [...out]
}
