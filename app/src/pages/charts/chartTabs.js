// Pure reducer + helpers for a Chart widget's multi-tab state.
//
// A single Chart widget can hold multiple INDEPENDENT chart profiles as tabs
// (TC2000-style "MU-D | MU-30m | MU-5m"). The MAIN tab (index 0) keeps using
// the user's global chart_settings exactly like a tab-less widget always has —
// so nothing changes for existing layouts and the dashboard/popups still follow
// the main chart. EXTRA tabs each carry their OWN full settings blob, timeframe,
// color-group link, and name, fully isolated: editing one tab never touches
// another or the global settings.
//
// State lives in the widget's persisted `opts`:
//   opts.chartTabs      — Array<{id,name,tf,color,settings}>  (EXTRA tabs only)
//   opts.activeChartTab — 0 = main, 1..N = chartTabs[i-1]
//   opts.mainTabName    — optional custom label for the main tab
//
// Absent/empty chartTabs = today's single-chart widget (no tab strip renders).
// All functions are PURE — they return a new opts object, never mutate.

import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { tfLabel } from '../../components/chart/timeframes'

// The look a brand-new tab loads with = "UCT Default" (the workspace's default
// chart look is CHART_DEFAULTS + the ChartWidget StockChart props; the settings
// half is exactly mergeChartSettings(null)). Cloned per call so no two tabs
// share a mutable object.
export function uctDefaultTabSettings() {
  return mergeChartSettings(null)
}

// Short random id (app code — Math.random is fine here; only workflow scripts ban it).
function _newTabId() {
  return `ct${Math.random().toString(36).slice(2, 9)}`
}

// Normalize possibly-legacy/partial opts into a predictable shape. Never throws.
export function sanitizeChartTabs(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const tabs = Array.isArray(o.chartTabs)
    ? o.chartTabs.filter(t => t && typeof t === 'object' && t.id)
    : []
  // activeChartTab is an index into [main, ...tabs]; clamp defensively so a stale
  // pointer (e.g. after a tab was closed in another session) can't select nothing.
  let active = Number.isInteger(o.activeChartTab) ? o.activeChartTab : 0
  if (active < 0 || active > tabs.length) active = 0
  return { tabs, active }
}

// The UI tab list: the main tab first, then every extra tab. Each entry is
// { id, isMain, label, tf }. label = custom name ?? the timeframe label.
export function chartTabList(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const { tabs } = sanitizeChartTabs(opts)
  const mainTf = o.tf || 'D'
  const main = {
    id: '__main__',
    isMain: true,
    label: (o.mainTabName && String(o.mainTabName).trim()) || tfLabel(mainTf),
    tf: mainTf,
  }
  const extras = tabs.map(t => ({
    id: t.id,
    isMain: false,
    label: (t.name && String(t.name).trim()) || tfLabel(t.tf || 'D'),
    tf: t.tf || 'D',
  }))
  return [main, ...extras]
}

// Add a new EXTRA tab (loads as UCT Default) and make it active. `color` is the
// color group it links to (defaults to the widget's current color so it starts
// on the same symbol the user is already viewing); `tf` defaults to Daily.
export function addChartTab(opts, { color = 'A', tf = 'D' } = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const { tabs } = sanitizeChartTabs(opts)
  const tab = { id: _newTabId(), name: null, tf, color, settings: uctDefaultTabSettings() }
  const nextTabs = [...tabs, tab]
  return { ...o, chartTabs: nextTabs, activeChartTab: nextTabs.length } // active = new last tab
}

// Close an extra tab by id. Never closes the main tab. Keeps the active pointer
// on a sensible neighbor (the tab before the closed one, clamped).
export function closeChartTab(opts, tabId) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const { tabs, active } = sanitizeChartTabs(opts)
  const idx = tabs.findIndex(t => t.id === tabId)
  if (idx < 0) return o
  const nextTabs = tabs.filter(t => t.id !== tabId)
  // The closed tab occupied UI position idx+1 (main is 0). If it was active or
  // before the active one, shift the pointer back one; then clamp.
  let nextActive = active
  const closedUiPos = idx + 1
  if (active === closedUiPos) nextActive = closedUiPos - 1
  else if (active > closedUiPos) nextActive = active - 1
  if (nextActive > nextTabs.length) nextActive = nextTabs.length
  if (nextActive < 0) nextActive = 0
  const next = { ...o, chartTabs: nextTabs, activeChartTab: nextActive }
  if (!nextTabs.length) delete next.chartTabs // clean back to a bare single-chart widget
  return next
}

// Select a tab by UI index (0 = main).
export function setActiveChartTab(opts, index) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const { tabs } = sanitizeChartTabs(opts)
  let idx = Number.isInteger(index) ? index : 0
  if (idx < 0) idx = 0
  if (idx > tabs.length) idx = tabs.length
  return { ...o, activeChartTab: idx }
}

// Rename a tab. tabId '__main__' renames the main tab (stored on opts.mainTabName);
// an empty/blank name clears back to the auto timeframe label.
export function renameChartTab(opts, tabId, name) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const clean = name && String(name).trim() ? String(name).trim().slice(0, 24) : null
  if (tabId === '__main__') {
    const next = { ...o }
    if (clean) next.mainTabName = clean
    else delete next.mainTabName
    return next
  }
  const { tabs } = sanitizeChartTabs(opts)
  return { ...o, chartTabs: tabs.map(t => (t.id === tabId ? { ...t, name: clean } : t)) }
}

// Patch a single extra tab (settings / tf / color). No-op for unknown ids.
export function patchChartTab(opts, tabId, patch) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const { tabs } = sanitizeChartTabs(opts)
  return { ...o, chartTabs: tabs.map(t => (t.id === tabId ? { ...t, ...patch } : t)) }
}
