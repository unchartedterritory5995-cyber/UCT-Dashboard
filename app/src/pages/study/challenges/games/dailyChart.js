// DAILY CHART, the rules (docs/study/GAMES.md §3, kind 'daily'). Pure: no React, no storage, no clock of its own, no
// Math.random(). Every function that needs the time takes a Date; every deal takes the ET day as its seed; every number
// the game shows is counted here or read from the server's reveal.
//
// THE PLAY. Three charts a day, the same three for every member: POST /api/study/spot-setup {rounds: 3, shared: true}
// draws them on the server with the ET day as the seed (api/routers/study.py post_spot_setup), from the charts whose last
// candle is their setup and NOTHING ELSE among the setups we teach (study_spot_setup.lookalikes runs
// study_hard.hard_eligible on a Yes item). So "what fired on the last candle?" has exactly one right answer, and the
// question is Hard mode's without "Nothing fired" (something always fired here; Trade Story asks it the same way). Four
// setup names, dealt from the ET day and the chart's id, so every member sees the same four tiles in the same order.
//
// SCORED ON THE SERVER. The pick posts Hard mode's answer (hardMode.hardAnswer): the chart's own setup is the bank's
// Yes; another setup's name is posted as itself, so the server records the miss. XP is what /attempts grants; this game
// never posts a game run.
//
// ONE GO A DAY. The day's result is kept on the device under `study.daily.YYYY-MM-DD` (the ET day), written after every
// answer, so closing the sheet mid-run never buys a second look: the next open picks up at the next chart, and once the
// day's charts are answered it opens on the result. Every write first reads the device again (mergeDay), so a second tab
// open on the same day never overwrites an answer already given. The streak of days played (a day counts once all its
// charts are answered) lives beside it. The share line is plain characters only: "UCT Daily Chart 2026-11-09: 2/3 X - X".
import { SETUP_NAMES, setupName } from '../challengeBank'
import { RUN_AFTER_PEAK, culminationLabel, hardAnswer, hardRight, idSeed, runLength, setupFired, withArticle } from '../hardMode'
import { clausesOf, splitLesson } from '../../ui/lesson'

export const DAILY_KIND = 'daily'
export const DAILY_TOTAL = 3                    // charts a day
export const DAILY_VIEW = 90                    // sent to the server: the same window for every member, so the same draw
export const DAILY_URL = '/api/study/spot-setup'
export const DAY_PREFIX = 'study.daily.'        // + the ET day: that day's result on this device
export const STREAK_KEY = 'study.daily.streak'  // the days played in a row, on this device
export const KEEP_DAYS = 60                     // day results older than this are cleared from the device
export const ET_ZONE = 'America/New_York'
export const HIT = 'X'                          // the share line's marks: plain characters, never emoji
export const MISS = '-'
export const RULE_MAX = 170                     // a rule sentence longer than this shows its first clause in the takeover
export const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
export const FAILED_LINE = "Today's charts did not load. Check your connection and try again."
// an answer that did not come back: the game could not score it (whether the server heard it is not known here, so the
// line never claims it), the pick stays, and Check sends it again
export const ANSWER_FAILED = 'We could not score that answer. Check your connection, then press Check again.'
export const ANSWER_SIGNED_OUT = 'You are signed out, so this answer was not recorded. Sign in again, then press Check.'
export const QUESTION = 'What fired on the last candle?'

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const KEY_RE = /^study\.daily\.(\d{4}-\d{2}-\d{2})$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WORDS = ['no', 'one', 'two', 'three']
const HOUR = 3600000
const pad = (v) => String(v).padStart(2, '0')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ── the ET day and the clock ─────────────────────────────────────────────────────────────────────────────────────────

let etFmt = null
function etFormat() {
  if (!etFmt) {
    etFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }
  return etFmt
}

const msOf = (date) => (date instanceof Date ? date.getTime() : typeof date === 'number' ? date : NaN)

