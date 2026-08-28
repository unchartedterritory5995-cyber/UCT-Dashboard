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
// ── Metadata fields ─────────────────────────────────────────────────────────
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
// - menus.journal  — offered by the notebook's slash menu / insert palette.
//                    Chart only: it's the type whose params are TYPEABLE
//                    (symbol + tf). Every other live-rendering type embeds
//                    through its widget's Send-to-Journal door instead — a
//                    capture needs the widget's on-screen state/payload,
//                    which a slash command has no way to supply.
// - themeFollow    — when uncustomized, the widget chrome re-flips to the app
//                    theme's light tokens (every type except chart, whose
//                    canvas always comes from its own settings blob).
//
// ── Params layer (journal embeds) ───────────────────────────────────────────
// - paramsSchema   — declarative field descriptors for the widget's FROZEN
//                    params: what an embedded snapshot stores in the notebook
//                    doc and re-renders from. Types: 'symbol' | 'tf' | 'ts' |
//                    'string' | 'number' | 'boolean' | 'enum' (options) |
//                    'json'. Drives normalizeParams / validateParams / slash-
//                    command arg parsing / config UI. Keep keys STABLE — every
//                    stored notebook doc carries them verbatim.
//                    ⭐ Params always carry RESOLVED values: the materialized
//                    group symbol (never a color-group letter) and the fully
//                    MERGED settings blob (never a null opts.settings that
//                    would re-resolve from a global pref and repaint a March
//                    entry when the user re-themes in April).
// - plainText      — (params) => the search-index line for this embed. Feeds
//                    BOTH plain-text serializers (client extractPlainText and
//                    the server's extract_plain_text — the server branch is
//                    what makes embeds findable in notebook search).
// - reconstructable— boolean | (params) => boolean. Whether a months-old
//                    snapshot can re-render from data instead of its stored
//                    image. Three regimes — READ EACH ENTRY, don't trust a
//                    roster typed here (an earlier version of this comment
//                    named four payload types while eight shipped):
//                    · re-fetch: chart (per-timeframe, CHART_TF_CEILING_DAYS)
//                      and calendar (date-parameterized endpoints).
//                    · payload freeze (owner-approved): reconstructable is a
//                      fn over the entry's captured rows/payload — the frozen
//                      data renders verbatim forever.
//                    · image-only (literal false): a first-class verdict, not
//                      a failure — point-in-time views whose PNG is the
//                      honest capture.
// - liveCapable    — whether mode:'live' embeds may mount this widget live in
//                    the journal (v1: chart only — every other widget's data
//                    hooks would open polls/streams inside a note).
//
// The spec's captureParams(instance) concept is split in two: mounted widgets
// expose a live "what am I looking at" read-out (the chart registers
// getCaptureState() on the workspace's chartApiById; other widgets follow in
// the insertion-workflow phase), and normalizeParams() below is the shared
// normalizer that turns that loose read-out into schema-shaped frozen params.

// ⚠️ DELIBERATE MIRROR of the server's intraday fetch ceilings —
// api/services/bars_fetch.py:684 `max_lookback` — the authority on how far
// back each intraday timeframe can be fetched. If the server WIDENS a
// ceiling, this mirror only under-promises (an embed shows its archived image
// where a live re-render had become possible); it can never break an entry.
// Daily/weekly/monthly are effectively unbounded (30y + yfinance to IPO).
const CHART_TF_CEILING_DAYS = { 1: 60, 5: 365, 15: 1000, 30: 3200, 60: 3200 }

// Search-index text for a timeframe code. Deliberately LOCAL and minimal:
// this is what lands in body_plain for search, not a UI label (the UI keeps
// using components/chart/timeframes tfLabel).
export function tfText(tf) {
  const t = String(tf ?? 'D')
  return { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h' }[t] || t
}

// YYYYMMDD int (periodsort's wire format) → 'YYYY-MM-DD'.
function ymdText(n) {
  const s = String(n ?? '')
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s
}

// A ts param is epoch seconds (intraday) or 'YYYY-MM-DD' (daily) — the same
// dual encoding the bars store uses. → epoch seconds, or null when unreadable.
function tsToEpochSeconds(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 10_000_000_000 ? v / 1000 : v
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms / 1000 : null
  }
  return null
}

