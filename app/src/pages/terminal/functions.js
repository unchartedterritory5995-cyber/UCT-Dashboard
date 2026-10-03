// UCT Terminal — THE FUNCTION REGISTRY. One data module; every function code lives here.
//
// A code has up to two VARIANTS, chosen by whether the command carried a security:
//   ticker: { panel, props?, flag?, section? }   `NVDA FA`   — renders in the focused panel
//   market: { panel | door, flag? }              `CAL`       — no security needed
// `panel` names an entry in `panels.jsx` (an EXISTING component, embedded, never forked).
// `door` is an EXISTING route the shell navigates to when the surface is a whole page whose
// content cannot yet be embedded without forking it. `section` is the `/research/:sym`
// `?section=` value of the same surface, so every security panel can open its full page.
// `flag` is the auth-payload key that already gates that surface on `/research/:sym`
// (the shell never shows what the page itself would hide).
//
// ⛔ NOTHING HERE IS TYPED TWICE. `functions.rail.test.js` DERIVES the check that every
// `panel` resolves to a real module with a default-exported component (import-based), every
// `door` matches a route in `App.jsx` (acorn AST), every `section` is a key of
// `ResearchPage.jsx`'s `SECTION_TO_TAB` (AST), and every `flag` is a key `AuthContext`
// provides (AST).
//
// ⛔ ABSENT is not UNKNOWN. A code a member will reasonably type for a surface that does not
// exist on this build answers with WHY, never with "unknown command".

export const FUNCTION_GROUPS = ['Calendar', 'Security', 'Options', 'Market', 'Shell']

