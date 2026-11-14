// UCT Agent market data — weekly / monthly bars and relative performance for `stock.dailyBars` (Phase 2 history,
// hist-builder). PURE: no read, no clock of its own (callers pass `today`). The reads live in marketDataBars.js.
//
//   periods   ONE bars.daily read with tf W | M: the product's own resampler over UCT's daily store (weeks dated by their
//             Friday close, months by their 1st) — each period's close, its change vs the previous period's close, the
//             sessions it holds; a FORMING week / month is labelled partial, never shown as a closed bar
//   compare   one bars.daily read per symbol (2–3 symbols, the gateway's per-turn read budget is 8): the close-to-close
//             change of each over the SAME periods (the keys every read holds), side by side
//
// Every figure in the prose is formatted from the envelope's own numbers (closes, change_pct, counts, dates); nothing is
// extrapolated, and a read with no usable rows answers in fixed words. Rows before 2003-09-10 are labelled yfinance.

import { num, money, signedPct, sessionDate } from './marketDataFormat'

export const TIMEFRAMES = ['D', 'W', 'M']
export const MAX_PERIODS = { W: 520, M: 300 }
export const DEFAULT_PERIODS = { W: 12, M: 12 }
export const MAX_COMPARE = 3
export const ROWS_IN_TEXT = 13
const UNIT = { W: 'week', M: 'month' }
const ADJ = { W: 'weekly', M: 'monthly' }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const monthWord = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(`${iso.slice(0, 7)}-15T12:00:00Z`))

/** A period's own label: "week ending Fri, Jan 31, 2025" / "Jan 2025". */
export function periodLabel(tf, row, ref = null) {
  return tf === 'W' ? `week ending ${sessionDate(row.date, ref)}` : monthWord(row.date)
}
const PERIODS_DONE = (tf) => `From UCT's daily bars, resampled to ${tf === 'W' ? 'weeks dated by their Friday close' : 'calendar months'}: completed sessions only, today's session is not included.`
export const PRE_FLOOR = "Rows before Sep 10, 2003 come from yfinance history (Massive's daily archive starts Sep 10, 2003)."

const rowsOf = (env) => {
  const bars = env?.data?.bars
  return Array.isArray(bars) ? bars.filter(b => b && typeof b.date === 'string' && num(b.close) != null) : []
}
const usable = (env) => !!env && (env.status === 'ok' || env.status === 'partial') && env.data?.timeframe && rowsOf(env).length > 0

function rowNote(tf, r) {
  const out = []
  if (r.partial && r.partial_reason === 'forming') out.push(`forming: partial, not a closed ${UNIT[tf]}`)
  else if (r.partial) out.push('partial: a session is missing from the store')
  if (r.pre_vendor_floor) out.push('yfinance history')
  return out.join('; ')
}

function staleLine(env, sym) {
  const through = env.data?.through
  const latest = env.data?.latest_completed_session
  return env.stale && through && latest && through !== latest
    ? `Note: UCT's bars for ${sym} end ${sessionDate(through, latest)}, but the most recent completed session was ${sessionDate(latest, latest)}, so the newest ${UNIT[env.data.timeframe]} is not up to date.`
    : null
}