/** The New York wall clock at `date` (a Date, or epoch ms): { y, m, d, hh, mm, ss }, or null for an invalid time. */
export function etClock(date) {
  const t = msOf(date)
  if (!Number.isFinite(t)) return null
  const p = {}
  for (const part of etFormat().formatToParts(new Date(t))) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return { y: p.year, m: p.month, d: p.day, hh: p.hour % 24, mm: p.minute, ss: p.second }
}

/** The ET calendar day of `date`, "YYYY-MM-DD" (the day the server draws the charts for); '' for an invalid time. */
export function etDay(date) {
  const c = etClock(date)
  return c ? `${c.y}-${pad(c.m)}-${pad(c.d)}` : ''
}

/** A calendar day `n` days from `day` ("YYYY-MM-DD"); '' when `day` is not one. */
export function addDays(day, n) {
  const m = DAY_RE.exec(String(day || ''))
  if (!m) return ''
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.trunc(Number(n) || 0))).toISOString().slice(0, 10)
}

/** The instant (epoch ms) of the next midnight in New York after `date`: when the next charts arrive. Right across the
 *  clock changes: midnight is never the hour that moves (they move at 2 AM), so the day before a change is 23 or 25
 *  hours long and this says so. NaN for an invalid time. */
export function nextEtMidnight(date) {
  const c = etClock(date)
  if (!c) return NaN
  const next = new Date(Date.UTC(c.y, c.m - 1, c.d + 1))
  const wall = Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate())   // that midnight, read as UTC
  let at = wall + 5 * HOUR                                                                // New York is UTC-5 or UTC-4
  for (let k = 0; k < 3; k++) {
    const w = etClock(at)
    const off = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss) - at                      // the zone's offset at `at`
    const fix = wall - off
    if (fix === at) break
    at = fix
  }
  return at
}

/** Milliseconds from `date` to the next charts (never negative). */
export function msToNextDay(date) {
  const t = msOf(date)
  const at = nextEtMidnight(date)
  return Number.isFinite(t) && Number.isFinite(at) ? Math.max(0, at - t) : 0
}

/** "04:12:09": a countdown, rounded up to the second so it never reads 00:00:00 while time is left. */
export function clockText(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000))
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

