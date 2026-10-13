// ── BREADTH: historical market breadth, answered LOCALLY (Market Intelligence slice 1) ─────────────
//
// ⛔ LOCAL-RESULT BOUNDARY (owner 2026-10-11, uct-mi-phase0/LOCAL-RESULT-BOUNDARY-CONTRACT.md).
// The model only PLANS `breadth.show` — validated args (mode, universe, metrics, dates). The browser
// asks /api/agent/breadth (admin-only, no model) and shows UCT's deterministic answer to the member.
// The figures NEVER go back to a model:
//   · this capability is `localOnly` — useAgent records its answer with outcomeData.local and the
//     request args, and the server replays that row as a note (turn.outcome_for_model), decided by
//     the action NAME on the server (turn.LOCAL_ONLY_ACTIONS) whatever the browser says;
//   · the model's own planning reply for such a turn is dropped (server and browser);
//   · the context section below carries DATES ONLY (today, latest finalized session), never a value.
// Values come from market_intel.breadth_reads / breadth_answer (MI-owned) — the same canonical series
// the member's breadth charts use. Finalized end-of-day only; nothing is invented or substituted.

import { registerCapability, registerTargetKind, registerContextProvider, registerWarmup } from '../capabilities'
import { chartTarget } from '../present'

//: Mirrors market_intel.breadth_reads (tests/test_uct_agent_breadth.py pins them equal).
export const BREADTH_UNIVERSES = ['us', 'nyse', 'nasdaq']
//: The member may name UCT's own universe. UCT Breadth has it, but the Agent's breadth reads (MI slice 1)
//: and the current-reading contract cover US / NYSE / Nasdaq only (UCT's live row is anchored to the
//: Yahoo-sourced collector — licensing note T-75/L2). So `uct` is a valid CHOICE that is answered
//: locally with what is true — never "UCT doesn't have that", never a guess, never a web search.
export const AGENT_UNIVERSES = [...BREADTH_UNIVERSES, 'uct']
export const UCT_UNIVERSE_ANSWER = 'Breadth for UCT’s own universe is on the Breadth page — UCT Agent can’t read it yet. '
  + 'UCT Agent answers breadth for US, NYSE and Nasdaq stocks (current readings and finalized history).'
export const BREADTH_METRICS = [
  'pct_above_5sma', 'pct_above_10sma', 'pct_above_20sma', 'pct_above_40sma', 'pct_above_50sma',
  'pct_above_100sma', 'pct_above_150sma', 'pct_above_200sma',
  'new_52w_highs', 'new_52w_lows', 'net_new_high_low', 'hi_ratio', 'lo_ratio',
  'new_20d_highs', 'new_20d_lows', 'near_52w_high',
  'up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day',
  'adv_decline', 'advancing', 'declining', 'universe_count',
  'stage2_count', 'stage4_count',
]
//: The documented GENERAL overview (`metrics: []`), mirrors api/services/uct_agent/breadth_present.py
//: OVERVIEW_METRICS (tests pin them equal): participation short + long, leadership, the day's moves.
export const OVERVIEW_METRICS = ['pct_above_50sma', 'pct_above_200sma', 'net_new_high_low', 'adv_decline']
export const METRIC_GUIDE = (
  'pct_above_{5,10,20,40,50,100,150,200}sma = % of stocks above that N-day simple MA; '
  + 'new_52w_highs/new_52w_lows = counts at 52-week highs/lows; net_new_high_low = highs minus lows; '
  + 'hi_ratio/lo_ratio = % of stocks at 52-week highs/lows; new_20d_highs/new_20d_lows = 20-day; '
  + 'near_52w_high = within 5% of 52w high; up_4pct_today/down_4pct_today = up/down 4%+ that day; '
  + 'ratio_5day/ratio_10day = up-4%/down-4% ratio over 5/10 days; '
  + 'adv_decline = net advancers; advancing/declining = issues up/down; universe_count = stocks counted; '
  + 'stage2_count/stage4_count = Stage 2 uptrend / Stage 4 downtrend counts.'
)

const ISO = /^\d{4}-\d{2}-\d{2}$/
const isoOrNull = (v) => (typeof v === 'string' && ISO.test(v) ? v : null)

// Dates only, refreshed in the background (the context is built synchronously).
const DATES_TTL_MS = 30 * 60 * 1000
const dates = { today_et: null, latest_finalized: null, at: 0, inflight: null }
export function _resetBreadthDates() { Object.assign(dates, { today_et: null, latest_finalized: null, at: 0, inflight: null }) }

