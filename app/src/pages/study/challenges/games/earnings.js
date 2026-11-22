// EARNINGS DESK (docs/study/GAMES.md §3, kind 'earnings'): the pure half of the game. Real quarters from course unit
// F5.08, "Earnings Desk: real quarters" (POST /api/study/sessions {kind: 'skill', skill_id: 'fund.earnings_desk'}): beat,
// miss or in line, the surprise in percent, the guide, and what the stock did. Each item is scored on the server
// (POST /api/study/attempts), which keeps the key until the member has answered and grants the XP, so this game never
// posts a game run. Nothing here knows an answer before the server says it, and nothing here writes a market fact: this
// module shapes the draw into reports, reads the company and the quarter off the front of the bank's own question (so the
// card can carry them as its masthead), deals the tiles from a seed, reads what the member typed, keeps the hearts, and
// reads the server's reveal into the desk note: why, the working (recomputed here and shown only when it agrees with the
// server's own result), and the sentences of the reveal that say what the stock did, word for word.
// No clock reads, no Math.random.
//
// What an F5.08 item carries (scripts/study/courses_lib.build_items): type 'recall' with prompt_json.kind 'mcq' | 'tf' |
// 'fill' | 'fill_numeric' (a number, with its `prefix` "$" or `suffix` "%" / "million"), or type 'scenario' (kind 'mcq'
// with a `story`). After the attempt the reveal holds `why` (it opens on the verdict: "A beat. $3.53 is well above ...",
// and a report's ends on how the stock reacted: "Shares plunged nearly 20% the next day."), `lesson_line`, `wrong` (a note
// for each wrong choice), `facts.calc` (a computed answer's function, inputs and result), and `depth.sources` (each cited
// page: {name: "<publisher>: <title>", url, quote}).
import { clean } from './trueFalse'
import {
  TF_CHOICES, addCase, bestLine, casesOf, clip, deckOf as historyDeck, detailOf, fmtNumber, heartsLeft as historyHearts,
  lessonLineOf, parseNumber, saidOf as historySaid, solvedOf, sourcesOf, truthOf as historyTruth,
} from './history'

export { TF_CHOICES, addCase, bestLine, clip, detailOf, fmtNumber, lessonLineOf, parseNumber, solvedOf, sourcesOf }
export { answerFor, dealChoices, pickNote, rightIndex, typedNumber, verdictOf, xpOf } from './history'

export const EARNINGS_KIND = 'earnings'
export const EARNINGS_SKILL = 'fund.earnings_desk'
export const EARNINGS_UNIT = 'F5.08'
/** The reports a run deals (the session asks for this many). */
export const EARNINGS_TOTAL = 8
export const EARNINGS_HEARTS = 3
/** Fewer usable reports than this and the game shows its honest empty state instead of a thin run. */
export const EARNINGS_MIN = 3
export const EARNINGS_BEST_KEY = 'study.earnings.best'
export const EARNINGS_POOL_TIMEOUT_MS = 15000
export const EARNINGS_ATTEMPT_TIMEOUT_MS = 10000
/** The longest line of what the stock did that the verdict takeover carries (it cannot scroll on a small phone); the
 *  whole of it is always in the desk note. */
export const TAKEOVER_STOCK_MAX = 180

export const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
/** A draw with a report or two but fewer than a run needs: said as it is, never "no questions" when there are some. */
export const thinLine = (n) => `Only ${n} ${n === 1 ? 'report is' : 'reports are'} approved so far, too few for a run. More arrive as the courses are approved.`
export const FAILED_LINE = 'We could not check that answer, so it does not count yet. Press Check to send it again.'
export const SIGNED_OUT_LINE = 'You are signed out, so that answer was not checked. Sign in, then press Check again.'
export const NUMBER_HINT = 'Type a number, like 12.5'

