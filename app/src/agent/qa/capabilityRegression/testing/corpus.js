// CAPABILITY REGRESSION (Mission 2) — the corpus / golden data, normalised, and the deterministic-path reader.
import { it } from 'vitest'
import corpus from '../baseline/corpus.json'
import golden from '../baseline/goldenWorkflows.json'
import { multiChartPlan } from '../../../multiChart'
import { fastParse } from '../../../fastPath'
import { planCompound } from '../../../compound'
import { resolveFollowUp } from '../../../conversation'
import { createMemory } from '../../../memory'

// ⚠ a copy of useAgent.js FOLLOW_CUES (not exported): which messages try the conversation's follow-up reader FIRST
const FOLLOW_CUES = /\b(?:it|that|this|them|those|these|both|first|second|third|last|other|others|rest|fast|faster|fastest|slow|slower|slowest|short|long|same|match|look like|next to|just added|i added|new one|everywhere|all of them|all my|every)\b/i

export { corpus, golden }
export const phrasingsOf = (intent) => intent.phrasings.map(p => (typeof p === 'string' ? { text: p } : p))
/** Every (intent, phrasing) pair. */
export const allPhrasings = () => corpus.intents.flatMap(intent => phrasingsOf(intent).map(ph => ({ intent, ph })))

/** The assertion LABEL of a failure: its first line up to ": expected" — which check failed, not the volatile values. */
export const failureMode = (err) => String(err?.message ?? err).split('\n')[0].split(': expected')[0].trim()

/**
 * vitest `it`, or — for a recorded known gap — a test that must fail IN THE RECORDED WAY (review #769 nit 3):
 *   • it passes only when the body throws AND the failure's assertion label contains `gap.mode`;
 *   • it fails loudly when the body passes (the fix landed: remove the marker), or fails for any OTHER reason (a harness
 *     crash, a different assertion, a changed failure) — never the silent pass `it.fails` gives on any throw.
 * CAPREG_CAPTURE_GAPS=<file> appends each gap's actual failure mode (to record `mode` for a new gap).
 */
export function gapIt(gap) {
  if (!gap) return { run: it, tag: '' }
  if (!gap.id || !gap.reason || !gap.owner) throw new Error(`a known gap needs {id, reason, owner}: ${JSON.stringify(gap)}`)
  const run = (title, fn, timeout) => it(title, async () => {
    let err = null
    try { await fn() } catch (e) { err = e }
    const capture = globalThis.process?.env?.CAPREG_CAPTURE_GAPS
    if (capture && err) { const fs = await import('node:fs'); fs.appendFileSync(capture, JSON.stringify({ id: gap.id, reason: gap.reason, title, mode: failureMode(err) }) + '\n') }
    if (!err) throw new Error(`KNOWN GAP ${gap.id} no longer fails — the fix landed: remove the gap marker (no decision needed)`)
    if (!gap.mode) throw new Error(`KNOWN GAP ${gap.id} records no failure \`mode\` (actual: ${failureMode(err)})`)
    if (!failureMode(err).includes(gap.mode)) throw new Error(`KNOWN GAP ${gap.id} failed for an UNRELATED reason — expected the mode "${gap.mode}", got: ${String(err?.message ?? err).split('\n')[0]}`)
  }, timeout)
  return { run, tag: ` [KNOWN GAP ${gap.id}]` }
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
  const follow = () => {
    const f = resolveFollowUp(text, { host, memory: createMemory(), epoch: null })
    if (f?.kind === 'ops') return { plan: f.ops.map(o => ({ action: o.action, args: o.args || {} })), via: 'followUp' }
    if (f?.kind === 'say' || f?.kind === 'ask') return { say: true, via: 'followUp' }
    return null
  }
  const cued = FOLLOW_CUES.test(text)
  if (cued) { const f = follow(); if (f) return f }
  const fp = fastParse(text, { host })
  if (fp?.kind === 'ops') return { plan: fp.ops.map(o => ({ action: o.action, args: o.args || {} })), via: 'fastPath' }
  if (fp?.kind === 'undo') return { plan: [{ action: 'agent.undo', args: fp.about ? { about: fp.about } : {} }], via: 'fastPath' }
  if (fp?.kind === 'say') return { say: true, text: fp.text, via: 'fastPath' }
  if (fp) return { kind: fp.kind, via: 'fastPath' }
  if (!cued) { const f = follow(); if (f) return f }
  const cp = planCompound(text, { host })
  if (cp?.steps) return { steps: cp.steps.map(s => s.kind), stepTexts: cp.steps.map(s => s.text), via: 'compound' }
  return null
}

/** Deep PARTIAL match: every key `want` names equals in `got` (arrays: same length, element-wise partial). */
export function partialMatch(got, want) {
  if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((w, i) => partialMatch(got[i], w))
  if (want && typeof want === 'object') return !!got && typeof got === 'object' && Object.keys(want).every(k => partialMatch(got[k], want[k]))
  return got === want
}
// a ticker's CASE is not part of the plan (the runtime resolves it: instrument.resolve / the symbol search)
const upperSymbols = (v, k = null) => (Array.isArray(v) ? v.map(x => upperSymbols(x, k))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, upperSymbols(x, kk)]))
    : (k === 'symbol' || k === 'symbols') && typeof v === 'string' ? v.toUpperCase() : v)
/** Is a deterministic reading equivalent to the intent's canonical deterministic expectation? */
export function equivalent(reading, det) {
  if (!reading) return false
  if (det.steps) return Array.isArray(reading.steps) && reading.steps.join() === det.steps.join()
  if (det.plan) return Array.isArray(reading.plan) && partialMatch(upperSymbols(reading.plan), det.plan)
  // a fixed-words answer (a capability's `__say`, e.g. uctIntelligence.set asking which "patterns"): no op, the words match `say`
  if (det.say) return reading.say === true && new RegExp(det.say, 'i').test(String(reading.text || ''))
  return false
}
