// WEEKEND WATCHLIST, the rules (docs/study/GAMES.md §3, kind 'watchlist'). Pure: no React, no clock, no Math.random(); a
// seed deals the board and every number on the screen is counted here or read from the server's reveal.
//
// THE PLAY. A Sunday scan: eight real charts from the Hard pool (challengeBank.fetchSpotPool with `hard: true`, the
// charts api/services/study_hard.py swept so that on a Yes chart only its own setup fires on the last bar and on a No
// chart nothing fires at all), tickers hidden. The member flags every chart where a setup fired on the last candle and
// passes on the rest, then locks the list.
//
// WHY THERE IS NO SET NUMBER. The bank's Yes / No key never reaches the browser before an answer
// (study_store.get_item_prompt: never the key), so nothing here can know how many charts on a board fired until each
// one is scored. A board that said "three of these fired" would be a guess, and a guess can be wrong (the owner, batch
// 21: "We cannot have incorrect examples and explanations!"). So the prompt says the honest thing: there is no set
// number, it could be none of them or all of them; every chart is a call, and the count is told after the lock.
//
// SCORED ON THE SERVER. Each chart posts the answer Hard mode would send for it (hardMode.hardAnswer): a flag names the
// chart's own setup (the bank's Yes; on a swept chart "a setup fired" and "its setup fired" are the same claim), a pass
// is "Nothing fired" (the bank's No). XP is what those attempts earn; this game never posts a game run.
import { NOTHING, RUN_AFTER_PEAK, SHORT_SETUPS, culmination, hardAnswer, runLength, setupFired, withArticle } from '../hardMode'
import { SETUP_NAMES } from '../challengeBank'
import { firstSentence, splitLesson } from '../../ui/lesson'

export const WATCH_KIND = 'watchlist'
export const WATCH_TOTAL = 8           // charts on a board
export const WATCH_PER_SKILL = 4       // charts asked of each setup's Hard pool (Hard mode asks the same)
export const WATCH_VIEW = 60           // sessions a board chart frames before the lock (a phone frames fewer)
export const WATCH_VIEW_PHONE = 48
export const WAVE_MS = 170             // the board's charts start their run-on this far apart after the lock

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const sess = (n) => plural(n, 'session')
const pctText = (v) => `${Math.abs(v).toFixed(1)}%`
const signed = (v) => `${v >= 0 ? '+' : '−'}${pctText(v)}`
// "The gap was 0.3%" reads "the gap was 0.3%" after a colon; "RVOL was 1.1x" or "AAPL closed" keep their capitals
const lowerFirst = (t) => (t && /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t)

/** "Kicker, Launchpad, ... and Bear gap": the setups the swept pool is checked against (study_hard.SETUP_RULES), so the
 *  question says what "a setup" means on this board (rule 10: enough detail to know what to look at). */
export function setupList(names = SETUP_NAMES) {
  const list = (names || []).filter(Boolean)
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] || '')
}

function seeded(seed) {
  let s = Math.abs(Math.floor(Number(seed) || 1)) % 2147483647 || 1
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
}

/** THE DEAL. Up to `total` charts from the pool, the same board for the same seed: the pool shuffled by the seed, then
 *  taken round robin across the setups, so a board is never eight of one kind while the pool has others. Each chart
 *  appears once; a chart without at least two bars is left out (it cannot show a last candle against the one before). */
export function dealBoard(pool, seed = 1, total = WATCH_TOTAL) {
  const seen = new Set()
  const list = []
  for (const it of Array.isArray(pool) ? pool : []) {
    if (!it || it.id == null || seen.has(it.id) || !Array.isArray(it.bars) || it.bars.length < 2) continue
    seen.add(it.id)
    list.push(it)
  }
  const rnd = seeded(seed)
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]] }
  const queues = new Map()
  for (const it of list) {
    const k = String(it.skill || it.name || '')
    if (!queues.has(k)) queues.set(k, [])
    queues.get(k).push(it)
  }
  const lanes = [...queues.values()]
  const out = []
  const cap = Math.max(0, Math.floor(Number(total) || 0))
  while (out.length < cap && lanes.some((q) => q.length)) {
    for (const q of lanes) if (q.length && out.length < cap) out.push(q.shift())
  }
  return out
}