/** The session the game asks for: the approved items of the unit's one skill. */
export const sessionBody = (size = EARNINGS_TOTAL) => ({ kind: 'skill', skill_id: EARNINGS_SKILL, size })

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').toLowerCase()
/** The same words, whether or not they open on "The", "It's" or "It" (a reveal's verdict line vs a choice label). */
const core = (s) => norm(s).replace(/^(?:the|it's|it is|it)\s+/, '')
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// a stop ends a sentence when a space and a new sentence follow it: a capital, or (unlike ui/lesson.firstSentence, which
// waits for a capital) a dollar figure or a number, because an earnings reveal opens sentences on them ("A beat. $3.53 is
// well above ...", "$3.00. $1.76 plus $1.24."); an abbreviation's stop ("vs.", "Inc.", "U.S.") never ends one
const STOP = /[.!?]["”’')]*(?=\s+["“‘'(]?[A-Z$0-9])/g
const ABBR = /(?:^|[\s(])(?:vs|etc|approx|Inc|Corp|Co|Ltd|No|Mr|Ms|Mrs|Dr|St|Jr|Sr|e\.g|i\.e|U\.S|a\.m|p\.m)\.$/

/** The sentences of a passage, each in the bank's own words (a stop inside a number, "$3.53", never ends one; a
 *  semicolon never splits one, so "Nike plunged nearly 20%; Alphabet rose 10%" stays one line). */
export function sentencesIn(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  const out = []
  let start = 0
  for (const m of t.matchAll(STOP)) {
    if (ABBR.test(t.slice(start, m.index + 1))) continue
    const end = m.index + m[0].length
    out.push(t.slice(start, end).trim())
    start = end
  }
  const tail = t.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

// ── the masthead: the company and the quarter, read off the front of the bank's own words ─────────────────────────
const ORD = '(?:[Ff]irst|[Ss]econd|[Tt]hird|[Ff]ourth)'
const YEAR = '(?:19|20)\\d{2}'
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)'
const PERIOD = `(?:${ORD}[- ][Qq]uarter(?: of)?(?: [Ff]iscal)? ${YEAR}`
  + `|(?:[Ff]iscal )?Q[1-4] (?:of )?(?:[Ff]iscal )?${YEAR}`
  + `|(?:[Ff]iscal|[Ff]ull[- ]year) ${YEAR}`
  + `|${MONTH} ${YEAR})`
const WORD = "[A-Z][A-Za-z0-9&.'’-]*"
const NAME = `${WORD}(?: (?:of|and|&|${WORD})){0,3}`
/** "Netflix, first quarter 2022: EPS of $3.53. ..." / "Walmart, May 2022. New full-year guide: ..." */
const LEAD = new RegExp(`^(${NAME}), (${PERIOD})[:.]\\s+(\\S[\\s\\S]*)$`)
/** "Meta's Q4 2022 EPS was $1.76. ..." / "Nike's fiscal Q4 2024 release says ..." */
const POSS = new RegExp(`^(${NAME}?)['’]s (${PERIOD})\\b`)
const NAME_ONLY = new RegExp(`^${NAME}$`)
/** A sentence that opens on one of these is not a company's name ("Two EPS beats.", "When a company ..."). */
const NOT_A_NAME = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'for', 'by', 'to', 'two', 'three', 'four', 'one', 'both', 'each', 'every',
  'when', 'if', 'which', 'what', 'how', 'why', 'your', 'you', 'we', 'our', 'this', 'that', 'these', 'those', 'it', 'its', 'after',
  'before', 'since', 'during', 'analysts', 'tap', 'pick', 'true', 'false', 'yes', 'no', 'shares', 'stocks', 'revenue', 'sales', 'eps',
  'earnings', 'guidance', 'profit', 'consensus'])
const named = (co) => !!co && NAME_ONLY.test(co) && !NOT_A_NAME.has(co.split(' ')[0].toLowerCase())

/** The company and the quarter a question or story opens on ({company, period, rest}), or null when it opens on
 *  neither (a desk rule, two companies at once). `rest` is the text after "Company, quarter:" when the masthead can
 *  carry that opening on its own; it is the whole text when the name and the quarter sit inside the sentence ("Meta's
 *  Q4 2022 EPS was $1.76."), so a sentence is never cut. The words are the bank's own; the quarter's first letter is
 *  raised for the masthead. */
export function headOf(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const lead = LEAD.exec(t)
  if (lead && named(lead[1])) return { company: lead[1], period: cap(lead[2]), rest: cap(lead[3].trim()) }
  const poss = POSS.exec(t)
  if (poss && named(poss[1])) return { company: poss[1], period: cap(poss[2]), rest: t }
  return null
}

// ── the draw ────────────────────────────────────────────────────────────────────────────────────────────────────
/** The reports a run may deal, from a session payload ({session_id, items}): History Detective's reading of the same
 *  course items (history.casesOf: a playable kind, a question, two or more different choices, a fill sentence with its
 *  blank, each item once), less any item with a chart (this desk has no chart to show it on), each with its masthead
 *  read off the front of its story, else its question. */
export function reportsOf(set, normalize = (bars) => bars) {
  return casesOf(set, normalize).filter((c) => !c.chart).map((c) => {
    const from = c.story ? 'story' : c.kind === 'fill' ? null : 'q'
    const head = from ? headOf(c[from]) : null
    return {
      ...c, bars: null, chart: false,
      company: head?.company || '', period: head?.period || '',
      // the card's own words: the opening the masthead now carries is not printed twice
      cardStory: from === 'story' && head ? head.rest : c.story,
      cardQ: from === 'q' && head ? head.rest : c.q,
    }
  })
}

/** The run's reports: easiest first (the unit's rungs, as the server's difficulty 1 to 3), so a run climbs from beat or
 *  miss to the surprise in percent to reading the whole report. At most `total`. */
export const deckOf = (reports, total = EARNINGS_TOTAL) => historyDeck(reports, total)

// ── the screen's words ──────────────────────────────────────────────────────────────────────────────────────────
const BEAT_WORDS = /\b(?:beat|beats|miss|missed|in line)\b/i
/** The report's kind, as its eyebrow names it and the end screen groups it. */
export function kindWord(c) {
  if (!c) return ''
  if (c.story) return 'Read the report'
  if (c.kind === 'numeric') return 'Do the math'
  if (c.kind === 'tf') return 'True or false'
  if (c.kind === 'fill') return 'Fill the blank'
  return (c.choices || []).some((x) => BEAT_WORDS.test(x)) ? 'Beat or miss' : 'Make the call'
}

const ASK = { mcq: 'Make the call.', tf: 'True or false?', numeric: 'Work it out.' }
/** Where the report's words go: `story` the report on the card, `big` the card's question (or a fill's sentence), and
 *  `question` the line over the answers (a short ask, so the question is never printed twice; a fill keeps its own). */
export function cardText(c) {
  if (!c) return { story: '', big: '', question: '' }
  if (c.kind === 'fill') return { story: c.cardStory || '', big: c.sentence, question: c.q }
  return { story: c.cardStory || '', big: c.cardQ || c.q, question: ASK[c.kind] || ASK.mcq }
}

/** The masthead as one line ("Netflix · First quarter 2022"), or ''. */
export const deskLine = (c) => (c?.company ? [c.company, c.period].filter(Boolean).join(' · ') : '')

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** How many decimals a number is written with (3 → 0, 25.2 → 1, 0.125 → 3; at most 6). */
export function decimalsOf(x) {
  const s = String(x)
  if (/e/i.test(s)) return 6
  const frac = s.split('.')[1]
  return frac ? Math.min(6, frac.length) : 0
}
const isMoney = (c) => (c?.prefix || '') === '$'

/** A number case's value with its prefix and suffix, the way a desk writes it: money to the cent at least ("$3.00",
 *  "$1.765"), "25.2%", "2.7 million". */
export function numLabel(c, n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return ''
  const body = isMoney(c)
    ? Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, decimalsOf(Math.abs(x))) })
    : fmtNumber(Math.abs(x))
  const suffix = c?.suffix || ''
  return `${x < 0 ? '−' : ''}${c?.prefix || ''}${body}${/^[A-Za-z]/.test(suffix) ? ` ${suffix}` : suffix}`
}

