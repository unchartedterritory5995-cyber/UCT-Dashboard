// SPOT THE MISTAKE (docs/study/GAMES.md §3, kind 'mistake'): the pure half of the game. Eight approved scenario items
// from course unit F12.07 (skill process.mistakes; POST /api/study/sessions {kind: 'skill', skill_id, size}): each one a
// four-line trade plan or journal entry, numbered "1. ... 2. ... 3. ... 4. ...", with the choices "Line 1" to "Line 4".
// Three hearts. Every answer is scored on the server (POST /api/study/attempts), which keeps the key until the member has
// answered and grants the XP, so the game never posts a game run. Nothing here knows which line breaks the plan before
// the server says so: this module only shapes the pool, splits a story into its four lines, deals a run from a seed,
// counts the hearts and reads the server's reveal into the lines a miss teaches. No clock reads, no Math.random.
//
// What a scenario item carries (scripts/study/courses_lib.build_items, format "scenario"): prompt_json {q, kind: 'mcq',
// story, choices}; after the attempt, the reveal's `answer` ({answer: 'Line 4'}), its `why` (it opens on the verdict,
// "Line 4. A plan says where you get out ..."), its `lesson_line` (the mentor's line, at most 22 words), its `wrong`
// (each fine line explained: {'Line 1': 'Line 1 is fine. It names the setup ...'}) and `depth.sources` (the cited pages).
import { clean, shortSource, sourceOf } from './trueFalse'

export const MISTAKE_KIND = 'mistake'
export const MISTAKE_SKILL = 'process.mistakes'
export const MISTAKE_UNIT = 'F12.07'
export const SESSIONS_URL = '/api/study/sessions'
/** The entries in a run, and the draw asked of the server (the skill session deals a fresh draw of approved items). */
export const MISTAKE_TOTAL = 8
export const MISTAKE_SIZE = 8
export const MISTAKE_HEARTS = 3
/** Fewer playable entries than this and the game says so honestly instead of dealing a thin run. */
export const MISTAKE_MIN = 3
export const MISTAKE_LINES = 4
export const MISTAKE_BEST_KEY = 'study.mistake.best'
export const MISTAKE_POOL_TIMEOUT_MS = 15000
export const MISTAKE_ATTEMPT_TIMEOUT_MS = 8000
/** Answers that fail to reach the server in a row before the run stops (each one is not counted). */
export const MISTAKE_MAX_FAILS = 3
export const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
export const LOST_LINE = 'We could not check that one, so it does not count. Here is the next.'

export { clean, shortSource, sourceOf }

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const LINE_CHOICE = /^line\s*([1-4])$/

/** The line a choice names ("Line 3", "line 3", " LINE 3 ") as 1 to 4, or null. */
export function lineOf(choice) {
  const m = LINE_CHOICE.exec(norm(choice))
  return m ? Number(m[1]) : null
}

/** The line a key press names: 1 to 4, else null. */
export function keyLine(key) {
  const k = String(key ?? '')
  return /^[1-4]$/.test(k) ? Number(k) : null
}

// ── the story, as its four lines ───────────────────────────────────────────────────────────────────────────────────
/** The four numbered lines of a story ("1. Setup: a tight flag. 2. Risk: 1%. 3. Entry: over the high. 4. Stop: none."),
 *  robust to spacing and to "1)" markers. A marker is a digit 1 to 4 followed by a stop and a space, found in order
 *  (the first "1.", then the first "2." after it, and so on), so "1% of the account", "7:15 a.m." and "$1.50" inside a
 *  line are never read as markers. Null unless exactly those four lines are found, each with words in it: the game then
 *  shows the story whole and the plain choice tiles. */
export function parseLines(story) {
  const s = clean(story)
  if (!s) return null
  const marks = []
  let from = 0
  for (let n = 1; n <= MISTAKE_LINES; n++) {
    const re = new RegExp(`(?:^|\\s)${n}[.)]\\s+`, 'g')
    re.lastIndex = from
    const m = re.exec(s)
    if (!m) return null
    marks.push({ start: m.index, end: m.index + m[0].length })
    from = m.index + m[0].length
  }
  if (marks[0].start !== 0) return null                       // words before "1.": not a numbered story
  const lines = marks.map((m, k) => s.slice(m.end, k + 1 < marks.length ? marks[k + 1].start : s.length).trim())
  // a line with no words, or one that opens on a marker ("2. Then ..."): a number inside the line before it was read as
  // the marker ("trade 2. 2. Then"), so the split is garbled and the whole story is safer
  if (lines.some((l) => !/[A-Za-z]/.test(l) || /^[1-4][.)]\s/.test(l))) return null
  // a fifth marker after the fourth line would mean the story is longer than four lines: the whole story is safer
  if (/\s5[.)]\s+/.test(lines[MISTAKE_LINES - 1])) return null
  return lines
}

