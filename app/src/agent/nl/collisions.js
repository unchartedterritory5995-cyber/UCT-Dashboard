// ── UCT Agent NL: one name, several kinds of thing (Gate B safety, owner 2026-10-13) ──────────────
//
// "open swing" with a Swing watchlist AND a Swing Board layout; "remove momentum" with a Momentum
// watchlist AND a Momentum indicator. An instant command must never pick one of them arbitrarily:
// the owner's rule is zero unintended mutations over deterministic coverage. A capability's fast
// phrase that reads a BARE name (no "layout" / "watchlist" / "indicator" noun) asks this module
// whether the same words also name something of ANOTHER kind in the member's live workspace; if so
// it returns null, and the request goes to the model path, which sees every real name and asks.
//
// "Names" here: the words equal a name, or are a whole-word prefix of one ("swing" ↔ "Swing Board").
// Never a substring inside a word, never a typo match (a typo that is close to two kinds is already
// a tie for the matcher). Live state only — nothing here lists a name.

import { normText } from './match'

const LEAD = /^(?:my|the|our|this|that) /
const NOUNS = /\s+(?:layouts?|watch ?lists?|lists?|screens?|indicators?|study|studies)$/

export const bareWords = (phrase) => normText(phrase).replace(LEAD, '').replace(NOUNS, '').trim()

/** Do `words` name `name` (equal, or a whole-word prefix of it)? */
export function wordsName(words, name) {
  const w = bareWords(words)
  const n = normText(name)
  if (!w || !n) return false
  return n === w || n.startsWith(`${w} `)
}

const sources = (host) => ({
  layout: () => (host?.layouts?.snapshot?.()?.entries || []).map(e => e.name),
  watchlist: () => (host?.watchlists?.snapshot?.() || []).map(l => l.name),
  screen: () => (host?.savedScreens?.snapshot?.() || []).map(s => s.name),
})

/** The kinds of member-named things these words name, from live state: Set of
 *  'layout' | 'watchlist' | 'screen'. A source that cannot be read counts as naming nothing. */
export function namedKinds(host, words) {
  const out = new Set()
  for (const [kind, read] of Object.entries(sources(host))) {
    let names = []
    try { names = read() } catch { names = [] }
    if (names.some(n => wordsName(words, n))) out.add(kind)
  }
  return out
}

/** True when the words also name something of a kind OTHER than `kind` — the caller then does not
 *  claim the phrase. */
export function namesAnotherKind(host, words, kind) {
  for (const k of namedKinds(host, words)) if (k !== kind) return true
  return false
}
