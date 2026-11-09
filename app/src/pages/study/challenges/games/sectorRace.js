// SECTOR RACE (docs/study/GAMES.md §3, kind 'sectors'): the pure half of the game. Which group led? Sixty seconds and a
// track: the approved questions of the Sector leadership course (F7.09, skill history.sectors: which of the 11 sectors
// led or lagged in a documented year, what a sector is, how to read its strength against the S&P 500) are drawn as a
// skill session (POST /api/study/sessions {kind: 'skill', skill_id: 'history.sectors', size: 10}), each one a leg of
// 100 m. A right answer runs the member one leg; a miss leaves that leg unrun. Every answer is scored on the server
// (POST /api/study/attempts), which keeps the key until the member has answered and grants the XP, so this game never
// posts a game run. Nothing here knows an answer before the server says it: this module shapes the draw, deals it from
// a seed, keeps the run's score, distance and clock, and reads the server's reveal into the lines a miss teaches.
// No clock reads, no Math.random.
//
// What a course question carries (scripts/study/courses_lib.build_items): prompt_json {q, kind: 'mcq' | 'tf' | 'fill' |
// 'fill_numeric', choices, story (a scenario), sentence and bank (a fill)}; after the attempt, the reveal's `answer`
// (the key, {answer}), `why` (it opens on the verdict, "Energy, by a mile. The energy index gained 64.56%. ..."), its
// `lesson_line` (the mentor's line, at most 22 words), `wrong` (a note for each wrong choice, when the unit wrote one)
// and `depth.sources` (each cited page: {name, url, quote}).
//
// THE CHOICES ARE DEALT IN A SEEDED ORDER. The courses write the answer first (1,403 of their 1,467 multiple-choice
// questions on 2026-11-09), and the bank keeps that order; dealt as stored, the first tile would be the answer nearly
// every time. True or False stays True, False.
import { firstSentence } from '../../ui/lesson'
import { clean, shortSource, sourceOf } from './trueFalse'

export const SECTORS_KIND = 'sectors'
export const SECTORS_SKILL = 'history.sectors'
export const SECTORS_UNIT = 'F7.09'
export const SECTORS_COURSE = 'Sector leadership'
/** The draw asked of the server: one skill session of ten approved questions, so the track is ten legs at most. */
export const RACE_SIZE = 10
export const RACE_SECS = 60
/** Fewer playable questions than this and the game says so honestly instead of running a three-leg race. */
export const RACE_MIN = 4
/** One right answer runs one leg. */
export const LEG_M = 100
export const RACE_POINTS = 10
/** Crossing the line (every question right) turns each second left on the clock into points. */
export const FINISH_POINTS_PER_SEC = 5
export const RACE_BEST_KEY = 'study.sectors.best'
/** The clock's step: small enough that a pause (a miss, an answer on the wire) costs the member no time. */
export const RACE_TICK_MS = 100
export const RACE_POOL_TIMEOUT_MS = 15000
export const RACE_ATTEMPT_TIMEOUT_MS = 8000
/** Answers that fail to reach the server in a row before the run stops (each one is not counted). */
export const RACE_MAX_FAILS = 3
/** The beat between the last right answer and the end screen, so the runner is seen crossing the line. */
export const RACE_CROSS_MS = 900
/** How long a miss holds the screen before the next question comes on its own (a tap moves on sooner): at least
 *  TAKEOVER_MIN_MS, the fade-in, then a quarter second a word, never past TAKEOVER_MAX_MS. The clock is paused all the
 *  while, so reading costs the member nothing. */
export const TAKEOVER_MIN_MS = 3000
export const TAKEOVER_FADE_IN_MS = 900
export const READ_MS_PER_WORD = 250
export const TAKEOVER_MAX_MS = 10000
/** A tap (or Enter) this soon after a miss shows is a second tap meant for the next question: it never skips the lesson. */
export const TAKEOVER_GUARD_MS = 400
/** The reason a miss shows: its first sentence, and the next one while the two stay this short. */
export const REASON_MAX_WORDS = 32

