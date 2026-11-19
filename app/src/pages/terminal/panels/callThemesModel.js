// CEOS: what CEOs are saying, the pure half (no React and no imports, so an agent capability can
// reuse it and args.js can take the parsers without pulling a panel in).
//
// ONE READ, in api/routers/earnings_intel.py over api/services/call_themes.py:
//
//   GET /api/earnings/call-themes[?month=YYYY-MM]
//
// GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. Not behind a flag. A
//        `month` that is not YYYY-MM is a 422, so the panel only ever sends one it parsed.
//
// WHAT IT IS. For one calendar month of indexed earnings calls, the one-, two- and three-word
// phrases whose share of CALLS rose the most against the (up to three) months before it. A call
// counts once however often it says the phrase. Two lists:
//   new      at most `rules.new_max_base_pct` percent of the earlier calls said it; most-said first
//   rising   up by `rules.rise_min_points` points AND `rules.rise_min_ratio` times (a single word,
//            `rules.rise_min_ratio_one_word` times); biggest rise first
// The earlier share is LIKE FOR LIKE: the earlier calls are weighted to this month's mix of
// industries, because which industries report changes through an earnings season
// (`baseline.matched_pct` says how much of the month could be matched; 0 means a plain comparison).
//
// THE ANSWER, always HTTP 200, by `status`:
//   ok         { month, months: [YYYY-MM newest first], calls, companies,
//                baseline: { months, calls, matched_pct }, floor: { calls, companies },
//                new: [row], rising: [row], qualified: { new, rising },
//                built_at, refreshing, corpus: { calls, oldest, newest, months: [{ month, calls }] }, rules }
//     a row    { phrase, words, calls, pct, companies, base_calls, base_pct, base_raw_pct, rise,
//                ratio (null when nothing earlier), related: [phrase], examples: [ticker] }
//              `pct`, `base_pct` and `rise` are ALREADY IN PERCENT / POINTS. `related` are phrases
//              said by the same calls, folded into this row. `examples` are the companies whose
//              call said it most. A list holds at most `rules.list_cap` rows; `qualified` counts
//              the phrases that passed, so when it is larger the WEAKEST are the ones left out.
//   computing  nothing is held on this server yet. One background build has started; ask again.
//   empty      the call index holds no calls (a gap on our side, not a finding).
//   thin       the index holds calls, but no month has enough of them to compare yet.
//   no_month   there is no list for the month asked for; `months` says which exist.
//   error      the build failed moments ago.
// The lists are worked out once a day after the call index updates, never on the request;
// `built_at` is when. `refreshing` marks an answer the daily job has not replaced in time.
//
// ⛔ NO TRANSCRIPT TEXT. A row is a phrase of at most three words with counts and tickers. To read
// what was said, the panel opens the call search on the phrase (`searchCommand`).

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const CALL_THEMES_CODE = 'CEOS'
/** The call search a phrase opens. */
export const CALL_SEARCH_CODE = 'TSRC'
export const CALL_THEMES_URL = '/api/earnings/call-themes'
/** Rows of each list shown while both lists are on screen. */
export const BOTH_ROWS = 10

/** What the panel can show, with the chip label and the word the command line takes for it. */
export const CALL_THEME_LISTS = Object.freeze({
  both: { chip: 'Both lists', token: null },
  new: { chip: 'New this month', token: 'NEW' },
  rising: { chip: 'Rising', token: 'RISING' },
})
export const DEFAULT_CALL_THEMES_LIST = 'both'

/** Words typed after the code (`CEOS RISING`). args.js keeps a copy, pinned by args.callThemes.test.js. */
export const CALL_THEMES_LIST_ARG_WORDS = Object.freeze({
  NEW: 'new', FRESH: 'new', FIRST: 'new',
  RISING: 'rising', RISE: 'rising', RISERS: 'rising', UP: 'rising',
  BOTH: 'both', ALL: 'both',
})

