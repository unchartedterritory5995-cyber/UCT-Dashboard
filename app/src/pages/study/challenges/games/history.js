// HISTORY DETECTIVE (docs/study/GAMES.md §3, kind 'history'): the pure half of the game. Case files from real falls in US
// stocks, drawn from the approved items of course unit F7.08 (POST /api/study/sessions {kind: 'skill', skill_id:
// 'history.detective'}). Each item is scored on the server (POST /api/study/attempts), which keeps the key until the
// member has answered and grants the XP, so this game never posts a game run. Nothing here knows a case's answer before
// the server says it: this module shapes the draw into cases, orders them, deals each one's tiles from a seed, reads what
// the member typed, keeps the hearts, and reads the server's reveal into the case file a member reads after answering.
// No clock reads, no Math.random.
//
// What an F7.08 item carries (scripts/study/courses_lib.build_items): type 'recall' with prompt_json.kind 'mcq' | 'tf' |
// 'fill' | 'fill_numeric', or type 'scenario' (kind 'mcq' with a `story`); a chart question also has its bars inline
// (the index, ticker hidden: the bars' symbol is the item id). After the attempt the reveal holds `why` (it opens on the
// verdict), `lesson_line` (the mentor's line), `wrong` (a note for each wrong choice), `facts.calc` (a computed answer's
// function, inputs and result), `depth.sources` (each cited page: {name: "<publisher>: <title>", url, quote}), and for a
// chart its `sym` and `asof`.
import { firstSentence } from '../../ui/lesson'
import { clean, shortSource } from './trueFalse'

export const HISTORY_KIND = 'history'
export const HISTORY_SKILL = 'history.detective'
export const HISTORY_UNIT = 'F7.08'
/** The cases a run deals (the session asks for this many). */
export const HISTORY_TOTAL = 8
export const HISTORY_HEARTS = 3
/** Fewer usable cases than this and the game shows its honest empty state instead of a thin run. */
export const HISTORY_MIN = 3
export const HISTORY_BEST_KEY = 'study.history.best'
export const HISTORY_POOL_TIMEOUT_MS = 15000
export const HISTORY_ATTEMPT_TIMEOUT_MS = 10000
/** How many follow-up calls fetch the rest of a chart's aftermath (the server serves 60 bars a call). */
export const HISTORY_REST_CALLS = 4

export const TRUE = 'True'
export const FALSE = 'False'
export const TF_CHOICES = [TRUE, FALSE]

export const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
/** A draw with a case or two but fewer than a run needs: said as it is, never "no questions" when there are some. */
export const thinLine = (n) => `Only ${n} ${n === 1 ? 'case is' : 'cases are'} approved so far, too few for a run. More arrive as the courses are approved.`
export const FAILED_LINE = 'We could not check that answer, so it does not count yet. Press Check to send it again.'
export const SIGNED_OUT_LINE = 'You are signed out, so that answer was not checked. Sign in, then press Check again.'
export const NUMBER_HINT = 'Type a number, like 12.5'