export const FUNCTIONS = [
  // ── the Calendar section (owner ruling 2026-10-02: a first-class section of the shell) ──
  { code: 'CAL', label: 'Earnings & events calendar', group: 'Calendar',
    market: { panel: 'Calendar' } },
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
    ticker: { panel: 'Chart' } },
  { code: 'CN', label: 'Company news', group: 'Security',
    ticker: { panel: 'News', section: 'news' } },
  { code: 'CATS', label: 'Catalyst history', group: 'Security',
    ticker: { panel: 'Catalysts', section: 'catalysts' } },
  { code: 'TECH', label: 'Technical read', group: 'Security',
    ticker: { panel: 'Technical', section: 'technical', flag: 'researchTechnicalTabEnabled' } },
  { code: 'FA', label: 'Financials', group: 'Security',
    ticker: { panel: 'Financials', section: 'financials' } },
  { code: 'EE', label: 'Earnings estimates', group: 'Security',
    ticker: { panel: 'Estimates', section: 'estimates' } },
  { code: 'ANR', label: 'Analyst ratings', group: 'Security',
    ticker: { panel: 'AnalystRatings', section: 'analyst-ratings' } },
  { code: 'RTG', label: 'UCT composite rating', group: 'Security',
    ticker: { panel: 'Ratings', section: 'ratings' } },
  { code: 'OWN', label: 'Ownership', group: 'Security',
    ticker: { panel: 'Ownership', section: 'ownership' } },
  { code: 'TRAN', label: 'Calls & transcript', group: 'Security',
    ticker: { panel: 'Calls', section: 'calls' } },
  { code: 'MB', label: 'Model Book', group: 'Security',
    ticker: { panel: 'ModelBook', section: 'modelbook' },
    market: { door: '/model-book' } },
  { code: 'DR', label: 'Decision record', group: 'Security',
    ticker: { panel: 'DecisionRecord', section: 'decision-record', flag: 'decisionRecordEnabled' } },
  { code: 'HIS', label: 'Ticker history', group: 'Security',
    ticker: { panel: 'History', section: 'history', flag: 'tickerHistoryEnabled' } },
  { code: 'SEAS', label: 'Seasonality', group: 'Security',
    ticker: { panel: 'Seasonality', section: 'seasonality', flag: 'seasonalityEnabled' } },
  { code: 'CF', label: 'SEC filings', group: 'Security',
    ticker: { panel: 'Filings', section: 'filings' } },
  { code: 'FIL', label: 'Filing changes (blackline)', group: 'Security',
    ticker: { panel: 'FilingChanges', section: 'filing-changes', flag: 'filingBlacklineEnabled' } },
  { code: 'CMP', label: 'Compare two securities', group: 'Security',
    // `NVDA CMP AMD` — the research compare page, the comparator is the first arg.
    ticker: { door: '/research/{sym}/compare/{arg0}', needsArg: 'a comparator, e.g. NVDA CMP AMD' } },
  { code: 'RES', label: 'Full research page', group: 'Security',
    ticker: { door: '/research/{sym}' } },
  { code: 'ASK', label: 'Ask AI', group: 'Security',
    ticker: { panel: 'AskAi', section: 'ai' },
    market: { door: '/ai-search' } },

  // ── options ──
  { code: 'OMON', label: 'Option chain', group: 'Options',
    ticker: { panel: 'OptionsChain', section: 'options', flag: 'optionsChainEnabled' } },
  { code: 'OVS', label: 'Volatility surface', group: 'Options',
    ticker: { panel: 'OptionsChain', props: { volSurface: true }, section: 'options',
              flag: 'optionsVolSurfaceEnabled' } },
  { code: 'FLOW', label: 'Options flow', group: 'Options',
    ticker: { panel: 'Flow', section: 'flow', flag: 'researchFlowTabEnabled' },
    market: { door: '/options-flow' } },
  { code: 'GEX', label: 'Gamma exposure', group: 'Options',
    // GEX lives INSIDE the Options Flow page (its `gex` data mode), so it is a door — one
    // that opens that page ON its GEX view for the ticker (App.jsx OptionsFlowRoute).
    ticker: { door: '/options-flow?view=gex&ticker={sym}' },
    market: { door: '/options-flow?view=gex' } },
  { code: 'LIVE', label: 'Live flow tape', group: 'Options',
    market: { door: '/live-massive' } },

  { code: 'DP', label: 'Dark pool prints', group: 'Options', market: { door: '/dark-pool' } },
  { code: 'FREC', label: 'Flow record (scoreboard)', group: 'Options', market: { door: '/flow-scoreboard' } },

  // ── the market ──
  { code: 'WIRE', label: 'Morning Wire', group: 'Market', market: { door: '/morning-wire' } },
  { code: 'BRD', label: 'Market breadth', group: 'Market', market: { door: '/breadth' } },
  { code: 'SCR', label: 'Stock screener', group: 'Market', market: { door: '/screener' } },
  { code: 'U20', label: 'UCT 20', group: 'Market', market: { door: '/uct-20' } },
  { code: 'DASH', label: 'Dashboard', group: 'Market', market: { door: '/dashboard' } },
  { code: 'CHRT', label: 'Charts workspace', group: 'Market', market: { door: '/charts' } },
  { code: 'PMKT', label: 'Post-market', group: 'Market', market: { door: '/post-market' } },
  { code: 'CATH', label: 'Catalysts history', group: 'Market', market: { door: '/catalysts/history' } },
  { code: 'SETL', label: 'Setup library', group: 'Market', market: { door: '/setup-library' } },
  { code: 'FORM', label: 'Formula reference', group: 'Market', market: { door: '/formulas/reference' } },
  { code: 'DESK', label: 'The Desk', group: 'Market', market: { door: '/desk' } },
  { code: 'JRNL', label: 'Journal', group: 'Market', market: { door: '/journal' } },
  { code: 'RISK', label: 'Portfolio risk', group: 'Market', market: { door: '/portfolio-heat' } },
  { code: 'COMM', label: 'Community', group: 'Market', market: { door: '/community' } },

  // ── the shell itself ──
  { code: 'HELP', label: 'Function list & syntax', group: 'Shell', market: { panel: 'Help' } },
]

/** Codes a member will type for surfaces this build does not have. Answered, not refused. */
export const ABSENT = {
  OSCR: 'The options screener is not built on this release yet.',
  OBT: 'The options backtester is not on this release yet (it is being built dark).',
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

/** Prefix + edit-distance suggestions over the registry (and ABSENT, so a near-miss on
 *  `OSC` still names the answer). Deterministic order: exact-prefix first, then distance. */
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