/** A `bars.daily` W / M envelope → the member's answer. Pure; exported for tests. */
export function answerFromPeriods(env, { symbol, name = null, want = null, window = null }) {
  const bare = String(symbol || '').toUpperCase()
  const sym = name ? `${bare} (${name})` : bare
  if (!usable(env)) return { text: `I couldn't answer that for ${bare || 'that'}: its weekly / monthly bars are not available from UCT's market data. No price is stated.` }
  const tf = env.data.timeframe
  const rows = rowsOf(env)
  const ref = rows[rows.length - 1].last_session || rows[rows.length - 1].date
  const first = rows[0]
  const last = rows[rows.length - 1]
  const lines = []
  lines.push(`${sym} ${ADJ[tf]} closes, ${plural(rows.length, UNIT[tf])} from the ${periodLabel(tf, first, ref)} to the ${periodLabel(tf, last, ref)}${window ? ` (${window})` : ''}; each change is vs the previous ${UNIT[tf]}'s close:`)
  const table = {
    columns: [{ key: 'period', label: tf === 'W' ? 'Week ending' : 'Month' }, { key: 'close', label: 'Close' }, { key: 'change', label: 'Change' },
      { key: 'sessions', label: 'Sessions' }, { key: 'note', label: 'Note' }],
    rows: rows.map(r => ({ period: tf === 'W' ? sessionDate(r.date, ref) : monthWord(r.date), close: money(r.close), change: signedPct(r.change_pct) || '—', sessions: String(r.sessions ?? ''), note: rowNote(tf, r) })),
  }
  if (rows.length <= ROWS_IN_TEXT) {
    lines.push(...rows.map(r => `• ${periodLabel(tf, r, ref)}: close ${money(r.close)}${num(r.change_pct) != null ? ` (${signedPct(r.change_pct)})` : ''}${rowNote(tf, r) ? ` — ${rowNote(tf, r)}` : ''}.`))
  }
  const closed = rows.filter(r => !r.partial && num(r.change_pct) != null)
  if (closed.length >= 2) {
    const best = closed.reduce((a, b) => (b.change_pct > a.change_pct ? b : a))
    const worst = closed.reduce((a, b) => (b.change_pct < a.change_pct ? b : a))
    const up = closed.filter(r => r.change_pct > 0).length
    lines.push(`Of the ${plural(closed.length, `closed ${UNIT[tf]}`)} with a change: ${up} up, ${closed.length - up} down or flat; best ${signedPct(best.change_pct)} (${periodLabel(tf, best, ref)}), worst ${signedPct(worst.change_pct)} (${periodLabel(tf, worst, ref)}).`)
  }
  if (rows.length >= 2) {
    const pct = (last.close / first.close - 1) * 100
    lines.push(`From the ${periodLabel(tf, first, ref)} close of ${money(first.close)} to the ${periodLabel(tf, last, ref)} close of ${money(last.close)}: ${signedPct(pct)}.`)
  }
  if (last.partial && last.partial_reason === 'forming') {
    lines.push(`The ${periodLabel(tf, last, ref)} is still forming (${plural(last.sessions, 'session')} held, through ${sessionDate(last.last_session, ref)}): it is partial, not a closed ${UNIT[tf]}.`)
  }
  const stale = staleLine(env, bare)
  if (stale) lines.push(stale)
  if (want != null && rows.length < want) lines.push(`Only ${plural(rows.length, UNIT[tf])} ${rows.length === 1 ? 'is' : 'are'} held, fewer than the ${want} asked for.`)
  if (env.status === 'partial' && env.data?.window_from && first.first_session > env.data.window_from) {
    lines.push(`Note: UCT's bars for ${bare} start ${sessionDate(first.first_session, ref)}, after ${sessionDate(env.data.window_from, ref)}, so the window is shorter than asked.`)
  }
  if (rows.some(r => r.pre_vendor_floor)) lines.push(PRE_FLOOR)
  lines.push(PERIODS_DONE(tf))
  return { text: lines.join('\n'), table, present: { kind: 'table', title: `${bare} ${ADJ[tf]}`, short: bare, text: lines[0], table } }
}

/**
 * Several W / M envelopes (one per symbol) → relative performance over the periods EVERY read holds: each symbol's
 * close-to-close change from the first common period's close to the last common period's close. Pure.
 */