// Chart is reconstructable per-timeframe: the anchor (params.to) must sit
// within the fetch ceiling for its tf. No anchor = renders from latest bars.
// D/W/M (and any non-numeric tf) = any horizon. Post-ship captures also fire
// a capture-time deep-fill so their history lands in the forever-store; this
// gate is the conservative render-path decision, and the render chain still
// degrades to the stored image when data comes back empty.
function chartReconstructable(params) {
  const tf = String(params?.tf ?? 'D')
  if (!/^\d+$/.test(tf)) return true
  const to = tsToEpochSeconds(params?.to)
  if (to == null) return true
  // Custom intraday tfs (2/45/240/…) fall through BOTH durability rails:
  // StockChart drops `?to=` for them and the snapshot warm can't target their
  // resample base — so an anchored custom-tf snapshot must never PROMISE a
  // re-render the rails can't serve (review finding). Archive it.
  const ceiling = CHART_TF_CEILING_DAYS[tf]
  if (ceiling === undefined) return false
  const ageDays = (Date.now() / 1000 - to) / 86400
  return ageDays <= ceiling
}

// Object.freeze is shallow — a consumer could still mutate entry.defaults and
// silently reshape every host's grid. Freeze the whole tree once at init.
function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v)
  }
  return Object.freeze(obj)
}