/** "Monday, Nov 9" for an ET day; '' when it is not one. */
export function dayLabel(day) {
  const m = DAY_RE.exec(String(day || ''))
  if (!m) return ''
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return `${WEEKDAYS[wd]}, ${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}

/** "2025-03-04" from a bar's time ("2025-03-04", "2025-03-04T00:00:00", "20250304", 20250304) or a reveal's asof; '' when
 *  it is not a day. Strict: a ten-digit unix second (an intraday bar) is never read as a date in the year 1741, and a day
 *  that is not on the calendar (Feb 30) is refused. */
export function dayOf(t) {
  const s = String(t ?? '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (!m) return ''
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return ''
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate() ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

/** "Mar 4, 2025" from a day; '' when it is not one. */
export function dateLabel(t) {
  const day = dayOf(t)
  if (!day) return ''
  const [y, mo, d] = day.split('-').map(Number)
  return `${MONTHS[mo - 1]} ${d}, ${y}`
}

/** The device key for a day's result. */
export const dayKey = (day) => `${DAY_PREFIX}${day}`

// ── the charts ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The day's charts from the spot-setup answer, in the server's order (the draw is the same for every member): chart
 *  items the server verified (it sends `look` only for a chart whose last candle is its setup and no other, so the four
 *  names have exactly one right answer; an item without it is never asked), with at least two bars (a last candle and
 *  the one before), each once. `normalize` turns the server's bars into the chart's (useStudySession.normalizeBars;
 *  injected so this stays pure). */
export function poolItems(set, normalize = (b) => b) {
  const seen = new Set()
  const out = []
  for (const it of set?.items || []) {
    if (!it || it.id == null || seen.has(String(it.id)) || (it.type && it.type !== 'spot') || !it.look || !(it.bars?.bars?.length > 1)) continue
    seen.add(String(it.id))
    out.push({ id: it.id, skill: it.skill_id, name: setupName(it.skill_id), choices: it.prompt_json?.choices || ['Yes', 'No'], bars: normalize(it.bars), sessionId: set.session_id })
  }
  return out
}

function seeded(seed) {
  let s = Math.abs(Math.floor(Number(seed) || 1)) % 2147483647 || 1
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
}

/** Four setup names for a chart: its own setup and three others, dealt from the ET day and the chart's id, so every
 *  member sees the same tiles in the same order and a re-render never moves one under a finger. */
export function dailyChoices(item, day, names = SETUP_NAMES) {
  const rnd = seeded(idSeed(`${day}:${item?.id}`))
  const own = item?.name
  const others = (names || []).filter((x) => x && x !== own)
  const picked = []
  while (others.length && picked.length < 3) picked.push(others.splice(Math.floor(rnd() * others.length), 1)[0])
  const cards = [own, ...picked].filter(Boolean)
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]] }
  return cards
}

/** What a pick posts: Hard mode's answer. The chart's own setup is the bank's Yes; another setup is posted as itself. */
export const dailyAnswer = (picked, item, yes = 'Yes', no = 'No') => hardAnswer(picked, item, yes, no)

/** One answered chart, as the day keeps it: right only when the server agrees and the pick was the chart's own setup;
 *  what fired from the bank's key in the reveal (the pool's premise, the server's own filter, when the key is absent);
 *  the ticker from the reveal; the date of the last candle, where the setup fired (the reveal's asof when the bars have
 *  none); the XP the attempt earned. */
export function readAnswer(item, picked, attempt) {
  const rv = attempt?.reveal || {}
  const correct = !!attempt?.correct
  const key = setupFired(picked, item, correct, rv.answer)
  const bars = item?.bars || []
  return {
    id: String(item?.id ?? ''),
    name: String(item?.name || ''),
    said: String(picked ?? ''),
    ok: hardRight(picked, item, correct),
    fired: key !== false,
    ticker: String(rv.sym || rv.ticker || '').trim(),
    date: dayOf(bars[bars.length - 1]?.t) || dayOf(rv.asof),
    xp: Math.max(0, Number(attempt?.progress?.xp_gained) || 0),
  }
}

// ── the day on the device ────────────────────────────────────────────────────────────────────────────────────────────

const clampTotal = (n) => { const k = Math.floor(Number(n)); return Number.isFinite(k) && k >= 1 ? Math.min(DAILY_TOTAL, k) : 0 }

function cleanRow(r) {
  if (!r || typeof r !== 'object' || r.id == null || String(r.id) === '' || typeof r.ok !== 'boolean') return null
  return {
    id: String(r.id), name: String(r.name || ''), said: r.said == null ? '' : String(r.said), ok: r.ok, fired: r.fired !== false,
    ticker: String(r.ticker || ''), date: dayOf(r.date), xp: Math.max(0, Number(r.xp) || 0),
  }
}

/** A day with nothing answered yet. */
export function emptyRecord(day, total) {
  return { v: 1, day: String(day || ''), total: clampTotal(total), charts: [], done: false }
}

/** The day with one more chart answered: a chart already in it is never counted twice (the first answer stands), and a
 *  finished day takes no more; done once every chart is. */
export function addRow(rec, row) {
  const r = cleanRow(row)
  if (!rec || !r || rec.done || rec.charts.some((x) => x.id === r.id)) return rec
  const charts = [...rec.charts, r]
  return { ...rec, charts, done: rec.total > 0 && charts.length >= rec.total }
}

/** The day as the device holds it (`saved`, read back just now) and as this screen holds it (`mine`), as one: a finished
 *  day is final; otherwise every chart answered in either, the device's answers first, so a second tab never overwrites
 *  an answer already given or plays a chart twice. Null when neither is a record. */
export function mergeDay(saved, mine) {
  if (!saved || !mine || saved.day !== mine.day) return saved || mine || null
  if (saved.done) return saved
  if (mine.done) return mine
  const total = Math.max(saved.total, mine.total)
  const charts = [...saved.charts, ...mine.charts.filter((r) => !saved.charts.some((x) => x.id === r.id))].slice(0, total)
  return { ...saved, total, charts, done: total > 0 && charts.length >= total }
}

/** The day with its number of charts set (a thin bank, or a resumed day whose remaining charts are no longer drawn). */
export function withTotal(rec, total) {
  if (!rec) return rec
  const t = Math.max(clampTotal(total), Math.min(DAILY_TOTAL, rec.charts.length))
  return { ...rec, total: t, done: t > 0 && rec.charts.length >= t }
}

/** The day read back from the device: null unless it is a record of THIS day; `done` is recounted, never trusted. */
export function readSaved(raw, day) {
  let o = raw
  if (typeof raw === 'string') { try { o = JSON.parse(raw) } catch { return null } }
  if (!o || typeof o !== 'object' || o.day !== day || !DAY_RE.test(String(day))) return null
  const total = clampTotal(o.total)
  if (!total) return null
  const seen = new Set()
  const charts = []
  for (const x of Array.isArray(o.charts) ? o.charts : []) {
    const r = cleanRow(x)
    if (!r || seen.has(r.id) || charts.length >= total) continue
    seen.add(r.id)
    charts.push(r)
  }
  return { v: 1, day, total, charts, done: charts.length >= total }
}

/** What a run plays: the day's charts not answered yet, in the server's order. A fresh day has up to three; a resumed day
 *  keeps its count unless the bank no longer draws its remaining charts, then it is as many as can still be played.
 *  { total, todo, answered }. A total of 0 means there is nothing to play today. */
export function planRun(pool, saved = null, max = DAILY_TOTAL) {
  const items = []
  const seen = new Set()
  for (const it of Array.isArray(pool) ? pool : []) {
    if (!it || it.id == null || seen.has(String(it.id))) continue
    seen.add(String(it.id))
    items.push(it)
  }
  const done = new Set((saved?.charts || []).map((r) => String(r.id)))
  const want = saved ? saved.total : Math.min(Math.max(0, Math.floor(Number(max) || 0)), items.length)
  const todo = items.filter((it) => !done.has(String(it.id))).slice(0, Math.max(0, want - done.size))
  return { total: Math.min(want, done.size + todo.length), todo, answered: done.size }
}

/** Day results on the device older than `keep` days (never the streak, never another key): to clear. */
export function staleKeys(keys, today, keep = KEEP_DAYS) {
  const floor = addDays(today, -Math.max(1, Math.floor(Number(keep) || KEEP_DAYS)))
  if (!floor) return []
  return (keys || []).filter((k) => { const m = KEY_RE.exec(String(k)); return !!m && m[1] < floor })
}

// ── the score and the share line ─────────────────────────────────────────────────────────────────────────────────────

/** The day counted: right, answered, XP. */
export function tally(rows) {
  const list = (rows || []).filter(Boolean)
  return { right: list.filter((r) => r.ok).length, total: list.length, xp: list.reduce((t, r) => t + (Number(r.xp) || 0), 0) }
}

/** "X - X": one mark per chart in the order played, X named, - missed (and - for a chart not answered). */
export function marks(rows, total) {
  const n = clampTotal(total) || (rows || []).length
  return Array.from({ length: n }, (_, i) => (rows?.[i]?.ok ? HIT : MISS)).join(' ')
}

/** The line a member shares, plain text: "UCT Daily Chart 2026-11-09: 2/3 X - X". */
export function shareLine(day, rows, total) {
  const n = clampTotal(total) || (rows || []).length
  const right = (rows || []).slice(0, n).filter((r) => r?.ok).length
  return `UCT Daily Chart ${day}: ${right}/${n} ${marks(rows, n)}`
}

/** What fired on a chart, said plainly. */
export const whatFired = (r) => (r?.fired === false ? 'Nothing fired' : r?.name || '')

/** "JBI · Mar 4, 2025": the ticker and the date, whichever the chart has. */
export function whereText(r) {
  return [r?.ticker || '', dateLabel(r?.date)].filter(Boolean).join(' · ')
}

/** The end screen's run log (EndLooks.EndHard): what fired on each chart, its ticker and date, and on a miss the pick. */
export function logRows(rows) {
  return (rows || []).filter(Boolean).map((r) => ({ name: whatFired(r), ticker: whereText(r), ok: !!r.ok, said: r.ok ? null : r.said || null }))
}

/** The copy line under the share box. */
export function copyNote(status) {
  if (status === 'copied') return 'Copied. Paste it anywhere.'
  if (status === 'failed') return 'This browser blocked the copy. Select the line above and copy it.'
  return 'Your score as plain text: no tickers, no spoilers.'
}

// ── the streak ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The streak read back from the device: { last, count, best } or null. */
export function readStreak(raw) {
  let o = raw
  if (typeof raw === 'string') { try { o = JSON.parse(raw) } catch { return null } }
  if (!o || typeof o !== 'object' || !DAY_RE.test(String(o.last))) return null
  const count = Math.floor(Number(o.count))
  if (!Number.isFinite(count) || count < 1) return null
  const best = Math.max(count, Math.floor(Number(o.best)) || 0)
  return { last: o.last, count, best }
}

/** The streak after a day is played: the same day counts once; the day after the last one adds one; a gap starts again
 *  at one. A day before the last (a device clock set back) changes nothing. The best is kept. */
export function nextStreak(prev, day) {
  if (!DAY_RE.test(String(day || ''))) return prev || null
  if (prev && (prev.last === day || prev.last > day)) return prev
  const count = prev && prev.last === addDays(day, -1) ? prev.count + 1 : 1
  return { last: day, count, best: Math.max(prev?.best || 0, count) }
}

/** The streak as it stands on `today`: alive while the last day played is today or yesterday, else 0. */
export function shownStreak(rec, today) {
  if (!rec || !DAY_RE.test(String(today || ''))) return 0
  return rec.last === today || rec.last === addDays(today, -1) ? rec.count : 0
}

/** "3 days in a row" / "1 day in a row" / "No streak yet". */
export function streakText(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0))
  return k ? `${plural(k, 'day')} in a row` : 'No streak yet'
}

// ── the words ────────────────────────────────────────────────────────────────────────────────────────────────────────

const countWord = (n) => WORDS[n] || String(n)

/** The start screen's lead: the day's game, or where a resumed day stands, or the honest empty and failed lines. */
export function startLead({ total = DAILY_TOTAL, answered = 0, right = 0, empty = false, failed = false } = {}) {
  if (failed) return FAILED_LINE
  if (empty) return EMPTY_LINE
  if (answered > 0 && answered < total) {
    return `You named ${right} of ${answered} so far today. Pick up at chart ${answered + 1} of ${total}. The answers you gave stand.`
  }
  // a resumed day whose remaining charts the bank no longer draws: what was answered is the day
  if (answered > 0) return `You named ${right} of ${answered} today. That is your day. See your result.`
  const n = clampTotal(total) || DAILY_TOTAL
  const charts = n === 1 ? 'The same chart' : `The same ${countWord(n)} charts`
  return `${charts} for every member today, tickers hidden. Name the setup that fired on ${n === 1 ? 'its' : 'each'} last candle. One go a day, then share your score.`
}

/** The start screen's three steps, counted for the day (a thin bank deals one or two charts, and the steps say so). */
export function howSteps(total = DAILY_TOTAL) {
  const n = clampTotal(total) || DAILY_TOTAL
  const one = n === 1
  return [
    { icon: 'calendar', title: one ? "Today's chart" : `Today's ${countWord(n)} charts`,
      body: `${one ? 'A real chart' : 'Real charts'} from the UCT bank, ${one ? 'ticker' : 'tickers'} hidden, the same for every member today. The last candle${one ? ' is' : ' on each is'} ringed.` },
    { icon: 'eye', title: 'Name what fired', body: `One of our setups fired on ${one ? 'that' : 'each'} last candle. Pick it from four. One try${one ? '' : ' each'}, scored like every Study answer.` },
    { icon: 'play', title: 'Watch it, then share', body: `${one ? 'The chart runs' : 'Each chart runs'} on with the trade drawn. Copy your score line at the end. New charts arrive at midnight New York time.` },
  ]
}

