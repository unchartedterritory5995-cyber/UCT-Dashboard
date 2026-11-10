// ⭐ TWO-PART ASKS: "how do I add an RSI and then change its length". One walkthrough, the first part's steps then the
// second's, so the member is walked through both in order. A part that names nothing ("change ITS length", "flag IT") takes
// the thing the first part named. Both parts must reach a walkthrough of their own; otherwise the ask is read whole.
import { readIndicator, SLOTS } from './slots'

// "X then Y", "X and then Y", "X, then Y", "X and after that Y": one split, at the first such joint
const JOINT = /\s*(?:,\s*)?(?:\band then\b|\bthen\b|\band after that\b|\bafter that\b|\band next\b)\s+/i
// the way a member asks, at the start of the first part: never a part of its own
const ASK = /^(?:how (?:do|can|would|should) i|how to|show me how to|teach me (?:how )?to|walk me through(?: how to)?|where do i|help me)\s+/i

/** → [first, second] when the words are two asks joined by "then", else null. */
export function splitParts(words) {
  const s = String(words || '').trim()
  const m = JOINT.exec(s)
  if (!m || m.index < 4) return null
  const first = s.slice(0, m.index).trim()
  const second = s.slice(m.index + m[0].length).trim().replace(/[?.!]+$/, '')
  if (!second || second.split(/\s+/).length < 2) return null
  return [first, second]
}

/** The thing the first part named, in words the second part's walkthrough reads ("the RSI", "the trendline drawing", "my watchlist"). */
export function objectOf(first) {
  const q = String(first || '').toLowerCase().replace(ASK, '')
  const ind = readIndicator(q)
  if (ind) return ind.say || ind.name || ''
  const tool = SLOTS.tool?.read?.(q)
  if (tool) return `the ${tool.label.toLowerCase()} drawing`
  if (/\bwatch ?lists?\b|\blists?\b/.test(q)) return 'my watchlist'
  if (/\blayouts?\b/.test(q)) return 'my layout'
  return ''
}

/** The second part, carrying the first part's thing when it points back at it ("change ITS length", "flag IT"): never a part that says nothing of it. */
export function carried(second, first) {
  const obj = objectOf(first)
  if (!obj) return second
  return /\b(it|its|that|this|them|one)\b/i.test(second) ? `${second} ${obj}` : second
}