/** What the member said, as words for the screen and the log. */
export function saidOf(c, given = {}) {
  if (c?.kind !== 'numeric') return historySaid(c, given)
  const n = parseNumber(given.text)
  return n == null ? clean(given.text) : numLabel(c, n)
}

const keyOf = (reveal) => {
  const a = reveal?.answer
  const k = a && typeof a === 'object' ? a.answer : a
  return k == null || k === '' ? null : k
}
const toNumber = (k) => (typeof k === 'number' ? (Number.isFinite(k) ? k : null) : parseNumber(k))

/** The right answer as the screen shows it: a number case reads the server's own number in the desk's way ("$3.00"); a
 *  tile reads as its label (history.truthOf). Null when the server did not say. */
export function truthOf(c, reveal, given = {}) {
  if (c?.kind !== 'numeric') return historyTruth(c, reveal, given)
  const k = toNumber(keyOf(reveal))
  if (k != null) return numLabel(c, k)
  return given.correct && given.said ? given.said : null
}

const DECIMAL_WORDS = ['a whole number', 'one decimal', 'two decimals', 'three decimals']
/** Half away from zero, to `d` decimals, past a float's own error (25.15 rounds to 25.2, never 25.1). */
export const roundTo = (x, d) => (Math.sign(x) * Math.round(Math.abs(x) * 10 ** d + 1e-9)) / 10 ** d