/** The start button's words. `left` is the charts still to play (a resumed day whose remaining charts the bank no longer
 *  draws has none left: the button opens the day's result). */
export function startLabel({ loading = false, failed = false, empty = false, answered = 0, left = null } = {}) {
  if (failed) return 'The charts did not load'
  if (loading) return "Loading today's charts"
  if (answered > 0 && left === 0) return "See today's result"
  if (empty) return 'No charts yet'
  return answered > 0 ? `Pick up at chart ${answered + 1}` : "Play today's charts"
}

/** The verdict's headline. */
export function headline(r) {
  if (!r) return ''
  if (r.ok) return 'Named it.'
  return r.fired === false ? 'Nothing fired here.' : `It was ${withArticle(r.name)}.`
}

/** The setup's rule in the bank's own words, for the takeover on a miss: the first sentence of this chart's lesson rule,
 *  or of the setup's definition (`reveal.setup_rule`) when the lesson has none; its first clause when the sentence is too
 *  long for a screen that cannot scroll. Never rewritten; "the firm" reads as UCT (rule 11). '' when there is none. */
export function ruleLine(lesson, setupRule = null, name = '') {
  return ruleParts(lesson, setupRule, name).text
}

/** The rule line and whether it is only the rule's first step (a long rule cut at its first semicolon), so the takeover
 *  never labels part of a rule as the whole of it: { text, cut }. */