export const WIDGET_REGISTRY = deepFreeze({
  chart: {
    labels: { header: 'Chart', menu: 'Chart', tab: 'Chart' },
    defaults: { w: 12, h: 12, minW: 6, minH: 6 },
    // Smart-placement metadata (see pages/charts/placement/). `family` groups
    // like-with-like when auto-placing a new widget; `fill` hints wide vs narrow
    // preference. Charts cluster together and want wide, landscape space.
    placement: { family: 'chart', fill: 'wide' },
    menus: { workspace: true, tab: true, mobile: true, journal: true },
    themeFollow: false,
    paramsSchema: [
      { key: 'symbol', type: 'symbol', required: true },
      { key: 'tf', type: 'tf', default: 'D' },
      { key: 'from', type: 'ts' },              // visible-range start at capture
      { key: 'to', type: 'ts' },                // visible-range end = the anchor
      { key: 'settings', type: 'json' },        // fully-MERGED chart settings blob
    ],
    plainText: (p) => `[chart: ${p.symbol} ${tfText(p.tf)}]`,
    reconstructable: chartReconstructable,
    liveCapable: true,
  },
  watchlist: {
    labels: { header: 'Watchlist', menu: 'Watchlist', tab: 'Watchlist' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: true, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'watchKey', type: 'string', required: true },  // 'flagged' | user:<id> | community:<id> | tag:<color>
      { key: 'watchName', type: 'string' },
      { key: 'watchTab', type: 'string' },
      { key: 'settings', type: 'json' },
      { key: 'cols', type: 'json' },            // column layout lives in localStorage, NOT opts — freeze it
      { key: 'symbols', type: 'json' },         // resolved membership at capture (lists mutate/delete)
      // The captured LIST as it stood (owner-approved payload freeze, panel
      // batch 3): {sym, note, price, chgPct} per row — lists mutate and
      // delete, so the payload is the only durable record. Rendered by
      // FrozenList (the live Watchlists page is a page-grade renderer — the
      // P2 disqualification).
      { key: 'rows', type: 'json' },
    ],
    plainText: (p) => `[watchlist: ${p.watchName || p.watchKey}${Array.isArray(p.symbols) ? ` — ${p.symbols.length} symbols` : ''}]`,
    reconstructable: (p) => Array.isArray(p?.rows) && p.rows.length > 0,
    liveCapable: false,
  },
  themes: {
    labels: { header: 'Themes', menu: 'Theme Tracker', tab: 'Themes' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: true, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'period', type: 'enum', options: ['1d', '1w', '1m', '3m', '1y', 'ytd'], default: '1d' },
      { key: 'sortDir', type: 'enum', options: ['asc', 'desc'], default: 'desc' },
      { key: 'openTheme', type: 'string' },
      { key: 'search', type: 'string' },
      { key: 'selectedSym', type: 'symbol' },
      { key: 'settings', type: 'json' },        // GLOBAL theme_tracker_settings — merged copy
      // The captured LEADERBOARD as it stood (owner-approved payload freeze,
      // panel batch 3): {sym: ETF ticker, note: theme name, chgPct: period
      // return, extraValue: top holdings} per row. The taxonomy versions
      // forward and returns have no as-of endpoint — the payload is the only
      // honest record of that day's ranking. Rendered by FrozenList.
      { key: 'rows', type: 'json' },
    ],
    plainText: (p) => `[themes: ${p.period}${p.openTheme ? ` — ${p.openTheme}` : ''}]`,
    reconstructable: (p) => Array.isArray(p?.rows) && p.rows.length > 0,
    liveCapable: false,
  },
  scanner: {
    labels: { header: 'Scanner', menu: 'Scanner', tab: 'Scanner' },
    // minW matches the Watchlist widget (2) so the Scanner can be narrowed to a
    // thin rail; the results table scrolls/shrinks rather than forcing a wide cell.
    defaults: { w: 8, h: 10, minW: 2, minH: 4 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: true, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'scanKey', type: 'string', required: true },   // the WIRE contract (names get re-copywritten)
      { key: 'scanName', type: 'string' },                   // display copy at capture
      { key: 'settings', type: 'json' },
      { key: 'cols', type: 'json' },
      { key: 'asOf', type: 'string' },                       // backend ET stamp shown in the footer
      // The captured RESULT LIST (owner-approved payload freeze): ranked
      // symbols with price/±% as they stood. Rendered by FrozenList — the
      // live Watchlists-page table is a page-grade renderer (the P2
      // disqualification), so the embed renders the payload, not the page.
      { key: 'rows', type: 'json' },
    ],
    plainText: (p) => `[scanner: ${p.scanName || p.scanKey}]`,
    reconstructable: (p) => Array.isArray(p?.rows) && p.rows.length > 0,                     // scans are strictly as-of-now, no date parameter
    liveCapable: false,
  },
  fundamentals: {
    labels: { header: 'Fundamentals', menu: 'Fundamentals', tab: 'Fundamentals' },
    // h:4 — a short strip: the fundamentals content is a tab bar + one row of
    // quarter cards, so a taller default just adds empty space under the chart.
    defaults: { w: 8, h: 4, minW: 6, minH: 2 },
    // dock:'below-chart' — the fundamentals strip always docks under a chart when one
    // exists (a short full-width strip beneath it), not into the sidebar rail.
    placement: { family: 'panel', fill: 'wide', dock: 'below-chart' },
    menus: { workspace: true, tab: true, mobile: true, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'symbol', type: 'symbol', required: true },
      // Freeze the EFFECTIVE view — the widget silently falls annual↔quarterly
      // when a dataset is missing, and the capture must show what was shown.
      { key: 'view', type: 'enum', options: ['annual', 'quarterly', 'analyst', 'ownership'], default: 'quarterly' },
      { key: 'company', type: 'string' },
      { key: 'settings', type: 'json' },        // GLOBAL fundamentals_settings — merged copy
      // The captured table itself ({annual[], quarterly[]}) — owner-approved
      // payload freeze: reported rows are immutable and a few KB, and there
      // is no as-of endpoint, so the payload IS the only honest re-render.
      { key: 'data', type: 'json' },
    ],
    plainText: (p) => `[fundamentals: ${p.symbol} — ${String(p.view || 'quarterly').replace(/^./, c => c.toUpperCase())}]`,
    reconstructable: (p) => !!(p?.data && (p.data.annual?.length || p.data.quarterly?.length)),
    liveCapable: false,
  },
  breadth: {
    labels: { header: 'Breadth', menu: 'Breadth', tab: 'Breadth' },
    defaults: { w: 8, h: 10, minW: 4, minH: 4 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'hiddenMetrics', type: 'json', default: [] },
      { key: 'tileStyle', type: 'enum', options: ['values', 'spark', 'area', 'ghost'], default: 'values' },
      { key: 'settings', type: 'json' },        // GLOBAL breadth_widget_settings — merged copy
      // A mid-session capture shows the LIVE intraday row, which the system
      // DISCARDS at the 4:15 collector — no endpoint can serve it back. The
      // frozen row is the only honest record of what the user saw.
      { key: 'row', type: 'json' },
      { key: 'series', type: 'json' },          // sparkline arrays for visible keys
      { key: 'updated', type: 'string' },
    ],
    plainText: (p) => `[breadth: heatmap${p.updated ? ` — ${p.updated}` : ''}]`,
    // Owner-approved payload freeze: the row (and per-metric spark series)
    // render the captured heat-map verbatim — including a mid-session live
    // row the 4:15 collector discards, which exists nowhere else.
    reconstructable: (p) => !!(p?.row && typeof p.row === 'object'),
    liveCapable: false,
  },
  aisearch: {
    labels: { header: 'AI Search', menu: 'AI Search', tab: 'AI Search' },
    defaults: { w: 7, h: 10, minW: 3, minH: 3 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      // The widget already supports thread restore first-class (initialThread
      // + chrome={false}); the frozen thread is the whole capture.
      { key: 'thread', type: 'json', required: true },
      { key: 'settings', type: 'json' },        // GLOBAL aisearch_settings — merged copy
    ],
    plainText: (p) => {
      const last = Array.isArray(p.thread) && p.thread.length ? p.thread[p.thread.length - 1] : null
      return last?.q ? `[ai search: "${last.q}"]` : '[ai search]'
    },
    // The captured THREAD is the params (never re-queried — re-running would
    // return a DIFFERENT answer): AiSearchEmbed re-renders the stored
    // conversation read-only via the widget's own initialThread seam.
    reconstructable: (p) => Array.isArray(p?.thread) && p.thread.length > 0,
    liveCapable: false,
  },
  news: {
    labels: { header: 'News', menu: 'News & Catalysts', tab: 'News' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'symbol', type: 'symbol', required: true },
      { key: 'filter', type: 'enum', options: ['all', 'up', 'down'], default: 'all' },
      { key: 'company', type: 'string' },
      { key: 'settings', type: 'json' },
      // The captured feed itself — owner-approved payload freeze: headlines
      // + moves as they read on capture day, rendered verbatim forever.
      { key: 'events', type: 'json' },
    ],
    plainText: (p) => `[news: ${p.symbol}${p.filter && p.filter !== 'all' ? ` · ${p.filter}` : ''}]`,
    reconstructable: (p) => Array.isArray(p?.events) && p.events.length > 0,
    liveCapable: false,
  },

  notebook: {
    labels: { header: 'Notebook', menu: 'Notebook', tab: 'Notebook' },
    defaults: { w: 5, h: 11, minW: 3, minH: 5 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    // Per-widget nav (selected folder + open note) + appearance; no symbol.
    paramsSchema: [
      { key: 'folderId', type: 'string' },
      { key: 'noteId', type: 'string' },
      { key: 'settings', type: 'json' },
    ],
    plainText: () => '[notebook]',
    reconstructable: false,
    liveCapable: false,
  },
  profile: {
    labels: { header: 'Profile', menu: 'Stock Profile', tab: 'Profile' },
    defaults: { w: 6, h: 12, minW: 3, minH: 5 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'symbol', type: 'symbol', required: true },
      { key: 'company', type: 'string' },
      { key: 'statYear', type: 'number' },      // "<year> Gain" reads the ambient clock — freeze it
      { key: 'settings', type: 'json' },
    ],
    plainText: (p) => `[profile: ${p.symbol}${p.company ? ` — ${p.company}` : ''}]`,
    reconstructable: false,                     // YTD stats are live-only, no as-of parameter
    liveCapable: false,
  },
  alerts: {
    labels: { header: 'Alerts', menu: 'Alerts', tab: 'Alerts' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      // The payload IS the params: the user's mutable alert list × the live
      // price at that instant. levelAtCapture/priceAtCapture per row are
      // mandatory or the above/below badges render blank/wrong later.
      { key: 'alerts', type: 'json', default: [] },
      { key: 'settings', type: 'json' },
    ],
    plainText: (p) => `[alerts: ${Array.isArray(p.alerts) ? p.alerts.length : 0} price alerts]`,
    // Owner-approved payload freeze: the captured list (with levelAtCapture/
    // priceAtCapture per row) renders verbatim — deleted alerts are gone from
    // the server, so the embed is the only durable record of the list.
    reconstructable: (p) => Array.isArray(p?.alerts) && p.alerts.length > 0,
    liveCapable: false,
  },
  calendar: {
    labels: { header: 'Calendar', menu: 'Calendar', tab: 'Calendar' },
    defaults: { w: 6, h: 10, minW: 2, minH: 4 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      // The widget renders ONE DAY (the week is only the fetch granularity).
      { key: 'date', type: 'string', required: true },       // 'YYYY-MM-DD'
      { key: 'econStars', type: 'number', default: 3 },
      { key: 'selectedSym', type: 'symbol' },
      { key: 'tbdOpen', type: 'boolean', default: false },
      { key: 'sections', type: 'json' },        // {bmo,amc} × {sortBy,sortDir,showAll} — child-local state, lifted at capture
      { key: 'settings', type: 'json' },
    ],
    plainText: (p) => `[calendar: ${p.date}]`,
    // The calendar endpoints are date-parameterized + backfilled, so a
    // captured day re-renders live at any horizon (CalendarEmbed mounts the
    // real widget under the frozen workspace host with the date restored).
    // Residuals accepted: section sort state + live-mcap ordering.
    reconstructable: true,
    liveCapable: false,
  },
  optionsflow: {
    labels: { header: 'Options Flow', menu: 'Options Flow', tab: 'Flow' },
    defaults: { w: 8, h: 12, minW: 4, minH: 5 },
    placement: { family: 'panel', fill: 'wide' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'lead', type: 'enum', options: ['tape', 'biggest', 'sentiment'], default: 'tape' },
      { key: 'scope', type: 'enum', options: ['market', 'symbol'], default: 'market' },
      { key: 'symbol', type: 'symbol' },        // only meaningful when scope==='symbol'
      { key: 'filters', type: 'json' },         // {minPrem, cp, type, dir}
      { key: 'settings', type: 'json' },
    ],
    plainText: (p) => `[flow: ${p.scope === 'symbol' && p.symbol ? p.symbol : 'market'} · ${p.lead}]`,
    reconstructable: false,                     // flow at a past instant is not replayable
    liveCapable: false,
  },
  periodsort: {
    // ~fits Flag·Symbol·%·Industry with no blank filler
    labels: { header: 'Period Sort', menu: 'Period Sort', tab: 'Period Sort' },
    defaults: { w: 6, h: 12, minW: 3, minH: 5 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: false, tab: false, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'start', type: 'number', required: true },      // YYYYMMDD int (the widget's wire format)
      { key: 'end', type: 'number', required: true },        // YYYYMMDD int
      { key: 'group', type: 'enum', options: ['theme', 'sector', 'industry'] },
      { key: 'settings', type: 'json' },
      { key: 'colCfg', type: 'json' },          // session-only ephemeral columns — freeze or lose them
    ],
    plainText: (p) => `[periodsort: ${ymdText(p.start)} → ${ymdText(p.end)}${p.group ? ` · ${p.group}` : ''}]`,
    reconstructable: false,                     // the data replays; the renderer (full Watchlists page) does not
    liveCapable: false,
  },
  nhnl: {
    // First "Situational Awareness" tool: live intraday New-High / New-Low
    // twin-panel scanner. Wants width (two columns) and height (event logs).
    labels: { header: 'New Highs / Lows', menu: 'New Highs / Lows', tab: 'NH / NL' },
    defaults: { w: 8, h: 12, minW: 3, minH: 5 },
    placement: { family: 'panel', fill: 'wide' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'minPrice', type: 'number', default: 0 },
      { key: 'minCount', type: 'number', default: 1 },
      { key: 'settings', type: 'json' },
    ],
    plainText: () => '[new highs / lows]',
    reconstructable: false,                     // a live event stream at a past instant is not replayable
    liveCapable: false,
  },
  nhnlPulse: {
    // "H/L Pulse": the live New-Highs-vs-New-Lows line chart companion to the
    // scanner. Wants width for the time axis; less height than the scanner.
    labels: { header: 'H/L Pulse', menu: 'H/L Pulse', tab: 'H/L Pulse' },
    defaults: { w: 6, h: 8, minW: 3, minH: 4 },
    placement: { family: 'panel', fill: 'wide' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'settings', type: 'json' },
    ],
    plainText: () => '[h/l pulse]',
    reconstructable: false,                     // a live intraday series at a past instant is not replayable
    liveCapable: false,
  },
  volumescan: {
    // "Volume Surge": live relative-volume leaderboard (sustained volume spike +
    // real price move). A single tall ranked list — just two short columns (Symbol ·
    // RVOL), so minW is 2 (like the Watchlist) — it can be dragged very thin.
    labels: { header: 'Volume Surge', menu: 'Volume Surge', tab: 'Volume' },
    defaults: { w: 6, h: 12, minW: 2, minH: 5 },
    placement: { family: 'panel', fill: 'narrow' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'minRvol', type: 'number', default: 2 },
      { key: 'minMove', type: 'number', default: 0.25 },
      { key: 'minDollarK', type: 'number' },   // $-vol/min floor ($thousands); blank = session-aware auto
      { key: 'showLogos', type: 'boolean', default: false },   // company logos next to tickers (off by default)
      { key: 'settings', type: 'json' },
    ],
    plainText: () => '[volume surge]',
    reconstructable: false,                     // a live surge leaderboard at a past instant is not replayable
    liveCapable: false,
  },
  scatter: {
    // "Market Map": a scatter/bubble chart of a whole universe on user-chosen
    // X/Y (+ size) axes. Wants width AND height — it's an analysis canvas, not a
    // rail; big default so the point cloud + labels have room.
    labels: { header: 'Market Map', menu: 'Market Map', tab: 'Map' },
    defaults: { w: 10, h: 12, minW: 5, minH: 6 },
    placement: { family: 'chart', fill: 'wide' },
    menus: { workspace: true, tab: true, mobile: false, journal: false },
    themeFollow: true,
    paramsSchema: [
      { key: 'source', type: 'string', default: 'index' },   // universe descriptor
      { key: 'value', type: 'string', default: 'sp500' },
      { key: 'xKey', type: 'string', default: 'rvol' },
      { key: 'yKey', type: 'string', default: 'chg_today' },
      { key: 'sizeKey', type: 'string' },                    // '' = uniform dots
      { key: 'settings', type: 'json' },
    ],
    plainText: (p) => `[market map: ${p.value || p.source || 'market'} — ${p.yKey || 'y'} vs ${p.xKey || 'x'}]`,
    reconstructable: false,                     // a live market map at a past instant is not replayable
    liveCapable: false,
  },
})

