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

// 400, not 360. The header is `[Overview Financials Earnings Ownership News]
// [search]`, and .rdTabs is `overflow-x: auto` -- so when the five labels plus
// the 26px search button do not fit, the strip does NOT push back, it silently
// SCROLLS and the last tab ("News") slides under the search control. At 360 the
// strip needs ~375px, so News was clipped mid-word in the default position.
// MEASURED, not estimated -- canvas measureText at 600 11px "Instrument Sans"
// (the app's real stack) on 2026-09-08: labels 235.3px + 90px tab padding
// (5 x 18) + 44px search chrome (26 box + 2 border + 12 gap + 4 margin) + 4px
// header padding = 374px. Re-measure if a label, the font or .rdTab padding
// changes; the chartDock.width test fails if the default drops under it.
// 380 = the measured 374 the header needs + 6px, which lands the search
// control ~12px off the right edge: the same optical margin as the tab strip's
// left inset. 400 fit fine but left a visible dead gap after the search button
// once the strip stopped growing.
export const DEFAULT_RIGHT_W = 380
// The width the header chrome above needs before the tab strip starts scrolling.
// Not a hard floor -- MIN_RIGHT_W stays at 300 so a user who deliberately drags
// the panel narrow still can (the feed is designed down to 300); it exists so
// the stale-default migration below knows what "too narrow" means.
export const TABSTRIP_FIT_W = 374
// Every width we have ever SHIPPED as the default. None was user-chosen, so
// none should outlive the default moving -- see normalizeDock.
const LEGACY_DEFAULT_RIGHT_W = new Set([360, 400])
export const DEFAULT_BOTTOM_H = 116
export const TALL_BOTTOM_H = 300
export const MIN_RIGHT_W = 300
export const MIN_BOTTOM_H = 96

// Earnings strip. The DEFAULT is the height the content settles at on its own —
// three lines plus leading — so an untouched strip looks designed rather than
// arbitrary. The floor is where those lines start colliding instead of
// shrinking; the ceiling keeps the price pane the primary visual no matter how
// far the divider is dragged.
// Re-measured after the figures were promoted to 12px: padding 9 + header 14
// + gap 4 + two 19.4px rows + padding 10 = ~76, i.e. the old default fitted
// with ZERO slack, which reads as cramped even when nothing clips.
export const DEFAULT_STRIP_H = 84
export const MIN_STRIP_H = 70
export const MAX_STRIP_FRAC = 0.45      // of the chart column's height

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
  const newsFilter = ['all', 'bullish', 'bearish'].includes(d.newsFilter) ? d.newsFilter : 'all'
  // The earnings strip rides in the SAME persisted blob as the panel's own
  // open/tab/width, so it survives a ticker change and a refresh without a
  // second preference system for one boolean.
  const strip = !!d.strip
  const stripH = Number.isFinite(d.stripH) ? Math.max(MIN_STRIP_H, d.stripH) : DEFAULT_STRIP_H
  return {
    open,                                    // right (company) panel open?
    tab,                                     // active company tab
    bottom: !!d.bottom,                      // fundamentals strip open?
    // A user who never dragged the panel is still carrying a SHIPPED default in
    // their persisted opts, and would keep that layout forever even though the
    // default moved. Treat any previously shipped default as unset. A width the
    // user actually chose (any other number) is left alone.
    rightW: (Number.isFinite(d.rightW) && !LEGACY_DEFAULT_RIGHT_W.has(d.rightW))
      ? d.rightW
      : DEFAULT_RIGHT_W,
    bottomH: Number.isFinite(d.bottomH) ? d.bottomH : DEFAULT_BOTTOM_H,
    fundView,
    newsFilter,
    strip,                                   // earnings strip under the chart
    stripH,                                  // ...and its dragged height
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