/** What one chart posts: Hard mode's answer for it. A flag names the chart's own setup (the bank's Yes); a pass is
 *  "Nothing fired" (the bank's No). `yes` / `no` are the item's own choice labels (SpotSetupChallenge.yesNo). */
export function watchAnswer(item, flagged, yes = 'Yes', no = 'No') {
  return hardAnswer(flagged ? item.name : NOTHING, item, yes, no)
}

/** The time the member spent per chart, for the attempt's `time_ms`: the board's time shared across its charts. */
export function perChartMs(totalMs, n) {
  const t = Number(totalMs)
  return Math.round((Number.isFinite(t) && t > 0 ? t : 0) / Math.max(1, Math.floor(Number(n) || 0)))
}

/** One chart after its attempt (null when the attempt failed, so the chart is left out of the score, never counted as a
 *  miss it was not). `right` is the server's verdict; `fired` is the bank's key from the reveal (hardMode.setupFired,
 *  which falls back to the verdict on what was posted when the reveal has no yes / no key). */
export function readChart(item, flagged, attempt) {
  const f = !!flagged
  if (!attempt || typeof attempt !== 'object') return { scored: false, flagged: f, right: null, fired: null, truth: null, ticker: '', asof: null, xp: 0 }
  const rv = attempt.reveal || {}
  const right = !!attempt.correct
  const fired = setupFired(f ? item.name : NOTHING, item, right, rv.answer)
  return {
    scored: true,
    flagged: f,
    right,
    fired,
    truth: fired === true ? item.name : fired === false ? NOTHING : null,
    ticker: String(rv.sym || rv.ticker || '').trim(),
    asof: rv.asof || null,
    xp: Math.max(0, Number(attempt.progress?.xp_gained) || 0),
  }
}

/** The board counted. `total` and `right` are over the charts that were checked; a pick is a flagged chart, right when
 *  a setup fired on it; `fired` is how many charts on the board fired and `caught` how many of those were flagged. */
export function tally(rows) {
  const all = Array.isArray(rows) ? rows : []
  const scored = all.filter((r) => r && r.scored)
  const picks = scored.filter((r) => r.flagged)
  const passes = scored.filter((r) => !r.flagged)
  const fired = scored.filter((r) => r.fired === true)
  return {
    total: scored.length,
    right: scored.filter((r) => r.right).length,
    picks: picks.length,
    picksRight: picks.filter((r) => r.right).length,
    passes: passes.length,
    passesRight: passes.filter((r) => r.right).length,
    fired: fired.length,
    caught: fired.filter((r) => r.flagged).length,
    unscored: all.length - scored.length,
    xp: scored.reduce((t, r) => t + (Number(r.xp) || 0), 0),
  }
}

/** What the stock did after the last candle, measured from the bars the reveal sent. Fired: the best the move did
 *  while the setup was still alive (hardMode.culmination: the best high long, the best low short, until a close breaks
 *  the signal candle's range). Nothing fired: the plain change from the last candle's close to the last bar shown. */
export function moveOf(signal, forward, { fired = false, short = false } = {}) {
  if (!signal || !Number.isFinite(signal.c) || signal.c <= 0 || !Array.isArray(forward) || !forward.length) return null
  if (fired) {
    const c = culmination(signal, forward, short)
    return c ? { kind: 'peak', short, pct: c.pct, sessions: c.sessions, broke: c.broke == null ? null : c.broke + 1 } : null
  }
  const last = forward[forward.length - 1]
  if (!Number.isFinite(last?.c)) return null
  return { kind: 'drift', short: false, pct: (last.c / signal.c - 1) * 100, sessions: forward.length }
}

