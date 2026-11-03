// ── UCT Agent OPEN QUESTION (Wave 2 W2-A1; live findings LT-5 / LT-6, 2026-11-03) ─────────────────────────────
//
// When UCT asks the member something ("Which chart?", "What price level — open, close, high or low?") the
// question stays OPEN until the member answers it, sets it aside, or starts something else. Live, a new
// request typed while a question was open was merged into the old one ("trendline on nvda from 2031-01-01
// to today" was answered about the earlier October lows), and "the close" after an AVWAP question was
// read as a dated-close query. This module reads ONE message against the open question and says which
// case it is, so the panel and the model agree:
//
//   answer   the message is one of the offered choices (its label, its number, an ordinal), or a short
//            reply with no request shape in it ("the close", "150", "the left one", "weekly", "both")
//   new      the message reads as a NEW request (a request verb + object, a question, a different ticker,
//            a date range, a long sentence) — the question is CLOSED and the message starts fresh
//   cancel   "never mind" / "forget it" / "skip it" — the question is closed, nothing runs
//
// The reading is deterministic and conservative: an exact choice always binds; anything that LOOKS like a
// request never binds. The model is told the case (<open_question status="…">), never left to guess.
//
// FOLLOW-UP REFERENTS ("that alert", "the other one", "those") are read here too, against what the
// conversation itself did or showed (session memory) and the live board — a reading is handed to the model
// as `conversation_memory.referents`; when nothing fits, or several things do, the deterministic path says
// so or asks, and never picks one.

import { getCapability, getTargetKind } from './capabilities'

/** A question is open for this long after it was asked (the same window as a proposal). */
export const QUESTION_TTL_MS = 10 * 60 * 1000

const ORDINAL = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, sixth: 6, '6th': 6 }

