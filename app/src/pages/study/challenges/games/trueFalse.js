// TRUE OR FALSE (docs/study/GAMES.md §3, kind 'tf'): the pure half of the game. Forty-five seconds of approved true/false
// statements from every course (POST /api/study/game-pool {kind: 'tf'}); each call is scored on the server
// (POST /api/study/attempts), which keeps the key until the member has answered and grants the XP. Nothing here knows a
// statement's answer before the server says it: this module only shapes the pool, deals it from a seed, keeps the run's
// score and clock, and reads the server's reveal into the lines a miss teaches. No clock reads, no Math.random.
//
// What a course statement carries (scripts/study/courses_lib.build_items, format "tf"): prompt_json {q, kind: 'tf',
// choices: ['True', 'False']}; after the attempt, the reveal's `why` (it opens on the verdict, "False. You can't invest
// directly in an index. ..."), its `lesson_line` (the mentor's line, at most 22 words) and `depth.sources` (each cited
// page: {name: "<publisher>: <title>", url, quote}).
import { brandWords } from '../../drills/types'
import { firstSentence } from '../../ui/lesson'

export const TF_KIND = 'tf'
export const TF_POOL_URL = '/api/study/game-pool'
export const TF_SECS = 45
/** The draw asked of the server: more than a fast member can call in 45 seconds, so a run rarely runs dry. */
export const TF_POOL_SIZE = 40
/** Fewer usable statements than this and the game says so honestly instead of dealing a thin run. */
export const TF_MIN = 5
export const TF_POINTS = 10
export const TF_BEST_KEY = 'study.tf.best'
/** How long a miss holds the screen before the next statement comes on its own (a tap moves on sooner). */
export const TF_TAKEOVER_MS = 2500
/** A long reason holds longer: the clock is paused and a tap moves on, so time to read costs the member nothing. The
 *  reason fades in over about TF_FADE_IN_MS, then a quarter second a word, never past TF_TAKEOVER_MAX_MS. */
export const TF_FADE_IN_MS = 900
export const TF_READ_MS_PER_WORD = 250
export const TF_TAKEOVER_MAX_MS = 8000
/** A tap (or Enter) this soon after a miss shows is a second tap meant for the next statement: it must not skip the
 *  lesson. The takeover still moves on by itself at TF_TAKEOVER_MS. */
export const TF_TAKEOVER_GUARD_MS = 400
/** The clock's step: small enough that a pause (a miss, an answer on the wire) costs the member no time. */
export const TF_TICK_MS = 100
/** Answers that fail to reach the server in a row before the run stops (each one is not counted). */
export const TF_MAX_FAILS = 3
export const TF_POOL_TIMEOUT_MS = 15000
export const TF_ATTEMPT_TIMEOUT_MS = 8000
export const TRUE = 'True'
export const FALSE = 'False'
export const TF_CHOICES = [TRUE, FALSE]
/** A reason shorter than this many words leans on the sentence after it ("It helps." / "That's step 1."). */
export const REASON_MIN_WORDS = 6
/** The longest source name the takeover prints; the full name rides in the end screen's link title. */
export const SOURCE_MAX = 90

// ── the multiplier, Blitz's (challengeBank.blitzMult): it climbs with the streak and resets on a miss ─────────────
export const tfMult = (combo) => (combo >= 9 ? 5 : combo >= 6 ? 4 : combo >= 3 ? 3 : combo >= 1 ? 2 : 1)
/** The points one right call earns, at the streak it makes. */
export const pointsFor = (combo) => TF_POINTS * tfMult(combo)

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** Member copy from the bank, made safe to print: our name (never "the firm", rule 11), no em or en dash (a range keeps
 *  a hyphen: "569\u2013579" reads "569-579"), one space between words. */