export function loadBreadthDates() {
  if (dates.inflight) return dates.inflight
  if (dates.at && Date.now() - dates.at < DATES_TTL_MS) return Promise.resolve(dates)
  dates.inflight = fetch('/api/agent/breadth/dates', { credentials: 'include', cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then((b) => {
      if (b && typeof b === 'object') {
        // ⛔ only well-formed DATES are kept — whatever else a response holds never reaches the context
        dates.today_et = isoOrNull(b.today_et)
        const lf = b.latest_finalized && typeof b.latest_finalized === 'object' ? b.latest_finalized : {}
        dates.latest_finalized = Object.fromEntries(BREADTH_UNIVERSES.map(u => [u, isoOrNull(lf[u])]))
        dates.at = Date.now()
      }
      return dates
    })
    .catch(() => dates)
    .finally(() => { dates.inflight = null })
  return dates.inflight
}

const breadthSnap = () => ({ ref: 'breadth', label: 'Market breadth' })
export const breadthKind = {
  name: 'breadth',
  boardScoped: false,
  list: () => [breadthSnap()],
  read: (_host, ref) => (ref === 'breadth' ? breadthSnap() : null),
  stateOf: () => ({}),
  patch: () => null,
  commit: async () => true,
  landed: () => true,
  undoPatch: () => null,
  fingerprint: () => 'breadth',
}

// ── the member's last breadth SUBJECT (names only — a measure key, a universe, the last search's
// args; never a value): "that", "it", "same thing for Nasdaq", "what about last year?" resolve
// against it deterministically. In-memory, per page; the model path still has the history note.
let subject = null
export function rememberBreadthSubject(s) { subject = s && typeof s === 'object' ? { ...s } : null }
export const lastBreadthSubject = () => subject
export const breadthToday = () => dates.today_et
export function _resetBreadthSubject() { subject = null }

async function answerBreadth(args) {
  if (Array.isArray(args?.metrics)) {
    rememberBreadthSubject({ kind: 'show', universe: args.universe, metric: args.metrics.length === 1 ? args.metrics[0] : null, show: args })
  }
  if (args?.universe === 'uct') return { text: UCT_UNIVERSE_ANSWER, link: { href: '/breadth', label: 'Open Breadth' } }
  let r
  try {
    r = await fetch('/api/agent/breadth', {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(args || {}),
    })
  } catch (e) {
    return `I couldn't reach UCT's breadth data right now (${e?.message || 'network error'}). Nothing was looked up.`
  }
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    return `I couldn't read UCT's breadth data right now (${b.detail || `HTTP ${r.status}`}).`
  }
  // An unreadable body is SAID, never swallowed into a blank (TERM-033: no `.catch(() => null)`).
  let b
  try { b = await r.json() } catch { return "UCT's breadth answer came back unreadable, so nothing is shown." }
  if (!b || typeof b.text !== 'string') return "UCT's breadth answer came back unreadable, so nothing is shown."
  const t = b.table
  const table = t && Array.isArray(t.columns) && Array.isArray(t.rows) ? { columns: t.columns, rows: t.rows } : null
  // `present`: the server's concise view of the same answer (present.js); text + table become details
  const present = b.present && typeof b.present === 'object' ? b.present : null
  // OPEN CHART: the published series this answer read (the server's registry decides; none for "below")
  const chart = chartTarget(b.chart)
  return { text: b.text, table, ...(present ? { present } : {}), ...(chart ? { chart } : {}) }
}

// ── DETERMINISTIC routing for the OBVIOUS breadth questions (the fast path's own mechanism) ─────────
// "How's breadth today?", "What % of stocks are above their 50-day?", "... at the close?" are planned
// here with no model call — the SAME registry op, through the same planner / policy / runtime and the
// same local-only answer. Strict whole-message wording only: a date, a weekday, "yesterday", a second
// request or any other word → the model plans it, as before. Values never pass through here.
const SMA_PERIODS = new Set([5, 10, 20, 40, 50, 100, 150, 200])
const WHEN_NOW = '(?: (?:right now|now|today|currently|at the moment|so far today|this (?:morning|afternoon)))?'
const AT_CLOSE = ' (?:at|as of|on) (?:the )?(?:latest |last |most recent )?close'
const UNI_WORD = '(us|u\\.s\\.|nyse|nasdaq|uct)'
const UNI_PRE = `(?:${UNI_WORD} )?`
const UNI_POST = `(?: (?:on|for|in|across) (?:the )?${UNI_WORD}(?: stocks)?)?`
const ASK = "(?:(?:what(?:'s| is| are| was)?|how(?:'s| is)|show(?: me)?|give me|tell me) )?"
const OVERVIEW_RE = new RegExp(`^${ASK}(?:the )?${UNI_PRE}(?:market )?breadth(?: (?:look(?:ing)?|like|doing))*${UNI_POST}(${WHEN_NOW}|${AT_CLOSE})$`)
const PCT_RE = new RegExp(`^${ASK}(?:the )?(?:percent(?:age)?|%|pct|share) (?:of )?${UNI_PRE}(?:stocks )?(?:that are |are |were |is |trading )?(above|over|below|under|not above) (?:their |the |its )?(\\d+)(?:[\\s-]*(?:day|d))?(?:[\\s-]*(?:simple moving average|moving average|sma|dma|ma))?${UNI_POST}(${WHEN_NOW}|${AT_CLOSE})$`)
const uniOf = (...ws) => {
  const w = ws.find(Boolean)
  return !w || w === 'u.s.' ? 'us' : w
}
// "What was the lowest NYSE:A200 reading in 2022?" / "highest US 200sma in 2020" → series over that
// calendar year (MI's own range summary: low / high with their dates). A named PERIOD that is not a
// year ("the 2022 bear market") is left to the model, which asks for the dates it cannot resolve.
const LOWHIGH_RE = new RegExp(`^(?:what (?:was|is|were) )?(?:the )?(lowest|highest|low|high|minimum|maximum|min|max) (?:reading |value |level )?(?:(?:for|of|on) )?(?:the )?(?:${UNI_WORD}\\s*:?\\s*)?(?:a(\\d+)|(\\d+)[\\s-]*(?:day|d)?[\\s-]*(?:sma|dma|ma|moving average))(?: reading)?(?: (?:on|for) the ${UNI_WORD})? (?:in|during) (\\d{4})$`)
const SAME_SHOW_RE = new RegExp(`^(?:and )?(?:the )?same (?:thing |question )?(?:for|on) (?:the )?${UNI_WORD}(?: stocks)?$`)
// ── FOLLOW-UPS on the last READING (post-release 2026-10-13: "what about the nasdaq" after US:A50 reached
// the model). One thing changes; everything else — measure, side, basis — is the subject's.
//   "what about the Nasdaq?" / "and NYSE?" / "how about US stocks"     → the universe
//   "what about the 200?" / "and the 50-day?"                         → the moving average
//   "and how many are below it?" / "what % are above it"              → the side (above / at or below)
const FOLLOW_PRE = '(?:and |ok,? |so |then )?'
export const UNI_SWITCH_RE = new RegExp(`^(?:ok,? |so |then )?(?:(?:and )?(?:what|how) about|and(?: for)?) (?:the )?${UNI_WORD}(?: stocks| market)?$`)
const MA_SWITCH_RE = new RegExp(`^${FOLLOW_PRE}(?:(?:what|how) about|and) (?:the |their )?(\\d+)(?:[\\s-]*(?:day|d))?(?:[\\s-]*(?:simple moving average|moving average|sma|dma|ma))?$`)
const SIDE_SWITCH_RE = new RegExp(`^${FOLLOW_PRE}(?:how many|what (?:%|percent(?:age)?|share)|what about(?: the ones| stocks)?)(?: of them)? (?:are |were |is )?(?:trading )?(above|over|below|under|not above)(?: (?:it|that|the (?:ma|moving average|average)))?$`)
// UCT stores % ABOVE (strictly close > MA); "below" is its complement, served as the share AT OR BELOW
const sideOf = (w) => (/^(below|under|not above)$/.test(w) ? 'below' : null)
export function breadthFast(raw) {
  const t = String(raw || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[?.!]+$/g, '').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 120) return null
  // "same thing for Nasdaq" after a READING: the same request, one universe changed (a search → breadth.history)
  const lh = LOWHIGH_RE.exec(t)
  if (lh) {
    const n = Number(lh[3] || lh[4]), y = Number(lh[6])
    if (!SMA_PERIODS.has(n) || !(y >= 1990 && y <= 2100)) return null
    const thisYear = Number(String(dates.today_et || new Date().toISOString()).slice(0, 4))
    if (y > thisYear) return null
    return { mode: 'series', universe: uniOf(lh[2], lh[5]), metrics: [`pct_above_${n}sma`], date: null, compare_date: null,
      start: `${y}-01-01`, end: y === thisYear ? null : `${y}-12-31`, basis: null, side: null }
  }
  const same = SAME_SHOW_RE.exec(t)
  if (same) return subject?.kind === 'show' && subject.show ? { side: null, ...subject.show, universe: uniOf(same[1]) } : null
  const fu = followUp(t)
  if (fu !== undefined) return fu
  const base = { date: null, compare_date: null, start: null, end: null }
  let m = OVERVIEW_RE.exec(t)
  if (m) {
    return { mode: 'value', universe: uniOf(m[1], m[2]), metrics: [], ...base, basis: /close$/.test(m[3] || '') ? 'close' : null, side: null }
  }
  m = PCT_RE.exec(t)
  if (m) {
    const n = Number(m[3])
    if (!SMA_PERIODS.has(n)) return null
    return { mode: 'value', universe: uniOf(m[1], m[4]), metrics: [`pct_above_${n}sma`], ...base, basis: /close$/.test(m[5] || '') ? 'close' : null, side: sideOf(m[2]) }
  }
  return null
}

