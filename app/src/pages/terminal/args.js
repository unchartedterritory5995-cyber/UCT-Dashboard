// UCT Terminal — the ARGUMENTS a function honours (TERMINAL-NEXT V6a).
//
// parseCommand stores every token after the code in `args`. Before this module the shell
// read none of them: `NVDA GP W` drew a daily chart and `CAL TODAY` opened the calendar on
// nothing in particular, both in silence — the exact thing parseCommand's "never silent" rule
// forbids. Now a variant DECLARES what it takes (`args: [{ kind, prop | param }]` in
// functions.js) and `applyArgs` answers, for every token, either APPLIED or NOT APPLIED.
// The shell echoes both; nothing typed is dropped without a word.
//
// ⛔ A kind's accepted values are not invented here when an owner already publishes them:
// `TIMEFRAMES` is pinned to StockChart's own `TF_WM_LABELS` keys by functions.rail.test.js.
import { todayIso } from '../calendar/earningsModalRow'
import { currentWeekMonday, mondayOf } from '../calendar/weekAnchor'
import { canonicalCode, isCode } from './functions'
import { parseAlertPrice } from './alertModel'
import { parseScatMetric, parseScatUniverse, scatMetricLabel } from './scatterArgs'
import { COT_WORDS } from './panels/cotModel'

/** The chart's timeframe codes (StockChart `tf`), with the spellings a member types. */
export const TIMEFRAMES = {
  D: 'D', W: 'W', M: 'M',
  DAILY: 'D', WEEKLY: 'W', MONTHLY: 'M', '1D': 'D', '1W': 'W', '1MO': 'M',
  1: '1', 5: '5', 15: '15', 30: '30', 60: '60', '1H': '60', H: '60', '1MIN': '1', '5MIN': '5',
  '15MIN': '15', '30MIN': '30',
}

function shiftIso(iso, days) {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `YYYY-MM-DD` shape is not enough — native `Date` auto-rolls an impossible day
 *  (`2026-02-30` becomes 2026-03-02) rather than rejecting it. Parse the three parts and
 *  confirm the Date round-trips to the SAME y/m/d; a rollover means it was never real. */
function isRealIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(dt.getTime())) return false
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d
}

/** The comparison windows `lookback` accepts (REL, CORR). Each panel draws every one of them, and
 *  says so out loud for anything else (panels/RelPanel.jsx, panels/CorrPanel.jsx; railed). */
export const LOOKBACK_WINDOWS = Object.freeze(['1M', '3M', '6M', '1Y', '2Y', 'YTD'])
/** The words the data-wave-1 lenses accept (see the kinds at the foot of ARG_KINDS). Exported for
 *  args.dataWave1.test.js, which checks each against the panel that owns the vocabulary. */
