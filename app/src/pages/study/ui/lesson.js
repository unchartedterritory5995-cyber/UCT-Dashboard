// THE LESSON'S TWO HALVES (round 18; owner, batch 18: "This content here needs significant improvement and
// simplification"). A bank lesson is ONE paragraph: "<Setup>: <the rule, the owner's definition, several sentences>
// Here the stock <what this chart did, measured from its bars>." Nothing here rewrites a word of it (no model writes a
// market fact, and the lesson's numbers come from the bars): the card shows the chart's own sentence first, the rule's
// first sentence under it, and the rest of the rule on demand. The bank's provenance stamps "(owner rulings
// 2026-10-23/24)" are lifted out of the member's reading and returned separately.
const CITE = /\s*\((owner rulings?[^)]*)\)/gi

export function splitLesson(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  const citations = []
  let body = raw.replace(CITE, (_, c) => { citations.push(c); return '' }).replace(/\s+([.,;:])/g, '$1').trim()
  let setup = ''
  const named = /^([A-Z][A-Za-z0-9 ()'&/-]{1,48}?):\s+(?=\S)/.exec(body)
  if (named) { setup = named[1]; body = body.slice(named[0].length) }
  let rule = body
  let here = ''
  const at = hereIndex(body)
  if (at >= 0) { rule = body.slice(0, at).trim(); here = body.slice(at).trim() }
  const [ruleLead, ruleRest] = firstSentence(cap(rule))
  return { setup, rule: cap(rule), ruleLead, ruleRest, here: endStop(here), citations }
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

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function endStop(s) { return s && !/[.!?]$/.test(s) ? `${s}.` : s }