export function answerFromCompare(envs, { symbols, names = {}, window = null }) {
  const syms = symbols.map(s => String(s || '').toUpperCase())
  const bad = syms.filter((s, i) => !usable(envs[i]))
  if (bad.length) return { text: `I couldn't compare those: the weekly / monthly bars for ${bad.join(', ')} are not available from UCT's market data. No price is stated.` }
  const tf = envs[0].data.timeframe
  const byKey = envs.map(e => new Map(rowsOf(e).map(r => [r.date, r])))
  const keys = [...byKey[0].keys()].filter(k => byKey.every(m => m.has(k))).sort()
  if (keys.length < 2) return { text: `I couldn't compare those: their ${ADJ[tf]} bars share fewer than two ${UNIT[tf]}s in UCT's data. No price is stated.` }
  const k0 = keys[0], k1 = keys[keys.length - 1]
  const ref = byKey[0].get(k1).last_session || k1
  const r0 = byKey[0].get(k0), r1 = byKey[0].get(k1)
  const res = syms.map((s, i) => {
    const a = byKey[i].get(k0), b = byKey[i].get(k1)
    return { sym: s, label: names[s] ? `${s} (${names[s]})` : s, from: a.close, to: b.close, pct: (b.close / a.close - 1) * 100, partial: !!b.partial, forming: b.partial_reason === 'forming', pre: keys.some(k => byKey[i].get(k).pre_vendor_floor) }
  })
  const ranked = [...res].sort((a, b) => b.pct - a.pct)
  const lines = [`Relative performance on ${ADJ[tf]} closes, from the ${periodLabel(tf, r0, ref)} close to the ${periodLabel(tf, r1, ref)} close (${plural(keys.length - 1, UNIT[tf])}${window ? `, ${window}` : ''}):`]
  lines.push(...ranked.map(r => `• ${r.label}: ${signedPct(r.pct)} (${money(r.from)} → ${money(r.to)}).`))
  lines.push(`Ranked: ${ranked.map(r => `${r.sym} ${signedPct(r.pct)}`).join(', ')}. Price change only (split-adjusted, not dividend-adjusted).`)
  if (res.some(r => r.forming)) lines.push(`The ${periodLabel(tf, r1, ref)} is still forming: its close is the latest completed session's, not a closed ${UNIT[tf]}.`)
  else if (res.some(r => r.partial)) lines.push(`The ${periodLabel(tf, r1, ref)} is missing a session in the store for ${res.filter(r => r.partial).map(r => r.sym).join(', ')}.`)
  for (let i = 0; i < envs.length; i++) { const s = staleLine(envs[i], syms[i]); if (s) lines.push(s) }
  if (res.some(r => r.pre)) lines.push(PRE_FLOOR)
  lines.push(PERIODS_DONE(tf))
  const table = { columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'from', label: periodLabel(tf, r0, ref) }, { key: 'to', label: periodLabel(tf, r1, ref) }, { key: 'change', label: 'Change' }],
    rows: ranked.map(r => ({ symbol: r.sym, from: money(r.from), to: money(r.to), change: signedPct(r.pct) })) }
  return { text: lines.join('\n'), table, present: { kind: 'table', title: `${syms.join(' vs ')} ${ADJ[tf]}`, short: syms.join(' vs '), text: lines[0], table } }
}

// ── the member's window words → a W / M read (pure, given `today`) ──────────────────────────────────────────────
//   "in 2024" / "for 2024"     from 2024-01-01 to 2024-12-31 (the current year: to the latest completed session)
//   "this year" / "ytd"        from Jan 1 of this year
//   "since 2020"               from 2020-01-01
//   "over the last N weeks / months / years"     a count of periods (+1 for a comparison's base close)
const YEAR_RE = /^(?:in|for|during) (\d{4})$/
const SINCE_RE = /^since (\d{4})$/
const YTD_RE = /^(?:this year|so far this year|year to date|ytd)$/
const LASTN_RE = /^(?:over |for |in )?(?:the )?(?:last|past) (?:(\d{1,3}) )?(weeks?|months?|years?)$/

/** → { from, to } | { periods } | { why } | null (no window words). */
export function periodWindow(words, tf, today) {
  const w = String(words || '').trim().toLowerCase()
  if (!w) return null
  const year = Number(String(today).slice(0, 4))
  let m
  if ((m = YEAR_RE.exec(w))) {
    const y = Number(m[1])
    if (y > year) return { why: `${y} hasn't happened yet — UCT's bars cover completed sessions only.` }
    return { from: `${y}-01-01`, to: y === year ? null : `${y}-12-31`, word: String(y) }
  }
  if ((m = SINCE_RE.exec(w))) {
    const y = Number(m[1])
    if (y > year) return { why: `${y} hasn't happened yet — UCT's bars cover completed sessions only.` }
    return { from: `${y}-01-01`, to: null, word: `since ${y}` }
  }
  if (YTD_RE.test(w)) return { from: `${year}-01-01`, to: null, word: 'this year so far' }
  if ((m = LASTN_RE.exec(w))) {
    const n = m[1] ? Number(m[1]) : 1
    const unit = m[2].replace(/s$/, '')
    const periods = unit === 'year' ? (tf === 'W' ? 52 * n : 12 * n) : unit === 'month' ? (tf === 'W' ? Math.round(n * 52 / 12) : n) : (tf === 'W' ? n : null)
    if (periods == null) return { why: 'Weekly windows are counted in weeks, months or years, and monthly windows in months or years.' }
    if (!(periods >= 1) || periods > MAX_PERIODS[tf]) return { why: `That is more than UCT reads in one answer (${MAX_PERIODS[tf]} ${UNIT[tf]}s).` }
    return { periods, word: `the last ${plural(n, unit)}` }
  }
  return undefined
}
