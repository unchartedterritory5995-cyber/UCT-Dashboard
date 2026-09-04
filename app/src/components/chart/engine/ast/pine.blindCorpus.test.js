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


/** The member taking the door's own offer: splice `suggest` over `span`, repeat. */
function acceptEveryOffer(src, limit = 12) {
  let cur = src
  for (let i = 0; i < limit; i += 1) {
    let o
    try { o = translatePine(cur) } catch (e) { return null }
    if (o.ok) return cur
    const r = o.refusal
    if (!r || !r.suggest || !Array.isArray(r.span)) return null
    cur = cur.slice(0, r.span[0]) + r.suggest + cur.slice(r.span[1])
  }
  return null
}

const ACCEPTED = FILES.filter((f) => {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8')
  const taken = acceptEveryOffer(src)
  if (!taken) return false
  const out = translatePine(taken)
  if (!out.ok) return false
  const row = out.outputs[out.selected]
  const parsed = row && row.formula ? parseFormula(row.formula) : null
  return !!(parsed && parsed.ok && treeYieldsBool(parsed.ast))
})

/** ⭐ THE SECOND NUMBER, AND IT IS A DIFFERENT CLAIM: what a paste reaches
 *  once the member takes the engine's OWN offer, in a click rather than a retype. */
const ACCEPT_FLOOR = 26

/** ⭐ 2026-09-04 — 18 → 19 / 25 → 26: the RUN-LENGTH COUNTER identity
 *  (`pine.runLength.test.js`). `var n = 0` + `n := cond ? n + 1 : 0` compared
 *  against a whole number is decided by that many bars, so `pine:state` left this
 *  exam's guard histogram entirely. It widened no vocabulary — a genuine running
 *  total still refuses, and that control is the first test in the new file. */
/** 🔴 THE FLOOR. Raise it when the engine earns it; never lower it. */
const FLOOR = 19

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
    // ⚰️ THE HISTOGRAM ABOVE COUNTS ONLY THE **FIRST** REFUSAL PER SCRIPT, and
    // reading it as a roadmap OVERSTATES what any one fix buys. Measured: of the
    // ten scripts whose first blocker is a vendor ambiguity, four ALSO need
    // `request.security`, `ta.linreg` or `ta.kcw` — permanently. Settling all
    // four ambiguous definitions therefore unlocks six scripts, not ten.
    // ⭐ SO THE SECOND HISTOGRAM READS THE SOURCE, not the first stumble: every
    // name a miss MENTIONS that this engine does not serve. It is the honest
    // "what would it take", and it is derived so it cannot drift.
    const BLOCKED = /\b(?:ta\.(?:rising|falling|bbw|percentrank|median|cmf|obv|supertrend|valuewhen|cci|linreg|kcw)|request\.security|syminfo\.mintick)\b/g
    const needs = {}
    for (const r of MISSES) {
      for (const n of new Set(r.source.match(BLOCKED) || [])) {
        needs[n] = (needs[n] || 0) + 1
      }
    }
    // ⭐⭐ THE THIRD HISTOGRAM, AND IT IS THE ONE THAT DIRECTS WORK. `needs`
    // above counts every miss INCLUDING the ones an offer already recovers, so it
    // overstates what each name would buy. This counts only what is still blocked
    // after the member takes every offer, so "serve this and N scripts translate"
    // is READ OFF THE EXAM rather than estimated. Measured 2026-09-04, it is what
    // showed `request.security` gating four scripts no other work can reach, and
    // `ta.rising` five that are otherwise ONE name from translating.
    const stillBlocked = {}
    for (const r of MISSES) {
      if (ACCEPTED.includes(`${r.name}.pine`)) continue
      for (const n of new Set(r.source.match(BLOCKED) || [])) {
        (stillBlocked[n] || (stillBlocked[n] = [])).push(r.name)
      }
    }
    const ranked = Object.entries(stillBlocked)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([n, l]) => `${n}×${l.length}`).join('  ')
    const soleBlocker = MISSES.filter(
      (r) => new Set(r.source.match(BLOCKED) || []).size <= 1).length
    console.log(`
BLIND EXAM  ${PASSING.length}/${RESULTS.length} translate to a boolean screen   (authored corpus: 38/38)
guards      ${JSON.stringify(byGuard)}
names       ${JSON.stringify(byName)}
after offer ${ACCEPTED.length}/${RESULTS.length} once the member takes the door's own offer\nneeds (all) ${JSON.stringify(needs)}\none blocker ${soleBlocker}/${MISSES.length} misses need exactly ONE unserved name\nstill short ${ranked}\nmisses      ${MISSES.map((r) => r.name).join(', ')}
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

describe('⭐⭐ ta.kc — and the smoother is the whole point', () => {
  const kc = (body) => {
    const out = translatePine(`//@version=6\nindicator("s")\n${body}\n`)
    expect(out.ok, out.ok ? '' : out.refusal.message).toBe(true)
    return out.outputs[out.selected].formula
  }
  const UP = '[m, u, l] = ta.kc(close, 20, 2.0)\nplot(close > u ? 1 : 0)'

  it('⛔⛔ the range is smoothed with ema, NOT atr', () => {
    // ⚰️ THE LOOK-ALIKE THIS ENTRY EXISTS TO AVOID. Almost every third-party
    // Keltner — and TradingView's own CHART indicator of the same name — smooths
    // true range with ATR/RMA (Wilder alpha 1/L). `ta.kc` uses ema, alpha
    // 2/(L+1). At length 20 that is 0.0952 against 0.05: roughly twice the
    // responsiveness, wrong on every mature bar, and silent.
    const f = kc(UP)
    expect(f).toContain('ema(')
    expect(f, 'the band is smoothed with atr — that is a different indicator')
      .not.toContain('atr(')
  })

  it('⭐ every leg is the vendor formula, and MIDDLE comes first', () => {
    const TR = 'max(high - low, max(abs(high - close[1]), abs(low - close[1])))'
    expect(kc('[m, u, l] = ta.kc(close, 20, 2.0)\nplot(close > m ? 1 : 0)'))
      .toBe('close > ema(close, 20) ? 1 : 0')
    expect(kc(UP)).toBe(`close > ema(close, 20) + 2 * ema(${TR}, 20) ? 1 : 0`)
    expect(kc('[m, u, l] = ta.kc(close, 20, 2.0)\nplot(close < l ? 1 : 0)'))
      .toBe(`close < ema(close, 20) - 2 * ema(${TR}, 20) ? 1 : 0`)
  })

  it('⭐ useTrueRange=false swaps true range for the bar span', () => {
    expect(kc('[m, u, l] = ta.kc(close, 20, 2.0, false)\nplot(close > u ? 1 : 0)'))
      .toBe('close > ema(close, 20) + 2 * ema(high - low, 20) ? 1 : 0')
    // …and `true` is the same as omitting it, which is Pine's own default.
    expect(kc('[m, u, l] = ta.kc(close, 20, 2.0, true)\nplot(close > u ? 1 : 0)'))
      .toBe(kc(UP))
  })

  it('⛔ a NON-LITERAL useTrueRange is refused, not guessed', () => {
    // The flag decides WHICH range is built, so it has to be readable at
    // translate time. Anything else falls through to the ordinary refusal
    // rather than being assumed true.
    const out = translatePine('//@version=6\nindicator(\"s\")\nf = close > open\n[m, u, l] = ta.kc(close, 20, 2.0, f)\nplot(close > u ? 1 : 0)\n')
    expect(out.ok).toBe(false)
  })
})