/** What a typed number missed by, when it is a near thing worth naming: the right size with the sign flipped, or the
 *  right number written to more decimals than the answer is given to (the server scores the value as typed). '' for
 *  anything else; a plain miss is taught by the working. */
export function nearNote(c, text, reveal) {
  if (c?.kind !== 'numeric') return ''
  const typed = parseNumber(text)
  const key = toNumber(keyOf(reveal))
  if (typed == null || key == null || typed === key) return ''
  if (key !== 0 && Math.abs(typed + key) < 1e-9) return `Right size, wrong sign. The answer is ${numLabel(c, key)}.`
  const d = isMoney(c) ? Math.max(2, decimalsOf(key)) : decimalsOf(key)
  if (d < 1 || decimalsOf(typed) <= d || Math.abs(roundTo(typed, d) - key) > 1e-9) return ''
  return `Close. ${numLabel(c, typed)} rounds to ${numLabel(c, key)}, and the answer is given to ${DECIMAL_WORDS[d] || `${d} decimals`}.`
}

// ── the working: a computed answer, recomputed here from the reveal's own inputs ────────────────────────────────────
/** A small arithmetic reader for the bank's `arith` expressions ("(consensus - actual) / consensus * 100"): numbers,
 *  names, + - * / and brackets. Never `eval`. Returns the tokens, or null when the expression holds anything else. */
export function tokensOf(expr) {
  const src = String(expr ?? '')
  const out = []
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/()]))/y
  let at = 0
  while (at < src.length) {
    if (/^\s*$/.test(src.slice(at))) break
    re.lastIndex = at
    const m = re.exec(src)
    if (!m) return null
    if (m[1] != null) out.push({ t: 'num', v: Number(m[1]), s: m[1] })
    else if (m[2] != null) out.push({ t: 'name', v: m[2] })
    else out.push({ t: 'op', v: m[3] })
    at = re.lastIndex
  }
  return out.length ? out : null
}

/** The value of an expression over named values, or null when it cannot be read, names a value it was not given,
 *  divides by zero, or is not a finite number. */
