// Pure reducer + helpers for WIDGET-LEVEL tabs.
//
// A single workspace slot can hold multiple widgets of DIFFERENT types as tabs,
// so you can flip between (say) Stock Profile and News & Catalysts inside ONE
// slot instead of adding two separate widgets. This parallels the Chart widget's
// own internal chart-profile tabs (see ./chartTabs.js), but one level up — here a
// tab IS a whole widget (type + color group + its own opts blob).
//
// Tab 0 is the slot's BASE widget: it keeps using widget.type/color/opts exactly
// like a tab-less widget always has, so every existing layout, template, and
// popout is byte-unchanged. EXTRA tabs live in widget.wtabs; widget.activeWtab
// points into the list [base, ...wtabs] (0 = base, 1..N = wtabs[i-1]).
//
// All functions are PURE — they return a NEW widget object, never mutate.

// Types offerable as a tab + their labels. The short label rides the compact tab
// chip in the header; the menu label matches the "+ Add Widget" menu wording.
export const WIDGET_TAB_TYPES = ['chart', 'watchlist', 'themes', 'scanner', 'fundamentals', 'breadth', 'aisearch', 'news', 'profile']
export const WIDGET_TAB_LABEL = {
  chart: 'Chart', watchlist: 'Watchlist', themes: 'Themes', scanner: 'Scanner',
  fundamentals: 'Fundamentals', breadth: 'Breadth', aisearch: 'AI Search',
  news: 'News', profile: 'Profile',
}
export const WIDGET_TAB_MENU_LABEL = {
  chart: 'Chart', watchlist: 'Watchlist', themes: 'Theme Tracker', scanner: 'Scanner',
  fundamentals: 'Fundamentals', breadth: 'Breadth', aisearch: 'AI Search',
  news: 'News & Catalysts', profile: 'Stock Profile',
}

// Short random id (app code — Math.random is fine here; only workflow scripts ban it).
function _newTabId() {
  return `wt${Math.random().toString(36).slice(2, 9)}`
}

// Normalize possibly-legacy/partial widget tab state into a predictable shape.
export function sanitizeWidgetTabs(widget) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const tabs = Array.isArray(w.wtabs)
    ? w.wtabs.filter(t => t && typeof t === 'object' && t.id && t.type)
    : []
  let active = Number.isInteger(w.activeWtab) ? w.activeWtab : 0
  if (active < 0 || active > tabs.length) active = 0
  return { tabs, active }
}

// The label a tab shows: a user's custom name wins; otherwise an auto label that,
// for a watchlist tab, is the SELECTED list's name (so it reads "Flagged" / "AI
// Leaders" instead of a generic "Watchlist"). Falls back to the widget-type label.
export function tabLabel(type, opts, customName) {
  if (customName && String(customName).trim()) return String(customName).trim()
  if (type === 'watchlist') {
    if (opts?.watchKey === 'flagged') return 'Flagged'   // the flagged shadow list
    const n = opts?.watchName && String(opts.watchName).trim()
    if (n) return n
  }
  return WIDGET_TAB_LABEL[type] || type
}

// The UI tab list: the base tab first, then every extra tab.
// Each entry = { id, isMain, type, label }.
export function widgetTabList(widget) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const { tabs } = sanitizeWidgetTabs(widget)
  const main = { id: '__main__', isMain: true, type: w.type, label: tabLabel(w.type, w.opts, w.mainTabName) }
  const extras = tabs.map(t => ({ id: t.id, isMain: false, type: t.type, label: tabLabel(t.type, t.opts, t.name) }))
  return [main, ...extras]
}

// Rename a tab. tabId '__main__' names the base tab (stored on widget.mainTabName);
// an empty/blank name clears back to the auto label. Names are capped at 24 chars.
export function renameWidgetTab(widget, tabId, name) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const clean = name && String(name).trim() ? String(name).trim().slice(0, 24) : null
  if (tabId === '__main__') {
    const next = { ...w }
    if (clean) next.mainTabName = clean
    else delete next.mainTabName
    return next
  }
  const { tabs } = sanitizeWidgetTabs(widget)
  return { ...w, wtabs: tabs.map(t => (t.id === tabId ? { ...t, name: clean } : t)) }
}

// The type/color/opts of the currently-active tab — what the slot actually renders.
// `tabId` is '__main__' for the base tab, else the extra tab's id.
export function resolveActiveTab(widget) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const { tabs, active } = sanitizeWidgetTabs(widget)
  if (active === 0) return { isMain: true, tabId: '__main__', index: 0, type: w.type, color: w.color, opts: w.opts || {} }
  const t = tabs[active - 1]
  return { isMain: false, tabId: t.id, index: active, type: t.type, color: t.color, opts: t.opts || {} }
}

// Add a new EXTRA tab and make it active. `color` defaults to the base color so a
// new tab starts on the same symbol you're already viewing.
export function addWidgetTab(widget, { type, color = 'A' } = {}) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const { tabs } = sanitizeWidgetTabs(widget)
  const tab = { id: _newTabId(), type, color, opts: {} }
  const next = [...tabs, tab]
  return { ...w, wtabs: next, activeWtab: next.length } // active = the new last tab
}

// Close an extra tab by id. Never closes the base tab. Keeps the active pointer on
// a sensible neighbor; cleans wtabs/activeWtab off entirely when none remain so the
// slot is byte-identical to a tab-less widget again.
export function closeWidgetTab(widget, tabId) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const { tabs, active } = sanitizeWidgetTabs(widget)
  const idx = tabs.findIndex(t => t.id === tabId)
  if (idx < 0) return w
  const next = tabs.filter(t => t.id !== tabId)
  const closedPos = idx + 1
  let nextActive = active
  if (active === closedPos) nextActive = closedPos - 1
  else if (active > closedPos) nextActive = active - 1
  if (nextActive > next.length) nextActive = next.length
  if (nextActive < 0) nextActive = 0
  const out = { ...w, wtabs: next, activeWtab: nextActive }
  if (!next.length) { delete out.wtabs; delete out.activeWtab }
  return out
}

// Select a tab by UI index (0 = base).
export function setActiveWidgetTab(widget, index) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const { tabs } = sanitizeWidgetTabs(widget)
  let idx = Number.isInteger(index) ? index : 0
  if (idx < 0) idx = 0
  if (idx > tabs.length) idx = tabs.length
  return { ...w, activeWtab: idx }
}

// Patch the COLOR group of the active tab (base → widget.color; extra → its own).
export function patchActiveTabColor(widget, color) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const { tabs, active } = sanitizeWidgetTabs(widget)
  if (active === 0) return { ...w, color }
  return { ...w, wtabs: tabs.map((t, i) => (i === active - 1 ? { ...t, color } : t)) }
}

// Patch the OPTS blob of the active tab (base → widget.opts; extra → its own).
export function patchActiveTabOpts(widget, opts) {
  const w = widget && typeof widget === 'object' ? widget : {}
  const { tabs, active } = sanitizeWidgetTabs(widget)
  if (active === 0) return { ...w, opts }
  return { ...w, wtabs: tabs.map((t, i) => (i === active - 1 ? { ...t, opts } : t)) }
}