/** The session the game asks for: the approved items of the unit's one skill. */
export const sessionBody = (size = HISTORY_TOTAL) => ({ kind: 'skill', skill_id: HISTORY_SKILL, size })

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').toLowerCase()
/** The same words, whether or not they open on "The", "It's" or "It" (a reveal's verdict line vs a choice label). */
const core = (s) => norm(s).replace(/^(?:the|it's|it is|it)\s+/, '')
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** A line clipped at a word for a log row: never past `max` characters, an ellipsis when cut. */
export function clip(text, max = 120) {
  const t = clean(text)
  if (t.length <= max) return t
  const head = t.slice(0, max + 1)
  const sp = head.lastIndexOf(' ')
  return `${head.slice(0, sp > max / 2 ? sp : max).replace(/[\s,;:.]+$/, '')}…`
}

// ── the draw ────────────────────────────────────────────────────────────────────────────────────────────────────
/** The kind of play a session item makes, or null when this game cannot play it (a walk-through, a chart drill). */
export function kindOf(item) {
  if (!item || typeof item !== 'object') return null
  const type = String(item.type || '').toLowerCase()
  const p = item.prompt_json && typeof item.prompt_json === 'object' ? item.prompt_json : {}
  const k = String(p.kind || '').toLowerCase()
  if (type === 'scenario') return k === '' || k === 'mcq' ? 'mcq' : null
  if (type !== 'recall') return null
  if (k === 'mcq' || k === 'tf' || k === 'fill') return k
  if (k === 'fill_numeric') return 'numeric'
  return null
}

/** A choice list as the screen shows it (cleaned: our name, no long dash) and, for any label the cleaning changed, the
 *  bank's own text, which is what the server compares an answer against. */
function labelsOf(xs) {
  const labels = []
  const raw = {}
  for (const x of Array.isArray(xs) ? xs : []) {
    const r = typeof x === 'string' ? x : String(x?.label ?? '')
    const l = clean(r)
    if (!l) continue
    labels.push(l)
    if (l !== r.trim()) raw[l] = r
  }
  return { labels, raw }
}
const unique = (xs) => new Set(xs.map(norm)).size === xs.length
const goodBar = (b) => !!b && ['o', 'h', 'l', 'c'].every((k) => Number.isFinite(b[k])) && b.t != null && b.t !== ''
const affix = (v) => (typeof v === 'string' && v.trim() && v.length <= 12 ? v : '')

/** The cases a run may deal, from a session payload ({session_id, items}). `normalize` turns an item's bar list into
 *  chart bars (useStudySession.normalizeBars in the product). Kept: an item this game can play, with a question; a
 *  choice item with two or more different choices (true or false is always True and False); a fill item whose sentence
 *  has its blank; a chart item only when its bars came with it (a question about "this low" cannot be asked without
 *  the chart). Each item once. */
export function casesOf(set, normalize = (bars) => bars) {
  const items = Array.isArray(set?.items) ? set.items : []
  const sessionId = set?.session_id ?? null
  const out = []
  const ids = new Set()
  for (const it of items) {
    const kind = kindOf(it)
    const id = typeof it?.id === 'string' ? it.id.trim() : ''
    if (!kind || !id || ids.has(id)) continue
    const p = it.prompt_json || {}
    const q = clean(p.q || p.question || '')
    if (!q) continue
    let choices = []
    let bankWords = {}
    if (kind === 'mcq' || kind === 'fill') {
      const got = labelsOf(kind === 'mcq' ? p.choices : p.bank)
      choices = got.labels
      bankWords = got.raw
    } else if (kind === 'tf') {
      choices = [...TF_CHOICES]
    }
    if (kind !== 'numeric' && (choices.length < 2 || !unique(choices))) continue
    const sentence = clean(p.sentence || '')
    if (kind === 'fill' && !sentence.includes('___')) continue
    const raw = Array.isArray(it.bars) ? it.bars : Array.isArray(it.bars?.bars) ? it.bars.bars : []
    const bars = raw.length ? (normalize(raw) || []) : []
    const chart = bars.length >= 2 && bars.every(goodBar)
    if (it.has_chart && !chart) continue
    ids.add(id)
    out.push({
      id, sessionId, kind, q, choices, raw: bankWords, sentence: kind === 'fill' ? sentence : '',
      story: clean(p.story || ''), prefix: affix(p.prefix), suffix: affix(p.suffix), label: clean(p.label || ''),
      bars: chart ? bars : null, chart, difficulty: Math.max(1, Math.round(Number(it.difficulty) || 1)),
    })
  }
  return out
}

/** The run's cases: easiest first, so a run climbs from recall to the harder scenarios (the unit's rungs, as the
 *  server's difficulty 1 to 3); within a difficulty the server's own order stands. At most `total`. */
export function deckOf(cases, total = HISTORY_TOTAL) {
  const list = Array.isArray(cases) ? cases.map((c, i) => [c, i]) : []
  list.sort((a, b) => (a[0].difficulty - b[0].difficulty) || (a[1] - b[1]))
  return list.slice(0, Math.max(0, total)).map(([c]) => c)
}

// ── the tiles ───────────────────────────────────────────────────────────────────────────────────────────────────
const MOD = 2147483647
/** A seed from any text (FNV-1a), in 1 .. MOD-1. */
export function hashSeed(text) {
  let h = 2166136261
  for (const ch of String(text ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return (h % (MOD - 1)) + 1
}
function rngOf(seed) {
  let s = (Math.abs(Math.floor(Number(seed) || 0)) % (MOD - 1)) + 1
  const rnd = () => { s = (s * 48271) % MOD; return s / MOD }
  rnd(); rnd(); rnd()   // the first draws from nearby seeds are nearly the same number (trueFalse.deckOf)
  return rnd
}

/** The tiles for one case, in a seeded order: the bank lists the answer first more often than not, so a fixed order
 *  would point at it. The same run seed and case give the same order (a re-render never moves a tile under a finger);
 *  True and False stay in that order; a number case has no tiles. */
export function dealChoices(c, seed) {
  if (!c || c.kind === 'numeric') return []
  if (c.kind === 'tf') return [...TF_CHOICES]
  const a = [...(c.choices || [])]
  const rnd = rngOf(hashSeed(`${seed}:${c.id}`))
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** The index of `label` among the tiles, compared the way the server compares (case and spacing aside), or -1. */
export function rightIndex(choices, label) {
  if (label == null || label === '') return -1
  const k = norm(label)
  return (choices || []).findIndex((c) => norm(c) === k)
}

// ── what the member gave ────────────────────────────────────────────────────────────────────────────────────────
/** A typed number: digits with an optional sign, a decimal point and thousands commas ("1,234.5"), a leading $ or a
 *  trailing % allowed. A comma that is not a thousands comma ("19,8") is not a number here, never a guess. */
export function parseNumber(text) {
  let t = String(text ?? '').replace(/[−–—]/g, '-').replace(/\s+/g, '')   // a typed minus, however the keyboard makes it
  t = t.replace(/^(-?)\$/, '$1').replace(/%$/, '')
  if (!/\d/.test(t) || !/^-?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/.test(t)) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** What may be typed in the number field while the member types: digits, a sign, a point, commas, $ and %. */
export const typedNumber = (text) => String(text ?? '').replace(/[^0-9.,\-%$]/g, '').slice(0, 16)

/** A number as a member reads it: thousands commas, up to six decimals, nothing padded. */
export function fmtNumber(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return ''
  return x.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

/** A number case's value with its prefix and suffix ("19.8%", "$12.50" stays as the server's number reads). */
export function numLabel(c, n) {
  const suffix = c?.suffix || ''
  return `${c?.prefix || ''}${fmtNumber(n)}${/^[A-Za-z]/.test(suffix) ? ` ${suffix}` : suffix}`
}

/** The answer posted to the server: {choice} with the tile's label in the bank's own words (a label the screen cleaned
 *  goes back as the bank wrote it, so a right pick is never scored wrong over our name or a dash), or the typed number
 *  as a number (the scorer compares 19.8 and 19.80 as one value). Null until there is something to send. */
export function answerFor(c, { pick = null, text = '', choices = [] } = {}) {
  if (!c) return null
  if (c.kind === 'numeric') { const n = parseNumber(text); return n == null ? null : { choice: n } }
  const label = pick == null ? null : choices[pick]
  if (label == null || label === '') return null
  const bank = c.raw && Object.prototype.hasOwnProperty.call(c.raw, label) ? c.raw[label] : label
  return { choice: bank }
}

/** What the member said, as words for the screen and the log. */
export function saidOf(c, { pick = null, text = '', choices = [] } = {}) {
  if (!c) return ''
  if (c.kind === 'numeric') { const n = parseNumber(text); return n == null ? clean(text) : numLabel(c, n) }
  return pick == null ? '' : choices[pick] ?? ''
}

// ── the server's reply ──────────────────────────────────────────────────────────────────────────────────────────
/** The verdict: true or false, or null when the reply carries none (then it is not scored, never read as a miss). */
export const verdictOf = (attempt) => (attempt && typeof attempt.correct === 'boolean' ? attempt.correct : null)

/** The XP one answer earned, as the server counted it. */
export const xpOf = (attempt) => { const v = Number(attempt?.progress?.xp_gained); return Number.isFinite(v) && v > 0 ? v : 0 }

const keyOf = (reveal) => {
  const a = reveal?.answer
  const k = a && typeof a === 'object' ? a.answer : a
  return k == null || k === '' ? null : k
}
const toNumber = (k) => (typeof k === 'number' ? (Number.isFinite(k) ? k : null) : parseNumber(k))

/** The right answer as the screen shows it: on a right answer, what the member said (a number case reads the server's
 *  own number, so 19.80 typed shows as 19.8%); on a miss, the reveal's key, as the matching tile's label when there is
 *  one. Null when the server did not say. */
export function truthOf(c, reveal, { said = '', correct = false, choices = [] } = {}) {
  const key = keyOf(reveal)
  if (c?.kind === 'numeric') {
    const k = key == null ? null : toNumber(key)
    if (k != null) return numLabel(c, k)
    return correct && said ? said : null
  }
  if (correct) return said || null
  if (key == null || typeof key === 'object') return null
  const label = clean(String(key))
  const i = rightIndex(choices, label)
  if (i >= 0) return choices[i]
  return c?.kind === 'tf' ? cap(label.toLowerCase()) : label
}

/** The note the case keeps for the member's own wrong pick (the reveal's `wrong`), or ''. */
export function pickNote(reveal, said) {
  const w = reveal?.wrong
  if (!w || typeof w !== 'object' || !said) return ''
  if (typeof w[said] === 'string') return clean(w[said])
  // the notes are keyed in the bank's own words; the pick is the label as the screen cleaned it
  const k = Object.keys(w).find((x) => norm(x) === norm(said) || norm(clean(x)) === norm(said))
  return k && typeof w[k] === 'string' ? clean(w[k]) : ''
}

const VERDICT_WORD = /^(?:true|false)[.!]?$/i
/** Why, in the bank's words: the reveal's `why` without the verdict it opens on when the screen already shows that
 *  answer ("19.8%. From 2,930.75 down to 2,351.10, ..." under the answer 19.8% reads "From 2,930.75 ..."). A first
 *  sentence that says anything more stays. */
export function reasonOf(reveal, truth = null) {
  const src = clean(reveal?.why || '') || clean(reveal?.lesson || '')
  if (!src) return ''
  const [one, rest] = firstSentence(src)
  if (rest && (VERDICT_WORD.test(one) || (truth != null && core(one) === core(truth)))) return cap(rest)
  return src
}

/** The mentor's line. */
export const lessonLineOf = (reveal) => clean(reveal?.lesson_line || '')

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/\S+$/i.test(u.trim()) ? u.trim() : null)

/** The sources the case rests on, each once ({name, full, url, quotes}), in the order cited. */
export function sourcesOf(reveal) {
  const list = Array.isArray(reveal?.depth?.sources) ? reveal.depth.sources : []
  const out = []
  const at = new Map()
  for (const s of list) {
    const full = clean(s?.name || '')
    if (!full) continue
    let row = at.get(full)
    if (!row) { row = { name: shortSource(full), full, url: safeUrl(s.url), quotes: [] }; at.set(full, row); out.push(row) }
    const q = clean(s.quote || '')
    if (q && !row.quotes.includes(q)) row.quotes.push(q)
  }
  return out
}

// ── dates and the chart ─────────────────────────────────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** {y, m, d} from "2009-03-09", "20090309", 20090309 or an ISO stamp; null when it is not a real calendar day. */
export function partsOf(value) {
  const s = String(value ?? '').trim()
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:$|T)/.exec(s)
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  if (mo < 1 || mo > 12 || d < 1) return null
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
  return d > days ? null : { y, m: mo, d }
}
/** "March 9, 2009". */
export const longDate = (value) => { const p = partsOf(value); return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : '' }
/** "Mar 9, 2009". */
export const shortDate = (value) => { const p = partsOf(value); return p ? `${MONTHS[p.m - 1].slice(0, 3)} ${p.d}, ${p.y}` : '' }

/** The funds a History Detective chart may show and the index each one tracks (the unit's charts are SPY or QQQ). */
export const FUNDS = Object.freeze({ SPY: 'the S&P 500', QQQ: 'the Nasdaq-100' })
/** A chart of a fund, said plainly: the fund is not the index, so a level on its axis is not the index's close. */
export function fundNote(sym) {
  const idx = FUNDS[String(sym || '').toUpperCase()]
  return idx ? `${String(sym).toUpperCase()} is a fund that tracks ${idx}. Its moves follow the index closely, not exactly.` : ''
}

/** What the reveal says about a chart case: the ticker, the chart's last day ({sym, date, short, fund}); null for a case
 *  with no chart or a reveal that names neither. */
export function chartFactsOf(c, reveal) {
  if (!c?.chart) return null
  const raw = String(reveal?.sym || reveal?.ticker || '').trim().toUpperCase()
  const sym = /^[A-Z][A-Z0-9.^-]{0,9}$/.test(raw) ? raw : ''
  const date = longDate(reveal?.asof)
  if (!sym && !date) return null
  return { sym: sym || null, date, short: shortDate(reveal?.asof), fund: sym ? fundNote(sym) : '' }
}

// ── the working (a computed answer, recomputed here and shown only when it agrees with the server's) ──────────────
const decimalsOf = (x) => {
  const s = String(x)
  if (/e/i.test(s)) return 6
  const frac = s.split('.')[1]
  return frac ? Math.min(6, frac.length) : 0
}
/** An index level as the course quotes it: two decimals when it has any ("2,351.10"). */
const level = (x) => (Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }))
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The calculations a history case may carry (scripts/study/courses_lib CALCS, the same formulas), each a percent. */
export const WORKINGS = Object.freeze({
  drawdown_pct: {
    value: ({ peak, trough }) => (num(peak) && num(trough) != null ? ((peak - trough) / peak) * 100 : null),
    label: () => 'The fall', formula: '(peak − low) ÷ peak',
    filled: ({ peak, trough }) => `(${level(peak)} − ${level(trough)}) ÷ ${level(peak)}`,
  },
  pct_change: {
    value: ({ start, end }) => (num(start) && num(end) != null ? ((end - start) / start) * 100 : null),
    label: (r) => (r >= 0 ? 'The gain' : 'The change'), formula: '(end − start) ÷ start',
    filled: ({ start, end }) => `(${level(end)} − ${level(start)}) ÷ ${level(start)}`,
  },
  gain_to_recover: {
    value: ({ loss_pct: loss }) => (num(loss) != null && loss < 100 ? (1 / (1 - loss / 100) - 1) * 100 : null),
    label: () => 'The gain back to even', formula: '1 ÷ (1 − the loss) − 1',
    filled: ({ loss_pct: loss }) => `1 ÷ (1 − ${fmtNumber(loss)}%) − 1`,
  },
})

/** The working for a computed answer ({label, formula, filled, result, text}), from the reveal's `facts.calc`. It is
 *  recomputed here from the same inputs and shown only when it rounds to the server's own result (to the decimals that
 *  result carries); an unknown calculation, or one that disagrees, shows nothing rather than a wrong line. */
export function workingOf(reveal) {
  const calc = reveal?.facts?.calc
  if (!calc || typeof calc !== 'object') return null
  const w = WORKINGS[calc.fn]
  const result = Number(calc.result)
  const args = calc.args && typeof calc.args === 'object' ? calc.args : {}
  if (!w || calc.result == null || !Number.isFinite(result)) return null
  const raw = w.value(args)
  if (raw == null || !Number.isFinite(raw)) return null
  const d = decimalsOf(result)
  if (Math.abs(raw - result) > 0.5 * 10 ** -d + 1e-9) return null
  const label = w.label(result)
  const filled = w.filled(args)
  const shown = `${result.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`
  return { label, formula: w.formula, filled, result: shown, text: `${label} = ${w.formula} = ${filled} = ${shown}` }
}

// ── the screen's words ──────────────────────────────────────────────────────────────────────────────────────────
/** The case's kind, as its eyebrow names it. */
export function kindWord(c) {
  if (!c) return ''
  if (c.story) return 'Scenario'
  if (c.chart && c.kind !== 'fill') return 'Read the chart'
  return { tf: 'True or false', fill: 'Fill the blank', numeric: 'Do the math', mcq: 'Recall' }[c.kind] || 'Recall'
}

const ASK = { mcq: 'Pick the answer.', tf: 'True or false?', fill: 'Which word fills the blank?', numeric: 'Work it out.' }
/** Where the case's words go: `big` is the hero card's text when there is no chart (the question, or a fill's
 *  sentence), `story` the case notes, `question` the line over the answers (the question itself under a chart or a
 *  fill sentence, else a short ask so the question is never printed twice). */
export function caseText(c) {
  if (!c) return { big: '', story: '', question: '' }
  if (c.kind === 'fill') return { big: c.sentence, story: c.story, question: c.q }
  if (c.chart) return { big: '', story: c.story, question: c.q }
  return { big: c.q, story: c.story, question: ASK[c.kind] || ASK.mcq }
}

/** The help line under the question; on a phone only a number case needs one. */
export function detailOf(c, phone = false) {
  if (!c) return ''
  if (c.kind === 'numeric') return phone ? 'Type the number, then Check.' : 'Type the number, then press Enter or Check.'
  if (phone) return ''
  return c.kind === 'fill' ? 'Pick the word, or press its number. Enter checks.' : 'Pick one, or press its number. Enter checks.'
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Hearts left after these results (a miss costs one). */
export function heartsLeft(results, hearts = HISTORY_HEARTS) {
  const misses = (Array.isArray(results) ? results : []).filter((r) => r === false).length
  return Math.max(0, hearts - misses)
}
/** The run ends when the hearts are gone or every case is answered. */
export const runOver = (results, total, hearts = HISTORY_HEARTS) => heartsLeft(results, hearts) === 0 || (results?.length || 0) >= total
export const heartsLine = (left) => (left <= 0 ? 'Out of hearts' : `${left} heart${left === 1 ? '' : 's'} left`)

/** One answered case, as the run keeps it. */
export function rowOf(c, { ok, said = '', truth = null, reveal = null, xp = 0 } = {}) {
  const facts = chartFactsOf(c, reveal)
  const src = sourcesOf(reveal)[0] || null
  return {
    id: c?.id || '', ok: !!ok, xp: Number(xp) || 0, name: clip(c?.kind === 'fill' ? c.sentence : c?.q || ''),
    said: said || '', truth: truth || '', chart: facts ? [facts.sym, facts.short].filter(Boolean).join(' · ') : '',
    line: lessonLineOf(reveal), source: src ? { name: src.name, full: src.full, url: src.url } : null,
  }
}

/** The run after one case: its result, its row, the XP the server granted. */
export function addCase(run, row) {
  const r = run || { results: [], log: [], xp: 0 }
  return { ...r, results: [...r.results, !!row.ok], log: [...r.log, row], xp: r.xp + (Number(row.xp) || 0) }
}

export const solvedOf = (results) => (Array.isArray(results) ? results.filter((r) => r === true).length : 0)

/** The end screen's title: a detective's rank for the share solved. */
export function rankOf(right, total) {
  if (!total) return 'No cases solved'
  if (right === total) return 'Chief Detective'
  const r = right / total
  if (r >= 0.75) return 'Senior Detective'
  if (r >= 0.5) return 'Detective'
  return 'Junior Detective'
}

/** The best run on this device after this one. */
export const bestAfter = (prev, right) => Math.max(Number(prev) || 0, Number(right) || 0)

/** The end screen's best line: a new best, the standing best, or nothing at all before any case is solved (never
 *  "your best run stands at 0"). `before` is the best when this run started. */
export function bestLine(right, before) {
  const r = Number(right) || 0
  const b = Number(before) || 0
  if (r > 0 && r > b) return { fresh: true, n: r }
  return b > 0 ? { fresh: false, n: b } : null
}
