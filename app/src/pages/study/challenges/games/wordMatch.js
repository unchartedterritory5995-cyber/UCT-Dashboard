// WORD MATCH (docs/study/GAMES.md §3, kind 'match'): the pure half of the game. Three rounds of five: words in one
// column, their meanings shuffled in the other; tap a word then its meaning (or a meaning then its word). A right pair
// locks gold and fades out; a wrong pair adds MATCH_PENALTY_MS to the clock and shows both pairs. The clock counts up;
// the best time lives on the device. A pair right on the first try counts as right; the run reports {right, total}
// once to POST /api/study/game-runs. No clock reads and no Math.random here: the deal takes a seed, the clock takes `now`.
//
// THE POOL, AND WHY EVERY PAIR IS CHECKED (rule 6, "We cannot have incorrect examples and explanations!"). POST
// /api/study/game-pool {kind: 'match'} returns {id, term, meaning} from ANY approved vocab recall item whose answer is
// not its term and fits in 60 characters (api/services/study_store.game_pool). Measured 2026-11-09 against the course
// files (docs/study/courses/V/V.02 to V.13, built as scripts/study/courses_lib.build_items builds them), 462 vocab
// recall items qualify, and most answers are not meanings at all: true/false items ("timeframe" paired with "True"),
// fill-ins ("double top" with "double"), number answers (the bank's "How many bars make a Morning star?" gives "3"),
// items read backwards ("Earnings call" with "The earnings call"), and questions that ask something else about the
// word ("Which chart shows a rounding bottom best?" with "The weekly chart"; "When do the minutes of a regular FOMC
// meeting come out?" with "Three weeks after the decision"). So a pair plays only when (1) its words pass the plain
// checks below (meaningProblem: 208 of the 462 do) and (2) its own question, read through GET /api/study/items/{id}
// (the prompt only: no key, no subject), is a choice question that asks what the word means, names the word and does
// not narrow it to one side (meaningPromptProblem: 186 of those 208 do, every one a real definition when read by hand;
// re-read 2026-11-09 in review, which set aside "In the money" keyed for a call only and "Neckline" keyed for a top
// only). The desk glossary's vocab items never reach the pool: every definition there runs past 60 characters.
// Two pairs whose meanings read alike never share a round (lookAlike): "A sideways range lasting weeks or more" (base)
// beside "Sideways for several weeks or months" (flat base) would mark a fair answer wrong.
import { clean } from './trueFalse'

export const MATCH_KIND = 'match'
export const MATCH_POOL_URL = '/api/study/game-pool'
export const MATCH_ITEM_URL = '/api/study/items'
export const MATCH_RUNS_URL = '/api/study/game-runs'
/** The draw asked of the server: its ceiling (study_store.game_pool caps `size` at 60), four times the fifteen a run
 *  plays, because most of what the pool hands out is set aside here. Simulated in review (2026-11-09, 10,000 draws)
 *  over the V courses plus the candle bank's vocab items, which pass the server's filter and then fail the checks
 *  below: one draw of 15 never fills three rounds (37% fill none), one of 40 fills them about four times in ten, one of
 *  60 about 97 times in a hundred. */
export const MATCH_POOL_SIZE = 60
/** Draws asked of the server at most: a draw that leaves the rounds short asks again, and stops early when the server
 *  has nothing new to give. With three, the same simulation filled three rounds in all 10,000 draws, at 1.03 pool
 *  requests and 26 item checks a draw on average. */
