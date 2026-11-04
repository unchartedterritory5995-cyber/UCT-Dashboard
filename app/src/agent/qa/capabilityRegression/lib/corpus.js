// CAPABILITY REGRESSION (Mission 2) — the corpus / golden data, normalised, and the deterministic-path reader.
import { it } from 'vitest'
import corpus from '../data/corpus.json'
import golden from '../data/goldenWorkflows.json'
import { multiChartPlan } from '../../../multiChart'
import { fastParse } from '../../../fastPath'
import { planCompound } from '../../../compound'

export { corpus, golden }
export const phrasingsOf = (intent) => intent.phrasings.map(p => (typeof p === 'string' ? { text: p } : p))
/** Every (intent, phrasing) pair. */
export const allPhrasings = () => corpus.intents.flatMap(intent => phrasingsOf(intent).map(ph => ({ intent, ph })))

/** vitest `it`, or `it.fails` for a recorded known gap (the title carries its id, so the report and the run agree). */
export function gapIt(gap) {
  if (!gap) return { run: it, tag: '' }
  if (!gap.id || !gap.reason || !gap.owner) throw new Error(`a known gap needs {id, reason, owner}: ${JSON.stringify(gap)}`)
  return { run: it.fails, tag: ` [KNOWN GAP ${gap.id}]` }
}

/**
 * What the DETERMINISTIC layers make of a message, in useAgent's order (multiChart → fast path → compound), normalised:
 *   { plan: [{action, args}] } | { steps: [kind…] } | { say: true } | { kind } | null (nothing claimed it: the model's).
 */
export function deterministicReading(text, host) {
  const mc = multiChartPlan(text, { host })
  if (mc?.kind === 'ops') return { plan: mc.ops.map(o => ({ action: o.action, args: o.args || {} })), via: 'multiChart' }
  if (mc?.kind === 'steps') return { plan: mc.steps.flatMap(s => s.ops).map(o => ({ action: o.action, args: o.args || {} })), via: 'multiChart' }
  if (mc?.kind === 'say') return { say: true, via: 'multiChart' }
  const fp = fastParse(text, { host })
  if (fp?.kind === 'ops') return { plan: fp.ops.map(o => ({ action: o.action, args: o.args || {} })), via: 'fastPath' }
  if (fp?.kind === 'undo') return { plan: [{ action: 'agent.undo', args: fp.about ? { about: fp.about } : {} }], via: 'fastPath' }
  if (fp?.kind === 'say') return { say: true, via: 'fastPath' }
  if (fp) return { kind: fp.kind, via: 'fastPath' }
  const cp = planCompound(text, { host })
  if (cp?.steps) return { steps: cp.steps.map(s => s.kind), via: 'compound' }
  return null
}

/** Deep PARTIAL match: every key `want` names equals in `got` (arrays: same length, element-wise partial). */
export function partialMatch(got, want) {
  if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((w, i) => partialMatch(got[i], w))
  if (want && typeof want === 'object') return !!got && typeof got === 'object' && Object.keys(want).every(k => partialMatch(got[k], want[k]))
  return got === want
}
/** Is a deterministic reading equivalent to the intent's canonical deterministic expectation? */
export function equivalent(reading, det) {
  if (!reading) return false
  if (det.steps) return Array.isArray(reading.steps) && reading.steps.join() === det.steps.join()
  if (det.plan) return Array.isArray(reading.plan) && partialMatch(reading.plan, det.plan)
  return false
}