// ── the pool ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** The choices as the server sent them, when they are the four lines (in any order): [{line, choice}] by line, else null. */
function lineChoices(choices) {
  if (!Array.isArray(choices) || choices.length !== MISTAKE_LINES) return null
  const byLine = new Array(MISTAKE_LINES + 1).fill(null)
  for (const c of choices) {
    const n = lineOf(c)
    if (!n || byLine[n]) return null
    byLine[n] = String(c)
  }
  return byLine
}

/** The entries a run may deal, from the skill session's payload ({session_id, items}). Kept: a scenario item with an
 *  id, a story and the four "Line N" choices, with no chart under it. Each entry appears once, by id and by its story.
 *  Each carries the session's id, so its attempt lands in the session the server made. */
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
    if (it.type === 'walkthrough' || Array.isArray(p.steps)) continue
    if (p.kind && p.kind !== 'mcq') continue
    const story = clean(p.story || '')
    if (!story) continue
    const choices = lineChoices(p.choices)
    if (!choices) continue
    const k = story.toLowerCase()
    if (said.has(k)) continue
    ids.add(id); said.add(k)
    const d = Number(it.difficulty)
    out.push({
      id, sessionId, q: clean(p.q || p.question || '') || 'Which line breaks the plan?', story, lines: parseLines(story),
      choices, difficulty: Number.isFinite(d) ? d : 2, skill: typeof it.skill_id === 'string' ? it.skill_id : null,
    })
  }
  return out
}

/** The server's own string for a line of an entry ("Line 3"), so the attempt scores against the key as written. */
export const choiceFor = (qn, line) => (qn?.choices && qn.choices[line]) || `Line ${line}`

// ── the deal ───────────────────────────────────────────────────────────────────────────────────────────────────────
const MOD = 2147483647
/** A Park-Miller generator from a seed (challengeBank.shuffle's), its first draws thrown away: straight from a small
 *  seed, or from two seeds a few seconds apart, the first draw is nearly the same number (trueFalse.deckOf). */
function rngOf(seed) {
  let s = (Math.abs(Math.floor(Number(seed) || 0)) % (MOD - 1)) + 1
  const rnd = () => { s = (s * 48271) % MOD; return s / MOD }
  rnd(); rnd(); rnd()
  return rnd
}

/** The run: the entries shuffled from the seed, then the easier ones first (the unit's rungs, as the bank grades
 *  them), at most MISTAKE_TOTAL. The same seed deals the same run. */
export function deckOf(questions, seed, total = MISTAKE_TOTAL) {
  const a = Array.isArray(questions) ? [...questions] : []
  const rnd = rngOf(seed)
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a.map((q, i) => ({ q, i })).sort((x, y) => (x.q.difficulty - y.q.difficulty) || (x.i - y.i)).map((x) => x.q).slice(0, Math.max(0, total))
}

// ── the reveal, as the lines a miss teaches ─────────────────────────────────────────────────────────────────────────
/** The server's verdict on one answer: true or false, or null when the reply carries none. A reply without a verdict is
 *  not scored at all: reading it as a miss would show a line as the broken one on no evidence. */
export const verdictOf = (attempt) => (attempt && typeof attempt.correct === 'boolean' ? attempt.correct : null)

/** The line that broke the plan, as 1 to 4: the member's own when the server scored it right, else the line the
 *  reveal's key names; null when the key does not name one (the screen then says "Not that line" and no line glows). */
export function truthOf(reveal, said, correct) {
  if (correct) return said
  const key = reveal?.answer
  const raw = key && typeof key === 'object' ? (key.answer ?? key.choice) : key
  return lineOf(raw)
}

const VERDICT = /^\s*line\s*[1-4]\s*[.!:,;]\s*/i
/** Why that line breaks the plan: the reveal's `why` (or its whole lesson) without the verdict it opens on ("Line 4. "),
 *  in the bank's own words. */
