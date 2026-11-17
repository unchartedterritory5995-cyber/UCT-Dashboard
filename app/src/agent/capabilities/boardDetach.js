// ── BOARD DETACH & MERGE (Charts execution family, 2026-11-15, AUDIT-approved design) ────────────────────────────────
//
// What a member does to the Charts board with the in-canvas float and the Merge toggle, through the product's OWN writers:
//
//   boardDetach.float     float one widget over the board — the widget header's ⧉ float (ChartsWorkspace handleFloatWidget).
//                         It keeps its grid slot (Dock snaps it back). Floating is this tab's state: a reload docks it.
//   boardDetach.dock      dock a floating widget (or every floating one) back into its slot — the floating panel's Dock
//                         (handleDockFloatWidget). Undo floats it again; the panel's dragged position is not restored.
//   boardDetach.intoTabs  move a widget into another widget's tab strip — the floating panel's "Move into tabs of …"
//                         (handleFloatWidgetToTab → widgetTabs.moveIntoTabs, the SAME transform here). A board change that
//                         empties a slot: always a card; exact Undo puts the widget back whole. ⛔ A source with its OWN
//                         tabs is refused: moveIntoTabs carries only its base definition, so they would be lost.
//   boardDetach.setMerged the merged board view (no gaps, touching borders) — the Merge widgets toggle (toggleMerged, the
//                         member pref charts_merged, so it applies on every layout). Exact Undo.
//
// State is the board kind's (capabilities/board.js): float / dock / merged are its `viewDo` writes through host.detach and
// host.prefs, read back from the workspace; intoTabs is an ordinary board change (applyBoard), read back and undone by the
// board's own machinery. Refused on the phone view and in Multi Chart, where nothing floats or merges.

import { registerCapability } from '../capabilities'
import { labelMap } from '../../widgets/registry'
import { positionWord } from '../host'
import { moveIntoTabs, sanitizeWidgetTabs } from '../../pages/charts/widgetTabs'
import { GROUPS } from '../routing'
import { FLOAT_BUTTON_ON } from '../../pages/charts/floatButton'

// ⛔ AUDIT T2 (#1304): intoTabs runs only when the member's OWN words say the into-tabs move STRUCTURALLY — a verb, the target
// widget phrase and the into … tabs relation: the SAME words its routing group selects on (routing.js boardDetach, its
// into-tabs pattern), never a second list. "move the news widget to the right" (a modify verb on the widget class, which
// the kind-matched state rail would license) never moves a widget into tabs.
export const INTO_TABS_ASKED = (() => {
  const g = GROUPS.find(x => x.id === 'boardDetach')
  const re = (g?.words || []).find(r => r instanceof RegExp && /into/.test(r.source) && /tabs/.test(r.source))
  return re || /(?!)/
})()

export const BOARD_DETACH_ACTIONS = Object.freeze(['boardDetach.float', 'boardDetach.dock', 'boardDetach.intoTabs', 'boardDetach.setMerged'])
const common = { target: 'board', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
  // the negated-ticker exclusion (spatialCheck.withoutExcludedCharts): an op whose widget arg is an excluded chart never runs
  widgetArgs: ['widget', 'into'] }
const LABEL = labelMap('agent')
const labelOf = (t) => LABEL[t] || t
const nameOf = (w, all) => { const pos = positionWord(w, all); return `${labelOf(w.type)}${pos ? ` (${pos})` : ''}` }
const widgetOf = (st, id) => (id == null ? null : st.board.find(w => String(w.id) === String(id)) || null)