export function clean(text) {
  if (text == null) return ''
  const t = brandWords(String(text)) || ''
  return t
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1-$2')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── the pool ────────────────────────────────────────────────────────────────────────────────────────────────────
const isTfChoices = (choices) => {
  if (!Array.isArray(choices) || !choices.length) return true          // a tf prompt with no choices is True / False
  const set = choices.map((c) => String(c ?? '').trim().toLowerCase()).sort().join('|')
  return set === 'false|true'
}

/** The statements a run may deal, from the pool's items (study_store.game_pool: get_item_prompt rows). Kept: a tf
 *  prompt with a statement, whose choices are True and False (a "Yes / No" item would score against buttons it does
 *  not have), with no chart under it (a statement about "this chart" cannot be called without one). Each statement
 *  appears once, by id and by its words. */
export function statementsOf(items) {
  const out = []
  const ids = new Set()
  const said = new Set()
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue
    const id = typeof it.id === 'string' ? it.id.trim() : ''
    const p = it.prompt_json && typeof it.prompt_json === 'object' ? it.prompt_json : {}
    if (!id || p.kind !== TF_KIND || it.has_chart || !isTfChoices(p.choices)) continue
    const q = clean(p.q || p.question || '')
    const k = q.toLowerCase()
    if (!q || ids.has(id) || said.has(k)) continue
    ids.add(id); said.add(k)
    out.push({ id, q, skill: typeof it.skill_id === 'string' ? it.skill_id : null })
  }
  return out
}

const MOD = 2147483647
/** The run's order: the statements shuffled from a seed (the same seed, the same order; challengeBank.shuffle's
 *  Park-Miller generator). Its first draws are thrown away (as sizeIt.rngFor does): straight from a small seed, or from
 *  two seeds a few seconds apart, the first draw is nearly the same number, and the first statement always went last. */
