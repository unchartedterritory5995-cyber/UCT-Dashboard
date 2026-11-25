// ── D31 RESOLVER · THE DECISION FUNCTION (design §3, §4) ─────────────────────────────────────────────────────────────────
// resolve(input) → { verdict: 'resolved' | 'ask' | 'refuse' | 'abstain', referents, reason, perTarget, evidence, family }
//   input = { family, words: { typed, carried }, planTargets: [TypedRef], world }   (shapes: resolver/world.js)
// Pure: no writes, no model, no clock. The reason is a SOURCE (resolved) or a CODE (ask / refuse) from the oracle's closed
// sets (resolver/policy.js CODES / SOURCES — imported, never restated).
//   I1 words outrank plan   the plan is checked against what the words resolve; it never licenses itself
//   I2 ambiguous → ask      2+ candidates of the required type with nothing to tell them apart: asked, never picked
//   I3 type match           a plan target of another type than the referent's is refused
//   I4 pointer < words      a click that disagrees with a chart the words name: asked (removal reader)
//   I5 negated / kept       a negated mention is never a referent
//   I6 anchor               a relation's anchor is never the target
//   I7 additive             compose(): the resolver can only ADD an ask / refuse where both rails allowed (enforce.js)
import { CODES, SOURCES } from './policy'
import { readRemoval } from './families/removal'
import { typeOfId } from './referentTypes'
import { modeOf, MODES } from './enforce'

export const VERDICTS = Object.freeze(['resolved', 'ask', 'refuse', 'abstain'])
const RANK = { resolved: 0, abstain: 0, ask: 1, refuse: 2 }
const FAMILIES = { removal: readRemoval }

const refuse = (code) => ({ verdict: 'refuse', reason: code })
const ask = (code) => ({ verdict: 'ask', reason: code })

/** One plan target against the reading. */
export function decideTarget(t, reading) {
  if (reading.negated.has(t.id)) return refuse('negated-target')                                   // I5
  if (reading.anchors.has(t.id)) return refuse('anchor-as-target')                                  // I6
  const gs = reading.groups
  if (!gs.length) return refuse('plan-outside-words')                                               // I1: the plan never licenses
  const same = gs.filter(g => g.type === t.type || (g.type === '*thing' && t.type !== 'chart'))
  if (!same.length) return refuse('type-mismatch')                                                   // I3
  const hits = same.filter(g => g.type === '*thing' || g.refs.includes(t.id))
  if (!hits.length) {                                                                                // I1: outside what the words name
    if (same.every(g => g.absent && !g.refs.length)) return refuse('absent')
    if (same.every(g => g.source === 'description')) return refuse('description-mismatch')
    return refuse('plan-outside-words')
  }
  const conflict = hits.find(g => g.ask === 'pointer-vs-words')
  if (conflict) return ask('pointer-vs-words')                                                       // I4
  const clear = hits.find(g => !g.ask && g.type !== '*thing')
  if (clear) return { verdict: 'resolved', reason: clear.source }
  return ask(hits.find(g => g.ask)?.ask || 'ambiguous-n')                                           // I2
}

/** The typed plan targets → the family that reads them (P1: removal only; anything else abstains). */
export function familyOf(input) {
  if (input.family) return input.family
  return (input.planTargets || []).length ? 'removal' : null
}

export function resolve(input) {
  const family = familyOf(input)
  const targets = (input.planTargets || []).map(t => (typeof t === 'string' ? { type: typeOfId(t), id: t } : t))
  if (!family || !FAMILIES[family] || !targets.length) return { family, verdict: 'abstain', reason: 'not-a-referring-op', referents: [], perTarget: [], evidence: [] }
  const reading = FAMILIES[family]({ ...input, planTargets: targets })
  const perTarget = targets.map(t => ({ id: t.id, type: t.type, ...decideTarget(t, reading) }))
  let worst = perTarget[0]
  for (const x of perTarget) if (RANK[x.verdict] > RANK[worst.verdict]) worst = x
  let reason = worst.reason
  // (a description that fits SOME of the plan's targets: the rest are outside the words — plan-outside-words, not a mismatch)
  if (reason === 'description-mismatch' && perTarget.some(x => x.verdict === 'resolved')) reason = 'plan-outside-words'
  const referents = [...new Set(reading.groups.filter(g => !g.ask).flatMap(g => g.refs))]
  const out = { family, verdict: worst.verdict, reason, referents, perTarget, evidence: reading.evidence, cont: reading.cont }
  if (out.verdict !== 'resolved' && !CODES.includes(out.reason)) throw new Error(`resolver: code outside the closed set: ${out.reason}`)
  if (out.verdict === 'resolved' && !SOURCES.includes(out.reason)) throw new Error(`resolver: source outside the closed set: ${out.reason}`)
  return out
}

/**
 * I7 COMPOSITION: final = most restrictive(rails, resolver). `railText` is the rails' sentence (null = both allowed).
 * 'shadow' → the rails' decision, always. 'add' → the resolver's ask / refuse only where the rails allowed. Never a licence.
 */
export function compose(railText, rz, mode = modeOf(rz?.family)) {
  if (!MODES.includes(mode)) return { text: railText, by: 'rails' }
  if (railText != null) return { text: railText, by: 'rails' }
  if (mode === 'add' && rz && (rz.verdict === 'refuse' || rz.verdict === 'ask')) return { text: sentenceOf(rz), by: 'resolver' }
  return { text: null, by: 'rails' }
}
// (P2 builds the member-facing sentence from the rails' wording helpers; in P1 nothing is ever shown)
export const sentenceOf = (rz) => (rz.verdict === 'ask' ? 'Which do you mean? Nothing was changed.' : 'I didn’t change anything: your words name another object than this would change.')