export const LONG_RUN_WORDS = Object.freeze({
  '30D': '30D', 30: '30D', '60D': '60D', 60: '60D', '90D': '90D', 90: '90D',
  VOL1Y: 'VOL1Y', VOLUME1Y: 'VOL1Y', '1YVOL': 'VOL1Y',
  VOLMAX: 'VOLMAX', VOLEVER: 'VOLMAX', MAXVOL: 'VOLMAX', ALLTIME: 'VOLMAX',
  IPO: 'IPO', IPOS: 'IPO', LISTINGS: 'IPO',
})
export const ANALYST_KIND_WORDS = Object.freeze({
  UP: 'upgrades', UPGRADE: 'upgrades', UPGRADES: 'upgrades',
  DOWN: 'downgrades', DN: 'downgrades', DOWNGRADE: 'downgrades', DOWNGRADES: 'downgrades',
  PT: 'targets', TARGET: 'targets', TARGETS: 'targets',
})
export const HILO_SIDE_WORDS = Object.freeze({
  HIGHS: 'highs', HIGH: 'highs', HI: 'highs', NH: 'highs',
  LOWS: 'lows', LOW: 'lows', LO: 'lows', NL: 'lows',
})
export const FLOW_LIST_ARG_WORDS = Object.freeze({
  CREAM: 'cream', CROP: 'cream', TOP: 'cream',
  OPEN: 'open', BOARD: 'open', OPENFLOW: 'open',
})
// data wave 4: copies of the panel models' words (args.dataWave4.test.js pins each to its owner)
export const CONFLUENCE_LEAN_WORDS = Object.freeze({
  ALL: 'all', BOTH: 'all', ANY: 'all',
  BULL: 'bullish', BULLS: 'bullish', BULLISH: 'bullish', LONG: 'bullish',
  BEAR: 'bearish', BEARS: 'bearish', BEARISH: 'bearish', SHORT: 'bearish',
})
export const REPEAT_ORDER_WORDS = Object.freeze({
  STRONG: 'strong', STRONGEST: 'strong', SCORE: 'strong', TOP: 'strong', BEST: 'strong',
  LATEST: 'latest', RECENT: 'latest', NEWEST: 'latest', TIME: 'latest',
})
export const PERIOD_RANGE_WORDS = Object.freeze({
  MTD: 'mtd', MONTH: 'mtd',
  QTD: 'qtd', QUARTER: 'qtd',
  YTD: 'ytd', YEAR: 'ytd',
  '1M': 'm1', '3M': 'm3', '6M': 'm6', '1Y': 'y1', '12M': 'y1',
})
export const PERIOD_UNIT_WORDS = Object.freeze({
  STOCKS: 'stocks', STOCK: 'stocks',
  SECTORS: 'sector', SECTOR: 'sector',
  INDUSTRIES: 'industry', INDUSTRY: 'industry',
  THEMES: 'theme', THEME: 'theme',
})
export const PERIOD_SIDE_WORDS = Object.freeze({
  GAINERS: 'gainers', GAINER: 'gainers', UP: 'gainers', TOP: 'gainers', BEST: 'gainers',
  LOSERS: 'losers', LOSER: 'losers', DOWN: 'losers', BOTTOM: 'losers', WORST: 'losers',
})
/** CEOS's list words: a copy of panels/callThemesModel.js CALL_THEMES_LIST_ARG_WORDS (args.callThemes.test.js). */
export const CALL_THEMES_LIST_WORDS = Object.freeze({
  NEW: 'new', FRESH: 'new', FIRST: 'new',
  RISING: 'rising', RISE: 'rising', RISERS: 'rising', UP: 'rising',
  BOTH: 'both', ALL: 'both',
})
export const ROTATION_SIDE_ARG_WORDS = Object.freeze({
  IN: 'in', INTO: 'in', UP: 'in', RISING: 'in', LEADERS: 'in', GAINING: 'in',
  OUT: 'out', DOWN: 'out', FADING: 'out', FALLING: 'out', LAGGARDS: 'out', LOSING: 'out',
})
export const TOP_FLOW_STATUS_WORDS = Object.freeze({
  OPEN: 'open', ACTIVE: 'open', LIVE: 'open',
  EXPIRED: 'expired', ARCHIVED: 'expired', PAST: 'expired', CLOSED: 'expired',
})
export const TOP_FLOW_DIRECTION_WORDS = Object.freeze({
  BULL: 'bullish', BULLS: 'bullish', BULLISH: 'bullish',
  BEAR: 'bearish', BEARS: 'bearish', BEARISH: 'bearish',
})
export const TOP_FLOW_SORT_WORDS = Object.freeze({
  GAIN: 'gain', GAINERS: 'gain', WINNERS: 'gain', BEST: 'gain',
  LOSS: 'loss', LOSERS: 'loss', WORST: 'loss',
  PEAK: 'peak', HIGH: 'peak',
  NEW: 'newest', NEWEST: 'newest', LATEST: 'newest', RECENT: 'newest',
})
// the earnings season screen: copies of the panel model's words (args.earningsSeason.test.js pins each to its owner)
export const EARNINGS_DAY_WORDS = Object.freeze({ TODAY: 'today', TONIGHT: 'tonight', TOMORROW: 'tomorrow' })
export const EARNINGS_SESSION_WORDS = Object.freeze({
  BMO: 'bmo', MORNING: 'bmo', BEFORE: 'bmo',
  AMC: 'amc', EVENING: 'amc', AFTER: 'amc',
})
// unusual volume: copies of the panel model's words (args.unusualVolume.test.js pins each to its owner)
export const UNVOL_SIDE_WORDS = Object.freeze({
  UP: 'up', GAINERS: 'up', GREEN: 'up',
  DOWN: 'down', DN: 'down', LOSERS: 'down', RED: 'down',
})
export const UNVOL_MIN_WORDS = Object.freeze({
  '2X': 2, 2: 2, '3X': 3, 3: 3, '5X': 5, 5: 5,
})
// the short interest list: a copy of the panel model's words (args.shortInterest.test.js pins it to its owner)
export const SHORT_RANK_WORDS = Object.freeze({
  DTC: 'dtc', DAYS: 'dtc', COVER: 'dtc',
  UP: 'up', INCREASE: 'up', INCREASES: 'up', RISING: 'up', BUILDING: 'up',
  DOWN: 'down', DECREASE: 'down', DECREASES: 'down', FALLING: 'down', COVERING: 'down',
  FLOAT: 'float', PCT: 'float', PERCENT: 'float',
})
// the open interest change panel: a copy of the panel model's words (args.oiChange.test.js pins it to its owner)
export const OI_SIDE_WORDS = Object.freeze({
  C: 'call', CALL: 'call', CALLS: 'call',
  P: 'put', PUT: 'put', PUTS: 'put',
})

// Market Tide by day: a copy of the panel model's words (args.tideHistory.test.js pins it to its owner)
export const TIDE_SCOPE_WORDS = Object.freeze({ STOCKS: 'stocks', STOCK: 'stocks', ETFS: 'etfs' })
// the seasonality board: a copy of the panel model's words (args.seasonalityBoard.test.js pins it to its owner)
export const SEAS_MEASURE_WORDS = Object.freeze({ AVG: 'average', AVERAGE: 'average', MEAN: 'average', MEDIAN: 'median' })
// Market wave A: copies of the panel models' argument rules (args.marketWaveA.test.js pins each to its owner)
export const COT_MARKET_SHAPE = /^[A-Z0-9&][A-Z0-9&.-]{0,11}$/
export const ANLG_COUNT_BOUNDS = Object.freeze([3, 10])
// INS CLUSTER: a copy of the panel model's words (args.insiderClusters.test.js pins it to its owner)
export const INS_VIEW_WORDS = Object.freeze({ CLUSTER: 'cluster', CLUSTERS: 'cluster' })
// MKTH (2026-11-21): a copy of the panel model's index words (functions.marketHistory.test.js pins it to its owner)
export const MKTH_INDEX_ARG_WORDS = Object.freeze({
  SPX: 'SPX', SP500: 'SPX', SPY: 'SPX',
  NDX: 'NDX', NASDAQ: 'NDX', NAS100: 'NDX', QQQ: 'NDX',
})
/** A typed `MM/DD` for ERNS is the nearest such day; past this many days away it is the next or the last year's. */
export const EARNINGS_DAY_REACH = 183
export const RS_SCREEN_ARG_WORDS = Object.freeze({
  LEADERS: 'starter_rs_leaders', LEADER: 'starter_rs_leaders', LDR: 'starter_rs_leaders',
  TOP: 'starter_rs_top_rating', RATING: 'starter_rs_top_rating',
  NH: 'starter_rs_new_high', HIGHS: 'starter_rs_new_high',
  NHBP: 'starter_rs_nh_before_price', BEFORE: 'starter_rs_nh_before_price',
  EXIT: 'starter_rs_exit_warning_5', WARN: 'starter_rs_exit_warning_5', WARNINGS: 'starter_rs_exit_warning_5',
})
export const HILO_GROUP_WORDS = Object.freeze({
  SECTOR: 'sector', SECTORS: 'sector', INDUSTRY: 'industry', INDUSTRIES: 'industry', THEME: 'theme', THEMES: 'theme',
})
/** The cadences `cadence` accepts (RRG's daily or weekly closes; panels/RrgPanel.jsx RRG_CADENCES). */
export const CADENCES = Object.freeze(['D', 'W'])
// FUND (2026-11-21): a copy of the panel model's metric words (functions.fundMetrics.test.js pins it to its owner)
export const FUND_METRIC_WORDS = Object.freeze({
  REV: 'revenue_ttm', REVQ: 'revenue_q', NETINC: 'net_income_ttm', NETINCQ: 'net_income_q',
  EPS: 'eps_ttm', EPSQ: 'eps_q', OCF: 'operating_cash_flow_ttm', FREECF: 'fcf_ttm',
  REVG: 'revenue_growth_ttm', REVGQ: 'revenue_growth_q', EPSG: 'eps_growth_ttm', EPSGQ: 'eps_growth_q',
  GROSSM: 'gross_margin', OPM: 'operating_margin', NETM: 'net_margin', FCFM: 'fcf_margin', ROE: 'roe', ROA: 'roa',
  CASHEQ: 'cash', ASSETS: 'total_assets', LIAB: 'total_liabilities', EQUITY: 'shareholders_equity',
  SHARES: 'shares_outstanding',
  MCAP: 'market_cap', PE: 'pe_ttm', PS: 'ps_ttm', PBOOK: 'pb', FCFY: 'fcf_yield',
  BETA1Y: 'beta_1y_spy',
})
export const FUND_MAX_METRICS = 12
export const FUND_MAX_PEERS = 3
const FUND_WORD_OF = Object.freeze(Object.fromEntries(Object.entries(FUND_METRIC_WORDS).map(([w, id]) => [id, w])))
const fundMetricOf = (tok) => {
  const k = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(FUND_METRIC_WORDS, k) ? FUND_METRIC_WORDS[k] : null
}