export function whyOf(reveal) {
  const src = clean(reveal?.why || reveal?.lesson || '')
  return cap(src.replace(VERDICT, '').trim())
}

/** The mentor's line: the reveal's lesson line, else its why. */
export function lessonLineOf(reveal) {
  return clean(reveal?.lesson_line || '') || whyOf(reveal)
}

const FINE = /^\s*line\s*([1-4])\s+(?:is|was)\s+fine\s*[.!:,;]?\s*/i
/** Why each other line was fine, by line, from the reveal's `wrong` ({'Line 1': 'Line 1 is fine. It names the setup
 *  ...'}): the "Line 1 is fine." opener is lifted off (the screen says Fine beside the line), the rest kept as written.
 *  A line the reveal does not explain reads ''. The broken line is never in it. */
export function fineOf(reveal, truth) {
  const out = {}
  const wrong = reveal?.wrong && typeof reveal.wrong === 'object' ? reveal.wrong : {}
  for (let n = 1; n <= MISTAKE_LINES; n++) {
    if (n === truth) continue
    const key = Object.keys(wrong).find((k) => lineOf(k) === n)
    const text = key ? clean(wrong[key]) : ''
    const m = FINE.exec(text)
    const rest = m ? text.slice(m[0].length).trim() : text
    out[n] = cap(rest || text)
  }
  return out
}

/** One entry, as the run log keeps it. */
export function rowOf({ question, said, correct, reveal = null }) {
  const ok = !!correct
  const truth = truthOf(reveal, said, ok)
  return {
    id: question?.id || '', q: question?.q || '', story: question?.story || '', lines: question?.lines || null,
    said, truth, ok, why: whyOf(reveal), line: lessonLineOf(reveal), fine: fineOf(reveal, truth), source: sourceOf(reveal),
    unit: clean(reveal?.unit || '') || MISTAKE_UNIT,
  }
}

/** The broken line's own words (the mistake itself), for the log; "Line N" when the story could not be split. */
export function mistakeOf(row) {
  if (!row || !row.truth) return 'The line that broke the plan'
  return row.lines ? row.lines[row.truth - 1] : `Line ${row.truth}`
}

/** The takeover's verdict, first (VOICE.md §4: the verdict before the reason). */
export function verdictTitle(ok, truth) {
  if (ok) return 'Spotted it.'
  return truth ? `It was line ${truth}.` : 'Not that line.'
}

// ── the hearts and the run ─────────────────────────────────────────────────────────────────────────────────────────
/** The hearts left after these results: one goes with each miss, never below zero. */
export function heartsLeft(results, hearts = MISTAKE_HEARTS) {
  const misses = (Array.isArray(results) ? results : []).filter((r) => r === false).length
  return Math.max(0, hearts - misses)
}

/** Whether the run is over: the hearts are gone, or every entry is played. */
export function runOver(results, total, hearts = MISTAKE_HEARTS) {
  const r = Array.isArray(results) ? results : []
  return heartsLeft(r, hearts) === 0 || r.length >= total
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
/** The hearts, said: "2 hearts left" / "1 heart left" / "Out of hearts". */
export const heartsLine = (left) => (left > 0 ? `${plural(left, 'heart', 'hearts')} left` : 'Out of hearts')

/** The start screen when a few entries are approved but fewer than MISTAKE_MIN: said as it is, never "no questions". */
export const thinLine = (n) => `Only ${plural(n, 'entry is', 'entries are')} approved so far. The game opens at ${MISTAKE_MIN}.`

/** The end screen's title. */
export function endTitle(right, played, out = false) {
  if (!played) return 'No entries this run'
  if (out) return 'Out of hearts'
  if (right === played && played >= MISTAKE_TOTAL) return 'Every mistake spotted'
  const r = right / played
  if (r >= 0.75) return 'Sharp eye'
  if (r >= 0.5) return 'Solid review'
  return 'Tough review'
}

/** The end screen's note under the title, from the log. */
export function endNote(log) {
  const rows = Array.isArray(log) ? log : []
  if (!rows.length) return ''
  const misses = rows.filter((r) => !r.ok).length
  if (!misses) return 'No misses. Every plan here comes from a course unit and the rules it cites.'
  if (misses === 1) return 'The miss below shows the line that broke the plan, and why.'
  return `Each of the ${misses} misses below shows the line that broke the plan, and why.`
}