const text = (v) => (v === null || v === undefined ? '' : String(v))
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const whole = (v) => { const n = num(v); return n === null || n < 0 ? null : Math.round(n) }
const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)

/** Pure: a typed word as a list (`RISING` -> 'rising'), or null. */
export const parseCallThemesList = (token) => own(CALL_THEMES_LIST_ARG_WORDS, text(token).trim().toUpperCase())
/** Pure: a prop or a chip key as a list, falling back to both. */
export const normCallThemesList = (raw) => parseCallThemesList(raw)
  || (own(CALL_THEME_LISTS, text(raw).trim().toLowerCase()) ? text(raw).trim().toLowerCase() : DEFAULT_CALL_THEMES_LIST)

/** Pure: a typed month as `YYYY-MM` (`2026-10`, `2026-9`, `2026/10`), or null. */
export function parseCallThemesMonth(token) {
  const m = /^(\d{4})[-/](\d{1,2})$/.exec(text(token).trim())
  if (!m) return null
  const [y, mo] = [Number(m[1]), Number(m[2])]
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, '0')}` : null
}

/** Pure: the arguments a choice writes into the panel's command. Both lists of the newest month is the bare command. */
export function callThemesCommandArgs({ list = null, month = null } = {}) {
  return [CALL_THEME_LISTS[normCallThemesList(list)].token, parseCallThemesMonth(month)].filter(Boolean)
}

export const callThemesUrl = (month = null) => {
  const ym = parseCallThemesMonth(month)
  return ym ? `${CALL_THEMES_URL}?month=${ym}` : CALL_THEMES_URL
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Pure: `2026-11` as `Nov 2026`, or null. */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(text(ym).trim())
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** Pure: a phrase as the words the call search can take: letters and numbers, single spaces. */
export const cleanPhrase = (raw) => text(raw).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Pure: the command that opens the call search on a phrase, or null when nothing searchable is
 * left of it. One word is searched as typed; several are quoted, so the search reads them as one
 * exact phrase (`TSRC "pricing power"`).
 */
export function searchCommand(phrase) {
  const q = cleanPhrase(phrase)
  if (q.length < 2) return null
  return q.includes(' ') ? `${CALL_SEARCH_CODE} "${q}"` : `${CALL_SEARCH_CODE} ${q}`
}

const ticker = (v) => { const s = text(v).trim().toUpperCase(); return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) ? s : null }

function rowsOf(list) {
  const out = []
  const seen = new Set()
  for (const it of Array.isArray(list) ? list : []) {
    const phrase = text(it?.phrase).replace(/\s+/g, ' ').trim()
    const calls = whole(it?.calls)
    const cmd = searchCommand(phrase)
    // a phrase the call search cannot take is not a row (every row opens its quotes)
    if (!cmd || calls === null || seen.has(phrase.toLowerCase())) continue
    seen.add(phrase.toLowerCase())
    const base = num(it.base_pct)
    out.push({
      key: phrase.toLowerCase(),
      phrase,
      cmd,
      calls,
      share: num(it.pct),
      companies: whole(it.companies),
      base,
      baseRaw: num(it.base_raw_pct),
      baseCalls: whole(it.base_calls),
      rise: num(it.rise),
      ratio: num(it.ratio),
      related: (Array.isArray(it.related) ? it.related : []).map((r) => text(r).replace(/\s+/g, ' ').trim()).filter(Boolean),
      examples: [...new Set((Array.isArray(it.examples) ? it.examples : []).map(ticker).filter(Boolean))],
    })
  }
  return out
}

const STATES = { ok: 'ok', computing: 'computing', empty: 'empty', thin: 'thin', no_month: 'no-month', error: 'error' }

/**
 * Pure: the answer as the panel needs it.
 *   state     'ok' | 'computing' | 'empty' | 'thin' | 'no-month' | 'error' | 'failed' (not this route's answer)
 *   month, label          the month the lists are for (`2026-11`, `Nov 2026`)
 *   months                [{ month, label }] that have a list, newest first
 *   calls, companies      the month's indexed calls and the companies they came from (null when not sent)
 *   baseline              { from, to (labels), calls, matched (percent matched like for like, or null) }
 *   floor                 { calls, companies } a phrase needed
 *   lists                 { new: { rows, qualified, cut }, rising: { ... } }; `cut` is how many
 *                         phrases passed and are not in the rows (the weakest ones)
 *   builtAt, refreshing   when the lists were worked out; a newer build is running
 *   corpus                { calls, months: [{ month, label, calls }] } the index holds
 *   rules                 the server's thresholds, as numbers (missing ones are null)
 */
export function callThemesRead(body) {
  const none = {
    state: 'failed', month: null, label: null, months: [], calls: null, companies: null, baseline: null, floor: null,
    lists: { new: { rows: [], qualified: 0, cut: 0 }, rising: { rows: [], qualified: 0, cut: 0 } },
    builtAt: null, refreshing: false, corpus: { calls: null, months: [] }, rules: {},
  }
  if (!isObj(body) || !own(STATES, text(body.status))) return none
  const state = STATES[body.status]
  const months = (Array.isArray(body.months) ? body.months : [])
    .map((m) => ({ month: text(m).trim(), label: monthLabel(m) })).filter((m) => m.label)
  const corpus = isObj(body.corpus) ? body.corpus : {}
  const rules = {}
  for (const [k, v] of Object.entries(isObj(body.rules) ? body.rules : {})) rules[k] = num(v)
  const shared = {
    ...none,
    state,
    months,
    builtAt: text(body.built_at).trim() || null,
    refreshing: body.refreshing === true,
    rules,
    corpus: {
      calls: whole(corpus.calls),
      months: (Array.isArray(corpus.months) ? corpus.months : [])
        .map((m) => ({ month: text(m?.month).trim(), label: monthLabel(m?.month), calls: whole(m?.calls) }))
        .filter((m) => m.label && m.calls !== null),
    },
  }
  if (state === 'no-month') return { ...shared, month: parseCallThemesMonth(body.month), label: monthLabel(body.month) }
  if (state !== 'ok') return shared
  const label = monthLabel(body.month)
  if (!label || !Array.isArray(body.new) || !Array.isArray(body.rising)) return none
  const base = isObj(body.baseline) ? body.baseline : {}
  const baseMonths = (Array.isArray(base.months) ? base.months : []).map(monthLabel).filter(Boolean)
  const qualified = isObj(body.qualified) ? body.qualified : {}
  const listOf = (name) => {
    const rows = rowsOf(body[name])
    const passed = Math.max(whole(qualified[name]) ?? 0, rows.length)
    return { rows, qualified: passed, cut: passed - rows.length }
  }
  const floor = isObj(body.floor) ? body.floor : {}
  return {
    ...shared,
    month: text(body.month).trim(),
    label,
    calls: whole(body.calls),
    companies: whole(body.companies),
    baseline: {
      from: baseMonths[0] || null,
      to: baseMonths[baseMonths.length - 1] || null,
      calls: whole(base.calls),
      matched: num(base.matched_pct),
    },
    floor: { calls: whole(floor.calls), companies: whole(floor.companies) },
    lists: { new: listOf('new'), rising: listOf('rising') },
  }
}

/** Pure: the rows a list shows: all of them, or the first BOTH_ROWS while both lists are on screen. */
export const shownRows = (rows, list) => (normCallThemesList(list) === 'both' ? (rows || []).slice(0, BOTH_ROWS) : (rows || []))

/** Pure: the row-number commands of what is on screen, the new list first (`3` opens the third phrase's quotes). */
export function rowCommands(view, list) {
  if (!view || view.state !== 'ok') return []
  const pick = normCallThemesList(list)
  const names = pick === 'both' ? ['new', 'rising'] : [pick]
  return names.flatMap((n) => shownRows(view.lists[n].rows, pick).map((r) => r.cmd))
}
