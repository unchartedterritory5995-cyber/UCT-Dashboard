// WIDGET REGISTRY — the single source of truth for workspace widget metadata.
//
// Before this file, adding a widget type meant FOUR coordinated edits across
// parallel tables (WIDGET_DEFAULTS / WIDGET_TYPES / WIDGET_LABELS in
// ChartsWorkspace.jsx, the WidgetBody switch + TYPE_LABEL in WidgetHost.jsx,
// WIDGET_TAB_* in widgetTabs.js) plus two more copies nobody remembered
// (WidgetHost's themeFollow array, MobileWorkspace's own label map). Those
// sites now DERIVE from this registry; the characterization pins live in
// ./registry.test.js.
//
// This module is deliberately METADATA-ONLY — no component imports, no host
// imports, no CSS — so any surface (the /charts workspace, the journal
// notebook, a mobile shell) can read it without pulling widget code into its
// bundle. Hosts bind ids to components themselves: the /charts binding map is
// WORKSPACE_WIDGETS in pages/charts/WidgetHost.jsx (its shape is pinned by the
// same test file so an id added here without a binding fails loudly).
//
// Adding a widget type = one entry here + one binding line in the host(s).
//
// Field notes:
// - labels.header  — widget frame header + mobile tab strip wording
// - labels.menu    — "+ Add Widget" menu AND the add-as-tab menu wording
//                    (the two menus have always shared wording; if they ever
//                    need to diverge, add a labels.tabMenu and derive both)
// - labels.tab     — the compact tab CHIP (optionsflow shortens to 'Flow')
// - defaults       — react-grid-layout units, 24-col grid. themes minW is 2 so
//                    the widget can still go narrow, but the reachable middle
//                    size (3 units = 1.5 old cols) is the "in between" the
//                    too-thin and the good size.
// - menus.workspace / menus.tab — membership in the two add menus.
//                    'periodsort' is intentionally in NEITHER: it's reachable
//                    only from Tools → Custom-Period Sort (dock / add-as-tab).
//                    It stays registered so docked instances render.
// - menus.mobile   — membership in MobileWorkspace's add menu (the 5 types
//                    that are usable at 375px).
// - themeFollow    — when uncustomized, the widget chrome re-flips to the app
//                    theme's light tokens (every type except chart, whose
//                    canvas always comes from its own settings blob).

export const WIDGET_REGISTRY = Object.freeze({
  chart: {
    id: 'chart',
    labels: { header: 'Chart', menu: 'Chart', tab: 'Chart' },
    defaults: { w: 12, h: 12, minW: 6, minH: 6 },
    menus: { workspace: true, tab: true, mobile: true },
    themeFollow: false,
  },
  watchlist: {
    id: 'watchlist',
    labels: { header: 'Watchlist', menu: 'Watchlist', tab: 'Watchlist' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    menus: { workspace: true, tab: true, mobile: true },
    themeFollow: true,
  },
  themes: {
    id: 'themes',
    labels: { header: 'Themes', menu: 'Theme Tracker', tab: 'Themes' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    menus: { workspace: true, tab: true, mobile: true },
    themeFollow: true,
  },
  scanner: {
    id: 'scanner',
    labels: { header: 'Scanner', menu: 'Scanner', tab: 'Scanner' },
    defaults: { w: 8, h: 10, minW: 6, minH: 4 },
    menus: { workspace: true, tab: true, mobile: true },
    themeFollow: true,
  },
  fundamentals: {
    id: 'fundamentals',
    labels: { header: 'Fundamentals', menu: 'Fundamentals', tab: 'Fundamentals' },
    defaults: { w: 8, h: 6, minW: 6, minH: 2 },
    menus: { workspace: true, tab: true, mobile: true },
    themeFollow: true,
  },
  breadth: {
    id: 'breadth',
    labels: { header: 'Breadth', menu: 'Breadth', tab: 'Breadth' },
    defaults: { w: 8, h: 10, minW: 4, minH: 4 },
    menus: { workspace: true, tab: true, mobile: false },
    themeFollow: true,
  },
  aisearch: {
    id: 'aisearch',
    labels: { header: 'AI Search', menu: 'AI Search', tab: 'AI Search' },
    defaults: { w: 7, h: 10, minW: 3, minH: 3 },
    menus: { workspace: true, tab: true, mobile: false },
    themeFollow: true,
  },
  news: {
    id: 'news',
    labels: { header: 'News', menu: 'News & Catalysts', tab: 'News' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    menus: { workspace: true, tab: true, mobile: false },
    themeFollow: true,
  },
  profile: {
    id: 'profile',
    labels: { header: 'Profile', menu: 'Stock Profile', tab: 'Profile' },
    defaults: { w: 6, h: 12, minW: 3, minH: 5 },
    menus: { workspace: true, tab: true, mobile: false },
    themeFollow: true,
  },
  alerts: {
    id: 'alerts',
    labels: { header: 'Alerts', menu: 'Alerts', tab: 'Alerts' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    menus: { workspace: true, tab: true, mobile: false },
    themeFollow: true,
  },
  calendar: {
    id: 'calendar',
    labels: { header: 'Calendar', menu: 'Calendar', tab: 'Calendar' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    menus: { workspace: true, tab: true, mobile: false },
    themeFollow: true,
  },
  optionsflow: {
    id: 'optionsflow',
    labels: { header: 'Options Flow', menu: 'Options Flow', tab: 'Flow' },
    defaults: { w: 8, h: 12, minW: 4, minH: 5 },
    menus: { workspace: true, tab: true, mobile: false },
    themeFollow: true,
  },
  periodsort: {
    id: 'periodsort',
    // ~fits Flag·Symbol·%·Industry with no blank filler
    labels: { header: 'Period Sort', menu: 'Period Sort', tab: 'Period Sort' },
    defaults: { w: 6, h: 12, minW: 3, minH: 5 },
    menus: { workspace: false, tab: false, mobile: false },
    themeFollow: true,
  },
})

// Registry ids in declaration order — this order IS the menu order.
export const WIDGET_IDS = Object.keys(WIDGET_REGISTRY)

// Derived membership views (computed once; the registry is frozen).
export const WORKSPACE_MENU_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].menus.workspace)
export const TAB_MENU_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].menus.tab)
export const MOBILE_MENU_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].menus.mobile)
export const THEME_FOLLOW_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].themeFollow)

/** Full id→label map for one label kind ('header' | 'menu' | 'tab').
 *  Falls back to the header label so a kind never returns undefined. */
export function labelMap(kind) {
  return Object.fromEntries(
    WIDGET_IDS.map(id => [id, WIDGET_REGISTRY[id].labels[kind] ?? WIDGET_REGISTRY[id].labels.header]),
  )
}

/** Metadata for one widget id, or null for an unknown/removed type. */
export function widgetMeta(id) {
  return WIDGET_REGISTRY[id] || null
}
