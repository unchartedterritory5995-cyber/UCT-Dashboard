/**
 * S1 CP1 — THE SURFACE MANIFEST, AS INERT DATA.
 *
 * Gate: `s1-terminal-shell-pre-implementation-gate.md`, CP1, fingerprint `0a267d174`.
 *
 * ⛔⛔ NOTHING IMPORTS THIS TO RENDER. CP1 declares; it does not mount. No shell change,
 * no route change, no component reads it yet. `manifest.test.js` is the only consumer,
 * and that is the point: the manifest earns trust by being checkable BEFORE anything
 * depends on it. CP2 is where the shell reads one property.
 *
 * ⛔ DERIVED, NEVER TYPED. Every row here was produced by an AST walk over `App.jsx`'s
 * route table, collecting the `<Route path=…>` elements beneath `<Route element={<Layout/>}>`.
 * The rail re-derives on every run and fails when a route exists with no declaration, or a
 * declaration names no route. A hand-typed roster beside the source that owns it is the
 * defect this repo has paid for in the writer index, the COT router and the setup catalog.
 *
 * ⭐ `order` IS MEASURED, NOT CHOSEN — OI-06, answered 2026-09-14 from production
 * `/data/auth.db` (29 users, 13 with traffic), NOT the 20,640-user dev file of the same
 * name. Rank is SESSION-OPENER count first, total views as the tiebreak.
 *
 * ⛔ THE TWO ORDERINGS DISAGREE, AND THE DISAGREEMENT IS WHY THIS FIELD EXISTS. By total
 * views the notebook leads the product (1097); by first-surface-of-a-session `/dashboard`
 * wins with 22 of 50 admin session-days. A manifest ordered by total views would have put
 * the notebook first and been wrong about the morning.
 *
 * ⛔ CHILD TRAFFIC ROLLS UP TO ITS SHELL: a member who opened `/journal/notebook` opened
 * the journal. Dropping child traffic ranked `/journal` 6th; rolling it up ranks it 3rd.
 * A modelling choice that changes the answer, so it is stated rather than buried.
 *
 * ⚠️ `order` is `null` wherever telemetry is SILENT. Silence is not last place. 15 of the
 * 26 surfaces have no measured traffic and carry `null` rather than an invented rank —
 * the rail forbids inventing one.
 *
 * ⚠️ n = 13 active users over 50 admin session-days. This is an EXISTENCE CHECK that beat
 * its own stated threshold (the PRD said drop re-ranking if the median member touched ≤3
 * distinct surfaces; the median is 11), never a rate. Re-read past ~100 members.
 */

/** @typedef {'surface'|'child'|'detail'|'redirect'|'admin'} SurfaceKind */

export const SURFACE_KINDS = ['surface', 'child', 'detail', 'redirect', 'admin'];