/** A follow-up on the last READING: its args with one thing changed. null = recognised but not answerable
 *  here (the model plans it); undefined = not a reading follow-up (a SEARCH subject is breadth.history's). */
function followUp(t) {
  const u = UNI_SWITCH_RE.exec(t)
  const ma = u ? null : MA_SWITCH_RE.exec(t)
  const sd = u || ma ? null : SIDE_SWITCH_RE.exec(t)
  if (!u && !ma && !sd) return undefined
  if (!subject) return null
  if (subject.kind !== 'show') {
    if (!sd) return undefined
    // "how many are below it?" after a SEARCH: the current reading of that measure, on that side
    return subject.metric && /^pct_above_\d+sma$/.test(subject.metric) && BREADTH_UNIVERSES.includes(subject.universe)
      ? { mode: 'value', universe: subject.universe, metrics: [subject.metric], date: null, compare_date: null,
        start: null, end: null, basis: null, side: sideOf(sd[1]) }
      : null
  }
  const prev = { side: null, ...subject.show }
  if (u) return { ...prev, universe: uniOf(u[1]) }
  const one = Array.isArray(prev.metrics) && prev.metrics.length === 1 ? prev.metrics[0] : null
  if (!one || !/^pct_above_\d+sma$/.test(one)) return null
  if (ma) {
    const n = Number(ma[1])
    return SMA_PERIODS.has(n) ? { ...prev, metrics: [`pct_above_${n}sma`] } : null
  }
  if (prev.mode !== 'value') return null              // the share below is a reading, never a range
  return { ...prev, side: sideOf(sd[1]) }
}

