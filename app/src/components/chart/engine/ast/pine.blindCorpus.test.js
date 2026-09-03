// app/src/components/chart/engine/ast/pine.blindCorpus.test.js
//
// ─── ⭐⭐ THE EXAM THIS PROJECT DID NOT WRITE ─────────────────────────────────
//
// ⚰️⚰️ `pine.screenerCorpus.test.js` reads 38/38, and that number is worth less
// than it looks. Those fixtures were authored by the same process that then
// fixed the engine to pass them — its first draft scored 30/30, and the file
// says so itself: *"a corpus blind beside what it measures"*. A score of 100% on
// an exam you set is a statement about your imagination, not your grammar.
//
// ⭐ THESE FORTY-EIGHT WERE WRITTEN BLIND. Eight independent authors, one per
// trading lens (momentum, mean reversion, volume, volatility, breakout, candles,
// recency, multi-factor), each instructed explicitly NOT to read this repo — no
// manifest, no function table, no existing fixture — and to write the ordinary
// thing they would actually screen with. `INTENTS.json` carries each one's
// stated purpose in its author's words.
//
// 🔴 THE FIRST RUN: 17 of 48. Against 38/38 on the corpus we set ourselves.
// That gap IS the finding, and it is the honest measure of how far the Pine door
// is from "a member pastes what they already write".
//
// ⛔ THE FLOOR IS A RATCHET AND THE RESIDUAL IS A ROSTER — the same contract the
// authored corpus keeps. A count alone would let one script break while another
// was fixed. Every miss is named with the guard that refused it, so progress is
// legible and a regression is loud.
//
// ⚠️ ONE OF THE 48 IS THE AUTHOR'S OWN BUG (`multifactor-rsi-pullback-in-uptrend`
// references a name it never binds) and it is KEPT rather than quietly removed.
// Real pasted scripts contain real mistakes, the refusal for it is correct, and
// deleting inconvenient cases is how a corpus drifts back into flattery.
//
// ⛔ THIS FILE MUST NOT BECOME A TARGET. Do not "fix" a miss by teaching the
// grammar a look-alike — `_functions_excluded.obv` and the `MIN/lowest trap` are
// what that costs. A name is either expressible as an IDENTITY or it stays
// refused with a sentence that says why.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, treeYieldsBool } from './pine.js'
import { parseFormula } from './parse.js'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_blind')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()

/** Every fixture through the shipped door, judged as a SCREEN. */
const RESULTS = FILES.map((f) => {
  const source = fs.readFileSync(path.join(DIR, f), 'utf8')
  const name = f.replace(/\.pine$/, '')
  let out
  try { out = translatePine(source) } catch (e) { out = { ok: false, refusal: { guard: `THREW:${e.message}` } } }
  if (!out.ok) return { name, source, ok: false, guard: out.refusal.guard, message: String(out.refusal.message || '') }
  // ⛔ `ok` IS NOT THE CLAIM. A door can translate and hand back something that
  // is not a boolean column, which screens nothing.
  const row = out.outputs[out.selected]
  const parsed = row && row.formula ? parseFormula(row.formula) : null
  const bool = !!(parsed && parsed.ok && treeYieldsBool(parsed.ast))
  return { name, source, ok: bool, guard: bool ? null : 'not-a-boolean-screen', message: '' }
})

const PASSING = RESULTS.filter((r) => r.ok).map((r) => r.name)
const MISSES = RESULTS.filter((r) => !r.ok)

/** 🔴 THE FLOOR. Raise it when the engine earns it; never lower it. */
const FLOOR = 17

