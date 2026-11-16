// ── D31 RESOLVER · THE ORACLE RUNNER: resolve() over every FROZEN policy.js row (AUDIT R1: policy.js is never edited) ──────
// The resolver must give the POLICY on every non-emulated row — masterGap rows included (the resolver gets those RIGHT even where
// master does not). For an overAsk row the policy resolution is `policy`; `expect` there is master's block, which the additive
// composition (I7) keeps anyway, so the resolver is scored against `policy` and the composed outcome against `expect`.
// Emulated (offer) rows are reported apart. RESOLVER_REPORT=1 prints the tallies and every disagreement.
import { describe, it, expect, afterAll } from 'vitest'
import { registerBuiltins } from '../builtins'
import { POLICY, CODES, SOURCES } from './policy'
import { resolve, compose } from './resolve'
import { worldOfRow, mapRef, planOfRow } from './testing/oracleWorld'

registerBuiltins()

export const verdictOf = (rz) => (rz.verdict === 'resolved' ? 'resolved' : rz.verdict)
const want = (r) => {
  const e = r.overAsk ? r.policy : r.expect
  return e.startsWith('resolved:') ? 'resolved' : e
}
/** Run one policy row through the resolver. */
export function runRow(r) {
  const w = worldOfRow(r.context, mapRef)
  const carried = r.context.offers && !r.context.offers.stale ? r.context.offers.carried : null
  return resolve({ words: { typed: r.words, carried }, planTargets: planOfRow(w, r.plan), world: w })
}
const cat = (r) => (r.emulated ? 'emulated' : r.masterGap ? 'masterGap' : r.overAsk ? 'overAsk' : r.adds ? 'adds' : 'plain')
const tally = { plain: [0, 0], masterGap: [0, 0], overAsk: [0, 0], adds: [0, 0], emulated: [0, 0] }
const reasonAgree = { same: 0, differs: [] }
const disagree = []

describe(`RESOLVER × ORACLE · ${POLICY.length} frozen removal rows`, () => {
  it.each(POLICY.map(r => [r.id, r.words, r]))('%s · "%s"', (_id, _w, r) => {
    const rz = runRow(r)
    const got = verdictOf(rz), exp = want(r)
    const c = cat(r)
    tally[c][1]++
    if (got === exp) tally[c][0]++
    else disagree.push({ id: r.id, cat: c, words: r.words, ctx: r.context, plan: r.plan, exp, got, reason: rz.reason })
    if (got === exp) {
      const er = r.overAsk ? (r.policy.startsWith('resolved:') ? null : r.reason) : r.reason
      if (er && er === rz.reason) reasonAgree.same++
      else if (er) reasonAgree.differs.push(`${r.id} want ${er} got ${rz.reason}`)
    }
    expect(CODES.includes(rz.reason) || SOURCES.includes(rz.reason), `${r.id}: reason in the closed sets`).toBe(true)
    // the composed outcome (rails' master block + the resolver, additive) is the row's `expect` on an overAsk row
    if (r.overAsk) expect(compose('master block', rz).text).toBe('master block')
    if (!r.emulated) expect(got, `${r.id} "${r.words}" ${JSON.stringify(r.context)} plan ${r.plan} → ${rz.verdict} (${rz.reason})`).toBe(exp)
  })
  it('every non-emulated row agrees (masterGap rows included)', () => {
    expect(disagree.filter(d => d.cat !== 'emulated')).toEqual([])
  })
})

afterAll(() => {
  if (!globalThis.process?.env?.RESOLVER_REPORT) return
  const t = Object.entries(tally).map(([k, [a, n]]) => `${k} ${a}/${n}`).join(' · ')
  console.log([`RESOLVER × ORACLE: ${t}`, `reason agreement (agreeing rows): ${reasonAgree.same} same, ${reasonAgree.differs.length} differ`,
    'DISAGREE:', ...disagree.map(d => `  ${d.id} [${d.cat}] "${d.words}" ${JSON.stringify(Object.fromEntries(Object.entries(d.ctx).filter(([, v]) => v)))} plan ${d.plan} · want ${d.exp} · got ${d.got} (${d.reason})`),
    'REASON DIFFERS:', ...reasonAgree.differs.map(x => `  ${x}`)].join('\n'))
})