/**
 * Each kind: `parse(token, ctx)` → a value or null (not this kind), `describe(value)` → the
 * echo text, and `takes` → what to tell a member whose token did not fit.
 * A calendar value is an object of URL params; `null` in it means "remove that param".
 */
export const ARG_KINDS = {
  timeframe: {
    takes: 'a timeframe (D, W, M, 1, 5, 15, 30, 60)',
    parse: (tok) => TIMEFRAMES[String(tok).toUpperCase()] ?? null,
    describe: (v) => `timeframe ${v}`,
  },
  calendarDay: {
    takes: 'TODAY, NEXT, PREV or a date (YYYY-MM-DD)',
    parse: (tok, ctx = {}) => {
      const t = String(tok).toUpperCase()
      const today = ctx.today || todayIso()
      const thisWeek = currentWeekMonday(today)
      if (t === 'TODAY') return { week: null, d: today }
      if (t === 'NEXT' || t === 'PREV') {
        const w = thisWeek && shiftIso(thisWeek, t === 'NEXT' ? 7 : -7)
        return w ? { week: w, d: null } : null
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(tok) && isRealIsoDate(tok) && mondayOf(tok)) {
        return { week: mondayOf(tok) === thisWeek ? null : mondayOf(tok), d: tok }
      }
      return null
    },
    describe: (v) => (v.d ? `day ${v.d}` : `week of ${v.week}`),
  },
  /** One past session, Eastern time (CATH's day, wave 4 lane A): `2026-10-01`, or `10/01` / `10/1`
   *  for the most recent such day — this year's, or last year's when this year's is still ahead.
   *  A day after today (ET) has no catalyst list yet, so it is not taken. */
  etDate: {
    takes: 'a date (YYYY-MM-DD or MM/DD, Eastern time)',
    parse: (tok, ctx = {}) => {
      const t = String(tok ?? '').trim()
      const today = ctx.today || todayIso()
      const p = (n) => String(n).padStart(2, '0')
      let iso = null
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t
      else {
        const m = t.match(/^(\d{1,2})\/(\d{1,2})$/)
        if (!m) return null
        const year = Number(today.slice(0, 4))
        iso = `${year}-${p(m[1])}-${p(m[2])}`
        if (iso > today) iso = `${year - 1}-${p(m[1])}-${p(m[2])}`
      }
      return isRealIsoDate(iso) && iso <= today ? iso : null
    },
    describe: (v) => `day ${v}`,
  },
  code: {
    takes: 'a function code (HELP GP)',
    parse: (tok) => (isCode(tok) ? canonicalCode(tok) : null),   // HELP MOVERS focuses MOST
    describe: (v) => `function ${v}`,
  },
  // ── the comparison panels (RRG / REL / CORR, feature-gaps-2026-10-06) ──
  /** A comparator security. `$` forces a ticker reading; a bare function code is never one. */
  symbol: {
    takes: 'tickers to compare (NVDA REL AMD SMH)',
    parse: (tok) => {
      const t = String(tok).toUpperCase()
      const forced = t.startsWith('$')
      const s = t.replace(/^\$/, '')
      if (!/^[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z]{1,2})?$/.test(s)) return null
      if (!forced && isCode(s)) return null
      return s
    },
    describe: (v) => `ticker ${v}`,
  },
  /** A comparison window. */
  lookback: {
    takes: 'a window (1M, 3M, 6M, 1Y, 2Y, YTD)',
    parse: (tok) => {
      const t = String(tok).toUpperCase()
      return LOOKBACK_WINDOWS.includes(t) ? t : null
    },
    describe: (v) => `window ${v}`,
  },
  /** RRG's cadence: weekly or daily closes. */
  cadence: {
    takes: 'D or W',
    parse: (tok) => ({ D: 'D', DAILY: 'D', W: 'W', WEEKLY: 'W' })[String(tok).toUpperCase()] ?? null,
    describe: (v) => (v === 'D' ? 'daily closes' : 'weekly closes'),
  },
  /** MOST's lens: which cut of the movers tape. `VOL` is a function code, so it is not offered. */
  moversLens: {
    takes: 'UP, DOWN or RVOL',
    parse: (tok) => ({
      UP: 'up', GAINERS: 'up', GAIN: 'up',
      DOWN: 'down', DN: 'down', LOSERS: 'down', LOSS: 'down',
      RVOL: 'volume', UNUSUAL: 'volume', VOLUME: 'volume',
    })[String(tok).toUpperCase()] ?? null,
    describe: (v) => ({ up: 'gainers', down: 'losers', volume: 'unusual volume' })[v],
  },
  /** IMOV's window: the periods theme_performance stores a reference close for (1D is live). */
  contribWindow: {
    takes: 'a window (1D, 1W, 1M, 3M)',
    parse: (tok) => ({ '1D': '1D', TODAY: '1D', '1W': '1W', '1M': '1M', '3M': '3M' })[String(tok).toUpperCase()] ?? null,
    describe: (v) => `window ${v}`,
  },
  /** IMOV's theme, by NAME: every word the other kinds do not take (`IMOV AI / GPU Chips`). A
   *  REST kind (`rest: true` on the spec): the words are joined into one query and the PANEL
   *  resolves it against the themes it reads (case/spacing-insensitive, unique prefix, "did you
   *  mean" otherwise), because the theme list is data, not a constant. A window-shaped token
   *  (`1Y`) is never a theme word, so it is still said to be not applied. `THEME` is the marker
   *  the panel writes (`IMOV THEME SEMICONDUCTORS`): it forces the theme reading of one word
   *  that would otherwise be a ticker, and is not part of the name. */
  themeName: {
    takes: 'a theme name (IMOV SEMICONDUCTORS)',
    parse: (tok) => {
      const t = String(tok ?? '').trim()
      if (!t || /^(?:\d+[DWMY]|YTD|MTD|QTD)$/i.test(t)) return null
      return t.toUpperCase()
    },
    describe: (v) => `theme "${v}"`,
  },
  // ── my names (lane 9: ALRT and MON) ──
  /** ALRT's price: `950`, `$950`, `>950` (above) or `<950` (below). The SHELL sets the alert from
   *  a typed command (alertCommand.js); the panel only lists. Same parser, one spelling. */
  alertPrice: {
    takes: 'a price (NVDA ALRT 950, or >950 / <950 to say above or below)',
    parse: (tok) => {
      const p = parseAlertPrice(tok)
      return p ? `${p.direction === 'above' ? '>' : p.direction === 'below' ? '<' : ''}${p.price}` : null
    },
    describe: (v) => `price ${v}`,
  },
  /** MON's list: its number in the panel's own list order (`MON 2`), a watchlist address
   *  (`MON W:ab12`) or FLAGGED. The panel resolves it against the lists it reads. */
  watchlistPick: {
    takes: 'a list number (MON 2), W:id or FLAGGED',
    parse: (tok) => {
      const t = String(tok ?? '').trim()
      if (/^\d{1,2}$/.test(t) && Number(t) >= 1) return String(Number(t))
      if (/^W:[A-Za-z0-9_-]{1,40}$/i.test(t)) return `W:${t.slice(2)}`
      if (/^FLAG(GED|S)?$/i.test(t)) return 'FLAGGED'
      return null
    },
    describe: (v) => (v === 'FLAGGED' ? 'your flagged list' : v.startsWith('W:') ? `watchlist ${v}` : `list ${v}`),
  },
  /** "Mine" (wave 3 #6): only the member's own names — the calendar's My Stocks set
   *  (hooks/useMyTickers). `CAL MINE`, `MOST UP MINE`, `NVDA CN MINE`, `FREC MINE`. The chip a
   *  panel draws writes this word back into its command, so a reload keeps the filter. */
  mine: {
    takes: 'MINE (only your names)',
    parse: (tok) => (String(tok ?? '').trim().toUpperCase() === MINE_MARKER ? true : null),
    describe: () => 'only your names',
  },
  // ── SCAT (wave 9, lane 2): the universe and the two axes, written back by the panel ──
  /** SCAT's universe: an index (SP500 NDX DOW R2K), MARKET, SECTORS, FLAGGED, UCT20, one of the
   *  sector ETFs (XLK), or SCAN:KEY / BREADTH:KEY. Tables in scatterArgs.js mirror the server. */
  scatUniverse: {
    takes: 'a universe (SP500, NDX, DOW, R2K, MARKET, SECTORS, FLAGGED, UCT20, an ETF like XLK, SCAN:VOLUME or BREADTH:NEW_52W_HIGHS)',
    parse: (tok) => parseScatUniverse(tok),
    describe: (v) => `universe ${v.label}`,
  },
  /** SCAT's Y axis: the FIRST metric key typed (RS_RANK). */
  scatY: {
    takes: 'two metrics, Y then X (RS_RANK DIST_52W_HIGH)',
    parse: (tok) => parseScatMetric(tok),
    describe: (v) => `Y axis ${scatMetricLabel(v)}`,
  },
  /** SCAT's X axis: the SECOND metric key typed. */
  scatX: {
    takes: 'two metrics, Y then X (RS_RANK DIST_52W_HIGH)',
    parse: (tok) => parseScatMetric(tok),
    describe: (v) => `X axis ${scatMetricLabel(v)}`,
  },
  // ── data wave 1 (2026-11-17): the lenses of the new market panels. The accepted words are each
  // panel's own (panels/longRunModel.js LENS_WORDS, UpgradesPanel KIND_WORDS, HighsLowsPanel
  // SIDE_WORDS / GROUP_WORDS); args.dataWave1.test.js pins every word here to the value that
  // panel's own reader gives, so the two cannot drift. Typed here as plain maps so the panels'
  // code stays out of the shell's first-open bytes.
  /** LEAD's list: gainers over 30, 60 or 90 sessions, volume records, new listings. */
  longRunLens: {
    takes: '30D, 60D, 90D, VOL1Y, VOLMAX or IPO',
    parse: (tok) => LONG_RUN_WORDS[String(tok).toUpperCase()] ?? null,
    describe: (v) => `list ${v}`,
  },
  /** UPDG's cut: upgrades, downgrades or target changes. */
  analystKind: {
    takes: 'UP, DOWN or PT',
    parse: (tok) => ANALYST_KIND_WORDS[String(tok).toUpperCase()] ?? null,
    describe: (v) => ({ upgrades: 'upgrades', downgrades: 'downgrades', targets: 'target changes' })[v],
  },
  /** HILO's side: the highs list or the lows list (both is the bare command). */
  hiloSide: {
    takes: 'HIGHS or LOWS',
    parse: (tok) => HILO_SIDE_WORDS[String(tok).toUpperCase()] ?? null,
    describe: (v) => `new ${v}`,
  },
  /** HILO's grouping: rank sectors, industries or themes instead of stocks. */
  hiloGroup: {
    takes: 'SECTOR, INDUSTRY or THEME',
    parse: (tok) => HILO_GROUP_WORDS[String(tok).toUpperCase()] ?? null,
    describe: (v) => `by ${v}`,
  },
  // ── data wave 2 (2026-11-17). RSS's screen: one of the five UCT RS screens, by its short word.
  // The value is the screen's starter id (panels/rsScreensModel.js RS_SCREEN_WORDS owns the words;
  // args.dataWave2.test.js pins this map to it).
  rsScreen: {
    takes: 'LEADERS, TOP, NH, NHBP or EXIT',
    parse: (tok) => RS_SCREEN_ARG_WORDS[String(tok).toUpperCase()] ?? null,
    describe: (v) => `screen ${String(v).replace(/^starter_rs_/, '').replace(/_/g, ' ')}`,
  },
  // ── data wave 3 (2026-11-17) ──
  /** PERF's account: `ALL`, or the account's place in the Journal's own list (`2` is the second).
   *  Never an id, so a command, a link and the history carry nothing personal. The reader is
   *  panels/performanceModel.js parsePerformanceAccount (pinned by args.dataWave3.test.js). */
  journalAccount: {
    takes: 'ALL, or an account number (1, 2, 3)',
    parse: (tok) => {
      const t = String(tok ?? '').trim().toUpperCase()
      if (t === 'ALL') return 'all'
      return /^\d{1,2}$/.test(t) && Number(t) >= 1 ? Number(t) : null
    },
    describe: (v) => (v === 'all' ? 'all accounts' : `account ${v}`),
  },
  /** FLWL's list: Cream of the Crop or the open flow board (panels/flowListsModel.js LIST_WORDS). */
  flowList: {
    takes: 'CREAM or OPEN',
    parse: (tok) => FLOW_LIST_ARG_WORDS[String(tok).toUpperCase()] ?? null,
    describe: (v) => (v === 'open' ? 'the open flow board' : 'Cream of the Crop'),
  },
  // ── data wave 4 (2026-11-17) ──
  /** CONFL's direction (panels/confluenceModel.js CONFLUENCE_LEAN_ARG_WORDS; pinned by args.dataWave4.test.js). */
  confluenceLean: {
    takes: 'BULL or BEAR',
    parse: (tok) => CONFLUENCE_LEAN_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => (v === 'all' ? 'every direction' : `${v} names`),
  },
  /** ACCUM's order (panels/repeatContractsModel.js REPEAT_ORDER_ARG_WORDS). */
  repeatOrder: {
    takes: 'STRONG or LATEST',
    parse: (tok) => REPEAT_ORDER_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => (v === 'latest' ? 'latest first' : 'strongest first'),
  },
  /** PCHG's one-click range (panels/periodChangeModel.js PERIOD_RANGE_ARG_WORDS). */
  periodRange: {
    takes: 'a range (MTD, QTD, YTD, 1M, 3M, 6M, 1Y)',
    parse: (tok) => PERIOD_RANGE_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => `range ${({ mtd: 'MTD', qtd: 'QTD', ytd: 'YTD', m1: '1M', m3: '3M', m6: '6M', y1: '1Y' })[v] || v}`,
  },
  /** PCHG's own dates, a whole date each (`2026-01-02`, `20260102`, `1/2/2026`): the first typed
   *  is the start, the second the end. Unlike `etDate` a year is always typed, because a range
   *  can reach back decades. The panel model (periodRequest) decides what the server can take. */
  periodDate: {
    takes: 'one or two dates (YYYY-MM-DD)',
    parse: (tok) => {
      const t = String(tok ?? '').trim()
      let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t) || /^(\d{4})(\d{2})(\d{2})$/.exec(t)
      let parts = m ? [m[1], m[2], m[3]] : null
      if (!parts) { m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); if (m) parts = [m[3], m[1], m[2]] }
      if (!parts || Number(parts[0]) < 1900 || Number(parts[0]) > 2200) return null
      const iso = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
      return isRealIsoDate(iso) ? iso : null
    },
    describe: (v) => `date ${v}`,
  },
  /** PCHG's what-to-rank: stocks, or sectors, industries and themes over the same dates
   *  (panels/periodChangeModel.js PERIOD_UNIT_ARG_WORDS). `PCHG QTD SECTORS`. */
  periodUnit: {
    takes: 'STOCKS, SECTORS, INDUSTRIES or THEMES',
    parse: (tok) => PERIOD_UNIT_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => ({ stocks: 'stocks', sector: 'sectors', industry: 'industries', theme: 'themes' })[v] || v,
  },
  /** PCHG's end of the list (panels/periodChangeModel.js PERIOD_SIDE_ARG_WORDS). */
  periodSide: {
    takes: 'GAINERS or LOSERS',
    parse: (tok) => PERIOD_SIDE_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => (v === 'losers' ? 'biggest losers' : 'biggest gainers'),
  },
  /** TSRC's search words: a REST kind (`rest: true`), every word typed after the code, joined.
   *  Any non-empty text is taken here; the PANEL (callSearchModel.callQuery) says why a query
   *  cannot run (too short, too long), next to the box, because a one-letter word inside a phrase
   *  ("plan b") is fine while a one-letter query is not, and this kind sees one word at a time.
   *  Lower case, always: the command line carries no letter case (the shell upper-cases what is
   *  typed), and in capitals a plain "and" / "or" / "not" would reach the search as an operator. */
  callQuery: {
    takes: 'a word or a phrase (TSRC pricing power)',
    parse: (tok) => {
      const t = String(tok ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
      return t ? t : null
    },
    describe: (v) => `search "${v}"`,
  },
  /** CEOS's two picks (panels/callThemesModel.js; pinned by args.callThemes.test.js): which list,
   *  and a month as YYYY-MM. `CEOS RISING 2026-10` reads the same in either order. */
  callThemesList: {
    takes: 'NEW, RISING or BOTH',
    parse: (tok) => CALL_THEMES_LIST_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => ({ new: 'phrases new this month', rising: 'rising phrases', both: 'both lists' })[v] || v,
  },
  callThemesMonth: {
    takes: 'a month as YYYY-MM',
    parse: (tok) => {
      const m = /^(\d{4})[-/](\d{1,2})$/.exec(String(tok ?? '').trim())
      if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2100 || Number(m[2]) < 1 || Number(m[2]) > 12) return null
      return `${m[1]}-${m[2].padStart(2, '0')}`
    },
    describe: (v) => `month ${v}`,
  },
  /** TROT's side: themes rotating in, or rotating out (panels/themeRotationModel.js ROTATION_SIDE_WORDS). */
  rotationSide: {
    takes: 'IN or OUT',
    parse: (tok) => ROTATION_SIDE_ARG_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => (v === 'out' ? 'themes rotating out' : 'themes rotating in'),
  },
  // ── data wave 6 (2026-11-17) ──
  /** TOPF's three picks (panels/topFlowModel.js; pinned by args.dataWave6.test.js): which picks,
   *  which direction, and the order. No word sits in two of the maps, so `TOPF EXPIRED BEAR PEAK`
   *  reads the same in any order. */
  topFlowStatus: {
    takes: 'OPEN or EXPIRED',
    parse: (tok) => TOP_FLOW_STATUS_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => `${v} picks`,
  },
  topFlowDirection: {
    takes: 'BULL or BEAR',
    parse: (tok) => TOP_FLOW_DIRECTION_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => `${v} picks`,
  },
  topFlowSort: {
    takes: 'an order (GAIN, LOSERS, PEAK, NEW)',
    parse: (tok) => TOP_FLOW_SORT_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => ({ gain: 'biggest gain first', loss: 'biggest loss first', peak: 'biggest peak gain first', newest: 'newest pick first' })[v] || v,
  },
  // ── the earnings season screen (2026-11-17) ──
  /** ERNS's day (panels/earningsSeasonModel.js parseEarningsDay; pinned by args.earningsSeason.test.js):
   *  TODAY, TONIGHT (today, after the close), TOMORROW (the next session), or a date. Unlike
   *  `etDate` the day may be ahead, and `11/19` is the NEAREST such day, not the most recent. The
   *  word is kept as a word, so a saved `ERNS TOMORROW` still means tomorrow the day after. */
  earningsDay: {
    takes: 'TODAY, TONIGHT, TOMORROW or a date (YYYY-MM-DD or MM/DD)',
    parse: (tok, ctx = {}) => {
      const t = String(tok ?? '').trim().toUpperCase()
      if (Object.prototype.hasOwnProperty.call(EARNINGS_DAY_WORDS, t)) return EARNINGS_DAY_WORDS[t]
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return isRealIsoDate(t) ? t : null
      const m = t.match(/^(\d{1,2})\/(\d{1,2})$/)
      if (!m) return null
      const today = ctx.today || todayIso()
      const p = (n) => String(n).padStart(2, '0')
      const year = Number(today.slice(0, 4))
      const at = (y) => `${y}-${p(m[1])}-${p(m[2])}`
      const dayNumber = (iso) => { const [y, mo, d] = iso.split('-').map(Number); return Date.UTC(y, mo - 1, d) / 86400000 }
      let iso = at(year)
      if (!isRealIsoDate(iso)) return null
      const away = dayNumber(iso) - dayNumber(today)
      if (away < -EARNINGS_DAY_REACH) iso = at(year + 1)
      else if (away > EARNINGS_DAY_REACH) iso = at(year - 1)
      return isRealIsoDate(iso) ? iso : null
    },
    describe: (v) => ({ today: 'today', tonight: 'today, after the close', tomorrow: 'the next session' })[v] || `day ${v}`,
  },
  /** ERNS's part of the day (panels/earningsSeasonModel.js EARNINGS_SESSION_ARG_WORDS). */
  earningsSession: {
    takes: 'BMO (before the open) or AMC (after the close)',
    parse: (tok) => EARNINGS_SESSION_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => (v === 'bmo' ? 'before the open' : 'after the close'),
  },
  // ── sector and theme drill-down (2026-11-18) ──
  /** GRP's group, by NAME or by sector fund: a REST kind (`rest: true`), every word the range does
   *  not take, joined (`GRP AI / GPU CHIPS`, `GRP AEROSPACE & DEFENSE`, `GRP XLK`). A leading
   *  SECTOR, INDUSTRY or THEME pins the kind; the PANEL (panels/groupDrillModel.js parseGroupQuery,
   *  resolveGroup) reads that word and resolves the name against the lists it loads, because the
   *  groups are data, not a constant. A range word is never a name word, so a second one (`GRP XLK
   *  3M 1Y`) is said to be not applied instead of becoming part of the name. Upper case, as typed:
   *  the resolver ignores case and punctuation. */
  groupName: {
    takes: 'a sector fund, a sector, an industry or a theme (GRP XLK, GRP THEME AI / GPU CHIPS)',
    parse: (tok) => {
      const t = String(tok ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
      if (!t || Object.prototype.hasOwnProperty.call(PERIOD_RANGE_WORDS, t)) return null
      return t
    },
    describe: (v) => `group "${v}"`,
  },
  // ── unusual volume (2026-11-18) ──
  /** UNVOL's two picks (panels/unusualVolumeModel.js; pinned by args.unusualVolume.test.js): which
   *  way the stock is going on the day, and how far above its usual volume it must be. No word
   *  sits in both maps, so `UNVOL 3X UP` reads the same in either order. */
  unvolSide: {
    takes: 'UP or DOWN',
    parse: (tok) => UNVOL_SIDE_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => (v === 'down' ? 'down on the day' : 'up on the day'),
  },
  unvolMin: {
    takes: 'a multiple (2X, 3X, 5X)',
    parse: (tok) => UNVOL_MIN_WORDS[String(tok ?? '').trim().toUpperCase()] ?? null,
    describe: (v) => `${v}× its usual volume or more`,
  },
  // ── short interest (2026-11-18) ──
  /** SHRTS's rank (panels/shortListModel.js SHORT_RANK_ARG_WORDS; pinned by args.shortInterest.test.js). */
  shortRank: {
    takes: 'a rank (DTC, UP, DOWN, FLOAT)',
    parse: (tok) => {
      const key = String(tok ?? '').trim().toUpperCase()
      return Object.prototype.hasOwnProperty.call(SHORT_RANK_WORDS, key) ? SHORT_RANK_WORDS[key] : null
    },
    describe: (v) => ({ dtc: 'most days to cover first', up: 'biggest increase in short interest first',
      down: 'biggest decrease in short interest first', float: 'highest percent of float first' })[v] || v,
  },
  // ── open interest change (2026-11-19) ──
  /** OIC's side (panels/oiChangeModel.js OI_SIDE_ARG_WORDS; pinned by args.oiChange.test.js). */
  oiSide: {
    takes: 'a side (C for calls, P for puts)',
    parse: (tok) => {
      const key = String(tok ?? '').trim().toUpperCase()
      return Object.prototype.hasOwnProperty.call(OI_SIDE_WORDS, key) ? OI_SIDE_WORDS[key] : null
    },
    describe: (v) => ({ call: 'calls only', put: 'puts only' })[v] || v,
  },
  // ── Market Tide by day (2026-11-19) ──
  /** TIDEH's scope (panels/tideHistoryModel.js TIDE_SCOPE_ARG_WORDS; pinned by args.tideHistory.test.js). */
  tideScope: {
    takes: 'STOCKS or ETFS',
    parse: (tok) => {
      const key = String(tok ?? '').trim().toUpperCase()
      return Object.prototype.hasOwnProperty.call(TIDE_SCOPE_WORDS, key) ? TIDE_SCOPE_WORDS[key] : null
    },
    describe: (v) => ({ stocks: 'stocks only', etfs: 'ETFs and indexes only' })[v] || v,
  },
  // ── the seasonality board (2026-11-20) ──
  /** SEASB's measure (panels/seasonalityBoardModel.js SEAS_MEASURE_ARG_WORDS; pinned by args.seasonalityBoard.test.js). */
  seasMeasure: {
    takes: 'AVG or MEDIAN',
    parse: (tok) => {
      const key = String(tok ?? '').trim().toUpperCase()
      return Object.prototype.hasOwnProperty.call(SEAS_MEASURE_WORDS, key) ? SEAS_MEASURE_WORDS[key] : null
    },
    describe: (v) => ({ average: 'the average month', median: 'the median month' })[v] || v,
  },
  // ── Market wave A (2026-11-20) ──
  /** COT's market: ONE typed word, a market code or a plain word (`GOLD`, `ES`, `10Y`). Like
   *  `groupName` it is passed through upper-cased and the PANEL resolves it against the list the
   *  route returns, so the shell holds no market table. The shape is a pinned copy of
   *  panels/cotModel.js COT_ARG_SHAPE (args.marketWaveA.test.js). */
  cotMarketName: {
    takes: 'a futures market: its code or a plain word (COT GOLD, COT ES, COT 10Y)',
    parse: (tok) => {
      const t = String(tok ?? '').trim().toUpperCase()
      return COT_MARKET_SHAPE.test(t) ? t : null
    },
    describe: (v) => `market "${v}"`,
    // a word in COT's own market dictionary (OIL, GOLD, WTI…) is COT's even when it is also a function code
    // (`OIL`, the weekly oil report): `COT OIL` is crude positioning; any other code after COT stays that code
    known: (tok) => Object.prototype.hasOwnProperty.call(COT_WORDS, String(tok ?? '').trim().toUpperCase()),
  },
  /** ANLG's count: how many similar sessions, a whole number from 3 to 10 (the route's own bounds;
   *  a pinned copy of panels/analoguesModel.js, args.marketWaveA.test.js). */
  anlgCount: {
    takes: 'how many similar sessions (3 to 10)',
    parse: (tok) => {
      const t = String(tok ?? '').trim()
      if (!/^\d{1,2}$/.test(t)) return null
      const n = Number(t)
      return n >= ANLG_COUNT_BOUNDS[0] && n <= ANLG_COUNT_BOUNDS[1] ? n : null
    },
    describe: (v) => `${v} similar sessions`,
  },
  // ── INS CLUSTER (2026-11-21) ──
  /** INS's view (panels/insiderClustersModel.js INS_VIEW_ARG_WORDS; pinned by args.insiderClusters.test.js):
   *  `INS CLUSTER` is the cluster list from the SEC's Form 4 filings; bare `INS` stays all buys. */
  insView: {
    takes: 'CLUSTER',
    parse: (tok) => {
      const key = String(tok ?? '').trim().toUpperCase()
      return Object.prototype.hasOwnProperty.call(INS_VIEW_WORDS, key) ? INS_VIEW_WORDS[key] : null
    },
    describe: (v) => (v === 'cluster' ? 'insider cluster buys' : v),
  },
  // ── FUND (2026-11-21): the panel model's words (panels/fundMetricsModel.js; pinned by functions.fundMetrics.test.js) ──
  /** FUND's line: ONE metric word draws that metric as a line (parseFundMetric). */
  fundMetric: {
    takes: 'a metric to draw as a line (PE, REV, EPS, NETM, FCFM, ROE)',
    parse: (tok) => fundMetricOf(tok),
    describe: (v) => `line of ${FUND_WORD_OF[v] || v}`,
  },
  /** FUND's rows: metric words joined by + (`REV+EPS+PE`, `REV+` for one), at most twelve (parseFundMetrics). */
  fundMetrics: {
    takes: 'the rows, metric words joined by + (REV+EPS+PE)',
    parse: (tok) => {
      const t = String(tok ?? '').trim().toUpperCase()
      if (!t.includes('+')) return null
      const parts = t.split('+').filter(Boolean)
      if (!parts.length || parts.length > FUND_MAX_METRICS) return null
      const ids = parts.map(fundMetricOf)
      return ids.some((x) => !x) || new Set(ids).size !== ids.length ? null : ids
    },
    describe: (v) => `rows ${v.map((id) => FUND_WORD_OF[id] || id).join(', ')}`,
  },
  /** FUND's compared tickers: a REST kind (`rest: true` on the spec), every ticker after the code, at most
   *  three, none twice (parseFundPeers). A REST spec never decides on its own that a word is an argument
   *  rather than the stock (parseCommand.js isDeclaredArg), so `FUND NVDA AMD` keeps NVDA as the stock. A
   *  function code or a metric word is a ticker here only with `$`, as everywhere on the command line. */
  fundPeers: {
    takes: 'up to three tickers to compare (NVDA FUND AMD AVGO)',
    parse: (tok) => {
      const words = String(tok ?? '').trim().split(/\s+/).filter(Boolean)
      if (!words.length || words.length > FUND_MAX_PEERS) return null
      const out = []
      for (const w of words) {
        const s = ARG_KINDS.symbol.parse(w)
        if (!s || out.includes(s) || (!String(w).startsWith('$') && fundMetricOf(s))) return null
        out.push(s)
      }
      return out
    },
    describe: (v) => `compared with ${v.join(', ')}`,
  },
  // ── market history (2026-11-21) ──
  /** MKTH's index (panels/marketHistoryModel.js MKTH_INDEX_WORDS; pinned by functions.marketHistory.test.js). */
  mkthIndex: {
    takes: 'an index (SPX for the S&P 500, NDX for the Nasdaq-100)',
    parse: (tok) => {
      const key = String(tok ?? '').trim().toUpperCase()
      return Object.prototype.hasOwnProperty.call(MKTH_INDEX_ARG_WORDS, key) ? MKTH_INDEX_ARG_WORDS[key] : null
    },
    describe: (v) => (v === 'NDX' ? 'the Nasdaq-100' : 'the S&P 500'),
  },
}

