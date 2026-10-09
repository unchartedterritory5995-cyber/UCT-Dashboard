// UCT Terminal — THE FUNCTION REGISTRY. One data module; every function code lives here.
//
// A code has up to two VARIANTS, chosen by whether the command carried a security:
//   ticker: { panel | door, props?, flag?, section?, args? }   `NVDA FA`  — the focused panel
//   market: { panel | surface | door, props?, flag?, full?, args? } `CAL`      — no security needed
// Exactly ONE kind per variant:
//   `panel`   names an entry in `panels.jsx` (an EXISTING component, embedded, never forked).
//   `surface` is a whole PAGE embedded in the panel. It must be a path the TERM-037 panel set
//             (`surfaces/panelSet.js`) promotes, so the shell and the /charts board share ONE
//             panel vocabulary; `surfacePanels.js` binds the page module App.jsx itself loads.
//   `door`    an EXISTING route the shell navigates to. A door to a page the panel set promotes
//             must say `why` it is not embedded — a door is never the silent default.
// `section` is the `/research/:sym` `?section=` value of the same surface, so every security
// panel can open its full page; a market panel names its page with `full`.
// `flag` is the auth-payload key that already gates that surface on the page itself (the shell
// never shows what the page would hide). Dotted: one key of an auth object
// (`researchDepth.ftd_dataset_enabled`); `researchDepth.*`: ANY key of it (see `flagOn`).
// `args` declares what a variant honours after its code (kinds in `args.js`); anything else
// typed there is ECHOED as not applied, never dropped silently.
//
// ⛔ NOTHING HERE IS TYPED TWICE. `functions.rail.test.js` DERIVES the check that every
// `panel` resolves to a real module with a default-exported component (import-based), every
// `surface` is a page the panel set promotes AND App.jsx loads from the same module (AST),
// every `door`/`full` matches a route in `App.jsx` (acorn AST, nested routes composed), every
// `section` is a key of `ResearchPage.jsx`'s `SECTION_TO_TAB` (AST), and every `flag` is a key
// `AuthContext` provides (AST) — a dotted Depth flag, a key `researchDepthFlags.js` publishes.
//
// ⛔ ABSENT is not UNKNOWN. A code a member will reasonably type for a surface that does not
// exist on this build answers with WHY, never with "unknown command".

export const FUNCTION_GROUPS = ['Calendar', 'Security', 'Research depth', 'Options', 'Market', 'Shell']

const DEPTH = 'researchDepth'   // AuthContext's object of Research › Depth flags (researchDepthFlags.js)
/** IMOV's theme-name REST argument (args.js `themeName`; the marker is args.js THEME_MARKER). */
const IMOV_THEME_ARG = Object.freeze({ kind: 'themeName', prop: 'theme', rest: true, marker: 'THEME' })