export function ruleParts(lesson, setupRule = null, name = '') {
  let lead = splitLesson(lesson || '').ruleLead
  if (!lead && setupRule?.text) lead = splitLesson(`${setupRule.name || name || 'Setup'}: ${setupRule.text}`).ruleLead
  if (!lead) return { text: '', cut: false }
  if (lead.length <= RULE_MAX) return { text: lead, cut: false }
  const first = clausesOf(lead)
  return { text: first[0], cut: first.length > 1 }
}

/** The takeover's label for the rule line: "The Kicker rule:", or "The Launchpad rule, step one:" when only the first
 *  step fits (the lesson card under the chart has every step). */
export const ruleLabel = (name, cut = false) => `The ${name || 'setup'} rule${cut ? ', step one' : ''}:`

// ── the replay ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The chart's gold label at the move's best point (Hard mode's words): with the setup's plan, the advance from the entry
 *  at the trade's best bar; otherwise the culmination from the signal close. `n` = the bars before the run-on, `k` = the
 *  forward bars arrived; null until the best bar is on the chart. */
export function peakOf(trade, culm, n, k) {
  if (trade?.kind === 'plan' && trade.bestSessions && Number.isFinite(trade.advancePct)) {
    const off = trade.bestSessions - 1
    if (k <= off) return null
    const v = trade.advancePct
    const sess = plural(trade.bestSessions, 'session')
    return { index: n + off, text: trade.long === false ? `fell ${Math.abs(v).toFixed(1)}% from entry in ${sess}` : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}% from entry in ${sess}` }
  }
  if (!culm || k <= culm.offset || !Number.isFinite(culm.pct)) return null
  return { index: n + culm.offset, text: culminationLabel(culm) }
}

/** How many forward bars the review runs on: Hard mode's length (to the culmination and a few past it), stretched when the
 *  plan's best bar or its stop came later, so the point the label names is always on the chart; never past the strip. */
export function runOf(fwdLen, { fired = false, trade = null, culm = null } = {}) {
  const len = Math.max(0, Math.floor(Number(fwdLen) || 0))
  if (!len) return 0
  const base = runLength(len, culm, fired)
  if (!fired || trade?.kind !== 'plan') return base
  const at = (trade.bestSessions || trade.stoppedSession || 0) - 1
  return at >= 0 ? Math.min(len, Math.max(base, at + 1 + RUN_AFTER_PEAK)) : base
}