export const NOT_HERE = 'Floating and merging widgets is part of the Charts board on a desktop screen — it isn’t available here.'
export const ON_PHONE = 'On the phone view widgets don’t float or merge — that’s the desktop Charts board. Nothing was changed.'
export const IN_GRID = 'In Multi Chart, widgets don’t float or merge — leave Multi Chart first, then ask again. Nothing was changed.'
// ⛔ owner 11-14: the widget header's Float button is switched off (pages/charts/floatButton.js FLOAT_BUTTON_ON — the ONE switch,
// read here, never copied). While it is off the Agent floats nothing either: an honest refusal, no write, no card. Read at call
// time, so flipping the switch on brings the float back with the button.
export const floatOn = () => FLOAT_BUTTON_ON === true
export const FLOAT_OFF = 'Floating widgets is switched off on the Charts board for now, so nothing was changed. I can dock a floating widget, move one widget into another widget’s tabs, or merge the board’s widgets instead.'
export const OWN_TABS = 'That widget has its own tabs, and moving it into another widget’s tabs would lose them. Move its tabs first, or dock it — nothing was changed.'
const notOnBoard = (id) => `There’s no widget “${id}” on this board — use an id from the board entry.`
const FLOAT_NOTE = 'floating until reload — a reload docks it'
const MERGED_SCOPE = 'on every layout'

function placeWhy(st) {
  const v = st.view
  if (!v) return NOT_HERE
  if (v.mobile) return ON_PHONE
  if (v.gridMode) return IN_GRID
  return null
}
const floating = (st) => new Set(st.view?.floating || [])
const popped = (st) => new Set(st.view?.popped || [])
const withView = (st, part) => {
  const vd = { ...(st.viewDo || {}) }
  const fl = new Set(st.view?.floating || [])
  for (const id of part.floats || []) { fl.add(id); vd.docks = (vd.docks || []).filter(x => x !== id); if (!(vd.floats || []).includes(id)) vd.floats = [...(vd.floats || []), id] }
  for (const id of part.docks || []) { fl.delete(id); vd.floats = (vd.floats || []).filter(x => x !== id); if (!(vd.docks || []).includes(id)) vd.docks = [...(vd.docks || []), id] }
  if ('merged' in part) vd.merged = part.merged
  for (const k of ['floats', 'docks']) if (vd[k] && !vd[k].length) delete vd[k]
  return { ...st, view: { ...st.view, floating: [...fl], ...('merged' in part ? { merged: part.merged } : {}) }, viewDo: Object.keys(vd).length ? vd : null }
}