export const FUNCTIONS = [
  // ── the Calendar section (owner ruling 2026-10-02: a first-class section of the shell) ──
  { code: 'CAL', label: 'Earnings & events calendar', group: 'Calendar',
    // `CAL TODAY` / `CAL NEXT` / `CAL 2026-10-05` move the calendar through its OWN URL
    // contract (`?week=` / `?d=`, Calendar.jsx), never a second date state.
    market: { panel: 'Calendar', args: [{ kind: 'calendarDay', param: true }] } },
  { code: 'MYST', label: 'My stocks hub (earnings, news, calls, filings)', group: 'Calendar',
    market: { door: '/calendar/mystocks', leavesTerminal: true } },
  { code: 'ERN', label: 'Earnings detail (calendar modal)', group: 'Calendar',
    // The calendar's own earnings modal, opened through its own deep-link contract
    // (`?earnings=SYM`) — the C1–C11 rows of the coexistence parity matrix.
    ticker: { panel: 'Calendar', params: { earnings: true } } },

  // ── a security (each embeds the `/research/:sym` tab component as-is) ──
  { code: 'DES', label: 'Description / overview', group: 'Security',
    ticker: { panel: 'Overview', section: 'overview' } },
  { code: 'GP', label: 'Price chart', group: 'Security',
    ticker: { panel: 'Chart', args: [{ kind: 'timeframe', prop: 'tf' }] } },
  { code: 'CN', label: 'Company news', group: 'Security',
    ticker: { panel: 'News', section: 'news' } },
  { code: 'CATS', label: 'Catalyst history', group: 'Security',
    ticker: { panel: 'Catalysts', section: 'catalysts' } },
  // V15 (lane T3): "why is it moving" over the EXISTING watchlist-intelligence + catalyst
  // services, plus what is new since this member's last MOVE visit. WIIM is an ALIAS of it
  // (CODE_ALIASES, owner decision 2026-10-08): one function, one panel, one name.
  // Dark at the server (TERMINAL_GRAMMAR_ENABLED): unset, the panel says it is not enabled.
  { code: 'MOVE', label: 'Why is it moving (+ since last visit)', group: 'Security',
    ticker: { panel: 'Move' } },
  { code: 'TECH', label: 'Technical read', group: 'Security',
    ticker: { panel: 'Technical', section: 'technical', flag: 'researchTechnicalTabEnabled' } },
  { code: 'FA', label: 'Financials', group: 'Security',
    ticker: { panel: 'Financials', section: 'financials' } },
  // EE also carries what BRKE (broker estimates) had that EE did not: the firms acting on the
  // stock, shown only when that read is switched on and holds real rows (owner decision
  // 2026-10-08: BRKE is folded into EE and kept as an alias, CODE_ALIASES).
  { code: 'EE', label: 'Earnings estimates', group: 'Security',
    ticker: { panel: 'Estimates', section: 'estimates' } },
  { code: 'EEH', label: 'Estimate history (revisions)', group: 'Security',
    ticker: { panel: 'EstimateHistory', section: 'estimate-history', flag: 'estimateHistoryEnabled' } },
  { code: 'ANR', label: 'Analyst ratings', group: 'Security',
    ticker: { panel: 'AnalystRatings', section: 'analyst-ratings' } },
  { code: 'RTG', label: 'UCT composite rating', group: 'Security',
    ticker: { panel: 'Ratings', section: 'ratings' } },
  { code: 'OWN', label: 'Ownership', group: 'Security',
    ticker: { panel: 'Ownership', section: 'ownership' } },
  { code: 'PPL', label: 'People (executives, pay, insiders)', group: 'Security',
    ticker: { panel: 'People', section: 'people', flag: 'researchPeopleEnabled' } },
  { code: 'TRAN', label: 'Calls & transcript', group: 'Security',
    ticker: { panel: 'Calls', section: 'calls' } },
  { code: 'MB', label: 'Model Book', group: 'Security',
    ticker: { panel: 'ModelBook', section: 'modelbook' },
    market: { door: '/model-book', leavesTerminal: true, why: 'a curated year-by-year library with its own two-pane admin editor; the security variant embeds the per-ticker tab' } },
  { code: 'DR', label: 'Decision record', group: 'Security',
    ticker: { panel: 'DecisionRecord', section: 'decision-record', flag: 'decisionRecordEnabled' } },
  { code: 'HIS', label: 'Ticker history', group: 'Security',
    ticker: { panel: 'History', section: 'history', flag: 'tickerHistoryEnabled' } },
  { code: 'SEAS', label: 'Seasonality', group: 'Security',
    ticker: { panel: 'Seasonality', section: 'seasonality', flag: 'seasonalityEnabled' } },
  { code: 'CF', label: 'SEC filings', group: 'Security',
    ticker: { panel: 'Filings', section: 'filings' } },
  { code: 'FEED', label: 'Filings feed (as filed)', group: 'Security',
    ticker: { panel: 'FilingsFeed', section: 'filings-feed', flag: 'filingsFeedEnabled' } },
  { code: 'FIL', label: 'Filing changes (blackline)', group: 'Security',
    ticker: { panel: 'FilingChanges', section: 'filing-changes', flag: 'filingBlacklineEnabled' } },
  { code: 'RSCH', label: 'My research (notes on this ticker)', group: 'Security',
    ticker: { panel: 'MyResearch', section: 'research' } },
  { code: 'CMP', label: 'Compare two securities', group: 'Security',
    // `NVDA CMP AMD` — the research compare page, the comparator is the first arg. Unlike
    // every other Security code this leaves the multi-panel Terminal entirely (`leavesTerminal`
    // — describeCommand reads it to say so in the interpreted-parse echo).
    ticker: { door: '/research/{sym}/compare/{arg0}', needsArg: 'a comparator, e.g. NVDA CMP AMD',
      why: 'the compare page is a side-by-side two-security layout with its own URL shape; a panel cannot hold two securities', leavesTerminal: true } },
  { code: 'RES', label: 'Full research page', group: 'Security',
    ticker: { door: '/research/{sym}',
      why: 'the full research page is the same tabs already embedded here, plus the ones this build does not panel-ize yet; RES is the escape hatch to all of it at once', leavesTerminal: true } },
  { code: 'ASK', label: 'Ask AI', group: 'Security',
    ticker: { panel: 'AskAi', section: 'ai' },
    market: { door: '/ai-search', leavesTerminal: true, why: 'the AI search page owns a streaming conversation and its own history rail' } },

  // ── Research › Depth (each panel is its own surface behind its own flag) ──
  { code: 'DPTH', label: 'Research depth (every depth panel you have)', group: 'Research depth',
    ticker: { panel: 'Depth', section: 'depth', flag: `${DEPTH}.*` } },
  { code: 'EVTS', label: 'Events timeline', group: 'Research depth',
    ticker: { panel: 'Events', section: 'depth', flag: `${DEPTH}.events_timeline_enabled` } },
  { code: 'FSRC', label: 'Filing full-text search', group: 'Research depth',
    ticker: { panel: 'FilingSearch', section: 'depth', flag: `${DEPTH}.filing_search_enabled` } },
  { code: 'ERX', label: 'Earnings reaction', group: 'Research depth',
    ticker: { panel: 'EarningsReaction', section: 'depth', flag: `${DEPTH}.earnings_reaction_panel_enabled` } },
  { code: 'FTD', label: 'Fails to deliver', group: 'Research depth',
    ticker: { panel: 'Ftd', section: 'depth', flag: `${DEPTH}.ftd_dataset_enabled` } },
  { code: 'ATTN', label: 'Room attention (mentions)', group: 'Research depth',
    ticker: { panel: 'MentionSeries', section: 'depth', flag: `${DEPTH}.mention_series_enabled` } },

  // ── options ──
  { code: 'OMON', label: 'Option chain', group: 'Options',
    ticker: { panel: 'OptionsChain', section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'OVS', label: 'Volatility surface', group: 'Options',
    // `focus`: the surface leads and the chain folds beneath it (audit 2026-10-08, OVS P1).
    ticker: { panel: 'OptionsChain', props: { volSurface: true, focus: 'surface' }, section: 'options',
              flag: 'optionsVolSurfaceEnabled' } },
  // `offNotice`: these six open a dark surface ON ITS OWN, and every route behind them answers 404
  // until its own switch is set. Embedded under the chain or on Options Flow, a 404 renders nothing;
  // as a whole panel that was a titled box with an empty body. With the prop, a panel whose every
  // section answered 404 says "<feature> isn't switched on yet" (optionsAnalytics/OffNotice.jsx).
  // O12: IVH and STRS now gate on their OWN switch, carried on the auth payload
  // (`iv_history_enabled`, `options_strategy_screens_enabled`), so the shell refuses them while
  // dark instead of opening an empty panel; the off notice stays as the second line of defence.
  { code: 'IVH', label: 'IV history (implied vs realized)', group: 'Options',
    ticker: { panel: 'IvHistory', props: { offNotice: true }, section: 'options', flag: 'ivHistoryEnabled' } },
  { code: 'VOL', label: 'Volatility stats', group: 'Options',
    ticker: { panel: 'VolStats', props: { offNotice: true }, section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'POS', label: 'Options positioning (levels, max pain)', group: 'Options',
    ticker: { panel: 'Positioning', props: { offNotice: true }, section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'OHIS', label: 'Options history (straddles, moves)', group: 'Options',
    ticker: { panel: 'OptionsHistory', props: { offNotice: true }, section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'OBT', label: 'Options backtest', group: 'Options',
    ticker: { panel: 'Backtest', section: 'options', flag: 'optionsBacktestEnabled' } },
  { code: 'OSCR', label: 'Options screener', group: 'Options',
    // `?tab=options` is Screener.jsx's own deep-link param (read once at mount as the
    // initial tab) — without it "Full page" always landed on the Stocks tab.
    market: { panel: 'OptionsScreener', full: '/screener?tab=options', flag: 'optionsScreenerEnabled' } },
  { code: 'FLOW', label: 'Options flow', group: 'Options',
    // No shell flag (audit 2026-10-08, FLOW P1): the `Flow` panel is FlowGate -- the flow tab while
    // researchFlowTabEnabled is on; with it off it says so and offers the page doors.
    ticker: { panel: 'Flow', section: 'flow' },
    market: { door: '/options-flow', leavesTerminal: true, why: 'partner-owned page; its view routing lives in App.jsx\'s OptionsFlowRoute, which no panel can import' } },
  { code: 'GEX', label: 'Gamma exposure', group: 'Options',
    // GEX lives INSIDE the Options Flow page (its `gex` data mode), so it is a door — one
    // that opens that page ON its GEX view for the ticker (App.jsx OptionsFlowRoute).
    ticker: { door: '/options-flow?view=gex&ticker={sym}', leavesTerminal: true, why: 'GEX is a data mode inside the partner-owned Options Flow page' },
    market: { door: '/options-flow?view=gex', leavesTerminal: true, why: 'GEX is a data mode inside the partner-owned Options Flow page' } },
  { code: 'TIDE', label: 'Market Tide (net premium)', group: 'Options',
    market: { panel: 'MarketTide', props: { offNotice: true }, full: '/options-flow' } },
  { code: 'STRS', label: 'Options strategy screens', group: 'Options',
    market: { panel: 'StrategyScreens', props: { offNotice: true }, full: '/options-flow',
              flag: 'optionsStrategyScreensEnabled' } },
  { code: 'LIVE', label: 'Live flow tape', group: 'Options',
    market: { door: '/live-massive', leavesTerminal: true, why: 'a socket-fed tape page that owns a live stream connection per mount' } },

  { code: 'DP', label: 'Dark pool prints', group: 'Options', market: { door: '/dark-pool', leavesTerminal: true } },
  // `embedded` is the page's OWN prop (it already honours it inside the Options Flow page): the
  // panel header names the function, so the page drops its outer page chrome.
  { code: 'FREC', label: 'Flow record (scoreboard)', group: 'Options',
    market: { surface: '/flow-scoreboard', props: { embedded: true } } },

  // ── the market ──
  { code: 'WIRE', label: 'Morning Wire', group: 'Market', market: { surface: '/morning-wire' } },
  { code: 'BRD', label: 'Market breadth', group: 'Market', market: { surface: '/breadth' } },
  // `embedded` is the page's OWN prop (the /charts Screener widget passes it): no full-page <h1>
  // under a panel header that already says "SCR Stock screener".
  { code: 'SCR', label: 'Stock screener', group: 'Market',
    market: { surface: '/screener', props: { embedded: true } } },
  { code: 'U20', label: 'UCT 20', group: 'Market', market: { surface: '/uct-20' } },
  { code: 'DASH', label: 'Dashboard', group: 'Market',
    market: { door: '/dashboard', leavesTerminal: true, why: 'the dashboard is itself a bento of tiles and hosts the hub tile; a board inside a panel is a second shell' } },
  { code: 'CHRT', label: 'Charts workspace', group: 'Market',
    market: { door: '/charts', leavesTerminal: true, why: 'the /charts board is the panel host itself (the panel set refuses it as board-host)' } },
  { code: 'CATH', label: 'Catalysts history', group: 'Market', market: { surface: '/catalysts/history' } },
  { code: 'FORM', label: 'Formula reference', group: 'Market',
    market: { door: '/formulas/reference', leavesTerminal: true, why: 'App.jsx loads it with a bare lazy() and no lazyPage importer to share' } },
  { code: 'DESK', label: 'The Desk', group: 'Market',
    market: { door: '/desk', leavesTerminal: true, why: 'a video-and-article page with its own section router (?section=)' } },
  { code: 'JRNL', label: 'Journal', group: 'Market',
    market: { door: '/journal', leavesTerminal: true, why: 'a nested-route shell (JournalShellSelector + Outlet); its children need the router' } },
  { code: 'NB', label: 'Notebook', group: 'Market', market: { door: '/journal/notebook', leavesTerminal: true } },
  { code: 'RISK', label: 'Portfolio risk', group: 'Market', market: { surface: '/portfolio-heat' } },
  { code: 'COMM', label: 'Community', group: 'Market',
    market: { door: '/community', leavesTerminal: true, why: 'threads are routed (/community/:threadId); a panel cannot hold the thread URL' } },

  // ── the shell itself ──
  { code: 'HELP', label: 'Function list & syntax', group: 'Shell',
    market: { panel: 'Help', args: [{ kind: 'code', prop: 'focusCode' }] } },

  // ── comparison analytics (feature-gaps-2026-10-06: what leading terminals give a swing trader
  // that this one did not). Each is computed in its panel from `/api/bars` closes; no new route.
  // `with0` … `withN` are the comparator tickers typed after the code. A linked panel's security
  // leads the list, so `RRG` in a panel following NVDA plots NVDA among the sectors.
  { code: 'RRG', label: 'Relative rotation graph (sectors or any list vs SPY)', group: 'Market',
    ticker: { panel: 'Rrg', args: [{ kind: 'cadence', prop: 'tf' }, ...symbolArgs(11)] },
    market: { panel: 'Rrg', args: [{ kind: 'cadence', prop: 'tf' }, ...symbolArgs(12)] } },
  { code: 'REL', label: 'Relative performance & A/B ratio', group: 'Security',
    ticker: { panel: 'Rel', args: [{ kind: 'lookback', prop: 'lookback' }, ...symbolArgs(5)] },
    market: { panel: 'Rel', args: [{ kind: 'lookback', prop: 'lookback' }, ...symbolArgs(6)] } },
  { code: 'CORR', label: 'Correlation matrix (daily returns)', group: 'Security',
    ticker: { panel: 'Corr', args: [{ kind: 'lookback', prop: 'lookback' }, ...symbolArgs(9)] },
    market: { panel: 'Corr', args: [{ kind: 'lookback', prop: 'lookback' }, ...symbolArgs(10)] } },

  // ── movers (feature-gaps-2026-10-06 #7): one tape, several lenses (Bloomberg 06 §5), never a
  // rack of codes. Market-only: it has no security of its own, so it never follows a group; a
  // row CLICK loads that name into the linked group instead (panels/MoversPanel.jsx).
  { code: 'MOST', label: 'Market movers (gainers, losers, unusual volume)', group: 'Market',
    market: { panel: 'Movers', args: [{ kind: 'moversLens', prop: 'lens' }] } },

  // ── theme contribution (feature-gaps-2026-10-06 #4, Bloomberg `IMOV`): which names are driving a
  // UCT theme's move, equal-weighted because a UCT theme IS an equal-weight basket. An index or ETF
  // is refused in the panel (no index weights are held). The ticker variant opens the theme(s)
  // holding that name; a row CLICK loads that name into the linked group (panels/ImovPanel.jsx).
  // A theme can be NAMED (`IMOV semiconductors`, `IMOV AI / GPU Chips`): every word the window does
  // not take is the theme query (a REST spec, args.js `themeName`), resolved in the panel. `THEME`
  // (args.js THEME_MARKER) is what the panel writes back for a hand-picked theme.
  { code: 'IMOV', label: 'Theme movers (which names drive a UCT theme)', group: 'Market',
    ticker: { panel: 'Imov', args: [{ kind: 'contribWindow', prop: 'win' }, IMOV_THEME_ARG] },
    market: { panel: 'Imov', args: [{ kind: 'contribWindow', prop: 'win' }, IMOV_THEME_ARG] } },

  // ── my names (lane 9, top-10 #4 and #5) ──
  // ALRT: `NVDA ALRT 950` SETS a price alert through the existing /api/watchlist-alerts (the shell
  // does it from a typed command, never a panel mount: alertCommand.js); `NVDA ALRT` lists that
  // ticker's alerts and `ALRT` all of them, each with Delete.
  { code: 'ALRT', label: 'Price alerts (set one: NVDA ALRT 950)', group: 'Market',
    ticker: { panel: 'Alerts', args: [{ kind: 'alertPrice', prop: 'price' }] },
    market: { panel: 'Alerts', args: [{ kind: 'alertPrice', prop: 'price' }] } },
  // MON: the member's watchlists as one live table (Bloomberg's MON). `W` alone opens it too
  // (parseCommand: W is Wayfair's ticker, so `$W` still means the stock). `MON 2` / `MON W:id` /
  // `MON FLAGGED` pick a list. Market-only: a row CLICK loads the name into the linked group.
  { code: 'MON', label: 'Watchlist monitor (my lists, live; also W)', group: 'Market',
    market: { panel: 'Watchlist', args: [{ kind: 'watchlistPick', prop: 'list' }] } },
  // ── Compass grade (wave 3, lane 11, owner decision 2026-10-08): the buy / hold / skip verdict
  // Compass gives, read-only, via `/api/terminal/grade/:sym` over api/services/grade_ticker.py.
  // No shell flag: the server decides. While BRAIN_TOOLS_ENABLED (or the Brain Pack) is off the
  // route answers `available: false` and the panel says "Grade not available yet" (never a verdict).
  { code: 'GRADE', label: 'Compass grade (buy / hold / skip verdict)', group: 'Security',
    ticker: { panel: 'Grade' } },
]

/** Other spellings of a registered code: `alias → code`. The parser answers an alias with the code
 *  itself (`MOVERS UP` runs, titles and records as `MOST UP`), so a panel, its URL and its history
 *  never carry two names for one function. Lookups by the typed spelling still resolve (BY_CODE
 *  carries the alias), so nothing that checks a token against the registry can miss it.
 *  Kept outside FUNCTIONS on purpose: an alias is not a second function, so the registry rails,
 *  HELP's numbered list and the ranking see one entry. A saved board or share link that still
 *  names an alias opens its code (boardModel `normalizePanel`). */
export const CODE_ALIASES = Object.freeze({
  MOVERS: 'MOST',   // the word members type for the movers list (fn2-movers)
  WIIM: 'MOVE',     // merged into MOVE (owner decision 2026-10-08)
  BRKE: 'EE',       // folded into EE (owner decision 2026-10-08)
})

/** Codes REMOVED from the terminal (owner decision 2026-10-08), each with the plain note a member
 *  gets instead of "unknown function": typed, from a saved board, or from a share link. The pages
 *  behind them still exist; only the terminal code is gone. Not functions, not suggested, not in
 *  HELP's list. `$EXP` still loads the ticker EXP. */
export const RETIRED = Object.freeze({
  EXP: 'EXP (exports) was removed from the terminal. Your exports are in Settings, under Legal. For the ticker, type $EXP.',
  PMKT: 'PMKT (post-market) was removed from the terminal. The Post-market page is still in the app at /post-market.',
  SETL: 'SETL (setup library) was removed from the terminal. The Setup library page is still in the app at /setup-library.',
})

/** The note for a removed code, or null. */
export function retiredNote(token) {
  const t = String(token || '').toUpperCase()
  return Object.prototype.hasOwnProperty.call(RETIRED, t) ? RETIRED[t] : null
}

/** `n` comparator-ticker argument slots (`with0` … `with{n-1}`), for the comparison codes. */
function symbolArgs(n) {
  return Array.from({ length: n }, (_, i) => ({ kind: 'symbol', prop: `with${i}` }))
}

/** Codes a member will type for surfaces this build does not have. Answered, not refused.
 *  (OSCR and OBT stood here until 2026-10-02 — both were BUILT, and the shell denied them.) */
export const ABSENT = {}

/** Whether `auth` turns a variant's `flag` on. Plain key: `=== true`. Dotted: one key of an
 *  auth object. `obj.*`: ANY key of it (the Depth tab's own rule, `anyResearchDepth`). */
export function flagOn(auth, flag) {
  if (!flag) return true
  const [head, tail] = String(flag).split('.')
  if (!tail) return auth?.[head] === true
  const obj = auth?.[head]
  if (!obj || typeof obj !== 'object') return false
  if (tail === '*') return Object.values(obj).some((v) => v === true)
  return obj[tail] === true
}

export const BY_CODE = Object.freeze(Object.fromEntries([
  ...FUNCTIONS.map((f) => [f.code, f]),
  ...Object.entries(CODE_ALIASES).map(([alias, code]) => [alias, FUNCTIONS.find((f) => f.code === code)]),
]))

export function isCode(token) {
  return typeof token === 'string' && Object.prototype.hasOwnProperty.call(BY_CODE, token.toUpperCase())
}

/** The registered code a token names: an alias answers with its code, anything else upper-cased. */
export function canonicalCode(token) {
  const t = String(token || '').toUpperCase()
  return Object.prototype.hasOwnProperty.call(CODE_ALIASES, t) ? CODE_ALIASES[t] : t
}

/** The aliases of one code (HELP prints them beside it). */
export function aliasesOf(code) {
  return Object.keys(CODE_ALIASES).filter((a) => CODE_ALIASES[a] === code)
}

/** The variant a command selects: ticker when a security was given AND the code has one,
 *  else market. A ticker-only code with no security falls back to the panel's linked one
 *  (decided by the shell, not here) — this returns null and the reason. */
export function variantFor(code, hasTicker) {
  const fn = BY_CODE[code]
  if (!fn) return { variant: null, reason: 'unknown' }
  if (hasTicker && fn.ticker) return { variant: fn.ticker, scope: 'ticker' }
  if (!hasTicker && fn.market) return { variant: fn.market, scope: 'market' }
  if (hasTicker && !fn.ticker) return { variant: fn.market, scope: 'market', ignoredTicker: true }
  return { variant: null, reason: 'needs-ticker' }
}

/** Fill a door template: `{sym}` is the security, `{argN}` the Nth command argument, each
 *  URL-encoded. Returns null when a placeholder has no value (the shell then says what is
 *  missing — the variant's `needsArg` — rather than navigating to a broken URL). */
export function fillDoor(door, { sym = null, args = [] } = {}) {
  let missing = false
  const out = String(door).replace(/\{(sym|arg(\d+))\}/g, (_, name, n) => {
    const v = name === 'sym' ? sym : args[Number(n)]
    if (!v) { missing = true; return '' }
    return encodeURIComponent(String(v).toUpperCase())
  })
  return missing ? null : out
}

/** The Research › Depth panel a variant opens, DERIVED from its own flag (never typed a second
 *  time): `section: 'depth'` + `flag: 'researchDepth.<key>'` → `<key>`, the same key DepthTab
 *  anchors that panel by. The whole-tab code (`researchDepth.*`) and every non-depth section
 *  name no panel. */
export function depthPanelOf(variant) {
  if (variant?.section !== 'depth') return null
  const [head, tail] = String(variant.flag || '').split('.')
  return head === DEPTH && tail && tail !== '*' ? tail : null
}

/** Every `?section=` an entry can open on `/research/:sym`, for the full-page link. A Depth
 *  panel also carries `&panel=<key>` so the page lands on that panel, not the tab's top. */
export function researchHref(sym, section, panel = null) {
  if (!sym) return null
  const s = encodeURIComponent(String(sym).toUpperCase())
  if (!section) return `/research/${s}`
  const p = panel ? `&panel=${encodeURIComponent(panel)}` : ''
  return `/research/${s}?section=${encodeURIComponent(section)}${p}`
}

/** Prefix + edit-distance suggestions over the registry (and ABSENT, so a near-miss on an
 *  absent code still names the answer). Deterministic order: exact-prefix first, then distance. */
export function suggest(token, limit = 5) {
  const t = String(token || '').toUpperCase()
  if (!t) return []
  const pool = [...FUNCTIONS.map((f) => f.code), ...Object.keys(CODE_ALIASES), ...Object.keys(ABSENT)]
  const scored = pool.map((code) => {
    if (code.startsWith(t)) return [0, code.length, code]
    if (t.startsWith(code)) return [1, code.length, code]
    return [2 + editDistance(t, code), code.length, code]
  }).filter(([score]) => score <= 3)
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1))
  return scored.slice(0, limit).map(([, , code]) => code)
}

/** Exported (lane T3) so the published ranking's "close spelling" class uses THIS metric. */
export function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

// ── wave 3 lane 13 (product #6 "Mine"): APPENDED, never edited above, so it merges beside the
// lanes that own the entries. `MINE` (args.js `mine`) filters a panel to the member's own names —
// the calendar's My Stocks set (hooks/useMyTickers.js). Each panel's "Mine" chip writes the word
// back into its command, so a reload, `?cmd=` and history keep the filter.
//   CAL MINE        this week's earnings for your names only (Calendar's `mine` prop)
//   MOST [UP] MINE  movers that are yours           FREC MINE   the honest tape, your names
//   NVDA CN MINE    news across all your names       NVDA FEED MINE  new filings by your names
const MINE_ARG = Object.freeze({ kind: 'mine', prop: 'mine' })
for (const [code, side] of [['CAL', 'market'], ['MOST', 'market'], ['FREC', 'market'], ['CN', 'ticker'], ['FEED', 'ticker']]) {
  const v = BY_CODE[code]?.[side]
  if (v && !(v.args || []).some((a) => a.kind === 'mine')) v.args = [...(v.args || []), MINE_ARG]
}