/** The move in a line: "Best move +18.2% in 9 sessions" / "Best move: fell 7.5% in 3 sessions" (a short setup) /
 *  "Next 20 sessions: +2.1%"; a setup that never went its way says so. */
export function moveLabel(m) {
  if (!m || !Number.isFinite(m.pct)) return ''
  if (m.kind === 'drift') return `Next ${sess(m.sessions)}: ${signed(m.pct)}`
  if (m.short) return m.pct < 0 ? `Best move: fell ${pctText(m.pct)} in ${sess(m.sessions)}` : 'Never traded under the signal close'
  return m.pct > 0 ? `Best move: +${pctText(m.pct)} in ${sess(m.sessions)}` : 'Never traded over the signal close'
}

/** THE CARD'S MOVE LINE, in the same numbers the focused review draws (so a chart never says two things). A setup that
 *  fired, with its plan from the server (hardMode.reviewTrade): the best advance from the entry while the trade was
 *  alive, or "Stopped out in 2 sessions" when it never went its way; without a plan, the culmination from the signal
 *  close (hardMode.culmination). Nothing fired: the change over the sessions shown (`drift`, moveOf). */
export function moveLine({ fired = null, trade = null, culm = null, short = false, drift = null } = {}) {
  if (fired !== true) return drift ? moveLabel(drift) : ''
  if (trade?.kind === 'plan') {
    if (trade.bestSessions && Number.isFinite(trade.advancePct)) {
      const where = `from entry in ${sess(trade.bestSessions)}`
      return trade.long === false ? `Best move: fell ${pctText(trade.advancePct)} ${where}` : `Best move: ${signed(trade.advancePct)} ${where}`
    }
    if (trade.stoppedSession) return `Stopped out in ${sess(trade.stoppedSession)}`
  }
  if (!culm || !Number.isFinite(culm.pct)) return ''
  return moveLabel({ kind: 'peak', short, pct: culm.pct, sessions: culm.sessions })
}

/** How many forward bars a chart runs on after the lock: Hard mode's length (hardMode.runLength: to the culmination and
 *  a few past it, a set length when nothing fired), stretched when the setup's plan peaked (or stopped out) later, so
 *  the point the move line names is always on the chart; never more than the strip holds. */
export function cardRun(fwdLen, { fired = false, trade = null, culm = null } = {}) {
  const len = Math.max(0, Math.floor(Number(fwdLen) || 0))
  if (!len) return 0
  const base = runLength(len, culm, fired)
  if (!fired || trade?.kind !== 'plan') return base
  const at = (trade.bestSessions || trade.stoppedSession || 0) - 1
  return at >= 0 ? Math.min(len, Math.max(base, at + 1 + RUN_AFTER_PEAK)) : base
}

/** "Mar 4, 2025" from the reveal's `asof` ("2025-03-04" or 20250304); '' when it cannot be read. */
export function dateLabel(asof) {
  const s = String(asof ?? '').trim()
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s)
  if (!m) return ''
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ''
  return `${MONTHS[mo - 1]} ${d}, ${y}`
}

/** "JBI · Mar 4, 2025": the ticker and the date, whichever the reveal carried. */
export function whereLabel(r) {
  return [r?.ticker || '', dateLabel(r?.asof)].filter(Boolean).join(' · ')
}

/** The flags counted, for the status line and the Lock button. */
export function boardCounts(flags) {
  const list = Array.isArray(flags) ? flags : []
  const flagged = list.filter(Boolean).length
  return { charts: list.length, flagged, passed: list.length - flagged }
}

/** The start screen's lead, with the board's real size (a thin bank deals fewer than eight). */
export function startLead(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0)) || WATCH_TOTAL
  const charts = k === WATCH_TOTAL ? 'eight charts' : plural(k, 'chart')
  return `Sunday night, ${charts}, tickers hidden. Flag each one where one of our setups fired on the last candle and pass on the rest. Then see what came next.`
}