export const TRUE = 'True'
export const FALSE = 'False'
export const TF_CHOICES = [TRUE, FALSE]
/** The kinds the race can deal: tiles answer them. A typed number (fill_numeric) has no tiles, so it is left out. */
export const PLAYABLE = ['mcq', 'tf', 'fill']
const MAX_CHOICES = 6

export const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
export const LOST_LINE = 'We could not check that one, so it does not count. Here is the next.'

/** The body of the draw: one skill session of the Sector leadership questions. */
export const sessionBody = () => ({ kind: 'skill', skill_id: SECTORS_SKILL, size: RACE_SIZE })

// ── the multiplier, Blitz's (challengeBank.blitzMult): it climbs with the streak and resets on a miss ─────────────
export const raceMult = (combo) => (combo >= 9 ? 5 : combo >= 6 ? 4 : combo >= 3 ? 3 : combo >= 1 ? 2 : 1)
/** The top multiplier a track of `legs` legs can reach: the longest streak is every leg right, so a short draw never
 *  promises x5 (it needs nine in a row). */
export const topMult = (legs) => raceMult(Math.max(0, Math.floor(Number(legs) || 0)))
/** The points one right answer earns, at the streak it makes. */
export const pointsFor = (combo) => RACE_POINTS * raceMult(combo)
/** The points the line is worth: every whole second left on the clock when the last leg is run. */
export const finishBonus = (secsLeft) => Math.max(0, Math.floor(Number(secsLeft) || 0)) * FINISH_POINTS_PER_SEC

// ── the track ───────────────────────────────────────────────────────────────────────────────────────────────────
const whole = (n) => Math.max(0, Math.floor(Number(n) || 0))
/** Metres run: one leg for each right answer. */
export const distanceOf = (right) => whole(right) * LEG_M
/** The track's length: one leg for each question in the draw. */
export const trackOf = (legs) => whole(legs) * LEG_M
/** A distance as the member reads it: "700 m", "1,000 m". */
export const metres = (m) => `${whole(m).toLocaleString('en-US')} m`
/** How far along the track the runner stands, 0 to 100. */
export function progressPct(right, legs) {
  const n = whole(legs)
  if (!n) return 0
  return Math.min(100, (Math.min(whole(right), n) / n) * 100)
}
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** The track in words, for a screen reader. */
export function trackLabel(right, legs, missed = 0) {
  const parts = [`${metres(distanceOf(right))} of ${metres(trackOf(legs))} run`, plural(whole(right), 'right', 'right')]
  if (missed) parts.push(plural(whole(missed), 'miss', 'misses'))
  return parts.join(', ')
}

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** The server's own comparison (api/services/study_scoring._norm): case and spacing never matter. */
export function norm(v) {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v).trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

// ── the draw ────────────────────────────────────────────────────────────────────────────────────────────────────
/** What a prompt asks for, the way the lesson player reads it (drills/RecallDrill.kindOf). */
export function kindOf(p) {
  if (!p || typeof p !== 'object') return ''
  if (p.kind) return String(p.kind)
  if (p.bank) return 'fill'
  if (p.sentence && !p.bank) return 'fill_numeric'
  if (!Array.isArray(p.choices) || !p.choices.length) return 'tf'
  return 'mcq'
}

const BLANK = /_{3,}/
const isTfSet = (list) => list.map((c) => norm(c)).sort().join('|') === 'false|true'

/** The tiles a prompt offers: {value, label}. `value` is the bank's own string, posted as the answer exactly as stored so
 *  the server's key always meets it; `label` is what the tile shows (our name, never "the firm"; no em dash). Null when
 *  the prompt cannot be answered with tiles: fewer than two, more than six, two that read the same, or a true/false
 *  prompt whose choices are not True and False (it would score against buttons it does not have). */
