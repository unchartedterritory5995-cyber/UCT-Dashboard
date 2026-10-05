// UCT Terminal — THE FUNCTION REGISTRY. One data module; every function code lives here.
//
// A code has up to two VARIANTS, chosen by whether the command carried a security:
//   ticker: { panel | door, props?, flag?, section?, args? }   `NVDA FA`  — the focused panel
//   market: { panel | surface | door, flag?, full?, args? }    `CAL`      — no security needed
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

export const FUNCTIONS = [
  // ── the Calendar section (owner ruling 2026-10-02: a first-class section of the shell) ──
  { code: 'CAL', label: 'Earnings & events calendar', group: 'Calendar',
    // `CAL TODAY` / `CAL NEXT` / `CAL 2026-10-05` move the calendar through its OWN URL
    // contract (`?week=` / `?d=`, Calendar.jsx), never a second date state.
    market: { panel: 'Calendar', args: [{ kind: 'calendarDay', param: true }] } },
  { code: 'MYST', label: 'My stocks hub (earnings, news, calls, filings)', group: 'Calendar',
    market: { door: '/calendar/mystocks' } },
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
  // services, plus what is new since this member's last MOVE visit. WIIM is its alias code.
  // Dark at the server (TERMINAL_GRAMMAR_ENABLED): unset, the panel says it is not enabled.
  { code: 'MOVE', label: 'Why is it moving (+ since last visit)', group: 'Security',
    ticker: { panel: 'Move' } },
  { code: 'WIIM', label: 'Why is it moving (same as MOVE)', group: 'Security',
    ticker: { panel: 'Move' } },
  { code: 'TECH', label: 'Technical read', group: 'Security',
    ticker: { panel: 'Technical', section: 'technical', flag: 'researchTechnicalTabEnabled' } },
  { code: 'FA', label: 'Financials', group: 'Security',
    ticker: { panel: 'Financials', section: 'financials' } },
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
    market: { door: '/model-book', why: 'a curated year-by-year library with its own two-pane admin editor; the security variant embeds the per-ticker tab' } },
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
    market: { door: '/ai-search', why: 'the AI search page owns a streaming conversation and its own history rail' } },

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
  { code: 'BRKE', label: 'Broker estimates', group: 'Research depth',
    ticker: { panel: 'BrokerEstimates', section: 'depth', flag: `${DEPTH}.broker_estimates_enabled` } },

  // ── options ──
  { code: 'OMON', label: 'Option chain', group: 'Options',
    ticker: { panel: 'OptionsChain', section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'OVS', label: 'Volatility surface', group: 'Options',
    ticker: { panel: 'OptionsChain', props: { volSurface: true }, section: 'options',
              flag: 'optionsVolSurfaceEnabled' } },
  { code: 'IVH', label: 'IV history (implied vs realized)', group: 'Options',
    ticker: { panel: 'IvHistory', section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'VOL', label: 'Volatility stats', group: 'Options',
    ticker: { panel: 'VolStats', section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'POS', label: 'Options positioning (levels, max pain)', group: 'Options',
    ticker: { panel: 'Positioning', section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'OHIS', label: 'Options history (straddles, moves)', group: 'Options',
    ticker: { panel: 'OptionsHistory', section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'OBT', label: 'Options backtest', group: 'Options',
    ticker: { panel: 'Backtest', section: 'options', flag: 'optionsBacktestEnabled' } },
  { code: 'OSCR', label: 'Options screener', group: 'Options',
    market: { panel: 'OptionsScreener', full: '/screener', flag: 'optionsScreenerEnabled' } },
  { code: 'FLOW', label: 'Options flow', group: 'Options',
    ticker: { panel: 'Flow', section: 'flow', flag: 'researchFlowTabEnabled' },
    market: { door: '/options-flow', why: 'partner-owned page; its view routing lives in App.jsx\'s OptionsFlowRoute, which no panel can import' } },
  { code: 'GEX', label: 'Gamma exposure', group: 'Options',
    // GEX lives INSIDE the Options Flow page (its `gex` data mode), so it is a door — one
    // that opens that page ON its GEX view for the ticker (App.jsx OptionsFlowRoute).
    ticker: { door: '/options-flow?view=gex&ticker={sym}', why: 'GEX is a data mode inside the partner-owned Options Flow page' },
    market: { door: '/options-flow?view=gex', why: 'GEX is a data mode inside the partner-owned Options Flow page' } },
  { code: 'TIDE', label: 'Market Tide (net premium)', group: 'Options',
    market: { panel: 'MarketTide', full: '/options-flow' } },
  { code: 'STRS', label: 'Options strategy screens', group: 'Options',
    market: { panel: 'StrategyScreens', full: '/options-flow' } },
  { code: 'LIVE', label: 'Live flow tape', group: 'Options',
    market: { door: '/live-massive', why: 'a socket-fed tape page that owns a live stream connection per mount' } },

  { code: 'DP', label: 'Dark pool prints', group: 'Options', market: { door: '/dark-pool' } },
  { code: 'FREC', label: 'Flow record (scoreboard)', group: 'Options', market: { surface: '/flow-scoreboard' } },

  // ── the market ──
  { code: 'WIRE', label: 'Morning Wire', group: 'Market', market: { surface: '/morning-wire' } },
  { code: 'BRD', label: 'Market breadth', group: 'Market', market: { surface: '/breadth' } },
  { code: 'SCR', label: 'Stock screener', group: 'Market', market: { surface: '/screener' } },
  { code: 'U20', label: 'UCT 20', group: 'Market', market: { surface: '/uct-20' } },
  { code: 'DASH', label: 'Dashboard', group: 'Market',
    market: { door: '/dashboard', why: 'the dashboard is itself a bento of tiles and hosts the hub tile; a board inside a panel is a second shell' } },
  { code: 'CHRT', label: 'Charts workspace', group: 'Market',
    market: { door: '/charts', why: 'the /charts board is the panel host itself (the panel set refuses it as board-host)' } },
  { code: 'PMKT', label: 'Post-market', group: 'Market', market: { door: '/post-market' } },
  { code: 'CATH', label: 'Catalysts history', group: 'Market', market: { surface: '/catalysts/history' } },
  { code: 'SETL', label: 'Setup library', group: 'Market', market: { door: '/setup-library' } },
  { code: 'FORM', label: 'Formula reference', group: 'Market',
    market: { door: '/formulas/reference', why: 'App.jsx loads it with a bare lazy() and no lazyPage importer to share' } },
  { code: 'DESK', label: 'The Desk', group: 'Market',
    market: { door: '/desk', why: 'a video-and-article page with its own section router (?section=)' } },
  { code: 'JRNL', label: 'Journal', group: 'Market',
    market: { door: '/journal', why: 'a nested-route shell (JournalShellSelector + Outlet); its children need the router' } },
  { code: 'NB', label: 'Notebook', group: 'Market', market: { door: '/journal/notebook' } },
  { code: 'RISK', label: 'Portfolio risk', group: 'Market', market: { surface: '/portfolio-heat' } },
  { code: 'COMM', label: 'Community', group: 'Market',
    market: { door: '/community', why: 'threads are routed (/community/:threadId); a panel cannot hold the thread URL' } },
  { code: 'EXP', label: 'Exports (your data, preferences backup)', group: 'Market',
    market: { door: '/settings?section=legal' } },

  // ── the shell itself ──
  { code: 'HELP', label: 'Function list & syntax', group: 'Shell',
    market: { panel: 'Help', args: [{ kind: 'code', prop: 'focusCode' }] } },
]

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

export const BY_CODE = Object.freeze(Object.fromEntries(FUNCTIONS.map((f) => [f.code, f])))

export function isCode(token) {
  return typeof token === 'string' && Object.prototype.hasOwnProperty.call(BY_CODE, token.toUpperCase())
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

/** Every `?section=` an entry can open on `/research/:sym`, for the full-page link. */
export function researchHref(sym, section) {
  if (!sym) return null
  const s = encodeURIComponent(String(sym).toUpperCase())
  return section ? `/research/${s}?section=${encodeURIComponent(section)}` : `/research/${s}`
}

/** Prefix + edit-distance suggestions over the registry (and ABSENT, so a near-miss on an
 *  absent code still names the answer). Deterministic order: exact-prefix first, then distance. */
export function suggest(token, limit = 5) {
  const t = String(token || '').toUpperCase()
  if (!t) return []
  const pool = [...FUNCTIONS.map((f) => f.code), ...Object.keys(ABSENT)]
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