// Registry ids in declaration order — this order IS the menu order.
export const WIDGET_IDS = Object.keys(WIDGET_REGISTRY)

// Derived membership views (computed once; the registry is frozen).
export const WORKSPACE_MENU_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].menus.workspace)
export const TAB_MENU_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].menus.tab)
export const MOBILE_MENU_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].menus.mobile)
export const JOURNAL_MENU_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].menus.journal)
export const THEME_FOLLOW_TYPES = WIDGET_IDS.filter(id => WIDGET_REGISTRY[id].themeFollow)

// ── Add-menu categories ──────────────────────────────────────────────────────
// The "Add Widget" menu is grouped by category so it stays scannable as the widget
// count grows (a flat list of 15+ is a wall of text). Membership lives HERE, in one
// ordered place, rather than a field on every entry — a new widget is slotted by
// adding its id to a category (registry.test pins that every menu widget lands in
// exactly one, so nothing silently falls out of the menu). Category order + the id
// order within each are the menu order.
export const WIDGET_CATEGORIES = [
  { key: 'charts',    label: 'Charts',                 items: ['chart'] },
  { key: 'lists',     label: 'Watchlists & Screening', items: ['watchlist', 'themes', 'scanner', 'scatter'] },
  // "Market Internals" is the home for the real-time, market-wide tools — the growing
  // NH/NL-style family. Renamed from "Breadth & Momentum" as that family expands.
  { key: 'internals', label: 'Market Internals',       items: ['breadth', 'nhnl', 'nhnlPulse', 'volumescan'] },
  { key: 'research',  label: 'Research',               items: ['fundamentals', 'profile', 'news', 'aisearch', 'calendar', 'notebook'] },
  { key: 'flow',      label: 'Flow & Alerts',          items: ['optionsflow', 'alerts'] },
]

