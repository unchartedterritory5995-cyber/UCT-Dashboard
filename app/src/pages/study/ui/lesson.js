// THE LESSON'S PARTS (round 18; owner, batch 18: "This content here needs significant improvement and simplification";
// batch 19: "dont say THE FIRM"; batch 21: "simpler to read and more direct as a teacher and mentor"). A bank lesson is
// ONE paragraph: "<Setup>: <the rule, the owner's definition, several sentences> Here the stock <what this chart did,
// measured from its bars>." A fixture reads "The firm's detector does (not) fire on the last bar of this chart. <why>".
// Nothing here rewrites a market fact (the lesson's numbers come from the bars): the chart's own sentence leads, the
// rule's first sentence is split into the steps the bank already wrote (its semicolons, its "then"), the rest of the rule
// on demand; "the firm" is read through the product's own brand words (drills/types.brandWords, the round-17b ruling);
// the bank's provenance stamps "(owner rulings 2026-10-23/24)" and the review notes "(dropped by the blind review)" are
// lifted out of the member's reading and kept.
import { brandWords } from '../drills/types'

const CITE = /\s*\((owner rulings?[^)]*|dropped by the blind review[^)]*|label variant only[^)]*|the S\d[^)]*gate[^)]*)\)/gi
const NOTHING = /^(?:UCT's|The firm's|Our)\s+detector does not fire on the last bar of this chart\.?\s*/i
const FIRES = /^(?:UCT's|The firm's|Our)\s+detector fires on the last bar of this chart\.?\s*/i

const EMPTY = { setup: '', rule: '', ruleLead: '', ruleRest: '', here: '', nothing: false, template: false, reason: '' }

export function splitLesson(text) {
  const raw = brandWords(String(text || '').replace(/\s+/g, ' ').trim()) || ''
  const citations = []
  let body = raw.replace(CITE, (_, c) => { citations.push(c); return '' }).replace(/\s+([.,;:])/g, '$1').trim()
  let setup = ''
  const named = /^([A-Z][A-Za-z0-9 ()'&/-]{1,48}?):\s+(?=\S)/.exec(body)
  if (named) { setup = named[1]; body = body.slice(named[0].length) }
  // a near-miss ("Capitulation: the firm's detector does not fire on the last bar of this chart. <why>"): the rest is why
  const nm = NOTHING.exec(body)
  if (nm) {
    const reason = endStop(cap(body.slice(nm[0].length).trim()))
    return { ...EMPTY, setup, nothing: true, template: true, reason, citations }
  }
  // a fixture positive ("... detector fires on the last bar of this chart. real daily bars; ..."): no rule, no chart line
  if (FIRES.test(body)) return { ...EMPTY, setup, template: true, citations }
  let rule = body
  let here = ''
  const at = hereIndex(body)
  if (at >= 0) { rule = body.slice(0, at).trim(); here = body.slice(at).trim() }
  const [ruleLead, ruleRest] = firstSentence(cap(rule))
  return { ...EMPTY, setup, rule: cap(rule), ruleLead, ruleRest, here: endStop(here), citations }
}

/** Where the chart's own sentence starts: a "Here" that opens the text or follows a stop (the LAST such one). */
function hereIndex(s) {
  if (/^Here\b/.test(s)) return 0
  const re = /[.!?;:]\s+Here\b/g
  let m, last = -1
  while ((m = re.exec(s))) last = m.index + m[0].length - 4
  return last
}

/** [first sentence, the rest]: a stop followed by a space and a capital (or the end) ends a sentence; "0.48%" does not. */
export function firstSentence(s) {
  const t = String(s || '').trim()
  if (!t) return ['', '']
  const m = /^[\s\S]*?[.!?](?=\s+[A-Z"'(]|$)/.exec(t)
  if (!m) return [t, '']
  return [m[0].trim(), t.slice(m[0].length).trim()]
}

/** The clauses of a chained sentence ("the drive ...; the pullback ...; the trigger ..."), each starting with a capital
 *  and ending with a stop; one clause when there is no chain. The words are the bank's own. */
export function clausesOf(text) {
  const t = String(text || '').trim()
  if (!t) return []
  const parts = t.split(/;\s+/).map((c) => c.trim()).filter(Boolean)
  if (parts.length < 2) return [t]
  return parts.map((c, i) => cap(i === parts.length - 1 || /[.!?]$/.test(c) ? c : `${c}.`))
}

/** The sentences of a passage, each its own line (round 21: the chart's own line read as one paragraph); a stop inside a
 *  number ("0.48%") never ends one. Semicolon chains inside a sentence are cut by clausesOf. The words are the bank's own. */
export function sentencesOf(text) {
  const out = []
  let rest = String(text || '').trim()
  while (rest) {
    const [one, more] = firstSentence(rest)
    if (!one) break
    out.push(...clausesOf(one))
    rest = more
  }
  return out
}

/** THE RULE AS STEPS (round 21): the rule's first sentence cut where the bank already cut it, at its semicolons
 *  ("the day before closes red ...; then the next day gaps up ..."), or, in a sentence with no semicolon that walks
 *  through a session ("opens below ..., trades under ..., then reverses and closes above ..."), at its commas when that
 *  gives two to four short steps. Each step starts with a capital and ends with a stop; the shouted THEN reads Then.
 *  One step when the sentence is not a sequence. The words are the bank's own. */
export function stepsOf(sentence) {
  const t = String(sentence || '').trim()
  if (!t) return []
  let parts = t.split(/;\s+/).map((c) => c.trim()).filter(Boolean)
  if (parts.length < 2 && /,\s+then\b/i.test(t)) {
    const commas = t.split(/,\s+/).map((c) => c.trim()).filter(Boolean)
    if (commas.length >= 2 && commas.length <= 4 && commas.every((c) => c.length <= 72)) parts = commas
  }
  if (parts.length < 2) return [endStop(cap(t))]
  return parts.map((c) => endStop(cap(c.replace(/^THEN\b/, 'Then').replace(/[.,;:]+$/, ''))))
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function endStop(s) { return s && !/[.!?]$/.test(s) ? `${s}.` : s }