describe('the exam this project did not write', () => {
  it('⭐ the corpus is real, blind, and screener-shaped', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(48)
    // ⛔ NON-VACUITY: every fixture is a v6 script that outputs something.
    for (const r of RESULTS) {
      expect(r.source, `${r.name} is not v6`).toContain('//@version=6')
      expect(r.source.match(/\bplot\s*\(/), `${r.name} has no output`).toBeTruthy()
    }
    // Every lens is represented, so the score cannot be carried by one easy
    // family while another is silently absent.
    const lenses = new Set(FILES.map((f) => f.split('-')[0]))
    expect(lenses.size).toBeGreaterThanOrEqual(8)
  })

  it('⏳ the floor moves ONE WAY, and the residual is NAMED', () => {
    const named = MISSES.map((r) => `${r.name} [${r.guard}]`).sort()
    expect(PASSING.length, `misses:\n  ${named.join('\n  ')}`)
      .toBeGreaterThanOrEqual(FLOOR)
  })

  it('⭐⭐ it prints the standing gap, and what is in the way', () => {
    // The buckets, derived — so the roadmap is read off the run rather than
    // typed into a comment that goes stale the way three others did today.
    const byGuard = {}
    for (const r of MISSES) byGuard[r.guard] = (byGuard[r.guard] || 0) + 1
    const missingName = (m) => (m.match(/`(ta\.[a-zA-Z_]+|syminfo\.[a-zA-Z_]+|request\.[a-zA-Z_]+)`/) || [])[1]
    const byName = {}
    for (const r of MISSES) {
      const n = missingName(r.message)
      if (n) byName[n] = (byName[n] || 0) + 1
    }
    console.log(`
BLIND EXAM  ${PASSING.length}/${RESULTS.length} translate to a boolean screen   (authored corpus: 38/38)
guards      ${JSON.stringify(byGuard)}
names       ${JSON.stringify(byName)}
misses      ${MISSES.map((r) => r.name).join(', ')}
`)
    expect(RESULTS.length).toBeGreaterThan(0)
  })

  it('⛔ the judge can FAIL a script — it is not counting everything as a pass', () => {
    // ⚠️ THE CONTROL. Without it, a `treeYieldsBool` that answered truthy for
    // everything would report a perfect score over a broken door. A plain price
    // plot is exactly the shape the `yields` gate exists to stop.
    const priced = translatePine('//@version=6\nindicator("s")\nplot(ta.sma(close, 20))\n')
    expect(priced.ok).toBe(true)
    const row = priced.outputs[priced.selected]
    expect(!!treeYieldsBool(parseFormula(row.formula).ast)).toBe(false)
    // …and it really does pass the ones it counts.
    expect(PASSING.length).toBeGreaterThan(0)
  })
})

describe('⭐ the rulings this corpus earned', () => {
  const S = (body) => `//@version=6
indicator("s")
plot(${body} ? 1 : 0)
`
  const refuse = (body) => {
    const out = translatePine(S(body))
    expect(out.ok, `${body} unexpectedly translated`).toBe(false)
    return out.refusal
  }

  it('⛔⛔ the advice the refusal gives is VERIFIED, not asserted', () => {
    // ⚰️ A REFUSAL THAT NAMES A REWRITE IS A CLAIM ABOUT A RUN. If the sentence
    // tells a member to write `(close - low) / (high - low)` and that spelling
    // refuses too, the refusal is worse than the generic one it replaced — it
    // sends them somewhere and the door is shut there as well. So the advice is
    // EXECUTED here rather than trusted.
    const advised = '(close - low) / (high - low) > 0.7'
    const out = translatePine(S(advised))
    expect(out.ok, out.ok ? '' : `the advice does not translate: ${out.refusal.message}`)
      .toBe(true)
    // And the sentence really does name that spelling, so the two cannot drift.
    const r = refuse('(close - low) / math.max(high - low, syminfo.mintick) > 0.7')
    expect(r.guard).toBe('pine:builtin')
    expect(r.message).toContain('(close - low) / (high - low)')
  })

  it('⭐ it names the IDIOM, and is honest that the answers differ', () => {
    const r = refuse('math.max(high - low, syminfo.mintick) > 1')
    expect(r.message).toContain('math.max(high - low, syminfo.mintick)')
    // ⛔ THE DIFFERENCE IS STATED, NOT GLOSSED. On a zero-range bar Pine answers
    // 0 and this engine answers nothing; a refusal that offered the rewrite as a
    // free simplification would be talking a member into a silent semantic change.
    expect(r.message).toMatch(/NOT COMPUTABLE/)
    expect(r.message).toMatch(/REAL difference/)
  })

  it('⛔ NON-VACUITY: a built-in with no ruling still gets the generic sentence', () => {
    // Without this, a change that appended the mintick paragraph to every
    // built-in refusal would satisfy both cases above.
    const r = refuse('barstate.islast')
    expect(r.guard).toBe('pine:builtin')
    expect(r.message).not.toContain('minimum price increment')
  })
})