/** The word IMOV writes before a hand-picked theme (see `themeName`). */
export const THEME_MARKER = 'THEME'
/** The word that filters a panel to the member's own names (see `mine`). */
export const MINE_MARKER = 'MINE'

/**
 * Pure: what a variant does with the tokens typed after its code.
 *   props    — component props (`{ tf: 'W' }`)
 *   params   — URL params for a URL-owning panel (`{ week: null, d: '2026-10-02' }`)
 *   applied  — echo text for every token that took effect
 *   ignored  — every token that did NOT, verbatim (the shell says so out loud)
 *   takes    — what the variant would have accepted, for the echo
 * A door's `{argN}` placeholders consume their tokens first (CMP's comparator).
 */
export function applyArgs(variant, args = [], ctx = {}) {
  const out = { props: {}, params: {}, applied: [], ignored: [], takes: [] }
  const tokens = [...(args || [])].filter((t) => t != null && String(t) !== '')
  if (!variant) { out.ignored = tokens; return out }
  const consumed = new Set()
  if (variant.door) {
    for (const m of String(variant.door).matchAll(/\{arg(\d+)\}/g)) {
      const i = Number(m[1])
      if (i < tokens.length) consumed.add(i)
    }
  }
  const specs = variant.args || []
  out.takes = [...new Set(specs.map((s) => ARG_KINDS[s.kind]?.takes).filter(Boolean))]
  const filled = new Set()
  // A REST spec (IMOV's theme name) collects every word the single-token specs do not take.
  const restAt = specs.findIndex((s) => s.rest)
  const rest = []
  tokens.forEach((tok, i) => {
    if (consumed.has(i)) return
    const at = specs.findIndex((s, j) => !s.rest && !filled.has(j) && ARG_KINDS[s.kind]?.parse(tok, ctx) != null)
    if (at < 0) {
      if (restAt >= 0 && ARG_KINDS[specs[restAt].kind]?.parse(tok, ctx) != null) rest.push(tok)
      else out.ignored.push(tok)
      return
    }
    filled.add(at)
    const spec = specs[at]
    const value = ARG_KINDS[spec.kind].parse(tok, ctx)
    if (spec.prop) out.props[spec.prop] = value
    if (spec.param) Object.assign(out.params, value)
    out.applied.push(ARG_KINDS[spec.kind].describe(value))
  })
  if (rest.length) {
    const spec = specs[restAt]
    const words = spec.marker && String(rest[0]).toUpperCase() === spec.marker ? rest.slice(1) : rest
    const value = words.length ? ARG_KINDS[spec.kind].parse(words.join(' '), ctx) : null
    if (value == null) out.ignored.push(...rest)            // a bare `THEME` names nothing
    else {
      if (spec.prop) out.props[spec.prop] = value
      out.applied.push(ARG_KINDS[spec.kind].describe(value))
    }
  }
  return out
}

/** The one sentence the shell shows for a command's arguments, or null when there were none. */
export function argsEcho(code, result) {
  if (!result || (!result.applied.length && !result.ignored.length)) return null
  const parts = []
  if (result.applied.length) parts.push(`${code}: applied ${result.applied.join(', ')}.`)
  if (result.ignored.length) {
    const what = result.ignored.map((t) => `"${t}"`).join(', ')
    parts.push(result.takes.length
      ? `Not applied: ${what} — ${code} takes ${result.takes.join(' or ')}.`
      : `Not applied: ${what} — ${code} takes no arguments.`)
  }
  return parts.join(' ')
}