export const MATCH_DRAWS = 3
export const MATCH_ROUNDS = 3
export const MATCH_PER_ROUND = 5
/** Fewer usable pairs than one full round and the game says so honestly instead of dealing a thin board. */
export const MATCH_MIN = MATCH_PER_ROUND
/** Verified pairs to stop checking at: fifteen to play, and spares for rounds that must not hold two look-alikes. */
export const MATCH_WANT = 20
/** Item checks in flight at once. */
export const MATCH_CHECKS = 6
export const MATCH_PENALTY_MS = 3000
export const MATCH_TICK_MS = 100
export const MATCH_POOL_TIMEOUT_MS = 15000
/** How long a matched pair shows its gold before it fades to an empty slot. */
export const MATCH_LOCK_MS = 600
/** How long a wrong pair flashes red on the board before its lesson takes over the screen (the clock is held). */
export const MATCH_MISS_FLASH_MS = 600
/** A tap or Enter this soon after the lesson shows is a second tap meant for the board: it never skips the lesson. */
export const MATCH_TAKEOVER_GUARD_MS = 400
/** The pause between rounds ("Round 1 clear"), the clock held. */
export const MATCH_ROUND_GAP_MS = 1200
/** The beat between the last pair and the end screen (the clock already stopped at the last pair). */
export const MATCH_END_BEAT_MS = 700
export const MATCH_BEST_PREFIX = 'study.match.best'
export const TERM_MAX = 48
export const MEANING_MAX = 120
export const WORD_KEYS = ['1', '2', '3', '4', '5']
export const MEANING_KEYS = ['A', 'B', 'C', 'D', 'E']
export const MISS_TITLE = 'Not a pair.'
export const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'

