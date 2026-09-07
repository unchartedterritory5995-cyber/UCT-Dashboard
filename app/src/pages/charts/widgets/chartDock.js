/**
 * Pure helpers + constants for the Chart Detail Dock — a Company Intelligence
 * panel that docks into the chart. Kept out of ChartDetailDock.jsx so that file
 * only exports React components (react-refresh requirement).
 *
 * The RIGHT dock is one panel with a tab bar (Overview · Financials · Earnings ·
 * Valuation · News). The BOTTOM dock is the thin quarterly-earnings glance strip.
 */

// Company-panel tabs (the right dock's tab bar).
// Ownership REPLACED Valuation (2026-09-07). Valuation's metrics were the
// weakest tab in the set and every one of them already appears in Overview's
// Valuation group; ownership and positioning had no home at all.
export const COMPANY_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'financials', label: 'Financials' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'news', label: 'News' },
]
const TAB_KEYS = COMPANY_TABS.map(t => t.key)

// What the TF-bar "Panels" popover toggles.
export const DOCK_PANELS = [
  { key: 'company', label: 'Company Panel', icon: 'info', side: 'right' },
  { key: 'fundamentals', label: 'Fundamentals Strip', icon: 'scale', side: 'bottom' },
]

export const DEFAULT_RIGHT_W = 360
export const DEFAULT_BOTTOM_H = 116
export const TALL_BOTTOM_H = 300
export const MIN_RIGHT_W = 300
export const MIN_BOTTOM_H = 96

// Coerce whatever is in opts.dock into a known shape. Back-compat: the previous
// model stored `right: 'profile'|'news'|null`; map it onto the new open/tab pair.
export function normalizeDock(raw) {
  const d = raw && typeof raw === 'object' ? raw : {}
  let open = !!d.open
  // Anyone whose panel was left on Valuation lands on the tab that replaced it,
  // not silently back at Overview.
  const wanted = d.tab === 'valuation' ? 'ownership' : d.tab
  let tab = TAB_KEYS.includes(wanted) ? wanted : 'overview'
  if (d.open === undefined && (d.right === 'profile' || d.right === 'news')) {
    open = true
    tab = d.right === 'news' ? 'news' : 'overview'
  }
  const fundView = ['quarterly', 'annual', 'analyst', 'ownership'].includes(d.fundView) ? d.fundView : 'quarterly'
  const newsFilter = ['all', 'up', 'down'].includes(d.newsFilter) ? d.newsFilter : 'all'
  return {
    open,                                    // right (company) panel open?
    tab,                                     // active company tab
    bottom: !!d.bottom,                      // fundamentals strip open?
    rightW: Number.isFinite(d.rightW) ? d.rightW : DEFAULT_RIGHT_W,
    bottomH: Number.isFinite(d.bottomH) ? d.bottomH : DEFAULT_BOTTOM_H,
    fundView,
    newsFilter,
  }
}

export function dockIsOpen(dock, key) {
  if (key === 'fundamentals') return !!dock.bottom
  return !!dock.open   // 'company'
}

export function toggleDockPanel(dock, key) {
  if (key === 'fundamentals') return { ...dock, bottom: !dock.bottom }
  return { ...dock, open: !dock.open }
}

// The Fundamentals strip is thin for Quarterly/Annual and taller for the denser
// Analyst/Ownership panels — auto-fit height on tab change without fighting a size
// the user has deliberately dragged past the target band.
export function fundViewHeight(prevView, nextView, currentH) {
  const wasTall = prevView === 'analyst' || prevView === 'ownership'
  const willTall = nextView === 'analyst' || nextView === 'ownership'
  if (willTall && !wasTall && currentH < TALL_BOTTOM_H) return TALL_BOTTOM_H
  if (!willTall && wasTall && currentH > DEFAULT_BOTTOM_H + 60) return DEFAULT_BOTTOM_H
  return currentH
}
