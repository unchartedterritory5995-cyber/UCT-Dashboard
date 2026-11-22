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
/** GRP's group-name REST argument (args.js `groupName`). `phrase`: every word after the code is the
 *  name, even one that is itself a function code (`GRP TECH`); see parseCommand.js `takesPhrase`. */
const GROUP_NAME_ARG = Object.freeze({ kind: 'groupName', prop: 'group', rest: true, phrase: true })

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
    // `marketAs`: with no ticker, ERN IS that code. `ERN` alone and `ERN TODAY` / `ERN NEXT`
    // (any argument CAL declares) open the calendar; `ERN NVDA` is still one company.
    marketAs: 'CAL',
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
  { code: 'ASK', label: 'Ask the UCT Agent', group: 'Security',
    ticker: { panel: 'AskAi', section: 'ai' },
    market: { door: '/ai-search', leavesTerminal: true, why: 'the AI search page owns a streaming conversation and its own history rail' } },
  // ── wave 7 lane D: stock-lens codes (terminal-native panels over routes that already exist) ──
  // PEER: the stock beside its peers, over /api/groups/peers (paid) + live prices + MON's returns read.
  { code: 'PEER', label: 'Peers and relative value', group: 'Security',
    ticker: { panel: 'Peer' } },
  // ETF: leveraged / inverse ETFs on a stock (paid family map) and, for an ETF, its holdings.
  { code: 'ETF', label: 'ETF exposure (leveraged ETFs, holdings)', group: 'Security',
    ticker: { panel: 'Etf' } },
  // TWT: the curated X feed's posts on a ticker, 7 days. Honours VITE_TWITTER_UI_ENABLED in the panel.
  { code: 'TWT', label: 'Social posts (curated X feed, 7 days)', group: 'Security',
    ticker: { panel: 'Twt' } },
  // WHO: what the UCT trading team posted and called on a ticker (the TSDR trader archive), with
  // each call's measured outcome. The research modal's own block, embedded; `section` is the
  // Catalysts tab, where that block lives on the full page. No shell flag: the archive's switch
  // and paid gate are the server's, and the panel says which one answered.
  { code: 'WHO', label: 'Trader archive (what the trading team posted and called)', group: 'Security',
    ticker: { panel: 'TraderArchive', section: 'catalysts' } },
  // SIZE: position size + R targets, pure client math. With a ticker the entry is prefilled from the
  // live price; without one it is a plain calculator.
  { code: 'SIZE', label: 'Position size and R calculator', group: 'Security',
    ticker: { panel: 'Size' },
    market: { panel: 'Size' } },
  // ── wave 8 lane F: CHK pre-trade check ──
  // CHK: a planned trade (setup, entry, stop) against the setup library's checklist, its win rate,
  // past trades of it in today's phase and the member's open book. Five existing paid reads in
  // api/routers/intelligence.py; no flag (the engine's own "not loaded" answer is said in words).
  { code: 'CHK', label: 'Pre-trade check (checklist, win rate, past trades, risk)', group: 'Security',
    ticker: { panel: 'Check' } },
  // ── end wave 8 lane F ──
  // TAS: Time & Sales, the live trade tape (COV-08 / FT-077, the T&S half; owner approval
  // 2026-10-12). Over the Massive T prints bar_stream already receives, streamed only while the
  // panel is open. Dark at the server (TIME_AND_SALES_ENABLED): unset, the panel says it is not on.
  { code: 'TAS', label: 'Time and sales (live trade tape)', group: 'Security',
    ticker: { panel: 'TimeSales' } },

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
  // COV-12 / FT-067: STOCK Act disclosures from FMP. `NVDA CONG` = both chambers for the name (also
  // shown on OWN beside insiders and 13F); bare `CONG` = the newest disclosures market-wide.
  { code: 'CONG', label: 'Congressional trades (Senate and House disclosures)', group: 'Research depth',
    ticker: { panel: 'CongressTrades', section: 'depth', flag: `${DEPTH}.congress_trades_enabled` },
    market: { panel: 'CongressLatest', flag: `${DEPTH}.congress_trades_enabled` } },

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

  // `NVDA DP` opens the page on that ticker: DarkPool.jsx reads `?ticker=` and opens its own
  // ticker search on the name (wave 4, lane A: the ticker used to be refused as market-wide).
  { code: 'DP', label: 'Dark pool prints', group: 'Options',
    ticker: { door: '/dark-pool?ticker={sym}', leavesTerminal: true },
    market: { door: '/dark-pool', leavesTerminal: true } },
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
  // `CATH 2026-10-01` / `CATH 10/01` opens that session's list (args.js `etDate`, Eastern time);
  // a CATS row opens it for the row's date (wave 4, lane A). Bare `CATH` opens the latest session.
  { code: 'CATH', label: 'Catalysts history', group: 'Market',
    market: { surface: '/catalysts/history', args: [{ kind: 'etDate', prop: 'date' }] } },
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

  // ── market lists (wave 7, lane C): terminal-native panels over routes the app already serves.
  // Market-only, no arguments unless named. A ticker in a row opens its DES beside the list.
  { code: 'NEWS', label: 'Market news tape (every headline)', group: 'Market',
    market: { panel: 'MarketNews' } },
  { code: 'REGM', label: 'Market regime and exposure call', group: 'Market',
    market: { panel: 'Regime' } },
  // INS CLUSTER (2026-11-21): the stocks 3 or more insiders bought within 10 business days, built
  // each night from the SEC's own Form 4 filings (GET /api/insider/clusters). Bare INS is unchanged.
  { code: 'INS', label: 'Insider buying (market-wide, last 7 days)', group: 'Market',
    market: { panel: 'InsiderBuys', args: [{ kind: 'insView', prop: 'view' }] } },
  { code: 'RSL', label: 'RS leaderboard (top names by RS rank)', group: 'Market',
    market: { panel: 'RsLeaders' } },
  // THMS 1W: the UCT theme leaderboard over a window (1D 1W 1M 3M; 1Y and YTD are chips in the panel).
  { code: 'THMS', label: 'Theme leaderboard (leaders and laggards by period)', group: 'Market',
    market: { panel: 'ThemeBoard', args: [{ kind: 'contribWindow', prop: 'win' }] } },
  // ── wave 8, lane E: market reads over routes the app already serves ──
  // SENT: AAII, NAAIM, put/call and Fear & Greed from the Breadth Monitor rows, plus the key
  // economic series /api/econ publishes (dark until ECON_ENABLED; the panel says so).
  { code: 'SENT', label: 'Sentiment and macro (AAII, NAAIM, put/call, Fear & Greed, economy)', group: 'Market',
    market: { panel: 'Sentiment' } },
  // RATES (2026-11-18): Treasury yields at every maturity with their changes in basis points, the
  // 10-year minus 2-year and 10-year minus 3-month spreads, and two small pictures
  // (GET /api/research/treasury-yields, read from the US Treasury's own published daily par yield curve; end of day).
  // RATE and YLD are real funds (an interest rate hedge ETF and a high yield ETF), so the code is neither.
  { code: 'RATES', label: 'Treasury yields and the yield curve (2-year, 10-year, 30-year, the spreads)', group: 'Market',
    market: { panel: 'Rates' } },
  // SCAT: a universe on two metrics (RS rank vs % off the 52-week high by default), over the /charts
  // Market Map's own /api/scatter reads. A dot opens DES beside the panel.
  // SCAT NDX CHG_1M RS_RANK: universe, then Y and X (scatterArgs.js); the panel writes picks back.
  { code: 'SCAT', label: 'Scatter a universe (RS rank vs % off 52-week high)', group: 'Market',
    market: { panel: 'Scatter', args: [{ kind: 'scatUniverse', prop: 'universe' }, { kind: 'scatY', prop: 'yKey' }, { kind: 'scatX', prop: 'xKey' }] } },
  // ── end wave 8, lane E ──

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
  // ── wave 8 lane G: the breakout loop (BRKO finds the names; PLAN turns one into alerts + a note) ──
  // BRKO: tight names near a pattern pivot with a rising RS line, one read of the nightly screener
  // snapshot (POST /api/screener/scan, fixed spec in panels/BreakoutPanel.jsx). No new route.
  { code: 'BRKO', label: 'Breakout-ready list (tight, near pivot, RS rising)', group: 'Market',
    market: { panel: 'Breakout' } },
  // PLAN: `NVDA PLAN` (or `NVDA PLAN 203 195` to prefill buy point and stop). Set alerts writes the
  // buy point and the stop through the SAME POST /api/watchlist-alerts ALRT uses; Log to journal
  // writes one Journal 2.0 notebook note (POST /api/j2/notes). Each only on a button press.
  { code: 'PLAN', label: 'Trade plan (buy point, stop, alerts, journal)', group: 'Security',
    ticker: { panel: 'Plan', args: [{ kind: 'alertPrice', prop: 'buy' }, { kind: 'alertPrice', prop: 'stop' }] } },
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

  // ── data wave 1 (2026-11-17): data the app already served but the Terminal could not reach. Each
  // is a terminal-native panel over an existing member route; no new route. A ticker in a row
  // loads into the linked group like every other list.
  // UPDG: the analyst actions in the latest morning wire (GET /api/analyst-actions), which no
  // screen showed. The list is dated by its wire, never worded as the current day's on its own.
  { code: 'UPDG', label: 'Analyst upgrades, downgrades and target changes (latest morning wire)', group: 'Market',
    market: { panel: 'Upgrades', args: [{ kind: 'analystKind', prop: 'kind' }] } },
  // HILO: new highs and lows OF THE DAY, per session, from the live scanner (GET /api/nhnl/live).
  // Not the 52-week lists: those are the drill lists of the Breadth Monitor.
  { code: 'HILO', label: 'New highs and lows of the day (live scanner)', group: 'Market',
    market: { panel: 'HighsLows', args: [{ kind: 'hiloSide', prop: 'side' }, { kind: 'hiloGroup', prop: 'group' }] } },
  // SCTR: the 11 sector funds ranked (GET /api/sector-strength). SECT is a real ETF, so not that.
  { code: 'SCTR', label: 'Sector funds ranked by performance', group: 'Market',
    market: { panel: 'Sectors', args: [{ kind: 'contribWindow', prop: 'period' }] } },
  // LEAD: the long-window lists only the /charts Scanner widget showed (GET /api/scans/*).
  { code: 'LEAD', label: 'Long-run leaders (gainers, volume records, new listings)', group: 'Market',
    market: { panel: 'LongRun', args: [{ kind: 'longRunLens', prop: 'lens' }] } },
  // EMOV: one day of earnings reporters and how each stock moved (GET /api/calendar/reactions with
  // the calendar week). ERX is ONE stock and its past reactions; this is the whole day.
  { code: 'EMOV', label: 'Earnings movers (how each reporter moved, by day)', group: 'Calendar',
    market: { panel: 'EarningsScoreboard', args: [{ kind: 'etDate', prop: 'date' }] } },
  // LVL: the gamma walls and dark pool levels of one stock (GET /api/signature/gex-walls and
  // /darkpool-levels), until now only drawable as chart indicators.
  { code: 'LVL', label: 'Key levels (call wall, put wall, zero gamma, dark pool)', group: 'Options',
    ticker: { panel: 'Levels' } },

  // ── data wave 2 (2026-11-17) ──
  // H52: the 52-WEEK highs and lows (the Breadth Monitor drill lists); HILO is highs and lows of
  // the day. Live in the session, else the latest finished session, and it says which.
  { code: 'H52', label: 'New 52-week highs and lows (Breadth Monitor lists)', group: 'Market',
    market: { panel: 'Highs52', args: [{ kind: 'hiloSide', prop: 'side' }] } },
  // RSS: the five UCT RS screens, read from the same saved-screens list and scan door the Screener
  // uses. The screens have their own server switch; off, the panel says so and runs no scan.
  { code: 'RSS', label: 'RS screens (leaders, top rating, new highs, exit warnings)', group: 'Market',
    market: { panel: 'RsScreens', args: [{ kind: 'rsScreen', prop: 'screen' }] } },
  // LEARN: the teaching UCT holds on one stock: Desk articles that chart it, Desk video moments
  // that mention it, Model Book appearances. Never the trader archive (owner ruling 2026-10-17).
  // LRN is a real ticker (Stride), so the code is the word.
  { code: 'LEARN', label: 'Lessons on this stock (Desk articles, videos, Model Book)', group: 'Security',
    ticker: { panel: 'Learn' } },

  // ── data wave 3 (2026-11-17) ──
  // PERF: the member's OWN trading stats, read from the Journal's own routes (the session's user
  // only): headline numbers, results by setup with the sample size, the closed-trade equity curve.
  // `PERF 2` picks the second Journal account, `PERF ALL` every account.
  { code: 'PERF', label: 'My trading stats (from your Journal)', group: 'Market',
    market: { panel: 'Performance', args: [{ kind: 'journalAccount', prop: 'account' }] } },
  // FLWL: two curated options-flow lists that had no place in the app's menus: Cream of the Crop
  // (until now only a Discord card) and the open flow board (the /open-flow page).
  { code: 'FLWL', label: 'Options flow lists (Cream of the Crop, open flow board)', group: 'Options',
    market: { panel: 'FlowLists', args: [{ kind: 'flowList', prop: 'list' }] } },

  // ── data wave 4 (2026-11-17) ──
  // CONFL: stocks where large dark pool size and long-dated options flow line up (GET
  // /api/confluence), until now a tab inside the Options Flow page. `CONFL BEAR` = bearish names.
  { code: 'CONFL', label: 'Confluence board (dark pool size with long-dated options flow)', group: 'Options',
    market: { panel: 'Confluence', args: [{ kind: 'confluenceLean', prop: 'lean' }] } },
  // ACCUM: the option contracts hit again and again in one session, under the day's bullish
  // against bearish premium (GET /api/live/massive/by-contract and /day-stats). `ACCUM 11/14`
  // = a past day, `ACCUM LATEST` = newest first.
  { code: 'ACCUM', label: 'Repeat-hit option contracts, with the day\'s flow read', group: 'Options',
    market: { panel: 'RepeatContracts', args: [{ kind: 'etDate', prop: 'date' }, { kind: 'repeatOrder', prop: 'order' }] } },
  // PCHG: every stock ranked by percent change between two dates (GET /api/scans/period-change).
  // `PCHG QTD`, `PCHG 2026-01-02 2026-06-30 LOSERS`; a start alone means "since that day".
  // `PCHG QTD SECTORS` ranks sectors, industries or themes over the same dates instead
  // (GET /api/scans/period-change-groups); a group opens to its own stocks.
  { code: 'PCHG', label: 'Performance between any two dates (stocks, sectors, industries, themes)', group: 'Market',
    market: { panel: 'PeriodChange', args: [{ kind: 'periodRange', prop: 'range' }, { kind: 'periodDate', prop: 'start' },
      { kind: 'periodDate', prop: 'end' }, { kind: 'periodUnit', prop: 'unit' }, { kind: 'periodSide', prop: 'side' }] } },
  // TSRC: a word or phrase searched across every indexed earnings call, with its monthly share
  // of calls (GET /api/earnings/transcript-search and /transcript-trend). `TSRC pricing power`.
  { code: 'TSRC', label: 'Search every earnings call', group: 'Market',
    market: { panel: 'CallSearch', args: [{ kind: 'callQuery', prop: 'q', rest: true }] } },
  // CEOS: what CEOs are saying. The phrases new and rising across a month of earnings calls
  // (GET /api/earnings/call-themes, worked out once a day); a phrase opens TSRC on it.
  // `CEOS RISING`, `CEOS NEW 2026-10`.
  { code: 'CEOS', label: 'What CEOs are saying (phrases rising across earnings calls)', group: 'Market',
    market: { panel: 'CallThemes', args: [{ kind: 'callThemesList', prop: 'list' }, { kind: 'callThemesMonth', prop: 'month' }] } },
  // EXMV: what the options market priced before each earnings report beside what the stock then
  // did, and the coming report's priced move (GET /api/research/expected-move/{sym} and
  // /api/earnings-intel/{sym}).
  { code: 'EXMV', label: 'Expected move into earnings, against past reports', group: 'Security',
    ticker: { panel: 'ExpectedMove' } },
  // TROT: the themes whose rank changed most between last week and this one (GET
  // /api/theme-rotation), which no screen drew. `TROT OUT` = only the themes rotating out.
  { code: 'TROT', label: 'Theme rotation (themes rotating in and out)', group: 'Market',
    market: { panel: 'ThemeRotation', args: [{ kind: 'rotationSide', prop: 'side' }] } },

  // ── data wave 6 (2026-11-17) ──
  // IDAY: the AI-written intraday update (GET /api/intraday-update): the market phase and the
  // session note ONLY, labelled as AI-written with the time it was written (owner ruling
  // 2026-11-17: the update's stock candidates are not shown to members).
  { code: 'IDAY', label: 'Intraday market update (AI-written)', group: 'Market',
    market: { panel: 'IntradayUpdate' } },
  // UNEWS (2026-11-19): UCT News, the live news wire the /charts widget already shows, as a
  // Terminal panel. No new route: the tab's one shared stream (lib/tradeExchangeNewsStreamManager)
  // and the widget's by-day read (POST /api/trade-exchange-news/day). `UNEWS` is the whole wire,
  // a day at a time; `NVDA UCN` is every archived headline that names NVDA. TWO codes over one
  // panel, the NEWS / CN precedent: a code with a security variant follows the board's linked
  // security, so one dual code would open `UNEWS` on whatever stock was loaded and the whole
  // wire would be a click away at best (seen on a real screen, 2026-11-19). No `flag:`: the
  // feed has no key on /api/auth/me, so a switched-off wire is said in the panel (TAS precedent).
  // Short labels: a panel header and the function rail cut a long one off, and the "is
  // market-wide" note prints UCN's label in lower case (so it carries no brand name).
  { code: 'UNEWS', label: 'UCT News (live news wire)', group: 'Market',
    market: { panel: 'UctNews' } },
  { code: 'UCN', label: 'News wire history for one stock', group: 'Security',
    ticker: { panel: 'UctNews' } },
  // TOPF: every Top Flow pick, open and expired, with how its contract has done since it was
  // picked (GET /api/top-flow/history); FREC keeps the aggregate record over the same picks.
  // `TOPF EXPIRED BEAR PEAK`.
  { code: 'TOPF', label: 'Top Flow picks (each pick and how its contract has done)', group: 'Options',
    market: { panel: 'TopFlow', args: [{ kind: 'topFlowStatus', prop: 'status' }, { kind: 'topFlowDirection', prop: 'direction' },
      { kind: 'topFlowSort', prop: 'sort' }] } },

  // ── the earnings season screen (owner pick, 2026-11-17) ──
  // ERNS: one day's reporters, before the open and after the close: the move options priced
  // before each report, how the stock moved on its past reports, and the result and move once it
  // lands (GET /api/calendar/earnings-season, which only reads what the server already holds).
  // EMOV is the scoreboard of who HAS reported; this is the day ahead too. `ERNS TONIGHT`,
  // `ERNS TOMORROW BMO`, `ERNS 11/19`.
  { code: 'ERNS', label: 'Earnings season (who reports, the priced move, past moves, the result)', group: 'Calendar',
    market: { panel: 'EarningsSeason', args: [{ kind: 'earningsDay', prop: 'day' }, { kind: 'earningsSession', prop: 'session' }] } },

  // ── my history on a stock (2026-11-18) ──
  // MYH: the member's OWN Journal record on one stock, read from the Journal's own routes (the
  // session's user only): what they hold in it now, their closed trades on it with the Journal's
  // own numbers, and the newest notes that name it. `NVDA MYH 2` picks the second Journal
  // account, `NVDA MYH ALL` every account (PERF's words). Never the trader archive: WHO, HIS and
  // CHK are other panels.
  { code: 'MYH', label: 'My history on this stock (your trades, position and notes)', group: 'Security',
    ticker: { panel: 'MyHistory', args: [{ kind: 'journalAccount', prop: 'account' }] } },

  // ── sector and theme drill-down (2026-11-18) ──
  // GRP: ONE sector, industry or UCT theme and its stocks, ranked by their change over one of
  // PCHG's one-click ranges, each with its RS rank and whether it is on the confluence board. No
  // new route: the two period-change answers, the RS ranking and the confluence board, joined in
  // the panel. `GRP XLK` (a sector fund is its sector), `GRP SEMICONDUCTORS 3M`,
  // `GRP THEME AI / GPU CHIPS`. SCTR, THMS, TROT and PCHG's opened group each have a door to it.
  { code: 'GRP', label: 'Group drill-down (one sector, industry or theme: its stocks ranked, with RS and flow)', group: 'Market',
    market: { panel: 'GroupDrill', args: [{ kind: 'periodRange', prop: 'range' }, GROUP_NAME_ARG] } },
  // ── unusual volume (2026-11-18) ──
  // UNVOL: every liquid stock trading far above its usual volume FOR THIS TIME OF DAY, highest
  // first: the Screener's own live reading (today's volume so far against the 30-session average
  // times the usual share of a day done by this minute), read through POST /api/screener/scan.
  // Outside the hours that reading exists it says so and shows the last full session. MOST RVOL is
  // a burst in the last minutes; LEAD VOL1Y is record volume. `UNVOL UP 3X`, `UNVOL DOWN`.
  // UVOL is the NYSE up-volume symbol and RVOL is one of MOST's own words, so the code is neither.
  { code: 'UNVOL', label: 'Unusual volume (stocks far above their usual volume for the time of day)', group: 'Market',
    market: { panel: 'UnusualVolume', args: [{ kind: 'unvolSide', prop: 'side' }, { kind: 'unvolMin', prop: 'min' }] } },
  // ── short interest (2026-11-18) ──
  // SHINT: one stock's FINRA short interest, report by report (shares short, the change from each
  // report to the next, days to cover, percent of float), and its daily off-exchange short volume
  // (GET /api/research/short-data/{sym}, read through the site's stock-data vendor). OWN shows the
  // newest report only, when this service already holds one; this is the dated record. `NVDA SHINT`.
  // SHRT is a real fund (Gotham Short Strategies ETF) and SHORT is CONFL's own word for bearish
  // (`CONFL SHORT`; a code in second place would make CONFL a ticker), so the code is neither.
  { code: 'SHINT', label: 'Short interest history (every report, days to cover, daily short volume)', group: 'Security',
    ticker: { panel: 'ShortInterest' } },
  // SHRTS: the newest FINRA report across the stocks UCT follows, each beside its previous
  // report, ranked (GET /api/research/short-interest-list). `SHRTS` = most days to cover,
  // `SHRTS UP` / `SHRTS DOWN` = biggest change since the last report, `SHRTS FLOAT` = percent of float.
  // SHORTS is six letters and a code is two to five, so the code drops the O.
  { code: 'SHRTS', label: 'Short interest list (most days to cover, biggest changes, percent of float)', group: 'Market',
    market: { panel: 'ShortList', args: [{ kind: 'shortRank', prop: 'rank' }] } },
  // ── dilution watch (2026-11-18) ──
  // DILU: what one company has filed with the SEC that bears on selling new shares, for the last
  // three years: shelf registrations and when they took effect, prospectus supplements, new
  // registrations and unregistered sales, each with its link to sec.gov
  // (GET /api/research/dilution-watch/{sym}, read from the company's public EDGAR filing index;
  // no filing document is read, so there are no share counts and no dollar amounts). CF lists a
  // company's filings; this answers "can it sell stock, and has it been?". `NVDA DILU`.
  // DILU is not in the site's stock universe, and a web search on 2026-11-18 found no stock or fund
  // trading under it. SHELF and OFFR would each name one kind of filing; the panel reads several.
  { code: 'DILU', label: 'Dilution watch (shelf registrations, offering documents, unregistered sales)', group: 'Security',
    ticker: { panel: 'Dilution' } },
  // ── open interest change (2026-11-19) ──
  // OIC: one stock's open interest, contract by contract, against the recorded day before
  // (GET /api/options-screener/oi-change/{sym}, read from UCT's own options log: the two newest
  // recorded days, every contract that had an ask, open interest or volume). `NVDA OIC` = calls and
  // puts, `NVDA OIC C` / `NVDA OIC P` = one side. OIC is not in the site's stock universe.
  { code: 'OIC', label: 'Open interest change (contracts that gained or lost the most since the day before)', group: 'Options',
    ticker: { panel: 'OiChange', args: [{ kind: 'oiSide', prop: 'side' }] } },
  // ── Market Tide by day (2026-11-19) ──
  // TIDEH: each finished session's net call and net put premium, as the server stored it once
  // after that session's close (GET /api/options/market-tide/history, behind Market Tide's own
  // switch). TIDE is today, minute by minute; TIDEH is the days. `TIDEH` = stocks and ETFs
  // together, `TIDEH STOCKS` / `TIDEH ETFS` = one side. TIDEH is not in the site's stock universe.
  { code: 'TIDEH', label: 'Market Tide by day (net premium, each session)', group: 'Options',
    market: { panel: 'TideHistory', args: [{ kind: 'tideScope', prop: 'scope' }] } },
  // SEASB: the seasonality board. SEAS is ONE stock's record by calendar month; this is the
  // market's: the four index funds and the eleven sector funds, month by month, from the daily
  // bars we hold (GET /api/research/seasonality-board, behind Seasonality's own switch, so it
  // carries SEAS's flag). `SEASB` = the median month, `SEASB AVG` = the average month. SEASB is
  // not in the site's stock universe.
  { code: 'SEASB', label: 'Seasonality board (index and sector funds, month by month)', group: 'Market',
    market: { panel: 'SeasonalityBoard', flag: 'seasonalityEnabled', args: [{ kind: 'seasMeasure', prop: 'measure' }] } },
  // ── Market wave A (2026-11-20): three market screens over routes the site already serves ──
  // COT: futures positioning from the CFTC's weekly Commitments of Traders report (GET /api/cot/*,
  // the routes the COT Data page reads). `COT` = every market, one row each; `COT GOLD` / `COT ES`
  // / `COT 10Y` = one market, by its code or a plain word (resolved in the panel against the
  // route's own list). COT is not in the site's stock universe. `open: true`: the market name is
  // any word of the right shape, so it never outranks another function's code (`COT CAL` keeps the
  // canonical order; parseCommand.js, the `LEAD IPO` branch).
  { code: 'COT', label: 'Futures positioning (Commitments of Traders)', group: 'Market',
    market: { panel: 'Cot', args: [{ kind: 'cotMarketName', prop: 'market', open: true }] } },
  // ANLG: the past sessions whose breadth looked most like the newest one, and what the S&P 500
  // did after each (GET /api/breadth-monitor/analogues, the answer the Analogue Deck on Breadth
  // draws). `ANLG` = the 5 closest, `ANLG 8` = that many (3 to 10). Not in the stock universe.
  { code: 'ANLG', label: 'Days like today (breadth analogues)', group: 'Market',
    market: { panel: 'Analogues', args: [{ kind: 'anlgCount', prop: 'count' }] } },
  // MKTS: index funds, VIX, Treasury yields and Bitcoin on one board, each with its own source and
  // as-of (GET /api/snapshot, the Treasury read RATES uses, the crypto quote when switched on).
  // No argument. MKTS is not in the site's stock universe.
  { code: 'MKTS', label: 'Markets board (index funds, volatility, rates, Bitcoin)', group: 'Market',
    market: { panel: 'MarketsBoard' } },
  // IPO / DVD / CACT (2026-11-20): three reads of what the calendar and the chart already hold.
  // IPO: the IPO calendar day by day (GET /api/calendar/ipos, the Calendar page's own route). The
  // stocks listed in the last year stay on LEAD's lens (`LEAD IPO`), which the panel links to.
  // DVD: the declared dividends and splits AHEAD. The route answers for a list of stocks, not the
  // whole market: bare `DVD` = the member's own stocks, `NVDA DVD` = one stock. It holds nothing past.
  // CACT: one stock's held splits and dividends (GET /api/research/corporate-actions/{ticker}, which
  // never asks a vendor) and its name or ticker changes. None of the three is in the stock universe.
  { code: 'IPO', label: 'IPO calendar (upcoming and priced deals)', group: 'Calendar',
    market: { panel: 'IpoCalendar' } },
  // DVD MARKET (2026-11-21): every ex-dividend date and split this week and next for every stock the site
  // follows (GET /api/research/market-dividends, Massive's reference feed read by date range on the server).
  // ALL is a stock (Allstate), so the view word is MARKET; bare `DVD` and `NVDA DVD` are unchanged. Both variants
  // take the word: a panel that follows a group's stock resolves to the per-stock variant (args.js `marketView`).
  { code: 'DVD', label: 'Dividend calendar (next ex-dates and splits ahead)', group: 'Calendar',
    ticker: { panel: 'DividendCalendar', args: [{ kind: 'marketView', prop: 'view' }] },
    market: { panel: 'DividendCalendar', args: [{ kind: 'marketView', prop: 'view' }] } },
  { code: 'CACT', label: 'Corporate actions (splits, dividends, name changes)', group: 'Security',
    ticker: { panel: 'CorporateActions' } },
  // AUCT (2026-11-21): the Treasury auctions coming up and the results of the recent ones
  // (GET /api/research/treasury-auctions, read from the US Treasury's Fiscal Data service; the
  // server holds one answer and looks for new records once each weekday evening). No argument.
  // AUCT is not in the site's stock universe.
  { code: 'AUCT', label: 'Treasury auctions (upcoming and recent results)', group: 'Market',
    market: { panel: 'TreasuryAuctions' } },
  // FED (2026-11-21): Fed watch. The newest FOMC statement with a word-level redline against the one
  // before, live Fed headlines from the news wire's own store, the Board's speeches and testimony,
  // this week's Fed speakers and the next meeting from the economic calendar, the policy rate, the
  // officials' median rate projections and the New York Fed's Survey of Market Expectations
  // (GET /api/research/fed-watch; the server reads the Board's and the New York Fed's public pages
  // on its own schedule). No odds from futures prices. FED is not in the site's stock universe.
  { code: 'FED', label: 'Fed watch (statements, speeches, Fed headlines, the next meeting)', group: 'Market',
    market: { panel: 'FedWatch' } },
  // ECON (2026-11-21): the economy board. The official prints that move markets, theme by theme
  // (inflation, jobs, growth and spending, housing, rates), each with the print before, the change,
  // the period, the release day and the next release from the release calendar, plus the releases
  // due in the next 7 days (GET /api/econ/latest: the econ routes' own flag and gate, answered from
  // what the econ service already published). No argument. ECO is a real stock (in the site's
  // universe), so the code is ECON, which is not.
  { code: 'ECON', label: 'Economy dashboard (CPI, jobs, GDP, spending, housing: last print, prior, next release)', group: 'Market',
    market: { panel: 'Economy' } },
  // LIQ (2026-11-21): liquidity. Net liquidity (the Fed's total assets minus the TGA minus overnight
  // reverse repo, a UCT calculation on each H.4.1 Wednesday) with its 1, 4, 13 and 52-week change and
  // two years of it, then the parts (the Fed's assets, the TGA weekly and daily, reverse repo, reserves,
  // M2, SOFR). GET /api/econ/latest + GET /api/econ/series: the econ routes' own flag and gate, answered
  // from what the econ service already published. No argument. LIQ is not in the site's universe.
  { code: 'LIQ', label: 'Liquidity (Fed balance sheet, TGA, reverse repo, net liquidity)', group: 'Market',
    market: { panel: 'Liquidity' } },
  // OIL (2026-11-21): the EIA's weekly oil report. The week's crude build or draw (the econ service's own
  // weekly change, a UCT calculation from the EIA's stock figures), when it came out and the next weekly
  // report from the release calendar; each series' latest week, the week before, the change and the same
  // week a year ago; two years of crude stocks (GET /api/econ/latest and /api/econ/series: the econ routes'
  // own flag and gate). No argument. OIL is not in the site's stock universe.
  { code: 'OIL', label: 'Weekly oil report (EIA: crude, gasoline, distillate stocks, production, refining, pump prices)', group: 'Market',
    market: { panel: 'Oil' } },
  // FUND (2026-11-21): one company's metrics over time, point in time from its SEC filings (revenue, EPS,
  // margins, cash flow, and the valuation ratios composed with UCT's stored closes), one column per fiscal
  // quarter, and up to three more companies beside it, lined up by calendar quarter. GET /api/fundamentals/
  // pit/catalog + /series/{SYM} (FUNDAMENTALS_PIT_ENABLED, the chart-data gate) and, for a valuation row, the
  // chart's weekly bars. `NVDA FUND AMD AVGO` compares (the tickers are ONE rest argument, so `FUND NVDA AMD`
  // keeps NVDA as the stock); `NVDA FUND PE` draws P/E as a line; `NVDA FUND REV+EPS+ROE` picks the rows.
  // FUND is not in the site's universe.
  { code: 'FUND', label: 'Company metrics over time (revenue, EPS, margins, cash flow, valuation; point in time from SEC filings)', group: 'Security',
    ticker: { panel: 'FundMetrics', args: [{ kind: 'fundMetric', prop: 'line' }, { kind: 'fundMetrics', prop: 'metrics' },
      { kind: 'fundPeers', prop: 'peers', rest: true }] } },
  // MKTH (2026-11-21): market history. Every decline of 10% or more in the S&P 500 or the Nasdaq-100
  // on closing prices (a correction to 20%, a bear market past it), newest first, each with its peak,
  // low, sessions down and the day the peak was regained; open one for the index 1, 3, 6 and 12 months
  // after the low and the 25 stocks that rose most in the 63 sessions after it, with sector medians
  // (GET /api/research/market-history, worked out by the server from its stored closes each evening).
  // `MKTH NDX` for the Nasdaq-100. MKTH is not in the site's stock universe.
  { code: 'MKTH', label: 'Market history (every correction and bear market, the rallies and their leaders)', group: 'Market',
    market: { panel: 'MarketHistory', args: [{ kind: 'mkthIndex', prop: 'index' }] } },
  // GRPS (2026-11-21): every sector (or industry) one row, sortable by any column: the median revenue and EPS growth,
  // margins, ROE and valuation of its stocks from their SEC filings as known that day (point in time), and its breadth
  // from UCT's stored closes (above the 20, 50 and 200-day averages, near the 52-week high, highs minus lows), worked
  // out once each evening (GET /api/research/group-stats, paid). GRP shows one sector's or industry's in full above
  // its ranked stocks. `GRPS INDUSTRIES`, `GRPS VALUATION`. A new code, not a view of SCTR: SCTR ranks the 11 sector
  // FUNDS by their price over a window. GRPS is not in the site's universe.
  { code: 'GRPS', label: 'Every sector or industry: median growth, margins, valuation and breadth', group: 'Market',
    market: { panel: 'GroupTable', args: [{ kind: 'groupsKind', prop: 'kind' }, { kind: 'groupsView', prop: 'view' }] } },
  // SEG (2026-11-21): one stock's revenue by product (or business line) and by region, the newest period ranked with
  // each segment's share and the last four side by side (GET /api/research/revenue-segments/{ticker}, read from
  // Financial Modeling Prep on the server). `NVDA SEG REGION QUARTERLY`. SEG is not in the site's universe.
  { code: 'SEG', label: 'Revenue by segment (product and region)', group: 'Security',
    ticker: { panel: 'RevenueSegments', args: [{ kind: 'segView', prop: 'view' }, { kind: 'segPeriod', prop: 'period' }] } },
  // MNA (2026-11-21): the latest announced mergers and acquisitions across the market, or (`NVDA MNA`) the deals
  // naming one company, each with its SEC filing (GET /api/research/mergers, read from Financial Modeling Prep on
  // the server). A dual code like DVD, and like DVD both variants take MARKET: a panel that follows a group's stock
  // shows that stock's deals, and `MNA MARKET` (or the panel's chip) is the whole market there. MNA is not in the
  // site's universe.
  { code: 'MNA', label: 'Mergers and acquisitions (latest deals)', group: 'Market',
    ticker: { panel: 'Mergers', args: [{ kind: 'marketView', prop: 'view' }] },
    market: { panel: 'Mergers', args: [{ kind: 'marketView', prop: 'view' }] } },
  // IDXC (2026-11-21): additions to and removals from the S&P 500, the Nasdaq 100 and the Dow 30, newest first, or
  // (`NVDA IDXC`) one stock's own index history (GET /api/research/index-changes, read from Financial Modeling Prep on
  // the server). `IDXC NASDAQ100`; SP500, SPX, NDX, DOW and DJIA are COT's market words, so IDXC's are S&P500,
  // NASDAQ100 and DOW30. Both variants take MARKET (as DVD and MNA) and the index word. IDXC is not in the site's
  // universe.
  { code: 'IDXC', label: 'Index changes (additions and removals)', group: 'Market',
    ticker: { panel: 'IndexChanges', args: [{ kind: 'marketView', prop: 'view' }, { kind: 'idxcIndex', prop: 'index' }] },
    market: { panel: 'IndexChanges', args: [{ kind: 'marketView', prop: 'view' }, { kind: 'idxcIndex', prop: 'index' }] } },
  // STAT (2026-11-21): one stock's statistics, worked out by the server from the daily prices it
  // already stores (GET /api/research/stock-stats/{ticker}, held for the session): ATR, realized
  // volatility, average daily range, the 52-week range, volume; beta and correlation against SPY and
  // its sector fund, up and down capture; returns 1W to 5Y, the best and worst day and week; its own
  // declines of 20% or more; and how it acted in every S&P 500 correction MKTH finds inside its
  // history. No arguments. STAT is not in the site's stock universe.
  { code: 'STAT', label: 'Stock statistics (volatility, beta, returns, drawdowns, how it acted in every market correction)', group: 'Security',
    ticker: { panel: 'StockStats' } },
  // EEHSC (2026-11-21): estimate revisions by sector. Among the stocks UCT tracks (the S&P 500 list the estimate job
  // follows and the stocks members opened EEH on; not the whole market), how many had the consensus for their next
  // fiscal quarter raised, cut or held over 7 or 30 days, by sector, with net breadth and the largest raises and cuts
  // (GET /api/research/estimate-history, the market read of EEH's own snapshot store, behind EEH's switch).
  // `EEHSC 7D REVENUE`. Not a GRPS view: another population (at most 600 tracked stocks, not the universe) behind another
  // switch. EEH for one stock, EEHSC for every sector. Not in the site's universe, and no word members type is within
  // the command line's close-spelling reach of it (a four-letter EEHS came up before PEER for "peers").
  { code: 'EEHSC', label: 'Estimate revisions by sector', group: 'Market',
    market: { panel: 'RevisionBreadth', flag: 'estimateHistoryEnabled',
      args: [{ kind: 'eehscWindow', prop: 'window' }, { kind: 'eehscMetric', prop: 'metric' }] } },
  // PUBR (2026-11-22): one company's public records from four government agencies: its federal contract awards
  // (USAspending.gov), the clinical trials it leads (ClinicalTrials.gov), its FDA drug approvals (openFDA, Drugs@FDA)
  // and its lobbying (LDA.gov), each matched to the ticker by the company's names, with the names shown
  // (GET /api/research/public-records/{ticker}; the server reads each agency at most once a day per company).
  // `NVDA PUBR TRIALS`. The brief named it RECS, which is a real fund (Columbia Research Enhanced Core ETF, NYSE Arca);
  // PUBR is not in the site's universe and a web search on 2026-11-22 found no stock or fund trading under it.
  { code: 'PUBR', label: 'Public records (government contracts, clinical trials, FDA approvals, lobbying)', group: 'Security',
    ticker: { panel: 'PublicRecords', args: [{ kind: 'pubrView', prop: 'view' }] } },
  // EVST (2026-11-22): "what happened next", a member's own historical study. Every time a condition held on
  // a series (market breadth, a technical indicator over UCT's stored closes, CFTC futures positioning), what
  // did a symbol do over up to four windows, against every session; every episode listed, the engine's method
  // in words (GET /api/research/event-study and /series, worked out by the server's event-study engine from
  // stored data only, held per spec per evening, paid). `EVST` measures SPY; `NVDA EVST` measures NVDA. The
  // member's last study is kept in the browser. No arguments. EVST is not in the site's stock universe.
  { code: 'EVST', label: 'What happened next (build your own historical study)', group: 'Market',
    ticker: { panel: 'EventStudy' },
    market: { panel: 'EventStudy' } },
  // SETH (2026-11-22): how setups acted. A fixed library of seven chart setups (a breakout to a new 52-week high on
  // volume, a pullback to the 21-day EMA, a gap up, a reclaim of the 50-day, an inside week near a high, three weeks
  // tight, a pocket pivot), each a screen the Screener's own evaluator answers, and how each did 5, 20 and 60 sessions
  // on in every S&P 500 correction, in the first 3 months after each low and later in each uptrend (GET
  // /api/research/setup-history, worked out by the server once a week from the prices it stores, with the screen
  // backtester's floor, same-day control and survivorship sentence). `NVDA SETH` is every time each setup fired on that
  // stock (GET /api/research/setup-history/{ticker}); `SETH MARKET` the study on a panel that follows a stock.
  // SETH is not in the site's universe.
  { code: 'SETH', label: 'How setups acted (breakouts, pullbacks, gaps in every correction and rally)', group: 'Market',
    ticker: { panel: 'SetupHistory', args: [{ kind: 'marketView', prop: 'view' }] },
    market: { panel: 'SetupHistory', args: [{ kind: 'marketView', prop: 'view' }] } },
  // VFP (2026-11-22): one stock's volume footprint, worked out by the server from the daily bars it already stores
  // (GET /api/research/volume-footprint/{ticker}, held for the session): accumulation and distribution days over 25
  // and 50 sessions and the up/down volume ratio, the 10 heaviest sessions of the last year, every pocket pivot of
  // the last year, and every gap of 3% or more in the history held with when it filled; earnings marks from the
  // report dates the site's earnings page already holds. No arguments. VFP is not in the site's universe, and a web
  // search on 2026-11-22 found no stock or fund listed under it.
  { code: 'VFP', label: 'Volume footprint and gaps (accumulation and distribution days, pocket pivots, every gap of 3% or more)', group: 'Security',
    ticker: { panel: 'VolumeFootprint' } },
  // FCTX (2026-11-22): how one stock trades, worked out by the server from the daily closes it already stores (GET
  // /api/research/factor-exposure/{ticker}, held for the session): an ordinary least-squares regression of its daily
  // return on six fund spreads (SPY; IWM, MTUM, QUAL and USMV less SPY; IWF less IWD) over the newest 252 common
  // sessions and the 252 before them, each loading with its t-statistic, R-squared and the idiosyncratic share, and a
  // plain line built only from loadings whose t is above 2. No arguments. FCTX is not in the site's universe, and a
  // web search on 2026-11-22 found no stock or fund listed under it (FEX, the brief's first pick, is a First Trust fund).
  { code: 'FCTX', label: 'Factor exposure (market, size, growth vs value, momentum, quality, low volatility)', group: 'Security',
    ticker: { panel: 'FactorExposure' } },
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