/** The vocabulary units a pair comes from, by skill (docs/study/courses/V/V.02.json to V.13.json, each unit's title). */
export const UNIT_OF_SKILL = {
  'vocab.chart_terms': 'Chart words',
  'vocab.candle_terms': 'Candle words',
  'vocab.pattern_terms': 'Pattern and base words',
  'vocab.setup_terms': 'Setup words',
  'vocab.risk_terms': 'Risk words',
  'vocab.order_terms': 'Order words',
  'vocab.options_terms': 'Options words',
  'vocab.fund_terms': 'Fundamentals words',
  'vocab.macro_terms': 'Macro words',
  'vocab.breadth_terms': 'Breadth words',
  'vocab.psych_terms': 'Psychology words',
  'vocab.process_terms': 'Process words',
}
export const unitOf = (skill) => (typeof skill === 'string' && UNIT_OF_SKILL[skill]) || null

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
/** A word or a meaning as it is compared: our name, no dashes, straight quotes, one space, lower case. */
export const fold = (s) => clean(s).replace(/[‘’′]/g, "'").replace(/[“”]/g, '"').toLowerCase()
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** `phrase` stands in `text` as itself, never as part of a longer word ("r" is not in "risk"). Both folded. */
export function hasPhrase(text, phrase) {
  if (!text || !phrase) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRe(phrase)}(?=$|[^a-z0-9])`).test(text)
}
const wordsOf = (s) => String(s || '').trim().split(/\s+/).filter(Boolean)

/** Why a pair's words cannot be a word and its meaning, or null when they can. The plain checks, before any request:
 *  an answer of one word (True, False, a fill-in's "double"), a meaning that names its own word or is named inside it
 *  (a "which word is this" item read backwards: "Earnings call" and "The earnings call"), a scenario's lettered option
 *  ("A, on heavy volume"), a price from a story ("Just under $33"; a plain "$1" stays: "Its move per $1 move in the
 *  stock"), a bare number ("3"), or text too long for a tile. */
export function meaningProblem(term, meaning) {
  const t = fold(term), m = fold(meaning)
  if (!t || !m) return 'empty'
  if (t.length > TERM_MAX || m.length > MEANING_MAX) return 'too long'
  if (/^[\d\s.,%$:+\-/x]+$/.test(m)) return 'a number'
  if (wordsOf(m).length < 2) return 'one word'
  if (t === m || hasPhrase(m, t) || hasPhrase(t, m)) return 'names the word'
  if (/^[a-e]\s*[,:.)]\s/.test(m)) return 'an option letter'
  if (/\$\s?(?:\d{2,}|\d+\.\d)/.test(m)) return 'a price'
  return null
}

/** The pairs a draw may check, from the pool's items: each {id, term, meaning}, cleaned for print (our name, no em
 *  dash, a capital first letter), with the plain checks passed. Each id, each word and each meaning appears once, and a
 *  meaning that reads exactly as another pair's word is set aside (the two columns must never show the same text). */
export function pairsOf(items) {
  const out = []
  const ids = new Set(), terms = new Set(), meanings = new Set()
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id.trim()) continue
    if (typeof it.term !== 'string' || typeof it.meaning !== 'string' || it.term.includes('#')) continue
    const term = capFirst(clean(it.term)), meaning = capFirst(clean(it.meaning))
    if (meaningProblem(term, meaning)) continue
    const id = it.id.trim(), t = fold(term), m = fold(meaning)
    if (ids.has(id) || terms.has(t) || meanings.has(m)) continue
    ids.add(id); terms.add(t); meanings.add(m)
    out.push({ id, term, meaning })
  }
  return out.filter((p) => !terms.has(fold(p.meaning)))
}

// ── the check against each pair's own question ────────────────────────────────────────────────────────────────
/** The question forms that ask what a word means (read in the real course questions, V.02 to V.13, and the glossary
 *  items "At the desk, what does "X" mean?"). */
const ASKS_MEANING = [
  /\bwhat (?:is|are)\b/,
  /\bwhat does\b.*\b(?:mean|measure|show|stand for|track|count|compare|decide|limit|set|tell|give you|look like|do)\b/,
  /\bwhat do (?:we|you|they|traders|people) mean\b/,
  /\bwhat (?:job|role) does\b/,
  /\bwhat makes\b/,
  /\b(?:does|do) (?:that|this|it) mean\b/,
  /\bhow does\b.*\bdefine\b/,
  /\bwhat counts as\b/,
]
/** The forms that ask for something else: the word for a meaning (an item read backwards), or a kind of thing. */
const ASKS_OTHER = /\bwhich (?:word|term|name)\b|\bwhat (?:is|was) (?:that|this) (?:event|word|term)\b|\bwhat (?:type|kind|sort) of\b|\bwhat is (?:it|this|that) called\b/

/** The question names the pair's word: the whole word, either side of a bracket ("Year over year (YoY)" is named by
 *  "YoY"), or every part of it (a part of three letters or more may lead a longer word: "candle" in "candlestick",
 *  "roll" for "rolling"; a shorter part stands alone: "R" is never found in "risk"). */
export function mentions(question, term) {
  const q = fold(question), t = fold(term)
  if (!q || !t) return false
  const variants = [t]
  const br = t.match(/^(.*?)\s*\(([^()]+)\)\s*$/)
  if (br) variants.push(br[1].trim(), br[2].trim())
  if (variants.some((v) => v && hasPhrase(q, v))) return true
  const qWords = q.split(/[^a-z0-9/'-]+/).filter(Boolean)
  const parts = (br ? br[1] : t).split(/\s+/).filter(Boolean)
  return parts.length > 0 && parts.every((p) => (p.length < 3
    ? qWords.includes(p)
    : qWords.some((w) => w.startsWith(p) || (w.length >= 4 && p.startsWith(w)))))
}

/** The sides a question can narrow a word to: a call or a put, a top or a bottom. */
const ONE_SIDE = [/\bfor an? (call|put)\b/, /\b(top|bottom)s?\b/]
/** The side a question narrows its word to when the word itself leaves the side open, or null. "What does in the money
 *  mean for a call?" keys "The stock is above the strike", true of a call only (a put is in the money below it); "In a
 *  head and shoulders top, what is the neckline?" keys "Line through the lows between peaks" (a bottom's runs through
 *  the highs). On a tile beside the bare word either would read as the whole truth (rule 6), so such a pair never
 *  plays. A side the word names is no narrowing: "What does double bottom mean?", "What does a spinning top look like?" */
export function narrowedTo(question, term) {
  const q = fold(question), t = fold(term)
  if (!q || !t) return null
  for (const re of ONE_SIDE) {
    const m = q.match(re)
    if (m && !hasPhrase(t, m[1])) return m[1]
  }
  return null
}

/** Why a pair's own question shows it is not a word and its meaning, or null when it is. `item` is GET
 *  /api/study/items/{id} (the prompt only). It must be a choice question (no true/false, fill-in or number), with no
 *  scenario and no chart under it, list the pair's meaning among its choices, ask what a word means, name the word,
 *  and not narrow it to one side (narrowedTo). */
export function meaningPromptProblem(item, pair) {
  if (!item || typeof item !== 'object') return 'no item'
  if (item.has_chart) return 'a chart question'
  const p = item.prompt_json && typeof item.prompt_json === 'object' ? item.prompt_json : {}
  if (p.kind != null && p.kind !== '' && p.kind !== 'mcq') return 'not a choice question'
  if (p.story) return 'a scenario'
  const choices = Array.isArray(p.choices) ? p.choices : []
  const m = fold(pair?.meaning)
  if (!m || !choices.some((c) => fold(c) === m)) return 'not among its choices'
  const q = fold(p.q || p.question || '')
  if (!q) return 'no question'
  if (ASKS_OTHER.test(q)) return 'asks for a word'
  if (!ASKS_MEANING.some((re) => re.test(q))) return 'asks something else'
  if (!mentions(q, pair?.term)) return 'about another word'
  if (narrowedTo(q, pair?.term)) return 'one side only'
  return null
}

/** A check that means the member cannot play at all (signed out, unpaid, refused): the draw stops and says so. A 404
 *  is not one: the item was un-approved since the pool was drawn, so that pair is simply set aside. */
export const isFatalCheck = (e) => !!e && (e.status === 401 || e.status === 402 || e.status === 403)

/** Check each pair against its own question, `concurrency` at a time, until `want` pairs pass. `fetchPrompt(id)`
 *  resolves to the item's prompt. A refused check stops the draw (`fatal`); a pair whose check fails for another reason
 *  is set aside and counted in `failed`. `cache` (a Map) keeps each id's verdict and skill across draws. Returns
 *  {pairs, failed, fatal}: the passing pairs in the pool's order, each with the skill it comes from. */
export async function verifyPairs(pairs, fetchPrompt, { want = MATCH_WANT, concurrency = MATCH_CHECKS, cache = null } = {}) {
  const list = Array.isArray(pairs) ? pairs : []
  const kept = new Array(list.length).fill(null)
  let next = 0, passed = 0, failed = 0, fatal = null
  const worker = async () => {
    while (!fatal && passed < want && next < list.length) {
      const k = next++
      const pair = list[k]
      let v = cache ? cache.get(pair.id) : undefined
      if (v === undefined) {
        try {
          const item = await fetchPrompt(pair.id)
          v = { ok: meaningPromptProblem(item, pair) == null, skill: typeof item?.skill_id === 'string' ? item.skill_id : null }
        } catch (e) {
          if (isFatalCheck(e)) { fatal = fatal || e; return }
          if (e?.status === 404) v = { ok: false, skill: null }
          else { failed += 1; continue }   // not kept in the cache: the next draw may check it again
        }
        if (cache) cache.set(pair.id, v)
      }
      if (v.ok && !fatal && passed < want) { kept[k] = { ...pair, skill: v.skill }; passed += 1 }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker))
  return { pairs: fatal ? [] : kept.filter(Boolean), failed, fatal }
}

/** The whole draw: ask the pool (`fetchPool(n)` resolves to the n-th draw's items), check its pairs, and while the
 *  checked pairs cannot fill `rounds` full rounds, ask again, up to `draws` times. Each new draw joins the ones before
 *  it (an id once), its pairs are checked with the same cache (a pair checked once is never asked for again), and the
 *  asking stops early when a draw brings nothing new. The first draw's failure is the draw's failure; a later one
 *  plays what is already checked, unless it is a refusal (signed out, unpaid), which stops everything. `alive()` false
 *  stops it between requests (the sheet closed): it then resolves to null. Returns verifyPairs' {pairs, failed, fatal}
 *  for everything drawn. */
export async function drawPairs(fetchPool, fetchPrompt, { draws = MATCH_DRAWS, rounds = MATCH_ROUNDS, want = MATCH_WANT, cache = null, alive = () => true } = {}) {
  const items = [], ids = new Set(), memo = cache || new Map()
  let out = { pairs: [], failed: 0, fatal: null }
  let need = want, grew = false
  for (let n = 0; n < Math.max(1, draws); n++) {
    let got
    try { got = await fetchPool(n) } catch (e) { if (n === 0 || isFatalCheck(e)) throw e; break }
    if (!alive()) return null
    let added = 0
    for (const it of Array.isArray(got) ? got : []) {
      const id = it && typeof it.id === 'string' ? it.id.trim() : ''
      if (id && !ids.has(id)) { ids.add(id); items.push(it); added += 1 }
    }
    if (n > 0 && !added && !grew) break
    out = await verifyPairs(pairsOf(items), fetchPrompt, { want: need, cache: memo })
    if (!alive()) return null
    if (out.fatal || planRounds(out.pairs, { rounds }).length >= rounds) break
    // enough pairs passed but they read too alike to pack: the next pass checks further instead of stopping again
    grew = out.pairs.length >= need
    if (grew) need += want
  }
  return out
}

// ── rounds ─────────────────────────────────────────────────────────────────────────────────────────────────────
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'its', 'your', 'you', 'they', 'their', 'them', 'this', 'that',
  'than', 'then', 'are', 'was', 'has', 'have', 'not', 'but', 'into', 'how', 'what', 'who', 'can', 'may', 'will', 'just',
  'very', 'much', 'more', 'most', 'all', 'any', 'out', 'own'])
/** The words a meaning turns on, each cut to its first four letters so "price" meets "pricing" and "option" meets
 *  "options". */
export function stemsOf(text) {
  return new Set(fold(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.slice(0, 4)))
}

/** Two pairs that must not share a round: the same word or meaning, or meanings that share two or more of their words
 *  and at least half of the shorter one's ("Your planned loss, entry to stop" for R beside "Your risk per share, entry
 *  to stop" for 1R). Any doubt keeps them apart; the cost is only the order they are dealt in. */
export function lookAlike(a, b) {
  if (!a || !b) return false
  if (fold(a.term) === fold(b.term) || fold(a.meaning) === fold(b.meaning)) return true
  const x = stemsOf(a.meaning), y = stemsOf(b.meaning)
  if (!x.size || !y.size) return false
  let shared = 0
  for (const s of x) if (y.has(s)) shared += 1
  return shared >= 2 && shared / Math.min(x.size, y.size) >= 0.5
}

/** The rounds a draw can play: the pairs in the pool's order (the server draws at random), each into the first round
 *  with room and no look-alike, `rounds` of `per`; only full rounds are kept. */
export function planRounds(pairs, { rounds = MATCH_ROUNDS, per = MATCH_PER_ROUND } = {}) {
  const bins = Array.from({ length: Math.max(0, rounds) }, () => [])
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const bin = bins.find((b) => b.length < per && b.every((q) => !lookAlike(p, q)))
    if (bin) bin.push(p)
  }
  return bins.filter((b) => b.length === per && per > 0)
}

const MOD = 2147483647
/** A seeded generator (challengeBank.shuffle's Park-Miller), its first draws thrown away as trueFalse.deckOf does. */
export function rngOf(seed) {
  let s = (Math.abs(Math.floor(Number(seed) || 0)) % (MOD - 1)) + 1
  const rnd = () => { s = (s * 48271) % MOD; return s / MOD }
  rnd(); rnd(); rnd()
  return rnd
}
function shuffleWith(list, rnd) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
/** How many meanings sit on the same row as their word. */
export const inLine = (words, meanings) => words.reduce((n, id, i) => n + (meanings[i] === id ? 1 : 0), 0)

/** The run's deal from a seed: the rounds in a shuffled order, and in each the words and the meanings each shuffled.
 *  The meanings are shuffled again while more than one sits beside its own word (a board that lines up gives the
 *  answers away); after twelve tries they are turned one place, which leaves none in line. */
export function dealRun(plan, seed) {
  const rnd = rngOf(seed)
  const rounds = shuffleWith(Array.isArray(plan) ? plan : [], rnd)
  const order = rounds.map((pairs) => {
    const words = shuffleWith(pairs.map((p) => p.id), rnd)
    let meanings = shuffleWith(words, rnd)
    for (let t = 0; t < 12 && inLine(words, meanings) > 1; t++) meanings = shuffleWith(words, rnd)
    if (inLine(words, meanings) > 1) meanings = [...words.slice(1), words[0]]
    return { words, meanings }
  })
  return { rounds, order }
}

// ── the run ────────────────────────────────────────────────────────────────────────────────────────────────────
export const runIdOf = (seed, n = 0) => `match-${Math.abs(Math.floor(Number(seed) || 0)).toString(36)}-${n}`
export const EMPTY_RUN = { token: 0, runId: '', rounds: [], order: [], round: 0, sel: null, matched: [], missed: {}, misses: 0, results: [], log: [], done: false }
const NONE = { type: 'none' }

/** A fresh run on a plan: dealt from `seed`, numbered `token` (a late timer from an older run checks it). */
export function startRun(plan, seed, token = 1) {
  const { rounds, order } = dealRun(plan, seed)
  return { ...EMPTY_RUN, token, runId: runIdOf(seed, token), rounds, order }
}

/** A pair of the run, by id. */
export function pairOf(run, id) {
  for (const r of run?.rounds || []) for (const p of r) if (p.id === id) return p
  return null
}
export const totalOf = (run) => (run?.rounds || []).reduce((n, r) => n + r.length, 0)
/** The streak the run is on: right pairs in a row, to the latest. */
export function streakOf(results) {
  let n = 0
  for (let i = (results || []).length - 1; i >= 0 && results[i] === true; i--) n += 1
  return n
}

/** One tap. `side` is 'word' or 'meaning', `id` the pair whose tile it is. Returns {run, event}:
 *   select / deselect   the first tap of a pair (a second tap on the same side moves the pick; on the same tile drops it)
 *   match               the right partner: the pair locks; `ok` when it had no miss before (right on the first try)
 *   miss                the wrong partner: charged to the pair the member started from (they asked what THAT one
 *                       means, or whose meaning THAT is); `word` and `meaning` are the two tiles that flash
 *   none                a tile already matched, a tile from another round, or a run that is over */
export function pick(run, side, id) {
  const r = run || EMPTY_RUN
  const now = r.order[r.round]
  if (r.done || !now || (side !== 'word' && side !== 'meaning') || !now.words.includes(id) || r.matched.includes(id)) return { run: r, event: NONE }
  if (!r.sel) return { run: { ...r, sel: { side, id } }, event: { type: 'select', side, id } }
  if (r.sel.side === side) {
    if (r.sel.id === id) return { run: { ...r, sel: null }, event: { type: 'deselect', side, id } }
    return { run: { ...r, sel: { side, id } }, event: { type: 'select', side, id } }
  }
  const first = r.sel
  if (first.id === id) {
    const p = pairOf(r, id)
    const mixed = r.missed[id] || []
    const ok = mixed.length === 0
    const matched = [...r.matched, id]
    const clear = now.words.every((x) => matched.includes(x))
    const finished = clear && r.round >= r.order.length - 1
    const row = { id, term: p.term, meaning: p.meaning, skill: p.skill || null, ok, mixed: [...new Set(mixed)].map((o) => pairOf(r, o)?.term).filter(Boolean) }
    return {
      run: { ...r, sel: null, matched, results: [...r.results, ok], log: [...r.log, row], done: finished },
      event: { type: 'match', id, ok, first: first.side, roundClear: clear, finished },
    }
  }
  const charged = first.id, other = id
  return {
    run: { ...r, sel: null, missed: { ...r.missed, [charged]: [...(r.missed[charged] || []), other] }, misses: r.misses + 1 },
    event: { type: 'miss', first: first.side, charged, other, word: first.side === 'word' ? charged : other, meaning: first.side === 'word' ? other : charged },
  }
}

/** The run moved on to its next round (after "Round N clear"). */
export function nextRound(run) {
  const r = run || EMPTY_RUN
  if (r.done || r.round >= r.order.length - 1) return r
  return { ...r, round: r.round + 1, sel: null }
}

/** The run's tally: pairs right on the first try, pairs played, misses. */
export function tallyOf(run) {
  const results = run?.results || []
  return { right: results.filter(Boolean).length, total: results.length, misses: run?.misses || 0 }
}

/** What a miss teaches, from the miss event: the pair the member started from, whole, and the one they mixed it up
 *  with, whole, with the line between them and the unit the right pair comes from. */
export function missLesson(run, event) {
  const right = pairOf(run, event?.charged), mixed = pairOf(run, event?.other)
  if (!right || !mixed) return null
  const why = event.first === 'word'
    ? `That meaning goes with ${mixed.term}.`
    : `That meaning goes with ${right.term}, not ${mixed.term}.`
  return {
    first: event.first, title: MISS_TITLE, why,
    right: { term: right.term, meaning: right.meaning }, mixed: { term: mixed.term, meaning: mixed.meaning },
    from: unitOf(right.skill), cost: `+${MATCH_PENALTY_MS / 1000} seconds`,
  }
}

/** A key as a pick: 1 to 5 a word, A to E a meaning (either case); anything else is nothing. A pick is dropped by
 *  pressing it again (Escape is never taken: it closes the game's sheet). */
export function keyPick(key) {
  const k = String(key ?? '')
  const w = WORD_KEYS.indexOf(k)
  if (w >= 0) return { side: 'word', index: w }
  const m = MEANING_KEYS.indexOf(k.toUpperCase())
  if (k.length === 1 && m >= 0) return { side: 'meaning', index: m }
  return null
}

// ── the clock: it counts up, holds while a lesson or a round break shows, and takes a penalty on a miss ─────────────
export const CLOCK0 = { acc: 0, since: null }
/** The time on the clock at `now` (ms). */
export const clockAt = (c, now) => Math.max(0, (c?.acc || 0) + (c?.since == null ? 0 : Math.max(0, Number(now) - c.since)))
export const runClock = (c, now) => (c?.since == null ? { acc: c?.acc || 0, since: Number(now) } : c)
export const holdClock = (c, now) => (c?.since == null ? { acc: c?.acc || 0, since: null } : { acc: clockAt(c, now), since: null })
export const penalize = (c, ms = MATCH_PENALTY_MS) => ({ acc: (c?.acc || 0) + ms, since: c?.since ?? null })

/** The clock as it reads: minutes, seconds and tenths, "0:42.3" (a tenth is never rounded up). */
export function clockText(ms) {
  const t = Math.floor(Math.max(0, Number(ms) || 0) / 100)
  const m = Math.floor(t / 600), s = Math.floor((t % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${t % 10}`
}
/** The clock said aloud: "42.3 seconds", "1 minute 5.0 seconds". */
export function clockWords(ms) {
  const t = Math.floor(Math.max(0, Number(ms) || 0) / 100)
  const m = Math.floor(t / 600), s = (t % 600) / 10
  const sec = `${s.toFixed(1)} seconds`
  return m ? `${m} minute${m === 1 ? '' : 's'} ${sec}` : sec
}