export function evalExpr(expr, vars = {}) {
  const toks = tokensOf(expr)
  if (!toks) return null
  let i = 0
  const peek = () => toks[i]
  const isOp = (v) => peek()?.t === 'op' && peek().v === v
  function factor() {
    const tk = peek()
    if (!tk) throw new Error('end')
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) { i += 1; const v = factor(); return tk.v === '-' ? -v : v }
    if (tk.t === 'op' && tk.v === '(') { i += 1; const v = sum(); if (!isOp(')')) throw new Error('bracket'); i += 1; return v }
    if (tk.t === 'num') { i += 1; return tk.v }
    if (tk.t === 'name') {
      i += 1
      const v = vars[tk.v]
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('name')
      return v
    }
    throw new Error('token')
  }
  function product() {
    let v = factor()
    while (isOp('*') || isOp('/')) {
      const op = peek().v; i += 1
      const r = factor()
      if (op === '/' && r === 0) throw new Error('zero')
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function sum() {
    let v = product()
    while (isOp('+') || isOp('-')) { const op = peek().v; i += 1; const r = product(); v = op === '+' ? v + r : v - r }
    return v
  }
  try {
    const v = sum()
    return i === toks.length && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

const SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷' }
/** An expression as a member reads it: × and ÷ for * and /, a real minus sign, and each name either as words
 *  ("loss_pct" reads "loss pct") or, with `vars`, as its value ("1,234.5"). */
export function exprText(expr, vars = null) {
  const toks = tokensOf(expr) || []
  let out = ''
  toks.forEach((tk, k) => {
    const prev = toks[k - 1]
    if (tk.t === 'op' && SYMBOL[tk.v]) {
      const unary = !prev || (prev.t === 'op' && prev.v !== ')')
      out += unary ? SYMBOL[tk.v] : ` ${SYMBOL[tk.v]} `
    } else if (tk.t === 'op') {
      out += tk.v
    } else if (tk.t === 'num') {
      out += fmtNumber(tk.v)
    } else {
      out += vars ? fmtNumber(vars[tk.v]) : tk.v.replace(/_/g, ' ')
    }
  })
  return out
}

/** The calculations a report may carry (scripts/study/courses_lib CALCS, the same formulas), as expressions over the
 *  calc's own argument names, and whether the result is a percent. `yoy_growth` divides by the prior's size, so it is
 *  shown only for a positive prior, where that is the prior itself. */
export const FORMULAS = Object.freeze({
  pct_change: { expr: () => '(end - start) / start * 100', pct: true },
  yoy_growth: { expr: (a) => (typeof a.prior === 'number' && a.prior > 0 ? '(current - prior) / prior * 100' : null), pct: true },
  pe: { expr: () => 'price / eps', pct: false },
  arith: { expr: (a) => (typeof a.expr === 'string' ? a.expr : null), pct: false },
})

/** The working for a computed answer ({formula, filled, result, text}) from the reveal's `facts.calc`: the formula in
 *  words, the same with the numbers in, and the result. It is recomputed here from the same inputs and shown only when
 *  it rounds to the server's own result (to the decimals that result carries); an unknown calculation, or one that
 *  disagrees, shows nothing rather than a wrong line. The result reads as the number case's answer reads ("12.2%",
 *  "$3.00"); for a choice, as a plain number (a percent calculation keeps its %). */
export function workingOf(reveal, c = null) {
  const calc = reveal?.facts?.calc
  if (!calc || typeof calc !== 'object') return null
  const f = FORMULAS[calc.fn]
  const args = calc.args && typeof calc.args === 'object' ? calc.args : {}
  const result = Number(calc.result)
  if (!f || calc.result == null || calc.result === '' || !Number.isFinite(result)) return null
  const expr = f.expr(args)
  if (!expr) return null
  const raw = evalExpr(expr, args)
  if (raw == null) return null
  const d = decimalsOf(result)
  if (Math.abs(raw - result) > 0.5 * 10 ** -d + 1e-9) return null
  const formula = exprText(expr)
  const filled = exprText(expr, args)
  const shown = c?.kind === 'numeric' ? numLabel(c, result) : `${result < 0 ? '−' : ''}${fmtNumber(Math.abs(result))}${f.pct ? '%' : ''}`
  return { formula, filled, result: shown, text: `${formula} = ${filled} = ${shown}` }
}

// ── the reveal, as the desk note reads it ─────────────────────────────────────────────────────────────────────────
const VERDICT_WORD = /^(?:true|false)[.!]?$/i
/** Why, in the bank's words, without the verdict it opens on when the screen already shows that answer: "A beat." over
 *  the answer A beat, "25.2%." over 25.2%, and "Nike's." over Nike's: a revenue miss and a cut guide (the answer's own
 *  opening). A first sentence that says anything more stays. */
export function reasonOf(reveal, truth = null) {
  const src = clean(reveal?.why || '') || clean(reveal?.lesson || '')
  if (!src) return ''
  const [one, ...more] = sentencesIn(src)
  const rest = more.join(' ')
  if (!rest) return src
  const a = core(one)
  const t = truth == null ? null : core(truth)
  const opensTruth = t != null && a !== '' && (a === t || (t.startsWith(a) && /^[:,]/.test(t.slice(a.length))))
  return VERDICT_WORD.test(one) || opensTruth ? cap(rest) : src
}

// what a stock did, in a sentence: a move and a percent, said of the shares, on a day, or of a name with no company
// number in the sentence ("Revenue grew 15%" and "sales fell" are the report, not the reaction)
const MOVE = /\b(?:rose|rallied|rally|jumped|soared|surged|climbed|gained|popped|spiked|fell|plunged|plummeted|tumbled|sank|slid|slumped|dropped|sold off|closed (?:up|down)|traded (?:up|down))\b/i
const PCT = /\d(?:[\d,]*)(?:\.\d+)?\s?%/
const STOCK = /\b(?:shares?|stocks?)\b/i
const DAY = /\b(?:the next day|that day|in one day|on the day|the day after|after hours|after-hours)\b/i
const BOOKS = /\b(?:revenue|revenues|sales|eps|earnings|profits?|margins?|members|subscribers|users|customers|guidance|guide|outlook|forecasts?|estimates?|consensus|dividends?|buybacks?|costs?|expenses?|spending|prices?|inflation|growth|income|cash|orders|deliveries|bookings|backlog|wages)\b/i

/** True when a sentence says what a stock did: a move with its percent, of the shares, on a day, or with no company
 *  number named beside it. Kept tight on purpose: a sentence it passes over still reads in Why. */
export function isReaction(sentence) {
  const s = String(sentence ?? '')
  if (!PCT.test(s) || !MOVE.test(s)) return false
  return STOCK.test(s) || DAY.test(s) || !BOOKS.test(s)
}

/** The reveal's why as the desk note lays it out: `print` (the numbers and the reasons) and `stock` (the sentences that
 *  say what the stock did). The stock's sentences are lifted out only when the why ends on them, so every sentence keeps
 *  its order and its words; a why that only says what the stock did is all `stock`. */
export function splitWhy(reveal, truth = null) {
  const all = sentencesIn(reasonOf(reveal, truth))
  let k = all.length
  while (k > 0 && isReaction(all[k - 1])) k -= 1
  return { print: all.slice(0, k), stock: all.slice(k) }
}

/** The stock's line for the verdict takeover: all of what the stock did when it fits, else its first sentence when that
 *  fits, else '' (the desk note always carries the whole). */
export function stockLine(stock, max = TAKEOVER_STOCK_MAX) {
  const list = Array.isArray(stock) ? stock : []
  const all = list.join(' ')
  if (all && all.length <= max) return all
  return list[0] && list[0].length <= max ? list[0] : ''
}

/** The teaching line a miss holds the screen with (it cannot scroll): the near thing a typed number missed by, else the
 *  note for the member's own pick, else the working, else why. */
export function teachOf({ near = '', mine = '', working = null, print = [] } = {}) {
  return near || mine || working?.text || (Array.isArray(print) ? print.join(' ') : '')
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Hearts left after these results (a miss costs one). */
export const heartsLeft = (results, hearts = EARNINGS_HEARTS) => historyHearts(results, hearts)
/** The run ends when the hearts are gone or every report is answered. */
export const runOver = (results, total, hearts = EARNINGS_HEARTS) => heartsLeft(results, hearts) === 0 || (results?.length || 0) >= total
export const heartsLine = (left) => (left <= 0 ? 'Out of hearts' : `${left} heart${left === 1 ? '' : 's'} left`)

/** One answered report, as the run keeps it: the masthead (or the question) as its name, the question under a masthead,
 *  the answer, what was said, the first line of what the stock did, the lesson line and the first source. */
export function rowOf(c, { ok, said = '', truth = null, reveal = null, xp = 0 } = {}) {
  const desk = deskLine(c)
  const words = c?.kind === 'fill' ? c?.sentence : c?.q
  const { stock } = splitWhy(reveal, truth)
  const src = sourcesOf(reveal)[0] || null
  return {
    id: c?.id || '', ok: !!ok, xp: Number(xp) || 0, kind: kindWord(c),
    name: desk || clip(words || ''), ask: desk ? clip(c?.story ? c?.q : c?.cardQ || words || '') : '',
    said: said || '', truth: truth || '', stock: stock.length ? clip(stock.join(' '), 200) : '',
    line: lessonLineOf(reveal), source: src ? { name: src.name, full: src.full, url: src.url } : null,
  }
}

/** The end screen's title: a desk's rank for the share called right. */
export function rankOf(right, total) {
  if (!total) return 'No calls yet'
  if (right === total) return 'Head of the desk'
  const r = right / total
  if (r >= 0.75) return 'Senior analyst'
  if (r >= 0.5) return 'Analyst'
  return 'Junior analyst'
}

/** The kind of report to work on next: of the kinds missed in this run, the one with the lowest share right (then the
 *  most misses, then the first met). {word, ok, n} or null when nothing was missed. */
export function weakestOf(log) {
  const at = new Map()
  for (const r of Array.isArray(log) ? log : []) {
    const k = r?.kind || ''
    if (!k) continue
    const g = at.get(k) || { word: k, ok: 0, n: 0 }
    g.n += 1
    if (r.ok) g.ok += 1
    at.set(k, g)
  }
  let best = null
  for (const g of at.values()) {
    if (g.ok === g.n) continue
    if (!best) { best = g; continue }
    const a = g.ok / g.n, b = best.ok / best.n
    if (a < b || (a === b && g.n - g.ok > best.n - best.ok)) best = g
  }
  return best ? { ...best } : null
}
/** That kind, as the end screen says it. */
export const weakLine = (w) => (w ? `Work on next: ${w.word}. ${w.ok} of ${w.n} right this run.` : '')