// ── wave 9 lane 6 (discoverability): APPENDED, never edited above, so it merges beside the lanes
// that own the entries. Registry DATA a member finds a code by, read by HELP, the command line's
// suggestions (ranking.js) and the Ctrl/Cmd-K palette (paletteGrammar.js). Nothing here is a second
// list of functions: every key must be a registered code (railed in functionWords.test.js), and a
// code with no entry still gets a derived example and its label's own words.
//   `example`  one realistic command HELP shows (default: `NVDA CODE`, or `CODE` when market-only).
//   `keywords` plain words a swing trader types for it ("breakout", "position size"), lower case.
//   `note`     what the panel says when its feed is switched off at the server (no shell flag).
const FUNCTION_WORDS = {
  CAL: { example: 'CAL NEXT', keywords: ['earnings', 'calendar', 'events', 'earnings this week'] },
  MYST: { keywords: ['my stocks'] },
  ERN: { keywords: ['earnings date', 'earnings report'] },
  DES: { keywords: ['overview', 'company', 'profile', 'description'] },
  GP: { example: 'NVDA GP W', keywords: ['chart', 'price chart', 'graph'] },
  CN: { keywords: ['news', 'company news'] },
  CATS: { keywords: ['catalysts'] },
  MOVE: { keywords: ['why is it moving', 'why moving', 'wiim'], note: 'Says so if this read is switched off.' },
  TECH: { keywords: ['technicals', 'support', 'resistance', 'moving averages'] },
  FA: { keywords: ['financials', 'fundamentals', 'revenue', 'income statement', 'balance sheet'] },
  EE: { keywords: ['estimates', 'eps', 'consensus'] },
  EEH: { keywords: ['revisions', 'estimate revisions'] },
  ANR: { keywords: ['analysts', 'upgrades', 'downgrades', 'price target'] },
  RTG: { keywords: ['rating', 'score'] },
  OWN: { keywords: ['ownership', 'institutions', 'holders', '13f', 'short interest', 'short float', 'days to cover'] },
  PPL: { keywords: ['executives', 'management', 'ceo'] },
  TRAN: { keywords: ['transcript', 'conference call', 'earnings call'] },
  MB: { keywords: ['model book'] },
  SEAS: { keywords: ['seasonality'] },
  CF: { keywords: ['filings', 'sec', '10-k', '10-q'] },
  FIL: { keywords: ['blackline', 'filing changes'] },
  RSCH: { keywords: ['my notes', 'research notes'] },
  CMP: { example: 'NVDA CMP AMD', keywords: ['compare', 'versus', 'side by side'] },
  ASK: { keywords: ['ai', 'question'] },
  PEER: { keywords: ['peers', 'competitors', 'comps', 'relative value', 'valuation'] },
  ETF: { keywords: ['etf', 'leveraged etf', 'holdings'] },
  TWT: { keywords: ['twitter', 'tweets', 'social'], note: 'Says so if the X feed is switched off.' },
  WHO: { keywords: ['trader archive', 'team calls', 'tsdr', 'what did the team say'],
    note: 'Says so if the trader archive is switched off.' },
  SIZE: { keywords: ['position size', 'sizing', 'shares', 'risk per trade', 'r multiple'] },
  CHK: { keywords: ['check', 'checklist', 'pre-trade', 'win rate'], note: 'Says so if the setup library is not loaded.' },
  TAS: { keywords: ['time and sales', 'time & sales', 'tape', 'prints', 'trades', 'block trades'],
    note: 'Says so if the live tape is switched off.' },
  ERX: { keywords: ['earnings reaction'] },
  FTD: { keywords: ['fails to deliver'] },
  ATTN: { keywords: ['mentions', 'attention'] },
  CONG: { keywords: ['congress', 'congressional trades', 'senate', 'house', 'politicians', 'stock act'],
    note: 'Says so if this read is switched off.' },
  OMON: { keywords: ['options chain', 'options'] },
  OVS: { keywords: ['vol surface', 'skew'] },
  IVH: { keywords: ['iv', 'implied volatility'] },
  POS: { keywords: ['max pain', 'positioning'] },
  OHIS: { keywords: ['straddle', 'expected move'] },
  OBT: { keywords: ['options backtest'] },
  FLOW: { keywords: ['options flow', 'unusual options'] },
  GEX: { keywords: ['gamma', 'gamma exposure'] },
  TIDE: { keywords: ['market tide', 'net premium'] },
  LIVE: { keywords: ['live tape'] },
  DP: { keywords: ['dark pool'] },
  FREC: { keywords: ['flow record', 'scoreboard'] },
  WIRE: { keywords: ['morning wire', 'premarket', 'game plan'] },
  BRD: { keywords: ['breadth', 'advance decline'] },
  SCR: { keywords: ['screener', 'scan', 'filter'] },
  U20: { keywords: ['uct 20', 'top 20'] },
  CATH: { example: 'CATH 10/01', keywords: ['catalyst history'] },
  JRNL: { keywords: ['journal', 'trade log'] },
  NB: { keywords: ['notebook'] },
  RISK: { keywords: ['portfolio risk', 'heat', 'open risk'] },
  COMM: { keywords: ['community', 'chat'] },
  NEWS: { keywords: ['market news', 'news tape', 'headlines'] },
  REGM: { keywords: ['regime', 'market regime', 'exposure', 'market trend'] },
  INS: { keywords: ['insider', 'insider buying', 'insiders', 'form 4', 'cluster buys', 'insider clusters', 'insider cluster buys'] },
  RSL: { keywords: ['relative strength', 'rs rank', 'rs leaders', 'leaders'] },
  THMS: { example: 'THMS 1W', keywords: ['theme', 'themes', 'groups', 'industries', 'leading themes'] },
  SENT: { keywords: ['sentiment', 'aaii', 'naaim', 'fear and greed', 'put call', 'macro', 'economy'],
    note: 'The economy rows say so if that feed is switched off.' },
  RATES: { keywords: ['treasury yields', 'yield curve', 'interest rates', 'bond yields', '10 year yield', '2 year yield',
    'inverted curve', '2s10s', 'real yields', 'tips yields', 'breakeven inflation'],
    note: 'End-of-day figures, one a day. Real yields and breakevens are their own block, with their own date.' },
  SCAT: { keywords: ['scatter', 'scatter plot', 'market map'] },
  HELP: { example: 'HELP CHK', keywords: ['help', 'functions', 'commands'] },
  RRG: { keywords: ['rotation', 'sector rotation', 'sectors'] },
  REL: { example: 'NVDA REL SMH', keywords: ['relative performance', 'ratio'] },
  CORR: { example: 'NVDA CORR AMD AVGO', keywords: ['correlation'] },
  MOST: { example: 'MOST UP', keywords: ['movers', 'gainers', 'losers', 'unusual volume', 'top gainers', 'gappers',
    'premarket gappers', 'pre-market gappers', 'why is it gapping'] },
  IMOV: { example: 'IMOV semiconductors', keywords: ['theme movers', 'theme drivers'] },
  ALRT: { example: 'NVDA ALRT 950', keywords: ['alert', 'alerts', 'price alert'] },
  BRKO: { keywords: ['breakout', 'breakouts', 'pivot', 'tight', 'setups', 'near pivot'] },
  PLAN: { example: 'NVDA PLAN 203 195', keywords: ['plan', 'trade plan', 'buy point', 'stop', 'entry'] },
  MON: { keywords: ['watchlist', 'watchlists', 'monitor'] },
  GRADE: { keywords: ['grade', 'compass', 'verdict', 'buy or skip'], note: 'Says so if grades are not available yet.' },
  UPDG: { example: 'UPDG DOWN', keywords: ['analyst actions', 'rating changes', 'target changes', 'upgrades and downgrades'] },
  HILO: { example: 'HILO LOWS', keywords: ['new highs', 'new lows', 'highs and lows'],
    note: 'Says so if the live scanner is switched off or the market is closed.' },
  SCTR: { example: 'SCTR 1M', keywords: ['sector performance', 'sector funds', 'sector ranking'] },
  LEAD: { example: 'LEAD 60D', keywords: ['30 day gainers', 'long run leaders', 'volume record', 'new listings', 'recent ipos'] },
  EMOV: { example: 'EMOV 11/12', keywords: ['earnings reactions', 'earnings movers', 'earnings scoreboard', 'who reported'] },
  LVL: { keywords: ['key levels', 'call wall', 'put wall', 'zero gamma', 'dark pool levels'] },
  H52: { example: 'H52 LOWS', keywords: ['52 week highs', '52 week lows', 'yearly highs', 'new 52 week highs'] },
  RSS: { example: 'RSS NHBP', keywords: ['rs screens', 'rs new highs', 'rs exit warnings', 'top rs rating'],
    note: 'Says so if the RS screens are switched off.' },
  LEARN: { example: 'NVDA LEARN', keywords: ['lessons', 'desk articles', 'desk videos', 'learn about this stock'] },
  PERF: { example: 'PERF ALL', keywords: ['my stats', 'trading stats', 'win rate', 'expectancy', 'equity curve', 'my performance'] },
  FLWL: { example: 'FLWL OPEN', keywords: ['cream of the crop', 'open flow board', 'flow lists', 'open flow'] },
  CONFL: { example: 'CONFL BULL', keywords: ['confluence', 'dark pool and flow', 'long-dated flow', 'leaps'] },
  ACCUM: { example: 'ACCUM LATEST', keywords: ['repeat hits', 'accumulation', 'repeat contracts', 'flow read', 'bullish premium'] },
  PCHG: { example: 'PCHG QTD SECTORS', keywords: ['period change', 'performance between dates', 'since a date', 'best this quarter', 'custom range',
    'sector performance', 'industry performance', 'theme performance'] },
  TSRC: { example: 'TSRC pricing power', keywords: ['search earnings calls', 'transcript search', 'who said', 'call mentions'] },
  CEOS: { example: 'CEOS RISING', keywords: ['what ceos are saying', 'rising phrases', 'earnings call themes', 'new themes', 'buzzwords'] },
  EXMV: { example: 'NVDA EXMV', keywords: ['expected move', 'implied move', 'earnings straddle', 'priced move'] },
  TROT: { example: 'TROT IN', keywords: ['theme rotation', 'rotating in', 'rotating out', 'themes gaining rank'] },
  IDAY: { keywords: ['intraday update', 'market update', 'midday update', 'session note'] },
  UNEWS: { keywords: ['uct news', 'news wire', 'live news', 'breaking news', 'live headlines', 'trade exchange'],
    note: 'Says so if the news wire is switched off.' },
  UCN: { example: 'NVDA UCN', keywords: ['uct news for a stock', 'stock news wire', 'news history', 'headlines for a stock', 'trade exchange'],
    note: 'Says so if the news wire is switched off.' },
  TOPF: { example: 'TOPF OPEN', keywords: ['top flow picks', 'flow picks', 'pick by pick', 'how the picks did'] },
  ERNS: { example: 'ERNS TONIGHT', keywords: ['earnings season', 'who reports tonight', 'who reports tomorrow', 'earnings tonight',
    'reporting after the close', 'reporting before the open', 'priced move for earnings'] },
  MYH: { example: 'NVDA MYH', keywords: ['my history', 'my trades', 'my record', 'trade history', 'my notes on a stock', 'have i traded it'] },
  GRP: { example: 'GRP XLK', keywords: ['group drill-down', 'drill down', 'stocks in a sector', 'stocks in a theme', 'stocks in an industry',
    'sector stocks', 'theme stocks', 'industry stocks'] },
  UNVOL: { example: 'UNVOL UP', keywords: ['relative volume', 'rvol', 'volume leaders', 'heavy volume', 'volume vs usual',
    'above average volume', 'volume surge'] },
  SHINT: { example: 'NVDA SHINT', keywords: ['short interest history', 'short volume', 'shares short', 'finra short interest',
    'short interest change'] },
  SHRTS: { example: 'SHRTS UP', keywords: ['short interest list', 'most shorted', 'short squeeze', 'days to cover list',
    'shorts rising', 'short covering'] },
  DILU: { example: 'NVDA DILU', keywords: ['dilution', 'dilution watch', 'shelf registration', 'share offering', 'stock offering',
    'secondary offering', 'atm offering', 'prospectus supplement', 'share issuance'],
    note: 'From the SEC filing index only: what was filed and when, never amounts.' },
  OIC: { example: 'NVDA OIC', keywords: ['open interest change', 'oi change', 'open interest by strike', 'change in open interest',
    'new option positions', 'open interest'],
    note: 'Recorded once a day after the close; never live, and never who opened or which way.' },
  TIDEH: { example: 'TIDEH', keywords: ['market tide by day', 'tide history', 'daily net premium', 'net premium by day',
    'net premium history', 'options premium by day'],
    note: 'One row per finished session, stored once after the close; history starts at the first stored day.' },
  SEASB: { example: 'SEASB', keywords: ['seasonality board', 'sector seasonality', 'best months', 'index seasonality',
    'seasonality by sector', 'monthly seasonality', 'month by month'],
    note: 'How each index and sector fund has done in each calendar month. A record, not a forecast.' },
  COT: { example: 'COT GOLD', keywords: ['cot', 'commitments of traders', 'futures positioning', 'commercials', 'large speculators',
    'cftc'],
    note: 'Weekly: positions as of each Tuesday, published the following Friday. Net positions, not the two sides.' },
  ANLG: { example: 'ANLG', keywords: ['analogues', 'analogs', 'days like today', 'similar days', 'what happened next',
    'breadth analogues'],
    note: 'Past sessions with similar breadth and what the S&P 500 did after each. A record, not a forecast.' },
  MKTS: { example: 'MKTS', keywords: ['markets', 'cross asset', 'indexes', 'vix', 'bitcoin', 'markets board'],
    note: 'Index funds, VIX, Treasury yields and Bitcoin, each with its own source and time. No futures or commodity prices.' },
  IPO: { example: 'IPO', keywords: ['ipo', 'ipos', 'ipo calendar', 'new issues', 'upcoming ipos', 'priced ipos'],
    note: 'Deals from last week to next week, day by day. Stocks listed in the last year are on LEAD IPO.' },
  DVD: { example: 'DVD', keywords: ['dividend', 'dividends', 'dividend calendar', 'ex dividend', 'ex-date', 'upcoming dividends',
    'upcoming splits', 'market dividends', 'ex dividend this week', 'splits this week'],
    note: 'Declared dividends and splits ahead for your stocks, for one stock (NVDA DVD), or the whole market this week and next (DVD MARKET). Nothing past.' },
  CACT: { example: 'NVDA CACT', keywords: ['corporate actions', 'splits', 'stock split', 'dividend history', 'name change',
    'ticker change', 'past dividends'],
    note: 'Only what the server already holds for the stock: splits, dividends by ex-date and ticker changes.' },
  AUCT: { example: 'AUCT', keywords: ['treasury auctions', 'auctions', 'bond auction', 'auction results', 'bid to cover',
    'indirect bidders', 'treasury supply'],
    note: 'Auctions ahead and the last 45 days of results. A result shows the evening of the auction day.' },
  FED: { example: 'FED', keywords: ['fed', 'fomc', 'federal reserve', 'fed speakers', 'powell', 'fed statement', 'rate decision',
    'fed headlines', 'dot plot', 'fed minutes'],
    note: 'Statements, speeches and projections from the Board, live Fed headlines and a survey of market professionals. No odds from futures prices.' },
  // 'economy' stays with SENT (its own keyword since wave 8).
  ECON: { example: 'ECON', keywords: ['economic data', 'cpi', 'inflation', 'jobs report', 'payrolls', 'unemployment', 'gdp',
    'retail sales', 'jobless claims', 'pce', 'housing starts'],
    note: 'Official releases from the agencies, each with the print before and the next release date. No forecasts.' },
  // 'fed' and 'federal reserve' stay with FED, 'treasury' with RATES. 'qt' and 'm2' are under the
  // three-letter floor of the word search: 'quantitative tightening' and 'money supply' find LIQ.
  LIQ: { example: 'LIQ', keywords: ['liquidity', 'net liquidity', 'fed balance sheet', 'reverse repo', 'rrp', 'tga',
    'qt', 'quantitative tightening', 'm2', 'money supply', 'reserves'],
    note: 'Net liquidity is a UCT calculation from the Fed and Treasury figures, each part beside it. No forecasts.' },
  // None of these words was another code's keyword. 'spr' only reached RATES through "spreads" in its label (the
  // lowest score); RATES still follows OIL for it. No keyword makes a generic word ("prices") find OIL.
  OIL: { example: 'OIL', keywords: ['oil', 'crude', 'crude inventories', 'eia', 'oil inventories', 'gasoline', 'distillates',
    'refinery', 'spr'],
    note: "The EIA's own weekly figures, with the next report's date. No futures prices and no forecasts." },
  // 'fundamentals', 'revenue', 'income statement' and 'financials' stay with FA, 'eps' with EE, 'valuation'
  // with PEER: each of those words still finds its own function first.
  FUND: { example: 'NVDA FUND', keywords: ['fundamentals history', 'metrics', 'revenue history', 'eps history', 'margins',
    'fcf', 'roe', 'pe history', 'valuation history', 'financial history'],
    note: "Point in time from SEC filings: each figure dated by when its filing became public. Valuation is composed with UCT's stored prices." },
  MKTH: { example: 'MKTH', keywords: ['market history', 'corrections', 'bear market', 'drawdowns', 'rallies', 'past corrections',
    'rally leaders'],
    note: 'Every decline of 10% or more on closing prices, the rally after each low and its leaders. A record, not a forecast.' },
  // 'breadth' stays with BRD, 'sectors' with RRG and 'sector performance' with SCTR: each still finds its own first.
  GRPS: { example: 'GRPS INDUSTRIES', keywords: ['sector fundamentals', 'industry fundamentals', 'sector breadth', 'industry breadth',
    'sector valuation', 'sector margins', 'group fundamentals', 'sector table', 'industry table'],
    note: "Medians of each group's stocks from their SEC filings as known that day, and its breadth from stored closes; worked out each evening." },
  // 'revenue' stays with FA and 'geographic'/'regions' had no owner.
  SEG: { example: 'NVDA SEG', keywords: ['revenue by segment', 'segments', 'segment revenue', 'product revenue', 'revenue by product',
    'revenue by region', 'geographic revenue', 'business segments', 'revenue mix'],
    note: 'As the company reports its segments, period by period. A share is of the segments listed, which may not add up to total revenue.' },
  MNA: { example: 'MNA', keywords: ['mergers', 'acquisitions', 'mergers and acquisitions', 'm&a', 'merger', 'takeover', 'takeovers',
    'buyout', 'acquired', 'deal filings'],
    note: 'From SEC filings: the acquirer, the target as the filing names it, and the filing. One company: NVDA MNA. On a panel that follows a stock, MNA MARKET is the whole market.' },
  IDXC: { example: 'IDXC', keywords: ['index changes', 'index additions', 'index removals', 'added to the s&p', 'removed from the index',
    'index rebalance', 'sp500 changes', 'index deletions', 'index history'],
    note: 'The provider\'s list of additions and removals with the stock replaced and the reason. One stock: NVDA IDXC. On a panel that follows a stock, IDXC MARKET is all three indexes.' },
  // STAT: "volatility" stays IVH's and VOL's, "correlation" CORR's, "drawdowns" MKTH's (each answers it first today)
  STAT: { example: 'NVDA STAT', keywords: ['stock statistics', 'statistics', 'stock stats', 'atr', 'beta', 'max drawdown',
    'up capture', 'down capture'],
    note: "From UCT's stored daily prices (split-adjusted, price only). A record, not a forecast." },
  // 'revisions' and 'estimate revisions' stay with EEH (one stock's history), 'breadth' with BRD.
  EEHSC: { example: 'EEHSC', keywords: ['revision breadth', 'estimate revisions by sector', 'revisions by sector', 'sector revisions',
    'earnings revisions by sector', 'estimate breadth'],
    note: 'Among the stocks UCT tracks (the S&P 500 list and stocks members looked at), not the whole market. A change of more than 0.5% either way is a raise or a cut. One stock: NVDA EEH.' },
  // A word another panel owns keeps finding it: 'records' (in LEAD's title), 'contract' and 'contracts' (ACCUM), 'spend'
  // (ECON), 'fed' and 'federal' (FED). So no keyword here holds 'records', 'contract' or 'spend'; the label carries
  // "public records" for a one-word search on 'public'.
  PUBR: { example: 'NVDA PUBR', keywords: ['government contracts', 'federal contracts', 'clinical trials', 'fda approvals',
    'drug approvals', 'lobbying', 'usaspending'],
    note: 'From the agencies\' own records, matched to the company by name, with the matched names shown. One section: NVDA PUBR TRIALS.' },
  // EVST: "what happened next" stays ANLG's (days like today); "backtest" and "seasonality" stay where they are.
  EVST: { example: 'EVST', keywords: ['event study', 'event studies', 'historical study', 'build a study', 'study builder',
    'what happened after'],
    note: "Pick a condition on market breadth, a technical indicator or COT positioning; see what a symbol did after every time it held. From stored data. A record, not a forecast." },
  // 'setups' and 'breakout' stay BRKO's (today's breakout-ready list), 'correction' and 'rallies' MKTH's; no keyword
  // holds 'study' or 'returns' (a one-word search on either found SETH first).
  SETH: { example: 'SETH', keywords: ['setup history', 'how setups acted', 'breakout history', 'setup backtest',
    'setups by market phase'],
    note: 'Each setup is a screen the Screener answers on every past bar; the market phase is assigned with hindsight. One stock: NVDA SETH. A record, not a forecast.' },
  // VFP: "volume" stays LEAD's, UNVOL's and MOST's (MOST also takes VOLUME as a lens word), "accumulation" ACCUM's,
  // "gap" MOST's (its gappers) and "pivot" BRKO's: each still finds its own function first.
  VFP: { example: 'NVDA VFP', keywords: ['volume footprint', 'accumulation days', 'distribution days', 'pocket pivots',
    'pocket pivot', 'gap history', 'gaps', 'unfilled gaps', 'up down volume'],
    note: "From UCT's stored daily bars (settled sessions; prices and volumes split-adjusted). A record, not a forecast." },
  // FCTX: "exposure" stays REGM's (the market exposure call), "growth" GRPS's and "value" PEER's; no keyword starts with
  // either word ("growth or value" would have taken "growth" from GRPS). "momentum" and "quality" find FCTX through
  // its label: no other function answers them.
  FCTX: { example: 'NVDA FCTX', keywords: ['factor exposure', 'factor exposures', 'factor loadings', 'factors', 'style',
    'style factors', 'momentum exposure'],
    note: "From UCT's stored daily closes of the stock and the factor funds (settled sessions, price returns). Descriptive, not a forecast." },
}
for (const [code, w] of Object.entries(FUNCTION_WORDS)) {
  const f = BY_CODE[code]
  if (!f || code !== f.code) continue   // an unregistered key is reported by functionWords.test.js
  if (w.example) f.example = w.example
  if (w.keywords) f.keywords = Object.freeze([...w.keywords])
  if (w.note) f.note = w.note
}
/** Every key of the word data, for its rail (each must be a registered code). */
export const FUNCTION_WORD_CODES = Object.freeze(Object.keys(FUNCTION_WORDS))

