// THE LESSON'S PARTS (round 18; owner, batch 18: "This content here needs significant improvement and simplification";
// batch 19: "dont say THE FIRM"). A bank lesson is ONE paragraph: "<Setup>: <the rule, the owner's definition, several
// sentences> Here the stock <what this chart did, measured from its bars>." A near-miss fixture reads "The firm's
// detector does not fire on the last bar of this chart. <why not>". Nothing here rewrites a market fact (the lesson's
// numbers come from the bars): the chart's own sentence leads, the rule's first sentence follows, the rest of the rule
// on demand; "the firm" is read through the product's own brand words (drills/types.brandWords, the round-17b ruling);
// the bank's provenance stamps "(owner rulings 2026-10-23/24)" are lifted out of the member's reading and kept.
import { brandWords } from '../drills/types'

const CITE = /\s*\((owner rulings?[^)]*)\)/gi
const NOTHING = /^(?:UCT's|The firm's|Our)\s+detector does not fire on the last bar of this chart\.?\s*/i

export function splitLesson(text) {
  const raw = brandWords(String(text || '').replace(/\s+/g, ' ').trim()) || ''
  const citations = []
  let body = raw.replace(CITE, (_, c) => { citations.push(c); return '' }).replace(/\s+([.,;:])/g, '$1').trim()
  // a near-miss: the detector did not fire, and the rest is why
  const nm = NOTHING.exec(body)
  if (nm) {
    const reason = endStop(cap(body.slice(nm[0].length).trim()))
    return { setup: '', rule: '', ruleLead: '', ruleRest: '', here: '', nothing: true, reason, citations }
  }
  let setup = ''
  const named = /^([A-Z][A-Za-z0-9 ()'&/-]{1,48}?):\s+(?=\S)/.exec(body)
  if (named) { setup = named[1]; body = body.slice(named[0].length) }
  let rule = body
  let here = ''
  const at = hereIndex(body)
  if (at >= 0) { rule = body.slice(0, at).trim(); here = body.slice(at).trim() }
  const [ruleLead, ruleRest] = firstSentence(cap(rule))
  return { setup, rule: cap(rule), ruleLead, ruleRest, here: endStop(here), nothing: false, reason: '', citations }
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

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function endStop(s) { return s && !/[.!?]$/.test(s) ? `${s}.` : s }