export function deckOf(statements, seed) {
  const a = Array.isArray(statements) ? [...statements] : []
  let s = (Math.abs(Math.floor(Number(seed) || 0)) % (MOD - 1)) + 1
  const rnd = () => { s = (s * 48271) % MOD; return s / MOD }
  rnd(); rnd(); rnd()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** The key a member pressed, as a call: T or 1 is True, F or 2 is False; anything else is not a call. */
export function keyChoice(key) {
  const k = String(key ?? '')
  if (k === 't' || k === 'T' || k === '1') return TRUE
  if (k === 'f' || k === 'F' || k === '2') return FALSE
  return null
}

export const otherOf = (choice) => (choice === TRUE ? FALSE : TRUE)

/** The right answer, from what the member said and what the server scored: on a two-way call a wrong one means the
 *  other. Read from the verdict (not from a reveal field) so the screen can never disagree with the score. */
export const truthOf = (said, correct) => (correct ? said : otherOf(said))

/** The server's verdict on one call: true or false, or null when the reply carries none. A reply without a verdict is
 *  not scored at all: reading it as a miss would show the member the opposite of the answer as the answer. */
export const verdictOf = (attempt) => (attempt && typeof attempt.correct === 'boolean' ? attempt.correct : null)

// ── the reveal, as the lines a miss teaches ─────────────────────────────────────────────────────────────────────────
const VERDICT = /^\s*(?:true|false)\s*[.!:,;]\s*/i
/** A sentence that turns on the one before it. The one before was a concession ("The rule of thumb says about a year.
 *  But there were false alarms."), and alone, under "It's false.", it reads as a reason the statement is true. */
const TURN = /^(?:But|However|Yet|Still|Even so|That said)\b/

/** Why, in a sentence: the reveal's `why` (or its whole lesson) without the verdict it opens on ("False. "), cut to its
 *  first sentence. The next sentence comes with it when the first is under REASON_MIN_WORDS words (so the line always
 *  says something on its own) or when the next one turns on it (so the line never argues for the wrong answer). The
 *  words are the bank's own. */
export function reasonOf(reveal) {
  const src = clean(reveal?.why || reveal?.lesson || '')
  const body = cap(src.replace(VERDICT, '').trim())
  if (!body) return ''
  const [one, rest] = firstSentence(body)
  if (!rest) return one
  const [two] = firstSentence(rest)
  if (words(one) >= REASON_MIN_WORDS && !TURN.test(two)) return one
  return `${one} ${two}`.trim()
}

/** The mentor's line for the run log: the statement's lesson line, else its reason. */
export function lessonLineOf(reveal) {
  return clean(reveal?.lesson_line || '') || reasonOf(reveal)
}

/** A source name short enough for a phone: the parentheses (dates, editions, notes) dropped, then, when still longer
 *  than `max`, cut at the last comma, colon or semicolon that leaves a real name, or at a word with an ellipsis. */
export function shortSource(name, max = SOURCE_MAX) {
  let s = clean(name)
  for (let k = 0; k < 4; k++) {
    const next = s.replace(/\s*\([^()]*\)/g, '')
    if (next === s) break
    s = next
  }
  s = s.replace(/\s+([:,;.])/g, '$1').replace(/[\s:,;]+$/, '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const head = s.slice(0, max + 1)
  const at = Math.max(head.lastIndexOf(', '), head.lastIndexOf(': '), head.lastIndexOf('; '))
  if (at >= 30) return head.slice(0, at).replace(/[\s:,;]+$/, '')
  const sp = head.lastIndexOf(' ')
  return `${head.slice(0, sp > 30 ? sp : max).replace(/[\s:,;.]+$/, '')}…`
}

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : null)

/** Where the statement comes from: the reveal's first cited source with a name ({name, full, url}), or null. */
export function sourceOf(reveal) {
  const list = Array.isArray(reveal?.depth?.sources) ? reveal.depth.sources : []
  const first = list.find((c) => c && typeof c.name === 'string' && c.name.trim())
  if (!first) return null
  return { name: shortSource(first.name), full: clean(first.name), url: safeUrl(first.url) }
}

/** One call, as the run log keeps it. */
export function rowOf({ statement, said, correct, reveal = null }) {
  const ok = !!correct
  return {
    id: statement?.id || '', q: statement?.q || '', said, ok, truth: truthOf(said, ok),
    reason: reasonOf(reveal), line: lessonLineOf(reveal), source: sourceOf(reveal),
  }
}

/** The takeover's verdict, first (VOICE.md §4: the verdict before the reason). */
export const verdictTitle = (truth) => `It's ${String(truth || '').toLowerCase()}.`

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const EMPTY_RUN = { token: 0, deck: [], i: 0, score: 0, combo: 0, best: 0, right: 0, answered: 0, results: [], log: [], lost: 0, fails: 0, done: false }

/** The run after one scored call: the streak, the best streak, the points (at the streak the call makes), the tally. */
export function applyCall(run, row) {
  const r = run || EMPTY_RUN
  const ok = !!row?.ok
  const combo = ok ? r.combo + 1 : 0
  return {
    ...r, combo, best: Math.max(r.best, combo), score: r.score + (ok ? pointsFor(combo) : 0),
    right: r.right + (ok ? 1 : 0), answered: r.answered + 1, results: [...r.results, ok], log: [...r.log, row], fails: 0,
  }
}

/** The run after a call that never reached the server: not scored, not counted, one more failure in a row. */
export function applyLost(run) {
  const r = run || EMPTY_RUN
  return { ...r, lost: r.lost + 1, fails: r.fails + 1 }
}

/** The clock: `step` ms off what is left, unless it is paused; never below zero. */
export function tickClock(ms, paused, step = TF_TICK_MS) {
  const left = Math.max(0, Number(ms) || 0)
  return paused ? left : Math.max(0, left - step)
}

/** The seconds the clock shows: a part second still counts as one. */
export const secsOf = (ms) => Math.ceil(Math.max(0, Number(ms) || 0) / 1000)

// ── the end ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The end screen's title. */
export function tfVerdict(right, total) {
  if (!total) return 'No calls this run'
  if (right === total) return 'Every call right'
  const r = right / total
  if (r >= 0.8) return 'Sharp calls'
  if (r >= 0.6) return 'Solid run'
  return 'Tough run'
}

/** Which way the misses leaned, when they leaned: two thirds or more of two or more misses the same way. */
export function leanLine(log) {
  const rows = Array.isArray(log) ? log : []
  if (!rows.length) return ''
  const misses = rows.filter((r) => !r.ok)
  const m = misses.length
  if (!m) return 'No misses. Every statement here comes from a course and the source it cites.'
  if (m < 2) return 'The miss below carries its lesson and its source.'
  const calledTrue = misses.filter((r) => r.said === TRUE).length
  const calledFalse = m - calledTrue
  const share = (k) => (k < m ? `${k} of your ${m} misses were` : m === 2 ? 'Both your misses were' : `All ${m} of your misses were`)
  if (calledTrue * 3 >= m * 2) return `${share(calledTrue)} false statements you called true. One wrong word makes a statement false.`
  if (calledFalse * 3 >= m * 2) return `${share(calledFalse)} true statements you called false. Read what it says, not how it sounds.`
  return 'Each miss below carries its lesson and its source.'
}

/** How long this miss holds the screen: TF_TAKEOVER_MS at least, longer for a longer reason (see TF_READ_MS_PER_WORD). */
export function takeoverMs(reason) {
  const words = String(reason || '').trim().split(/\s+/).filter(Boolean).length
  return Math.min(TF_TAKEOVER_MAX_MS, Math.max(TF_TAKEOVER_MS, TF_FADE_IN_MS + words * TF_READ_MS_PER_WORD))
}