const nullableDate = { type: ['string', 'null'] }
let registered = false
export function registerBreadthCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(breadthKind)
  registerWarmup(() => loadBreadthDates())
  registerContextProvider({
    key: 'breadth',
    build: (_host, refFor) => {
      loadBreadthDates()                     // keep the dates fresh for the NEXT request (never blocks)
      return [{
        ref: refFor('breadth', 'breadth'),
        label: 'UCT market breadth (US, NYSE, Nasdaq — finalized end of day; dates only here)',
        ...(dates.today_et ? { today_et: dates.today_et } : {}),
        ...(dates.latest_finalized ? { latest_finalized: dates.latest_finalized } : {}),
      }]
    },
  })

  registerCapability({
    name: 'breadth.show',
    surfaces: ['charts'],
    target: 'breadth', query: true,
    // ⛔ the boundary: this answer is shown to the member and never replayed to a model
    localOnly: true,
    summary: 'Look up MARKET BREADTH from UCT\'s own data (US, NYSE, Nasdaq): the current reading (live in the session), a finalized value on a date, two dates compared, or a range summarised — % above a moving average, new highs/lows, advance/decline, Stage 2/4 counts. '
      + 'UCT shows the figures to the member; you never see them. Use this (disposition apply, research null) — never state breadth figures yourself.',
    hints: 'target = breadth ref. universe us (default) | nyse | nasdaq | uct. metrics 1–4 keys; [] = general overview. '
      + 'value: date null = now; basis "close" if a close is asked; side "below" for % BELOW MA; else null. '
      + 'compare: compare_date required, date null = latest. series: start required, end null = latest. '
      + 'Dates YYYY-MM-DD or null, from today_et / latest_finalized. '
      + 'reply: one short line, no figures. Keys: ' + METRIC_GUIDE,
    args: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['value', 'compare', 'series'] },
        universe: { type: 'string', enum: AGENT_UNIVERSES },
        metrics: { type: 'array', items: { type: 'string', enum: BREADTH_METRICS } },
        date: nullableDate, compare_date: nullableDate, start: nullableDate, end: nullableDate,
        // "close" = the member asked for a closing / end-of-day value (finalized); null = present tense
        basis: { type: ['string', 'null'], enum: ['close', null] },
        // "below" = the member asked for the share BELOW a moving average (value mode, % above-MA keys only):
        // UCT answers the share AT OR BELOW it (100 − above, the same measure); null otherwise
        side: { type: ['string', 'null'], enum: ['below', null] },
      },
      required: ['mode', 'universe', 'metrics', 'date', 'compare_date', 'start', 'end', 'basis', 'side'],
      additionalProperties: false,
    },
    fastWhole: true,
    // market data is never fetched on a guessed spelling ("whats bredth like" → the model plans it)
    fastCorrect: false,
    fast: ({ raw }) => breadthFast(raw),
    answer: (_snap, args) => answerBreadth(args),
  })
}