// ── Widget catalog presentation ──────────────────────────────────────────────
// Icon (a UIcon glyph name), a one-line blurb, and `live` (a real-time feed → a
// "LIVE" tag) for the visual Widget Catalog gallery. Kept beside WIDGET_CATEGORIES
// as the menu-presentation table (not a field on every entry, mirroring the
// categories); registry.test pins that every workspace-menu widget has an entry so a
// new widget can never ship into the gallery blank. (periodsort is Tools-only → no
// card.)
export const WIDGET_CATALOG = {
  chart:        { icon: 'chart',    blurb: 'Candles, drawings, indicators & timeframes.' },
  watchlist:    { icon: 'star',     blurb: 'Your symbols with live prices & columns.' },
  themes:       { icon: 'markets',  blurb: 'Theme & sector performance leaderboard.' },
  scanner:      { icon: 'screener', blurb: 'Build & run scans on your own criteria.' },
  fundamentals: { icon: 'scale',    blurb: 'Earnings, valuation & key financials.' },
  breadth:      { icon: 'breadth',  blurb: 'Market breadth & participation monitor.', live: true },
  aisearch:     { icon: 'sparkle',  blurb: 'Ask AI about any stock or the market.' },
  news:         { icon: 'wire',     blurb: 'High-impact news & catalysts per stock.' },
  profile:      { icon: 'book',     blurb: 'Company profile, description & stats.' },
  alerts:       { icon: 'bell',     blurb: 'Your price alerts, updating live.' },
  calendar:     { icon: 'calendar', blurb: 'Earnings & market events calendar.' },
  optionsflow:  { icon: 'flow',     blurb: 'Live options order-flow tape.', live: true },
  nhnl:         { icon: 'wave',     blurb: 'New highs vs new lows, live by group.', live: true },
  nhnlPulse:    { icon: 'bolt',     blurb: 'Real-time high/low momentum pulse.', live: true },
  volumescan:   { icon: 'flame',    blurb: 'Live relative-volume surge leaderboard.', live: true },
  scatter:      { icon: 'markets',  blurb: 'Plot any universe on custom X / Y / size axes.', live: true },
  notebook:     { icon: 'journal',  blurb: 'Read + jot Journal notes while you chart.' },
}

