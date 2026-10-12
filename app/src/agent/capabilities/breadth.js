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

//: Mirrors market_intel.breadth_reads (tests/test_uct_agent_breadth.py pins them equal).
export const BREADTH_UNIVERSES = ['us', 'nyse', 'nasdaq']
export const BREADTH_METRICS = [
  'pct_above_5sma', 'pct_above_10sma', 'pct_above_20sma', 'pct_above_40sma', 'pct_above_50sma',
  'pct_above_100sma', 'pct_above_150sma', 'pct_above_200sma',
  'new_52w_highs', 'new_52w_lows', 'net_new_high_low', 'hi_ratio', 'lo_ratio',
  'new_20d_highs', 'new_20d_lows', 'near_52w_high',
  'up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day',
  'adv_decline', 'advancing', 'declining', 'universe_count',
  'stage2_count', 'stage4_count',
]
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

async function answerBreadth(args) {
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
  const b = await r.json().catch(() => null)
  if (!b || typeof b.text !== 'string') return "UCT's breadth answer came back unreadable, so nothing is shown."
  const t = b.table
  const table = t && Array.isArray(t.columns) && Array.isArray(t.rows) ? { columns: t.columns, rows: t.rows } : null
  return { text: b.text, table }
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
    summary: 'Look up historical MARKET BREADTH from UCT\'s own finalized end-of-day data (US, NYSE or Nasdaq stocks): a value on a date, two dates compared, or a date range summarised — % of stocks above a moving average, new highs/lows, advance/decline, Stage 2/4 counts. '
      + 'UCT shows the figures to the member; you never see them. Use this (disposition apply, research null) — never state breadth figures yourself.',
    hints: 'target = the breadth entry ref. universe us (all US stocks; default) | nyse | nasdaq. metrics = 1–4 keys. '
      + 'mode value: date (null = latest). compare: compare_date required, date null = latest. series: start required, end null = latest. '
      + 'Dates YYYY-MM-DD, else null; turn "a month ago" into a date from the entry\'s today_et / latest_finalized. '
      + 'reply: one short line, no figures. Keys: ' + METRIC_GUIDE,
    args: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['value', 'compare', 'series'] },
        universe: { type: 'string', enum: BREADTH_UNIVERSES },
        metrics: { type: 'array', items: { type: 'string', enum: BREADTH_METRICS } },
        date: nullableDate, compare_date: nullableDate, start: nullableDate, end: nullableDate,
      },
      required: ['mode', 'universe', 'metrics', 'date', 'compare_date', 'start', 'end'],
      additionalProperties: false,
    },
    answer: (_snap, args) => answerBreadth(args),
  })
}