export function choicesOf(p, kind) {
  let raw
  if (kind === 'tf') {
    const given = Array.isArray(p.choices) ? p.choices.map((c) => String(c ?? '')) : []
    if (given.length && !isTfSet(given)) return null
    raw = TF_CHOICES
  } else if (kind === 'fill') {
    raw = Array.isArray(p.bank) ? p.bank.map((c) => String(c ?? '')) : []
  } else {
    raw = Array.isArray(p.choices) ? p.choices.map((c) => (typeof c === 'string' ? c : String(c?.label ?? c ?? ''))) : []
  }
  if (raw.length < 2 || raw.length > MAX_CHOICES) return null
  const out = []
  const seenValue = new Set()
  const seenLabel = new Set()
  for (const value of raw) {
    const label = clean(value)
    const v = norm(value), l = label.toLowerCase()
    if (!v || !label || seenValue.has(v) || seenLabel.has(l)) return null
    seenValue.add(v); seenLabel.add(l)
    out.push({ value, label })
  }
  return out
}

/** The questions a race may deal, from the skill session's payload (POST /api/study/sessions: {session_id, items}).
 *  Kept: an item with an id and a prompt the tiles can answer (a multiple-choice or scenario question, a true/false
 *  statement, a fill-in with its word bank), with no chart under it (a question about "this chart" cannot be asked
 *  without one). Each question appears once, by id and by its words. Each carries the session's id, so its attempt
 *  lands in the session the server made. */
export function questionsOf(set) {
  const items = Array.isArray(set?.items) ? set.items : []
  const sessionId = typeof set?.session_id === 'string' && set.session_id ? set.session_id : null
  const out = []
  const ids = new Set()
  const said = new Set()
  for (const it of items) {
    if (!it || typeof it !== 'object' || it.has_chart || it.bars) continue
    const id = typeof it.id === 'string' ? it.id.trim() : ''
    const p = it.prompt_json && typeof it.prompt_json === 'object' ? it.prompt_json : null
    if (!id || !p || ids.has(id)) continue
    // a walk-through is teaching, not a question: its prompt has no kind and no choices, so kindOf would read its title
    // as a true/false statement (a skill session leaves them out today; this keeps it so)
    if (it.type === 'walkthrough' || Array.isArray(p.steps)) continue
    const kind = kindOf(p)
    if (!PLAYABLE.includes(kind)) continue
    const choices = choicesOf(p, kind)
    if (!choices) continue
    const q = clean(p.q || p.question || '')
    const story = clean(p.story || '')
    const sentence = kind === 'fill' ? clean(p.sentence || '') : ''
    if (kind === 'fill' && !BLANK.test(sentence)) continue
    if (kind !== 'fill' && !q) continue
    const k = `${story}|${q}|${sentence}`.toLowerCase()
    if (said.has(k)) continue
    ids.add(id); said.add(k)
    const d = Number(it.difficulty)
    out.push({
      id, sessionId, kind, scenario: !!story, q, story, sentence, choices,
      difficulty: Number.isFinite(d) ? d : 2, skill: typeof it.skill_id === 'string' ? it.skill_id : null,
    })
  }
  return out
}

/** The question as one line, for the end screen's log: the situation and its question, the sentence with its blank,
 *  or the question itself. */
export function titleOf(qn) {
  if (!qn) return ''
  if (qn.kind === 'fill') return qn.sentence
  return qn.story ? `${qn.story} ${qn.q}` : qn.q
}

// ── the deal ────────────────────────────────────────────────────────────────────────────────────────────────────
const MOD = 2147483647
/** A Park-Miller generator from a seed (challengeBank.shuffle's), its first draws thrown away: straight from a small
 *  seed, or from two seeds a few seconds apart, the first draw is nearly the same number (trueFalse.deckOf). */
function rngOf(seed) {
  let s = (Math.abs(Math.floor(Number(seed) || 0)) % (MOD - 1)) + 1
  const rnd = () => { s = (s * 48271) % MOD; return s / MOD }
  rnd(); rnd(); rnd()
  return rnd
}
function shuffled(list, rnd) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
/** A small, stable number from a string (FNV-1a), so each question's tiles get their own order from one run seed. */
export function hashOf(str) {
  let h = 2166136261
  const s = String(str ?? '')
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}

/** One question's tiles in the run's order: shuffled from the run seed and the question's id (the same seed, the same
 *  order). True or False keeps True first. */