const CANCEL = /^(?:never ?mind|nvm|forget (?:it|that)|skip (?:it|that)|drop (?:it|that)|leave it|scratch that|cancel(?: that| it)?|no thanks|nothing|stop)[.!]*$/i
// exact control words keep their meaning whatever is open: Undo and approvals are never an answer
const CONTROL = /^(?:undo(?: that| it| all of that)?|do it|apply it|go ahead|confirm|yes do it|yes,? do it)[.!]*$/i
// a message that opens with a request verb (after any lead-in) — the shape of a new instruction
const LEAD = /^(?:(?:actually|ok|okay|now|and|also|then|so|alright|all right|hmm|wait|oh|hey|please|pls|can you|could you|would you|let'?s|just)[,!.]?\s+)+/i
const REQUEST_VERB = /^(?:add|remove|delete|draw|put|place|open|show|pull up|bring up|load|switch|change|set|make|turn|hide|unhide|find|scan|screen|look up|look for|search|save|create|build|rename|move|resize|compare|sort|filter|refine|run|give me|get me|get|mark|alert|pause|resume|clear|undo|redo|copy|apply|explain|tell me|list|what|what's|whats|why|how|when|where|which|who|is|are|does|do|can|could|should|will|would|sell|buy|trade|go to|zoom|replay|exit|close|export|share|reset|refresh|send|email|print)\b/i
// a request-shaped noun phrase: "trendline on nvda from …", "avwap from last saturday", "a 20 ema on it"
const OBJECT_PHRASE = /^(?:an? |the |my )?(?:\d{1,4}[- ]?)?(?:trend ?line|trendline|ray|horizontal (?:line|ray)|line|avwap|vwap|ema|sma|wma|hma|rsi|macd|bollinger|bands|fib|fibonacci|chart|charts|alert|alerts|watchlist|list|layout|screen|scan|scanner|indicator|indicators|drawing|drawings|note|level|levels|quote|profile|earnings|news|headlines)s?\b.*\b(?:on|from|for|to|at|of|in|with|about|called|named)\b/i
const QUESTION_SHAPE = /\?\s*$/
const DATE_RANGE = /\b\d{4}-\d{2}-\d{2}\b|\bfrom\b.+\bto\b/i
const TICKER = /\b[A-Z]{1,5}(?:\.[A-Z])?\b/g
const SHORT_WORDS = 12

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const lower = (s) => tidy(s).toLowerCase().replace(/[.!?]+$/, '').trim()

/** The choices of a question, as [{ label, ref }] (strings and objects alike; nothing else). */
export function questionChoices(q) {
  const raw = Array.isArray(q?.choices) ? q.choices : []
  return raw.map(c => (typeof c === 'string' ? { label: c, ref: null } : (c && typeof c.label === 'string' ? { label: c.label, ref: typeof c.ref === 'string' ? c.ref : null, cancel: !!c.cancel } : null))).filter(Boolean)
}

/** The choice a message picks: its exact label (case-insensitive, trailing punctuation ignored), its 1-based
 *  number, an ordinal ("the second one"), or the ONLY choice whose label starts with / contains the whole
 *  message as a word ("close" → "Close (last price)"). null when none, or more than one, fits. */
export function matchChoice(text, choices) {
  const t = lower(text)
  const list = questionChoices({ choices })
  if (!t || !list.length) return null
  const exact = list.map((c, i) => ({ ...c, index: i })).filter(c => lower(c.label) === t)
  if (exact.length === 1) return exact[0]
  const m = /^(?:the\s+)?(\d{1,2}|first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th)(?:\s+(?:one|option|choice))?$/.exec(t)
  if (m) {
    const n = Number(m[1]) || ORDINAL[m[1]]
    if (n >= 1 && n <= list.length) return { ...list[n - 1], index: n - 1 }
    return null
  }
  const core = t.replace(/^(?:the|a|an|my)\s+/, '').replace(/\s+(?:one|please|pls)$/, '')
  if (core.length < 2) return null
  const wordy = list.map((c, i) => ({ ...c, index: i })).filter(c => new RegExp(`(?:^|\\b)${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|$)`, 'i').test(c.label))
  return wordy.length === 1 ? wordy[0] : null
}

/** How one message reads against the open question → { kind: 'answer' | 'new' | 'cancel', choice, why }.
 *  `question` = { text, choices, asked, at }; `pendingProposal` = a proposal card is waiting too (approval
 *  words then belong to it, never to the question). */
export function readReply(text, question, { pendingProposal = false, now = Date.now() } = {}) {
  const t = tidy(text)
  const low = lower(t)
  if (!question || !low) return null
  if (question.at != null && now - question.at > QUESTION_TTL_MS) return { kind: 'new', choice: null, why: 'expired' }
  const choices = questionChoices(question)
  const picked = matchChoice(t, choices)
  if (picked?.cancel) return { kind: 'cancel', choice: null, why: 'cancel-choice' }
  if (picked) return { kind: 'answer', choice: picked, why: 'choice' }
  if (CANCEL.test(low)) return { kind: 'cancel', choice: null, why: 'cancel-words' }
  if (CONTROL.test(low) || pendingProposal && /^(?:yes|yep|yeah|ok|okay|sure|no|nope)[.!]*$/.test(low)) return { kind: 'new', choice: null, why: 'control-word' }
  const body = low.replace(LEAD, '')
  if (QUESTION_SHAPE.test(t) && REQUEST_VERB.test(body)) return { kind: 'new', choice: null, why: 'question' }
  if (DATE_RANGE.test(t)) return { kind: 'new', choice: null, why: 'date-range' }
  if (REQUEST_VERB.test(body)) return { kind: 'new', choice: null, why: 'request-verb' }
  if (OBJECT_PHRASE.test(body)) return { kind: 'new', choice: null, why: 'object-phrase' }
  // a ticker the question never mentioned: the member moved on to another symbol
  const qText = `${question.text || ''} ${question.asked || ''} ${choices.map(c => c.label).join(' ')}`
  const inQ = new Set((qText.match(TICKER) || []).map(s => s.toUpperCase()))
  const mine = (t.match(TICKER) || []).filter(s => s.length >= 2 && !/^(?:OK|NO|YES|THE|AND|FOR|EMA|SMA|RSI|VWAP|AVWAP|MACD|ET|PM|AM|USD)$/.test(s))
  if (mine.some(s => !inQ.has(s))) return { kind: 'new', choice: null, why: 'other-ticker' }
  if (body.split(' ').length > SHORT_WORDS) return { kind: 'new', choice: null, why: 'long' }
  return { kind: 'answer', choice: null, why: 'short-reply' }
}

/** What the server is told about the question this message met (TurnIn.openQuestion / RecordIn.openQuestion).
 *  Bounded, value-free: UCT's own question, its labels, the member's earlier words and the reading. */
export function openQuestionForServer(question, reading, { back = {} } = {}) {
  if (!question || !reading) return null
  const choices = questionChoices(question).filter(c => !c.cancel).map(c => c.label.slice(0, 120)).slice(0, 12)
  const out = {
    status: reading.kind === 'answer' ? 'answered' : 'closed',
    question: String(question.text || '').slice(0, 300),
    choices,
    asked: String(question.asked || '').slice(0, 500),
  }
  if (reading.kind === 'answer') {
    out.choice = reading.choice ? reading.choice.label.slice(0, 120) : null
    const ref = reading.choice?.ref ? (back[reading.choice.ref] || null) : null
    if (ref) out.choice_ref = ref
  } else {
    out.reason = reading.kind === 'cancel' ? 'cancelled' : 'new_request'
  }
  return out
}

// ── follow-up referents ───────────────────────────────────────────────────────────────────────────────────
const NOUN_KINDS = {
  alert: ['alert', 'indicatorAlert'], alerts: ['alert', 'indicatorAlert'],
  watchlist: ['watchlist'], list: ['watchlist'], layout: ['layouts', 'layout'],
  drawing: ['drawing'], trendline: ['drawing'], ray: ['drawing'], line: ['drawing'], level: ['drawing'],
  screen: ['screener'], scan: ['screener'], indicator: ['indicatorEdits', 'indicator'],
  chart: ['chart'], widget: ['board', 'widget'],
}
const THAT_NOUN = /\b(?:that|this|the same)\s+(alert|alerts|watchlist|list|layout|drawing|trendline|ray|line|level|screen|scan|indicator|chart|widget)\b/i
const OTHER_ONE = /\bthe other (?:one|chart|list|alert|drawing|symbol|ticker|stock)\b|\bthe other\b(?!\s+(?:charts|ones|lists|alerts|two|three|four|day|side|way))/i
const THOSE = /\b(?:those|them|these)\b/i

const listOf = (kindName, host) => { try { return getTargetKind(kindName)?.list(host) || [] } catch { return [] } }
const labelOf = (entry) => String(entry?.label || entry?.name || entry?.title || entry?.ref || '')

/** The targets of the given kinds the conversation's last turn acted on, still present on the live board. */
function recentTargets(kinds, { host, memory, epoch }) {
  const turn = memory?.lastTurn?.(epoch)
  const ops = turn?.ops || memory?.lastChange?.(epoch)?.ops || []
  const out = []
  for (const o of ops) {
    const kind = getCapability(o.action)?.target
    if (!kind || !kinds.includes(kind) || typeof o.target !== 'string') continue
    const live = listOf(kind, host).find(e => e.ref === o.target)
    if (live && !out.some(x => x.ref === live.ref)) out.push({ ref: live.ref, kind, label: labelOf(live) })
  }
  return out
}

/** Follow-up referents in one message, read before the model → { hints: [...], ask?: {text, choices}, say?: text }.
 *  - "that alert" / "this list" / "the same chart" → the ONE target of that kind the last turn acted on
 *    (several → a question naming them; none → nothing: the model asks, as before)
 *  - "the other one" → the unpicked choice of a two-choice question the member just answered, or the other
 *    symbol of a two-row result set, or the other target of a kind with exactly two when the last turn touched
 *    one — otherwise a plain refusal to guess
 *  - "those" / "them" → the latest result set, named as such (the model already has its tickers) */
export function resolveReferents(text, { host, memory, epoch = null, lastChoice = null } = {}) {
  const t = tidy(text)
  if (!t || !memory) return null
  const hints = []
  let ask = null, say = null
  const noun = THAT_NOUN.exec(t)
  if (noun) {
    const kinds = NOUN_KINDS[noun[1].toLowerCase()] || []
    const hits = recentTargets(kinds, { host, memory, epoch })
    if (hits.length === 1) hints.push({ words: noun[0].toLowerCase(), ref: hits[0].ref, kind: hits[0].kind, label: hits[0].label })
    else if (hits.length > 1) ask = { text: `Which ${noun[1].toLowerCase().replace(/s$/, '')} do you mean by “${noun[0].toLowerCase()}”?`, choices: hits.slice(0, 12).map(h => ({ label: h.label || h.ref })) }
  }
  const other = OTHER_ONE.exec(t)
  if (other && !ask) {
    let found = null
    if (lastChoice && Array.isArray(lastChoice.choices) && lastChoice.choices.length === 2 && lastChoice.picked != null) {
      const rest = lastChoice.choices.filter((_, i) => i !== lastChoice.picked)
      if (rest.length === 1) found = { words: other[0].toLowerCase(), label: rest[0].label, ...(rest[0].ref ? { ref: rest[0].ref } : {}), of: 'the question you answered' }
    }
    if (!found) {
      const set = memory.latestResults?.()
      if (set && set.symbols.length === 2) {
        const charts = listOf('chart', host)
        const shown = new Set(charts.map(c => String(c.symbol || '').toUpperCase()))
        const rest = set.symbols.filter(s => !shown.has(s))
        if (rest.length === 1) found = { words: other[0].toLowerCase(), symbol: rest[0], of: 'the last results' }
      }
    }
    if (!found) {
      const turn = memory.lastTurn?.(epoch)
      const kinds = [...new Set((turn?.ops || []).map(o => getCapability(o.action)?.target).filter(Boolean))]
      if (kinds.length === 1) {
        const list = listOf(kinds[0], host)
        const touched = new Set(turn.charts || [])
        if (list.length === 2 && touched.size === 1) {
          const rest = list.filter(e => !touched.has(e.ref))
          if (rest.length === 1) found = { words: other[0].toLowerCase(), ref: rest[0].ref, kind: kinds[0], label: labelOf(rest[0]), of: 'the last change' }
        }
      }
    }
    if (found) hints.push(found)
    else say = `I'm not sure what “${other[0].toLowerCase()}” points at — name it (a ticker, a chart, a list). Nothing has changed.`
  }
  if (THOSE.test(t) && !ask && !say) {
    const set = memory.latestResults?.()
    if (set) hints.push({ words: (THOSE.exec(t) || [])[0].toLowerCase(), set: 'latest', count: set.symbols.length })
  }
  if (!hints.length && !ask && !say) return null
  return { hints, ask, say }
}