// ── the best time on this device ──────────────────────────────────────────────────────────────────────────────
/** One best per board size: fifteen pairs and five are not the same race. */
export const bestKeyOf = (total) => `${MATCH_BEST_PREFIX}.${Math.max(0, Math.floor(Number(total) || 0))}`
export const bestOf = (raw) => { const v = Number(raw); return raw != null && raw !== '' && Number.isFinite(v) && v > 0 ? v : null }
export const isNewBest = (ms, best) => Number.isFinite(ms) && ms > 0 && (best == null || ms < best)
/** The pace bar under the clock: the time so far against the best, and whether it has gone past it. */
export function paceOf(ms, best) {
  if (!best || !(best > 0)) return null
  const t = Math.max(0, Number(ms) || 0)
  return { pct: Math.min(100, (t / best) * 100), over: t > best }
}

/** The rounds a draw plays, in words for the start screen ("Three rounds"): a thin draw fills fewer, never more. */
export function roundsWord(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0))
  const word = ['No', 'One', 'Two', 'Three'][k] ?? String(k)
  return `${word} ${k === 1 ? 'round' : 'rounds'}`
}

// ── the end ────────────────────────────────────────────────────────────────────────────────────────────────────
/** The misses, as the end screen says them. */
export function missLine(misses) {
  const n = Math.max(0, Math.floor(Number(misses) || 0))
  if (!n) return 'No misses. Every pair went in on the first try.'
  const secs = (n * MATCH_PENALTY_MS) / 1000
  return `${n} ${n === 1 ? 'miss' : 'misses'} added ${secs} seconds.`
}
/** The best, as the end screen says it: a new one, the first, or the one that stands. */
export function bestLine(ms, before) {
  if (before == null) return "Your first time on this board. That's the one to beat."
  if (isNewBest(ms, before)) return `A new best. You beat ${clockText(before)}.`
  return `Your best stands at ${clockText(before)}.`
}

/** The server's answer to the run as the end screen's level bar ({before, after}), or null when it is not one (then
 *  the XP did not save). */
export function levelOf(res) {
  const after = res?.progress?.xp
  const gained = Number(res?.xp_gained ?? res?.progress?.xp_gained ?? 0)
  return typeof after === 'number' && Number.isFinite(after) && Number.isFinite(gained) ? { before: after - gained, after } : null
}