export function dealChoices(qn, seed) {
  if (!qn || qn.kind === 'tf') return qn?.choices || []
  return shuffled(qn.choices, rngOf((Math.abs(Math.floor(Number(seed) || 0)) ^ hashOf(qn.id)) >>> 0))
}

/** The run's order: the questions shuffled from a seed, then the easier rungs first (a stable sort by difficulty, so
 *  the race warms up), each one's tiles dealt in their own seeded order. */
export function deckOf(questions, seed) {
  const list = Array.isArray(questions) ? questions : []
  const order = shuffled(list, rngOf(seed)).map((qn, k) => ({ qn, k }))
  order.sort((a, b) => (a.qn.difficulty - b.qn.difficulty) || (a.k - b.k))
  return order.map(({ qn }) => ({ ...qn, choices: dealChoices(qn, seed) }))
}

/** The tile a key picks on this question: 1 to the number of tiles; T or F on a true/false statement. -1 otherwise. */
export function keyIndex(qn, key) {
  const k = String(key ?? '')
  const n = qn?.choices?.length || 0
  if (/^[1-9]$/.test(k) && +k <= n) return +k - 1
  if (qn?.kind === 'tf') {
    const at = (want) => qn.choices.findIndex((c) => norm(c.value) === want)
    if (k === 't' || k === 'T') return at('true')
    if (k === 'f' || k === 'F') return at('false')
  }
  return -1
}

// ── the verdict, and the reveal as the lines a miss teaches ────────────────────────────────────────────────────
/** The server's verdict on one answer: true or false, or null when the reply carries none. A reply without a verdict
 *  is not scored at all: read as a miss, it would teach an answer the server never gave. */
export const verdictOf = (attempt) => (attempt && typeof attempt.correct === 'boolean' ? attempt.correct : null)

/** The values the key accepts, read from the reveal: its `answer` ({answer, accept} or a bare value), else the
 *  verdict's own `detail.expected`. */
function keysOf(reveal) {
  const out = []
  const key = reveal?.answer
  if (key && typeof key === 'object' && !Array.isArray(key)) {
    out.push(key.answer)
    if (Array.isArray(key.accept)) out.push(...key.accept)
  } else if (key != null) {
    out.push(key)
  }
  if (reveal?.detail && reveal.detail.expected != null) out.push(reveal.detail.expected)
  return out.filter((v) => v != null && norm(v) !== '')
}

/** The right tile, from the member's tile, the server's verdict and its key. A right answer is the member's own tile.
 *  On a miss: the tile the key names; on a true/false statement, the other tile (the verdict says which, so the screen
 *  can never disagree with the score). Null when the key is missing or names the member's own tile: then no answer is
 *  shown rather than a wrong one. */
export function truthOf(qn, said, correct, reveal) {
  const choices = qn?.choices || []
  const mine = choices.find((c) => norm(c.value) === norm(said)) || null
  if (correct) return mine
  const keys = keysOf(reveal).map(norm)
  const named = choices.find((c) => keys.includes(norm(c.value)))
  if (named && named !== mine) return named
  if (qn?.kind === 'tf' && mine) return choices.find((c) => c !== mine) || null
  return null
}

const VERDICT = /^(?:true|false)\s*[.!:,;]/i
/** Does this sentence only restate the answer ("Energy, by a mile.", "False.", "It was the best sector that year.")? */
export function restates(sentence, truth) {
  const s = norm(sentence)
  if (!s) return false
  if (VERDICT.test(s)) return true
  const t = norm(truth)
  if (!t || !s.startsWith(t)) return false
  const after = s.slice(t.length)
  return after === '' || /^[^a-z0-9]/.test(after)
}

/** A sentence that turns on the one before it: alone, it would argue the other way. */
const TURN = /^(?:But|However|Yet|Still|Even so|That said)\b/

/** Why, in a sentence or two, in the bank's own words: the reveal's `why` without the verdict it opens on (the answer
 *  is already on the screen), its first sentence, and the next one while the two stay within REASON_MAX_WORDS words
 *  (always, when the next one turns on the first). When the answer is not known the verdict stays, so the line still
 *  names it. */