const kcS = (b) => `//@version=6\nindicator("s")\nplot(${b} ? 1 : 0)\n`

describe('⭐⭐ an offer a member can TAKE, not retype', () => {
  it('⏳ the accepted floor moves one way too', () => {
    expect(ACCEPTED.length, `accepted: ${ACCEPTED.join(', ')}`)
      .toBeGreaterThanOrEqual(ACCEPT_FLOOR)
    // ⛔ AND IT MUST BEAT THE PASTE NUMBER, or the offer machinery is doing
    // nothing and this is a second name for the first measurement.
    expect(ACCEPTED.length).toBeGreaterThan(PASSING.length)
  })

  it('⛔⛔ the replacement is PARENTHESISED, and that is not cosmetic', () => {
    // ⚰️ SPLICING A BARE `high - low` INTO A DIVISION REASSOCIATES IT.
    // `(close - low) / math.max(high - low, syminfo.mintick)` would become
    // `(close - low) / high - low` — which PARSES, translates, and answers a
    // different number on every bar. A fix that silently breaks the expression it
    // repairs is worse than the refusal it replaced.
    const src = kcS('(close - low) / math.max(high - low, syminfo.mintick) > 0.7')
    const out = translatePine(src)
    expect(out.ok).toBe(false)
    expect(out.refusal.suggest).toBe('(high - low)')
    const taken = src.slice(0, out.refusal.span[0]) + out.refusal.suggest
      + src.slice(out.refusal.span[1])
    expect(taken).toContain('(close - low) / (high - low)')
    const after = translatePine(taken)
    expect(after.ok, after.ok ? '' : after.refusal.message).toBe(true)
    expect(after.outputs[after.selected].formula)
      .toBe('(close - low) / (high - low) > 0.7 ? 1 : 0')
  })

  it('⛔ the span covers the WHOLE call, not the operator inside it', () => {
    // A binary node's own token is the OPERATOR, so a naive span would replace
    // one character in the middle of the member's expression.
    const src = kcS('math.max(high - low, syminfo.mintick) > 1')
    const r = translatePine(src).refusal
    expect(src.slice(r.span[0], r.span[1]))
      .toBe('math.max(high - low, syminfo.mintick)')
  })

  it('⛔ it stays an OFFER — nothing is rewritten without the member', () => {
    // The two answers genuinely differ on a zero-range bar (Pine says 0, this
    // engine says nothing), so taking it is consent. Untaken, it still refuses.
    const out = translatePine(kcS('math.max(high - low, syminfo.mintick) > 1'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:builtin')
  })
})