// ── the member's own obvious words (no model call). Only a widget that is ON this board (by its type's name, one of it)
// is floated, only a FLOATING one is docked; "low float", "the float of NVDA", "dock the ranking" are never claimed. ──
function widgetByWords(words, board, pick = () => true) {
  const w = String(words || '').trim().toLowerCase().replace(/^(?:the|my|this|that) /, '').replace(/ (?:widget|panel)$/, '')
  if (!w) return null
  const hits = board.filter(x => pick(x) && (String(x.type).toLowerCase() === w || String(labelOf(x.type)).toLowerCase() === w))
  return hits.length === 1 ? hits[0] : null
}
function boardOf(host) {
  try { return { raw: host?.widgets?.snapshot?.()?.raw || [], view: host?.detach?.read?.() || null } } catch { return { raw: [], view: null } }
}
function fastFloat(lower, host) {
  const m = /^(?:float|detach)(?: the| my)? (.+?)(?: widget| panel)?(?: over the board| on top(?: of the board)?)?$/.exec(lower)
  if (!m) return null
  const { raw, view } = boardOf(host)
  const fl = new Set((view?.floating || []).map(String)), pp = new Set((view?.popped || []).map(String))
  const w = widgetByWords(m[1], raw, (x) => !fl.has(String(x.id)) && !pp.has(String(x.id)))
  return w ? { widget: String(w.id) } : null
}
function fastDock(lower, host) {
  const m = /^dock(?: the| my)? (.+?)(?: widget| panel)?(?: back)?(?: (?:in|on)(?:to)? the board)?$/.exec(lower)
  if (!m) return null
  const { raw, view } = boardOf(host)
  const fl = new Set((view?.floating || []).map(String))
  if (!fl.size) return null
  if (/^(?:them|everything|all|all(?: the)?(?: floating)? (?:widgets?|panels?)|(?:floating )?widgets|it)$/.test(m[1])) {
    if (m[1] === 'it') return fl.size === 1 ? { widget: [...fl][0] } : null
    return { widget: null }
  }
  const w = widgetByWords(m[1], raw, (x) => fl.has(String(x.id)))
  return w ? { widget: String(w.id) } : null
}
function fastMerged(lower) {
  let m = /^(merge|unmerge)(?: the| my)? (?:board|widgets|board'?s widgets|widgets on the board|borders)$/.exec(lower)
  if (m) return { merged: m[1] === 'merge' }
  m = /^(?:turn )?(on|off) (?:the )?merged (?:view|board)$/.exec(lower) || /^(?:the )?merged (?:view|board) (on|off)$/.exec(lower)
  return m ? { merged: m[1] === 'on' } : null
}

let registered = false
export function registerBoardDetachCapabilities() {
  if (registered) return
  registered = true

  registerCapability({
    ...common,
    name: 'boardDetach.float',
    summary: 'Float ONE widget over the board, as its header\'s float button does (it keeps its slot). Floating until reload. Undo docks it.',
    hints: 'target = the board entry; widget = its id. Not a pop-out window. Dock = boardDetach.dock.',
    args: { type: 'object', properties: { widget: { type: 'string' } }, required: ['widget'], additionalProperties: false },
    fast: ({ lower, host }) => fastFloat(lower, host),
    check(st, { widget } = {}) {
      if (!floatOn()) return FLOAT_OFF
      const why = placeWhy(st)
      if (why) return why
      const w = widgetOf(st, widget)
      if (!w) return notOnBoard(widget)
      if (popped(st).has(String(w.id))) return 'That widget is popped out into its own window — close or dock that window first.'
      return null
    },
    apply(st, { widget } = {}) {
      const w = widgetOf(st, widget)
      if (!w || floating(st).has(String(w.id))) return st
      return withView(st, { floats: [String(w.id)] })
    },
    describe(b, a) {
      const ids = (a.viewDo?.floats || []).filter(id => !floating(b).has(id))
      if (!ids.length) return null
      const names = ids.map(id => `the ${nameOf(widgetOf(b, id), b.board)}`).join(' and ')
      return `Floated ${names} over the board (${FLOAT_NOTE}; its spot on the board is kept, so Dock puts it back)`
    },
    noop: (st, _a, { widget } = {}) => { const w = widgetOf(st, widget); return `The ${w ? nameOf(w, st.board) : 'widget'} is already floating` },
  })

  registerCapability({
    ...common,
    name: 'boardDetach.dock',
    summary: 'Dock a floating widget back into its spot on the board (widget null = every floating one), as the floating panel\'s Dock does. Undo floats it again.',
    hints: 'target = the board entry; widget = the id of a floating widget, or null for all of them.',
    args: { type: 'object', properties: { widget: { type: ['string', 'null'] } }, required: ['widget'], additionalProperties: false },
    fast: ({ lower, host }) => fastDock(lower, host),
    check(st, { widget } = {}) {
      const why = placeWhy(st)
      if (why) return why
      if (widget != null && !widgetOf(st, widget)) return notOnBoard(widget)
      return null
    },
    apply(st, { widget } = {}) {
      const fl = floating(st)
      const ids = widget == null ? [...fl] : (fl.has(String(widget)) ? [String(widget)] : [])
      return ids.length ? withView(st, { docks: ids }) : st
    },
    describe(b, a) {
      const ids = (a.viewDo?.docks || []).filter(id => floating(b).has(id))
      if (!ids.length) return null
      const names = ids.map(id => `the ${nameOf(widgetOf(b, id), b.board)}`).join(' and ')
      return `Docked ${names} back into ${ids.length > 1 ? 'their spots' : 'its spot'} on the board (Undo floats ${ids.length > 1 ? 'them' : 'it'} again — the panel's dragged position isn't restored)`
    },
    noop: (st, _a, { widget } = {}) => {
      if (widget == null) return 'No widget is floating — everything is already on the board'
      const w = widgetOf(st, widget)
      return `The ${w ? nameOf(w, st.board) : 'widget'} is already on the board`
    },
  })

  registerCapability({
    ...common,
    name: 'boardDetach.intoTabs',
    risk: 'confirm',
    // useAgent's askedBy gate (as setMerged's): dropped unless the member's words name the into-tabs move
    askedBy: INTO_TABS_ASKED,
    askedByWhy: 'a widget moves into another widget’s tabs only when you ask for exactly that (“move the news widget into the chart’s tabs”).',
    summary: 'Move ONE widget into another widget\'s tabs (it leaves its spot on the board, which stays empty), as the floating panel\'s "Move into tabs" does. Shown first; Undo puts it back exactly.',
    hints: 'target = the board entry; widget = the id of the widget that moves; into = the id of the widget whose tabs it joins. Adding a NEW tab = widget.addTab.',
    args: { type: 'object', properties: { widget: { type: 'string' }, into: { type: 'string' } }, required: ['widget', 'into'], additionalProperties: false },
    check(st, { widget, into } = {}) {
      const why = placeWhy(st)
      if (why) return why
      const w = widgetOf(st, widget), t = widgetOf(st, into)
      if (!w) return notOnBoard(widget)
      if (!t) return notOnBoard(into)
      if (String(w.id) === String(t.id)) return 'A widget can’t move into its own tabs. Which widget should it join?'
      const pp = popped(st)
      if (pp.has(String(w.id))) return 'That widget is popped out into its own window — close or dock that window first.'
      if (pp.has(String(t.id)) || floating(st).has(String(t.id))) return `The ${nameOf(t, st.board)} is floating or popped out — dock it first, then I can move a widget into its tabs.`
      if (sanitizeWidgetTabs(w).tabs.length) return OWN_TABS
      return null
    },
    apply(st, { widget, into } = {}) {
      const w = widgetOf(st, widget), t = widgetOf(st, into)
      if (!w || !t) return st
      // a tab id the card and its approval both plan (the product's own is random); moveIntoTabs falls back if it is taken
      const board = moveIntoTabs(st.board, w.id, t.id, { tabId: `wtm${String(w.id).replace(/[^A-Za-z0-9]/g, '')}` })
      if (board === st.board) return st
      // a floating source is docked first, exactly as the handler clears its float flag
      const s2 = floating(st).has(String(w.id)) ? withView(st, { docks: [String(w.id)] }) : st
      return { ...s2, board, did: [...(st.did || []), ['intoTabs', nameOf(w, st.board), nameOf(t, st.board)]] }
    },
    describe(b, a) {
      const d = (a.did || []).filter(x => x[0] === 'intoTabs').at(-1)
      return d ? `Moved the ${d[1]} into the ${d[2]}’s tabs — its spot on the board is now empty` : null
    },
  })

  registerCapability({
    ...common,
    name: 'boardDetach.setMerged',
    summary: 'Turn the merged board view on or off (no gaps, widget borders touching), as the Merge widgets toggle does — on every layout. Undo puts it back.',
    hints: 'target = the board entry; merged = true to merge, false to unmerge. Only when they ask to merge / unmerge the board or its widgets.',
    args: { type: 'object', properties: { merged: { type: 'boolean' } }, required: ['merged'], additionalProperties: false },
    // ⛔ AUDIT (D21): never planned from additive words alone ("add a news widget") — useAgent drops it unless the member's own
    // words say merge / unmerge / merged / the gaps between widgets
    askedBy: /\b(?:un)?merg(?:e|ed|ing)\b|\bgaps?\b.*\b(?:widgets?|board)\b|\b(?:widgets?|board)\b.*\bgaps?\b/,
    fast: ({ lower }) => fastMerged(lower),
    check(st, { merged } = {}) {
      const why = placeWhy(st)
      if (why) return why
      return typeof merged === 'boolean' ? null : 'Merge the board’s widgets, or unmerge them?'
    },
    apply(st, { merged } = {}) {
      if (typeof merged !== 'boolean' || st.view?.merged === merged) return st
      return withView(st, { merged })
    },
    describe(b, a) {
      if (!a.viewDo || !('merged' in a.viewDo) || b.view?.merged === a.viewDo.merged) return null
      return a.viewDo.merged
        ? `Merged the board’s widgets (no gaps between them) — ${MERGED_SCOPE}`
        : `Unmerged the board’s widgets (gaps between them again) — ${MERGED_SCOPE}`
    },
    noop: (st) => (st.view?.merged ? 'The board’s widgets are already merged' : 'The board’s widgets are already unmerged'),
  })
}