export function reasonOf(reveal, truth) {
  const src = clean(reveal?.why || '')
  if (!src) return ''
  const [one, rest] = firstSentence(src)
  const body = cap((restates(one, truth) ? rest : src).trim())
  if (!body) return ''
  const [a, after] = firstSentence(body)
  if (!after) return a
  const [b] = firstSentence(after)
  if (TURN.test(b) || words(a) + words(b) <= REASON_MAX_WORDS) return `${a} ${b}`.trim()
  return a
}

/** The unit's note on the tile the member picked, when it wrote one ("Nine was the number of sector SPDR funds around
 *  2007. ..."): it speaks to the exact mistake. */
export function wrongOf(reveal, said) {
  const map = reveal?.wrong
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ''
  const want = norm(said)
  if (!want) return ''
  for (const [k, v] of Object.entries(map)) if (norm(k) === want) return clean(v)
  return ''
}

/** The mentor's line: the reveal's lesson line. */
export const lineOf = (reveal) => clean(reveal?.lesson_line || '')

export { shortSource, sourceOf }

/** The figures a line states, each once, as plain numbers: "64.56", "2021", "1000" (from "1,000"), "18.4" (from
 *  "18.40", so a line and a quote that write it differently still meet). A lone digit ("Q1", "3%") is left out, and so is
 *  an index's name ("S&P 500"): too common to tell one source from another. */
export function figuresOf(text) {
  const out = []
  for (const m of String(text || '').replace(/S&P\s*\d+/gi, ' ').matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
    const f = String(Number(m[0].replace(/,/g, '')))
    if (f.replace('.', '').length >= 2 && !out.includes(f)) out.push(f)
  }
  return out
}

/** The source to name under the lines on screen. A unit cites several pages for one question, and the first is not
 *  always the one a line's numbers come from (F7.09: energy's 2021 gain of 53.43% is in the January 2022 prospectus,
 *  while the first page cited is the January 2021 one, for the story's 2020 figures). So the cited page whose quote
 *  carries the most figures of the first line wins, then of the next line, and so on; a tie, or lines with no figures,
 *  keeps the unit's own order. Null when nothing is cited. */
export function sourceFor(reveal, texts = []) {
  const list = (Array.isArray(reveal?.depth?.sources) ? reveal.depth.sources : [])
    .filter((c) => c && typeof c.name === 'string' && c.name.trim())
  if (!list.length) return null
  const wants = (Array.isArray(texts) ? texts : [texts]).map(figuresOf)
  let best = 0
  let top = wants.map(() => 0)
  list.forEach((c, k) => {
    const have = new Set(figuresOf(c.quote))
    const score = wants.map((fs) => fs.filter((f) => have.has(f)).length)
    const at = score.findIndex((n, i) => n !== top[i])
    if (at >= 0 && score[at] > top[at]) { best = k; top = score }
  })
  return sourceOf({ depth: { sources: [list[best]] } })
}

/** One answer, as the run log keeps it. Its source is the page behind what the takeover shows on a miss (the unit's
 *  note on the member's tile, or why, then the lesson line); on a right answer, behind why and the lesson line. */
export function rowOf({ question, said, correct, reveal = null }) {
  const ok = !!correct
  const truth = truthOf(question, said, ok, reveal)
  const mine = (question?.choices || []).find((c) => norm(c.value) === norm(said)) || null
  const reason = reasonOf(reveal, truth ? truth.label : null)
  const wrong = ok ? '' : wrongOf(reveal, said)
  const line = lineOf(reveal)
  return {
    id: question?.id || '', title: titleOf(question), kind: question?.kind || '', ok,
    said: mine ? mine.label : clean(said), truth: truth ? truth.label : null,
    reason, wrong, line,
    source: sourceFor(reveal, [ok ? reason : wrong || reason, line]),
  }
}

/** The takeover's verdict, first (VOICE.md §4). A statement says which it was; any other question shows its answer
 *  under this line, so the line itself stays short. */