/** Catalog presentation (icon/blurb/live) for a widget id, with a safe fallback. */
export function catalogMeta(id) {
  return WIDGET_CATALOG[id] || { icon: 'sparkle', blurb: '' }
}

const _MENU_TYPE_SETS = {
  workspace: WORKSPACE_MENU_TYPES,
  tab: TAB_MENU_TYPES,
  mobile: MOBILE_MENU_TYPES,
  journal: JOURNAL_MENU_TYPES,
}

/** The add-menu widgets grouped into categories, filtered to one menu surface.
 *  Returns [{key, label, items:[id]}] with empty categories dropped. */
export function menuGroups(menu = 'workspace') {
  const allowed = new Set(_MENU_TYPE_SETS[menu] || WORKSPACE_MENU_TYPES)
  return WIDGET_CATEGORIES
    .map(c => ({ key: c.key, label: c.label, items: c.items.filter(id => allowed.has(id)) }))
    .filter(c => c.items.length > 0)
}

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

// ── Params helpers ───────────────────────────────────────────────────────────

// Guaranteed-serializable deep copy: strips functions/undefined, throws never.
function jsonClone(v) {
  if (v === undefined) return undefined
  try { return JSON.parse(JSON.stringify(v)) } catch { return undefined }
}

function coerce(field, v) {
  if (v === undefined || v === null) return undefined
  switch (field.type) {
    case 'symbol': {
      const s = String(v).trim().toUpperCase()
      return s || undefined
    }
    case 'tf': return String(v)
    case 'ts':
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && v) return v
      return undefined
    case 'string': {
      const s = String(v)
      return s || undefined
    }
    case 'number': {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    case 'boolean': return !!v
    case 'enum': return field.options?.includes(v) ? v : undefined
    case 'json': return jsonClone(v)
    default: return undefined
  }
}