export const MANIFEST = [
  { path: "/dashboard", pathKind: "literal", element: "Dashboard", kind: "surface", order: 1 },
  { path: "/morning-wire", pathKind: "literal", element: "MorningWire", kind: "surface", order: 8 },
  { path: "/uct-20", pathKind: "literal", element: "UCT20", kind: "surface", order: null },
  { path: "/charts", pathKind: "literal", element: "ChartsWorkspace", kind: "surface", order: 5 },
  { path: "/theme-tracker", pathKind: "literal", element: "LegacyRedirect", kind: "redirect", order: null },
  { path: "/watchlists", pathKind: "literal", element: "LegacyRedirect", kind: "redirect", order: null },
  { path: "/multi-chart", pathKind: "literal", element: "LegacyRedirect", kind: "redirect", order: null },
  { path: "/research/:sym", pathKind: "literal", element: "ResearchPage", kind: "detail", order: null },
  { path: "/research/:sym/compare/:comparator", pathKind: "literal", element: "ResearchComparePage", kind: "detail", order: null },
  { path: "/calendar", pathKind: "literal", element: "Calendar", kind: "surface", order: 6 },
  { path: "/breadth", pathKind: "literal", element: "Breadth", kind: "surface", order: 7 },
  { path: "/calendar/mystocks", pathKind: "literal", element: "MyStocksHub", kind: "surface", order: null },
  { path: "/screener", pathKind: "literal", element: "Screener", kind: "surface", order: 9 },
  { path: "/formulas/reference", pathKind: "literal", element: "FormulaReference", kind: "surface", order: null },
  { path: "FORMULA_LIBRARY_PATH", pathKind: "identifier", element: "FormulaLibrary", kind: "surface", order: null },
  { path: "/ai-search", pathKind: "literal", element: "AiSearchPage", kind: "surface", order: null },
  { path: "/options-flow", pathKind: "literal", element: "OptionsFlowRoute", kind: "surface", order: 4 },
  { path: "/live-flow", pathKind: "literal", element: "Navigate", kind: "redirect", order: null },
  { path: "/live-massive", pathKind: "literal", element: "LiveFlowMassive", kind: "surface", order: 2 },
  { path: "/flow-scoreboard", pathKind: "literal", element: "FlowScoreboard", kind: "surface", order: null },
  { path: "/traders", pathKind: "literal", element: "Traders", kind: "surface", order: null },
  { path: "/dark-pool", pathKind: "literal", element: "DarkPool", kind: "surface", order: null },
  { path: "/post-market", pathKind: "literal", element: "PostMarket", kind: "surface", order: null },
  { path: "/model-book", pathKind: "literal", element: "ModelBook", kind: "surface", order: null },
  { path: "/setup-library", pathKind: "literal", element: "SetupLibrary", kind: "surface", order: null },
  { path: "/desk", pathKind: "literal", element: "Desk", kind: "surface", order: null },
  { path: "/desk/article/:slug", pathKind: "literal", element: "ArticleReader", kind: "detail", order: null },
  { path: "/educational-videos", pathKind: "literal", element: "Navigate", kind: "redirect", order: null },
  { path: "/journal", pathKind: "literal", element: "JournalShellSelector", kind: "surface", order: 3 },
  { path: "(index)", pathKind: "literal", element: "TodaySurface", kind: "child", order: null },
  { path: "trades", pathKind: "literal", element: "TradesSurface", kind: "child", order: null },
  { path: "calendar", pathKind: "literal", element: "CalendarSurface", kind: "child", order: null },
  { path: "notebook", pathKind: "literal", element: "NotebookSurface", kind: "child", order: null },
  { path: "notebook/research/:symbol", pathKind: "literal", element: "TickerResearchSurface", kind: "child", order: null },
  { path: "journal", pathKind: "literal", element: "JournalSurface", kind: "child", order: null },
  { path: "insights", pathKind: "literal", element: "InsightsSurface", kind: "child", order: null },
  { path: "compass", pathKind: "literal", element: "CompassSurface", kind: "child", order: null },
  { path: "community", pathKind: "literal", element: "CommunitySurface", kind: "child", order: null },
  { path: "accounts", pathKind: "literal", element: "AccountsSurface", kind: "child", order: null },
  { path: "/community", pathKind: "literal", element: "Community", kind: "surface", order: 10 },
  { path: "/community/:threadId", pathKind: "literal", element: "Community", kind: "detail", order: null },
  { path: "/journal-2-0/calendar/:date", pathKind: "literal", element: "J2DayDetailPage", kind: "detail", order: null },
  { path: "/journal-2-0/report", pathKind: "literal", element: "J2ReportPage", kind: "surface", order: null },
  { path: "/journal-2-0/position/:sym", pathKind: "literal", element: "J2PositionDetailPage", kind: "detail", order: null },
  { path: "/journal-2-0/trade/:id", pathKind: "literal", element: "J2TradeDetailPage", kind: "detail", order: null },
  { path: "/support", pathKind: "literal", element: "Support", kind: "surface", order: null },
  { path: "/settings", pathKind: "literal", element: "Settings", kind: "surface", order: 11 },
  { path: "/admin", pathKind: "literal", element: "Admin", kind: "admin", order: null },
  { path: "/catalysts/history", pathKind: "literal", element: "CatalystsHistory", kind: "surface", order: null },
  { path: "/admin/chart-health", pathKind: "literal", element: "ChartHealth", kind: "admin", order: null },
  { path: "/admin/patterns", pathKind: "literal", element: "PatternAdmin", kind: "admin", order: null },
  { path: "/admin/pattern-review", pathKind: "literal", element: "PatternReview", kind: "admin", order: null },
  { path: "/admin/landing-analytics", pathKind: "literal", element: "LandingAnalytics", kind: "admin", order: null },
  { path: "/admin/wisdom", pathKind: "literal", element: "WisdomAdmin", kind: "admin", order: null },
];

/** Surfaces with a measured rank, best-first. Excludes anything telemetry is silent on. */
export const MEASURED_ORDER = MANIFEST
  .filter((m) => m.kind === 'surface' && m.order !== null)
  .sort((a, b) => a.order - b.order)
  .map((m) => m.path);