export function verdictTitle(row) {
  if (row?.kind === 'tf' && row.truth) return `It's ${row.truth.toLowerCase()}.`
  return 'Not this one.'
}

/** The lead line a miss shows: the unit's note on the tile the member picked when it wrote one, else why. */
export const missWhy = (row) => row?.wrong || row?.reason || ''

/** How long this miss holds the screen (see TAKEOVER_MIN_MS). */
export function takeoverMs(...texts) {
  const n = texts.reduce((t, s) => t + words(s), 0)
  return Math.min(TAKEOVER_MAX_MS, Math.max(TAKEOVER_MIN_MS, TAKEOVER_FADE_IN_MS + n * READ_MS_PER_WORD))
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const EMPTY_RUN = { token: 0, deck: [], legs: 0, i: 0, score: 0, combo: 0, best: 0, right: 0, answered: 0, results: [], log: [], lost: 0, fails: 0, done: false }

/** A fresh run on a dealt deck: one leg for each question. */
export function startRun(deck, token = 0) {
  const d = Array.isArray(deck) ? deck : []
  return { ...EMPTY_RUN, token, deck: d, legs: d.length }
}

/** The run after one scored answer: the streak, the best streak, the points (at the streak the answer makes), the tally. */
export function applyCall(run, row) {
  const r = run || EMPTY_RUN
  const ok = !!row?.ok
  const combo = ok ? r.combo + 1 : 0
  return {
    ...r, combo, best: Math.max(r.best, combo), score: r.score + (ok ? pointsFor(combo) : 0),
    right: r.right + (ok ? 1 : 0), answered: r.answered + 1, results: [...r.results, ok], log: [...r.log, row], fails: 0,
  }
}

/** The run after an answer that never reached the server: not scored, not counted, one more failure in a row. */
export function applyLost(run) {
  const r = run || EMPTY_RUN
  return { ...r, lost: r.lost + 1, fails: r.fails + 1 }
}

/** Every leg run: the member crossed the line. */
export const crossed = (run) => !!run && run.legs > 0 && run.right >= run.legs

/** How the run ends when its last question is done: across the line, or at the end of the draw. */
export const endOf = (run) => (crossed(run) ? 'line' : 'deck')

/** The clock: `step` ms off what is left, unless it is paused; never below zero. */
export function tickClock(ms, paused, step = RACE_TICK_MS) {
  const left = Math.max(0, Number(ms) || 0)
  return paused ? left : Math.max(0, left - step)
}

/** The seconds the clock shows: a part second still counts as one. */
export const secsOf = (ms) => Math.ceil(Math.max(0, Number(ms) || 0) / 1000)

// ── the end ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The end screen's title. */
export function raceVerdict(right, answered, legs) {
  if (!answered) return 'No answers this run'
  if (legs > 0 && right >= legs) return 'Crossed the line'
  const r = right / answered
  if (r >= 0.8) return 'Strong run'
  if (r >= 0.6) return 'Solid run'
  return 'Tough run'
}

/** The distance, said once the run is over. `stop`: line | time | deck | offline | signedOut. */
export function distanceLine({ right = 0, legs = 0, stop = null, secsLeft = 0 } = {}) {
  const ran = metres(distanceOf(right)), full = metres(trackOf(legs))
  if (stop === 'line') {
    const s = whole(secsLeft)
    return `You ran the full ${full} with ${plural(s, 'second', 'seconds')} to spare, worth +${finishBonus(s)} points.`
  }
  if (stop === 'time') return `The clock ran out at ${ran} of the ${full} track.`
  return `You ran ${ran} of the ${full} track.`
}

/** The line under it about the misses. */
export function missLine(log) {
  const rows = Array.isArray(log) ? log : []
  if (!rows.length) return ''
  const m = rows.filter((r) => !r.ok).length
  if (!m) return `No misses. Every answer here comes from our ${SECTORS_COURSE} course and the sources it cites.`
  return m === 1 ? 'The miss below carries its answer, its lesson and its source.' : 'Each miss below carries its answer, its lesson and its source.'
}