/** The start screen's line about the bank: how many charts this board will have. */
export function bankLine(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0))
  if (!k) return ''
  return k < WATCH_TOTAL ? `The bank has ${plural(k, 'chart')} ready, so this board has ${k}` : `${k} charts from the UCT bank, a fresh board every run`
}

/** The focused review's headline: "A Kicker fired." / "Nothing fired." */
export function focusTitle(r, name) {
  if (!r || !r.scored) return 'Not checked.'
  if (r.fired === true) { const t = withArticle(name); return `${t.charAt(0).toUpperCase()}${t.slice(1)} fired.` }
  return r.fired === false ? `${NOTHING}.` : 'Checked.'
}

/** The card's way into the chart on its own: the lesson on a miss, the trade on a setup called right, and on a chart where
 *  nothing fired (no trade to show) why nothing did. */
export function openLabel(r) {
  if (!r || !r.scored) return ''
  if (!r.right) return 'See the lesson'
  return r.fired === true ? 'See the trade' : 'See why'
}

/** The next chart the review can open from `from` going `dir` (+1 / -1): only a chart that was checked (an unchecked one
 *  has no verdict to show). -1 when there is none that way. */
export function scoredStep(rows, from, dir) {
  const list = rows || []
  const d = dir < 0 ? -1 : 1
  for (let i = from + d; i >= 0 && i < list.length; i += d) if (list[i] && list[i].scored) return i
  return -1
}

/** The takeover's button: straight to the first miss, to the board when nothing could be checked, else on to what came
 *  next on every chart. */
export function takeoverLabel(t, miss = -1) {
  if (miss >= 0) return 'See the misses'
  if (!t || !t.total) return 'Back to the board'
  return 'See what came next'
}

/** The member's call on one chart, said back. */
export function callLine(r) {
  if (!r || !r.scored) return 'This chart could not be checked.'
  if (r.flagged) return r.right ? 'You flagged it. Right call.' : 'You flagged it, but nothing fired.'
  return r.right ? 'You passed. Right call.' : 'You passed, but it fired.'
}

/** The chart's headline after the lock: what fired, or that nothing did. */
export function chartHead(r, name) {
  if (!r || !r.scored) return 'Not checked'
  return r.fired === true ? `${name} fired` : r.fired === false ? NOTHING : 'Checked'
}

/** The bank's own line about this chart (never written here): on a chart that fired, the first sentence of its "Here ..."
 *  measurement; on a chart where nothing fired, why its setup did not ("Not a Kicker: the gap is under ..."). '' when the
 *  lesson has neither (the card then shows the move alone). */
export function chartNote(r, lessonText, name) {
  if (!r || !r.scored || !lessonText) return ''
  const L = splitLesson(lessonText)
  if (r.fired === true && L.here) return firstSentence(L.here)[0]
  if (r.fired === false && L.nothing && L.reason) return `Not ${withArticle(L.setup || name)}: ${lowerFirst(firstSentence(L.reason)[0])}`
  return ''
}

/** THE PROMPT, honest about the count (see the header): the board's size, and when the bank had fewer charts ready
 *  than a full board, it says so. */
export function boardPrompt(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0))
  const thin = k < WATCH_TOTAL ? ` The bank had ${plural(k, 'chart')} ready, so this board has ${k}.` : ''
  const all = k === 1 ? 'it could be this one or none' : `it could be none of them, or all ${k}`
  return {
    eyebrow: `Weekend Watchlist · ${plural(k, 'chart')} · tickers hidden`,
    q: 'Which of these fired on the last candle?',
    detail: `Flag every chart where one of our setups fired on its last candle and pass on the rest. Our setups: ${setupList()}. There is no set number: ${all}.${thin}`,
  }
}