/** Normalize a capture provider's loose "what am I looking at" read-out into
 *  schema-shaped frozen params: coerce each declared field, apply defaults,
 *  DROP undeclared keys (a leak from a provider is a bug, not a param).
 *  Best-effort — missing required keys are validateParams' job to report. */
export function normalizeParams(widgetId, live = {}) {
  const w = WIDGET_REGISTRY[widgetId]
  if (!w) return {}
  const out = {}
  for (const field of w.paramsSchema) {
    let v = coerce(field, live[field.key])
    if (v === undefined && field.default !== undefined) v = jsonClone(field.default)
    if (v !== undefined) out[field.key] = v
  }
  return out
}

/** Validate STORED params (from a notebook doc). Unknown keys are tolerated —
 *  a doc written by newer code must stay renderable by older code. */
export function validateParams(widgetId, params) {
  const w = WIDGET_REGISTRY[widgetId]
  if (!w) return { ok: false, errors: [`unknown widget id '${widgetId}'`] }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, errors: ['params must be an object'] }
  }
  const errors = []
  for (const field of w.paramsSchema) {
    const v = params[field.key]
    if (v === undefined || v === null || v === '') {
      if (field.required) errors.push(`missing required param '${field.key}'`)
      continue
    }
    if (field.type === 'enum' && !field.options?.includes(v)) {
      errors.push(`param '${field.key}' not one of ${field.options?.join('|')}`)
    }
    if (field.type === 'number' && !(typeof v === 'number' && Number.isFinite(v))) {
      errors.push(`param '${field.key}' must be a number`)
    }
    if (field.type === 'boolean' && typeof v !== 'boolean') {
      errors.push(`param '${field.key}' must be a boolean`)
    }
    if ((field.type === 'symbol' || field.type === 'string' || field.type === 'tf') && typeof v !== 'string') {
      errors.push(`param '${field.key}' must be a string`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** The search-index line for an embed. Unknown/removed widget types degrade
 *  to a generic label — the render chain's never-crash rule applies to the
 *  serializers too. */
export function paramsPlainText(widgetId, params) {
  const w = WIDGET_REGISTRY[widgetId]
  if (!w || typeof w.plainText !== 'function') return '[widget]'
  try { return w.plainText(params || {}) } catch { return `[${widgetId}]` }
}

/** Whether a snapshot with these params can re-render from data (vs its
 *  stored image). Unknown widget id or a throwing predicate = image. */
export function isReconstructable(widgetId, params) {
  const w = WIDGET_REGISTRY[widgetId]
  if (!w) return false
  const r = w.reconstructable
  if (typeof r === 'boolean') return r
  try { return !!r(params || {}) } catch { return false }
}
