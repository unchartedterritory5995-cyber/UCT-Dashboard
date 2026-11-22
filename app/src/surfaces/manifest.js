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

/** ⭐ 2026-11-17: COMPACT ROWS, THE SAME OBJECTS. This table is in every page's first download
 *  (`pageTitle.js` imports it), so each row is written `r(path, element, kind, order)`: `order`
 *  defaults to null and `pathKind` to 'literal' (the one identifier row passes both). `r` builds
 *  exactly the object the old literal did, so every reader sees the same MANIFEST and only the
 *  bytes shrink. It paid for the three rows added the same day (notebook/playbook,
 *  /admin/rare-preview, /admin/ai-spend). */
const r = (path, element, kind, order = null, pathKind = 'literal') => ({ path, pathKind, element, kind, order });

export const MANIFEST = [
  r("/dashboard", "Dashboard", "surface", 1),
  r("/morning-wire", "MorningWire", "surface", 8),
  r("/uct-20", "UCT20", "surface"),
  r("/charts", "ChartsWorkspace", "surface", 5),
  r("/theme-tracker", "LegacyRedirect", "redirect"),
  r("/watchlists", "LegacyRedirect", "redirect"),
  r("/multi-chart", "LegacyRedirect", "redirect"),
  r("/research/:sym", "ResearchPage", "detail"),
  r("/research/:sym/compare/:comparator", "ResearchComparePage", "detail"),
  r("/calendar", "CalendarRoute", "surface", 6),
  r("/terminal", "TerminalRoute", "surface"),
  r("/terminal/calendar", "TerminalRoute", "child"),
  r("/breadth", "Breadth", "surface", 7),
  r("/calendar/mystocks", "MyStocksHub", "surface"),
  r("/screener", "Screener", "surface", 9),
  r("/formulas/reference", "FormulaReference", "surface"),
  r("FORMULA_LIBRARY_PATH", "FormulaLibrary", "surface", null, "identifier"),
  r("/ai-search", "AiSearchPage", "surface"),
  r("/options-flow", "OptionsFlowRoute", "surface", 4),
  r("/live-flow", "Navigate", "redirect"),
  r("/live-massive", "LiveFlowMassive", "surface", 2),
  r("/flow-scoreboard", "FlowScoreboard", "surface"),
  // ⚰️ ADDED 2026-09-24. Both routes landed in App.jsx (Packet L CP1: /open-flow;
  // A14 CP1: /portfolio-heat) without a row here, and this manifest's own rail --
  // "every Layout-hosted route has a declaration" -- had been red on master since.
  // Neither is a sidebar entry (NAV_ITEMS carries no row for either), so `order` is
  // null, as it is for every other reachable-but-unlisted surface above.
  r("/open-flow", "OpenFlow", "surface"),
  r("/portfolio-heat", "PortfolioHeat", "surface"),
  // 2026-10-15: the TSDR trader archive page (paid members). 2026-10-20: a sidebar + More-sheet
  // entry ("Trader Archive", dark behind WISDOM_ARCHIVE_ENABLED). `order` stays null: telemetry
  // has not measured it, and a nav row is not a rank (/formulas/reference is the precedent).
  r("/trader-archive", "TraderArchiveRedirect", "redirect"),
  r("/traders", "Traders", "surface"),
  // ⚰️ ADDED 2026-09-29 (TERM-037). App.jsx moved /provenance-demo inside <Layout/> on
  // 2026-09-25 (`7e0ab34c2`, gated with OI-17's siblings) without a row here, and this
  // manifest's own coverage rail had been red since. Not a sidebar entry, so `order` is null.
  r("/provenance-demo", "ProvenanceDemo", "surface"),
  r("/dark-pool", "DarkPool", "surface"),
  r("/post-market", "PostMarket", "surface"),
  r("/model-book", "ModelBook", "surface"),
  r("/setup-library", "SetupLibrary", "surface"),
  r("/desk", "Desk", "surface"),
  r("/desk/article/:slug", "ArticleReader", "detail"),
  r("/educational-videos", "Navigate", "redirect"),
  r("/journal", "JournalShellSelector", "surface", 3),
  r("(index)", "TodaySurface", "child"),
  r("trades", "TradesSurface", "child"),
  r("calendar", "CalendarSurface", "child"),
  r("notebook", "NotebookSurface", "child"),
  r("notebook/research/:symbol", "TickerResearchSurface", "child"),
  r("notebook/setups", "SetupsBoard", "child"),
  // S13 (44699ced87): My Playbook inside the Journal shell, the Notebook sidebar's door to it; the
  // standalone /journal-2-0/playbook surface below stays for Insights and every existing link.
  r("notebook/playbook", "J2MyPlaybook", "child"),
  r("journal", "JournalSurface", "child"),
  r("insights", "InsightsSurface", "child"),
  r("compass", "CompassSurface", "child"),
  r("community", "CommunitySurface", "child"),
  r("accounts", "AccountsSurface", "child"),
  r("/community", "Community", "surface", 10),
  r("/community/:threadId", "Community", "detail"),
  r("/journal-2-0/calendar/:date", "J2DayDetailPage", "detail"),
  r("/journal-2-0/report", "J2ReportPage", "surface"),
  r("/journal-2-0/position/:sym", "J2PositionDetailPage", "detail"),
  r("/journal-2-0/trade/:id", "J2TradeDetailPage", "detail"),
  r("/journal-2-0/playbook", "J2MyPlaybook", "surface"),
  // P2 Tier 3 Task 8: Your <year> in trading. A detail page (one year), reached from the Report
  // page's door; not a sidebar entry, so `order` is null.
  r("/journal-2-0/wrapped/:year", "J2WrappedSurface", "detail"),
  r("/support", "Support", "surface"),
  r("/settings", "Settings", "surface", 11),
  r("/admin", "Admin", "admin"),
  r("/catalysts/history", "CatalystsHistory", "surface"),
  r("/admin/chart-health", "ChartHealth", "admin"),
  r("/admin/patterns", "PatternAdmin", "admin"),
  r("/admin/pattern-review", "PatternReview", "admin"),
  r("/admin/rare-preview", "RarePreview", "admin"),
  r("/admin/landing-analytics", "LandingAnalytics", "admin"),
  r("/admin/ai-spend", "AiSpend", "admin"),
  r("/admin/wisdom", "WisdomAdmin", "admin"),
];

/** Surfaces with a measured rank, best-first. Excludes anything telemetry is silent on. */
export const MEASURED_ORDER = MANIFEST
  .filter((m) => m.kind === 'surface' && m.order !== null)
  .sort((a, b) => a.order - b.order)
  .map((m) => m.path);