/** The example HELP shows for a code: its own, else derived from its variants. */
export function exampleFor(f) {
  if (!f) return null
  if (f.example) return f.example
  return f.ticker ? `NVDA ${f.code}` : f.code
}

// Words in a label that say nothing about the function (they would match half the registry).
const LABEL_STOP = new Set(['with', 'from', 'what', 'every', 'list', 'this', 'your', 'last', 'since',
  'only', 'full', 'page', 'days', 'names', 'name', 'stock', 'stocks', 'market', 'which', 'drive', 'also', 'more'])
// An all-capitals token in a label is a code or a ticker in an example (`NVDA ALRT 950`), not a
// word for what the function does, so it is left out.
const labelWords = (f) => String(f.label || '').split(/[^A-Za-z0-9]+/)
  .filter((w) => w.length >= 4 && w !== w.toUpperCase()).map((w) => w.toLowerCase()).filter((w) => !LABEL_STOP.has(w))

/**
 * The codes a plain word or phrase names, best first. `q` is what the member typed ("breakout",
 * "position size", "insider"). Score: 0 a keyword is exactly it, 1 a keyword starts with it,
 * 2 a word inside a keyword starts with it, 3 a word of the label starts with it. Ties keep
 * registry order. Fewer than 3 letters names nothing (a ticker is far more likely). `maxScore`
 * narrows it (0 = an exact keyword only) where a ticker is the likelier reading.
 */
export function codesForWords(q, limit = 3, maxScore = 3) {
  const t = String(q || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (t.length < 3) return []
  const scored = []
  FUNCTIONS.forEach((f, i) => {
    const kws = f.keywords || []
    let s = null
    if (kws.includes(t)) s = 0
    else if (kws.some((k) => k.startsWith(t))) s = 1
    else if (kws.some((k) => k.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(t)))) s = 2
    else if (!t.includes(' ') && labelWords(f).some((w) => w.startsWith(t))) s = 3
    if (s != null && s <= maxScore) scored.push([s, i, f.code])
  })
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return scored.slice(0, limit).map(([, , code]) => code)
}