/** The verdict that takes over the screen when the list is checked. A clean board is every checked chart called right. */
export function boardVerdict(t) {
  if (!t || !t.total) return { ok: false, title: 'Your list could not be checked.', stamp: null }
  if (t.right === t.total) {
    if (!t.fired) return { ok: true, title: 'Nothing fired. Right to sit on your hands.', stamp: 'Clean' }
    return { ok: true, title: t.fired === 1 ? 'Clean scan. You caught the one that fired.' : `Clean scan. You caught all ${t.fired}.`, stamp: 'Clean' }
  }
  return { ok: false, title: `${t.right} of ${t.total} called right.`, stamp: null }
}

/** Two lines under the verdict: the member's list, and the board. */
export function summaryLines(t) {
  if (!t) return []
  if (!t.total) {
    if (!t.unscored) return []
    return [t.unscored === 1 ? 'The chart could not be checked.' : `None of the ${t.unscored} charts could be checked.`, 'Check your connection and try again.']
  }
  const list = t.picks ? `Your list: ${plural(t.picks, 'pick')}, ${t.picksRight} fired.` : 'Your list: empty. You passed on every chart.'
  const board = t.fired ? `${t.fired} of ${t.total} fired on this board. You caught ${t.caught}.` : `Nothing fired on this board.`
  const out = [list, board]
  if (t.unscored) out.push(`${plural(t.unscored, 'chart')} could not be checked and ${t.unscored === 1 ? 'is' : 'are'} left out.`)
  return out
}

/** The misses, one line each, for the takeover: "Chart 3: a Kicker fired, you passed." At most `max`; the rest counted. */
export function missLines(board, rows, max = 2) {
  const out = []
  let more = 0
  ;(rows || []).forEach((r, i) => {
    if (!r || !r.scored || r.right) return
    if (out.length >= max) { more += 1; return }
    const what = r.fired === true ? `${withArticle(board?.[i]?.name || 'setup')} fired` : 'nothing fired'
    out.push(`Chart ${i + 1}: ${what}, you ${r.flagged ? 'flagged it' : 'passed'}.`)
  })
  if (more) out.push(`And ${more} more on the board.`)
  return out
}

/** The index of the first miss, or -1: the review opens on it (the lesson first, on a miss). */
export function firstMiss(rows) {
  return (rows || []).findIndex((r) => r && r.scored && !r.right)
}

/** The end screen's note: picks right of the picks made, and the board. */
export function endNote(t) {
  if (!t || !t.total) return ''
  const picks = t.picks ? `Picks right: ${t.picksRight} of ${t.picks}.` : 'You passed on every chart.'
  const board = t.fired ? `${t.fired} fired on the board and you caught ${t.caught}.` : 'Nothing fired on the board.'
  return `${picks} ${board}`
}

/** The run log for the end screen (EndLooks.EndHard): what each checked chart was, its ticker and date, and on a miss
 *  what the member said. */
export function logRows(board, rows) {
  const out = []
  ;(rows || []).forEach((r) => {
    if (!r || !r.scored) return
    out.push({ name: r.truth || 'Checked', ticker: whereLabel(r), ok: !!r.right, said: r.right ? null : (r.flagged ? 'a setup fired' : 'nothing fired') })
  })
  return out
}

/** The chart's gold label at the move's best point in the focused review (Hard mode's rule, the same words): with the
 *  setup's plan, the advance from the entry at the trade's best bar; otherwise the culmination from the signal close.
 *  `n` is the visible bars, `k` the forward bars arrived. */
export function focusPeak(trade, culm, n, k) {
  if (trade?.kind === 'plan' && trade.bestSessions) {
    const off = trade.bestSessions - 1
    if (k <= off) return null
    const v = trade.advancePct
    return { index: n + off, text: trade.long ? `${signed(v)} from entry in ${sess(trade.bestSessions)}` : `fell ${pctText(v)} from entry in ${sess(trade.bestSessions)}` }
  }
  if (!culm || k <= culm.offset || !Number.isFinite(culm.pct)) return null
  return { index: n + culm.offset, text: `${signed(culm.pct)} in ${sess(culm.sessions)}` }
}

/** Is this chart's setup a short one (its move is measured down)? */
export const isShort = (item) => SHORT_SETUPS.includes(item?.name)
