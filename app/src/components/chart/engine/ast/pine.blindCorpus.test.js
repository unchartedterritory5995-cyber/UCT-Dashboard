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
 *  once the member takes the engine's OWN offer, in a click rather than a retype.
 *
 *  ⭐⭐ 28 -> 27 LOOKS LIKE A REGRESSION AND IS NOT ONE. This constant was
 *  ALREADY STALE before Vendor Parity Tranche 2 touched it: the program's own
 *  Project Evidence & Assumption Audit (2026-09-05) established that "28/48
 *  is NOT current truth" for this exact blind-corpus claim — the verified,
 *  reproducible baseline going into this tranche was 21/48, not 28 — but this
 *  ONE constant was missed by that correction pass and stayed silently wrong
 *  (a second-authority-over-one-value defect this program keeps finding).
 *
 *  21 -> 27 IS VENDOR PARITY TRANCHE 2, LANE B (2026-09-06): `ta.rising`,
 *  `ta.median`, `ta.percentrank` and `ta.bbw` declared, each resolved by a
 *  real TradingView capture (`closedTable.json::_functions_vendor_parity_resolutions`),
 *  not by guessing to close this gap. MEASURED, not assumed
 *  higher: the remaining 21 misses are blocked by OTHER unimplemented names
 *  this authorization does not cover — `syminfo.mintick` (9), `ta.valuewhen`
 *  (arity, not a missing name), `ta.falling` (rising's twin, deliberately
 *  NOT authorized alongside it), `ta.cci`, `ta.supertrend`, `ta.kcw`,
 *  `ta.cmf`, `ta.obv` — see the exam's own `console.log('still short ...')`
 *  output. Implementing any of those is a separate, future authorization,
 *  not a way to force this floor higher.
 *
 *  ⭐⭐ 27 -> 36 IS RISK-004 REMEDIATION A (2026-09-06): the mintick offer's
 *  span was computed in `lexPine`'s LF-normalized index space and spliced
 *  into `this.source` (the RAW, `\r\n`-intact script) — corrupting every
 *  application on a CRLF, multi-line source, which every one of these 48
 *  fixtures is. `lexPine` now also returns `rawOffsetMap`, and
 *  `Resolver.toRawSpan` translates through it before the offer touches
 *  `this.source` or leaves as `refusal.span`. All 9 of the corpus's
 *  `syminfo.mintick` misses now apply in exactly one offer step and fully
 *  recover — see `pine.blindCorpusDecomposition.test.js`. This is a REAL
 *  gain, not a bookkeeping correction: the engine earned it.
 *
 *  ⭐⭐ 36 -> 37 IS RISK-004 REMEDIATION, `ta.barssince` (2026-09-06):
 *  `breakout-squeeze-release-breakout`'s `nz(ta.barssince(squeeze), 1000) <=
 *  3` now recovers on RAW translation — it needed no offer at all, since
 *  `contextBoundedPlan` is a compile-time static identity, not an
 *  assisted-edit — so it counts here too. See `FLOOR`, below, for the
 *  raw-side accounting of the same change.
 *
 *  ⭐⭐ 37 -> 38 IS VENDOR-BACKED UNSERVED BUILTINS, BATCH 1 (2026-09-06),
 *  tracking `FLOOR`'s 28 -> 29 move one-for-one: `candles-doji-at-extension`
 *  needed no assisted offer either, since `ta.falling`'s translation is a
 *  RAW gain like `ta.barssince`'s. See `FLOOR`'s own note for the full
 *  accounting of what did and did not move in this tranche.
 *
 *  🔴🔴 38 -> 36 IS A CORRECTNESS CORRECTION, NOT A REGRESSION (RISK-043,
 *  2026-09-07): `volume-pocket-pivot-up-volume` and
 *  `meanrev-consecutive-down-closes-exhaustion` were both COUNTED HERE, and
 *  both were SILENT_WRONG_RESULT the entire time. Each mutates a scalar
 *  inside a top-level `for` loop (`maxDownVol`, `downCount`) and reads it
 *  afterward through an ordinary intermediate binding
 *  (`screen = ... volume > maxDownVol ...` / `streak = downCount >= minDown`)
 *  rather than directly inside the output call. The translator's closing-pass
 *  safety net for an un-foldable loop mutation ran once, AFTER the whole
 *  script had already been walked — too late for a binding made earlier in
 *  program order, which had already captured a stale, pre-loop snapshot of
 *  the mutated name and silently folded it into a compile-time constant. See
 *  `FLOOR`'s own note on the same tranche, and the permanent regression net
 *  at `pine.forLoopReassignSilentWrongResult.test.js`. The floor drops
 *  because two scripts that used to be silently, confidently wrong are now
 *  correctly refused — this is the engine getting MORE honest, not less
 *  capable, and this program's own correctness policy ranks that above the
 *  headline count. Do not restore these two to ACCEPTED without first
 *  implementing genuine loop-carried-state execution (not authorized). */
const ACCEPT_FLOOR = 36

/** ⭐⭐ THE NAMES THIS EXAM CALLS UNSERVED — WITH A PROBE FOR EACH, so the list
 *  cannot quietly go stale.
 *
 *  ⚰️ `ta.linreg` SAT IN THIS LIST WHILE THE ENGINE SERVED IT. Three misses were
 *  reported as needing a name they already had, so the histogram whose whole job
 *  is to DIRECT work pointed at a job already done — the hand-typed-list defect
 *  this repo keeps paying for, in the artifact meant to measure the gap honestly.
 *  The probes are the fix: a name may sit in this roster only while a minimal
 *  script using it actually refuses, and the rail below checks that every run.
 */
const UNSERVED_PROBES = Object.freeze({
  // ⭐⭐ VENDOR PARITY TRANCHE 2, LANE B (2026-09-06) MOVED `ta.rising`,
  // `ta.bbw`, `ta.percentrank` and `ta.median` OUT of this roster and INTO
  // `SERVED_CONTROLS` below — each now resolves, so a probe for it here
  // would fail this file's own staleness check ("a name may sit in this
  // roster only while a minimal script using it actually refuses").
  // ⭐⭐ VENDOR-BACKED UNSERVED BUILTINS — BATCH 1 (2026-09-06) MOVED
  // `ta.falling` and `ta.kcw` OUT of this roster too, for the same reason —
  // see `SERVED_CONTROLS`'s own note.
  'ta.cmf': 'plot(ta.cmf(21) > 0.1 ? 1 : 0)',
  'ta.obv': 'plot(ta.obv > 1000 ? 1 : 0)',
  'ta.accdist': 'plot(ta.accdist > 1000 ? 1 : 0)',
  'ta.supertrend': '[st, dir] = ta.supertrend(3.0, 10)\nplot(dir < 0 and st > 0 ? 1 : 0)',
  'ta.valuewhen': 'plot(ta.valuewhen(close > open, close, 0) > 10 ? 1 : 0)',
  'ta.cci': 'plot(ta.cci(close, 20) > 100 ? 1 : 0)',
  // ➕ ADDENDUM 2026-09-12 (ruling 3.5, `29d64a2ef`): this probe asked for "D" and
  // "D" now TRANSLATES — a literal naming the engine's own base folds to the identity.
  // ⛔ So `request.security` is no longer WHOLLY unserved: it serves the base period,
  // `W`, `M`, and another nameable symbol. What remains unserved is the
  // UNSERVABLE-TIMEFRAME case, so the probe is re-pointed at "60" and the name's row
  // keeps measuring a real gap.
  // ⭐ THE RAIL CAUGHT THIS ITSELF, saying the histograms were "overstating the gap by
  // one name" — which they were.
  'request.security': 'plot(request.security(syminfo.tickerid, "60", close) > 10 ? 1 : 0)',
  'syminfo.mintick': 'plot(high - low > syminfo.mintick ? 1 : 0)',
})
const UNSERVED = Object.keys(UNSERVED_PROBES)

/** ⛔ THE CONTROL SIDE: names the engine DOES serve. Without these a probe
 *  helper that refused every input would keep the roster check green over a list
 *  that had gone entirely wrong. `ta.linreg` leads because it is the one that
 *  was wrong. */
const SERVED_CONTROLS = Object.freeze({
  'ta.linreg': 'plot(ta.linreg(close, 20, 0) > ta.linreg(close, 20, 1) ? 1 : 0)',
  'ta.mfi': 'plot(ta.mfi(hlc3, 14) > 50 ? 1 : 0)',
  'ta.dev': 'plot(ta.dev(close, 20) > 1 ? 1 : 0)',
  // ⭐⭐ VENDOR PARITY TRANCHE 2, LANE B (2026-09-06) — moved from
  // UNSERVED_PROBES above now that each resolves via a real vendor capture.
  'ta.rising': 'plot(ta.rising(close, 3) ? 1 : 0)',
  'ta.bbw': 'plot(ta.bbw(close, 20, 2) > 0.1 ? 1 : 0)',
  'ta.percentrank': 'plot(ta.percentrank(close, 10) > 50 ? 1 : 0)',
  'ta.median': 'plot(ta.median(close, 4) > 10 ? 1 : 0)',
  // ⭐⭐ VENDOR-BACKED UNSERVED BUILTINS — BATCH 1 (2026-09-06) — resolved by
  // real TradingView capture (`tests/fixtures/vendor/observations/
  // ta-falling-close3-2026-09-06.json` / `ta-kcw-close20-2-2026-09-06.json`).
  // `ta.pvt`'s windowed-delta rewrite is proven separately, through the
  // comparison shape a member actually writes — see `pine.batch1VendorBacked
  // .test.js`'s `ta.pvt` describe block — a bare `ta.pvt` probe here would
  // correctly still refuse (the LEVEL stays excluded, exactly like `ta.obv`).
  'ta.falling': 'plot(ta.falling(close, 3) ? 1 : 0)',
  'ta.kcw': 'plot(ta.kcw(close, 20, 2.0) > 0.1 ? 1 : 0)',
})

/** ⭐ 2026-09-04 — 20 → 21 / 27 → 28: A VENUE-QUALIFIED TICKER.
 *  `"AMEX:SPY"` is the spelling `ticker.new('AMEX', 'SPY')` already took; the
 *  string form refused it only because a colon fails `TICKER_SHAPE`. Fixing that
 *  also CLOSED a hole in the other spelling, which had been dropping non-US
 *  venues silently. See `pine.security.test.js`. */
/** ⭐ 2026-09-04 — 19 → 20 / 26 → 27: OBV AGAINST ITS OWN AVERAGE
 *  (`pine.obvAverage.test.js`). `obv - sma(obv, n)` is a finite sum of `obvN`
 *  differences, so the fetch-dependent baseline cancels. The LEVEL is still
 *  refused and `_functions_excluded.obv` still says so — what became sayable is
 *  the COMPARISON, exactly as `obv > obv[k]` already was. */
/** ⭐ 2026-09-04 — 18 → 19 / 25 → 26: the RUN-LENGTH COUNTER identity
 *  (`pine.runLength.test.js`). `var n = 0` + `n := cond ? n + 1 : 0` compared
 *  against a whole number is decided by that many bars, so `pine:state` left this
 *  exam's guard histogram entirely. It widened no vocabulary — a genuine running
 *  total still refuses, and that control is the first test in the new file. */
/** ⭐ 2026-09-06 — RISK-004 blind-corpus decomposition tranche: re-running this
 *  exam against current HEAD found `PASSING.length` already at 27 (Vendor
 *  Parity Tranche 2 Lane B had moved it there on 2026-09-05, but this
 *  constant was never ratcheted to match — a bookkeeping lag, not a
 *  regression). Corrected here per that tranche's explicit "a trivial
 *  bookkeeping/documentation error required to report the truth" allowance.
 *  No engine behavior changed; only this floor's own honesty. */
/** ⭐⭐ 27 -> 28 IS RISK-004 REMEDIATION, `ta.barssince` (2026-09-06):
 *  `contextBoundedPlan` (pine.js) now also recognises `nz(ta.barssince(cond),
 *  S) <cmp> K` — inline and through a binding — as the SAME bounded identity
 *  already used for the bare form, WHEN `S`'s own truth under `<cmp> K`
 *  agrees with what the capped window would answer (`nzSentinelSound`).
 *  `breakout-squeeze-release-breakout` is sound and now translates outright,
 *  RAW, needing no offer. The other three `ta.barssince` misses stay refused,
 *  correctly: one supplies a sentinel that DISAGREES with the cap (forcing it
 *  would silently invert the answer on a symbol with no pivot yet — a
 *  confident wrong result this engine will not manufacture), and two use
 *  `barssince` numerically or compare it against ANOTHER unbounded
 *  `barssince` call — neither reduces to any finite comparison at all, and
 *  both are recorded as execution-model capability gaps, not fixed. See
 *  `pine.blindCorpusDecomposition.test.js`. */
/** ⭐⭐ 28 -> 29 IS VENDOR-BACKED UNSERVED BUILTINS, BATCH 1 (2026-09-06):
 *  `ta.falling` declared (`interpret.js::windowFallingMonotone`, resolved by
 *  an INDEPENDENT real vendor capture rather than assumed symmetry with
 *  `ta.rising` — see `closedTable.json`'s `falling_resolution`), `ta.kcw`
 *  declared (`BUILTIN_CALL_TREE.kcw`, composed from already-declared `ema`
 *  and `ta.tr`'s own expansion), and the `ta.pvt` windowed-delta rewrite
 *  declared (`pvtN`, mirroring `obvN` exactly). `candles-doji-at-extension`
 *  needed only `ta.falling` and now translates RAW, needing no offer at all.
 *  MEASURED, not assumed higher: `volatility-range-contraction-base` needs
 *  BOTH `ta.kcw` and `ta.falling` and STILL misses — its real remaining
 *  blocker is `request.security`, an unrelated pre-existing gap — and
 *  `volume-obv-accumulation-divergence` needed only `ta.pvt`'s windowed
 *  delta (now served) but its SAME boolean expression also reads `ta.obv`'s
 *  bare LEVEL (`obvLine = ta.obv`, used in `obvNewHigh`/`obvLine > obvSig`),
 *  which stays permanently refused for the reason `_functions_excluded.obv`
 *  states — a genuine secondary blocker, not a partial implementation.
 *  `ta.cmf` and `ta.accdist` were deliberately NOT implemented:
 *  `volume-dollar-volume-money-flow` (which needs both) correctly still
 *  misses. See `tests/test_vendor_parity_batch1.py` and
 *  `pine.batch1VendorBacked.test.js` for the vendor evidence and mutation
 *  controls behind each of these three. */
/** 🔴 THE FLOOR. Raise it when the engine earns it; never lower it —
 *  EXCEPT for a documented correctness correction, below.
 *
 *  🔴🔴 29 -> 27 IS THE SAME CORRECTNESS CORRECTION AS `ACCEPT_FLOOR`'s
 *  38 -> 36 (RISK-043, 2026-09-07), one-for-one: `volume-pocket-pivot-up-volume`
 *  and `meanrev-consecutive-down-closes-exhaustion` were both counted as RAW
 *  passes and both were SILENT_WRONG_RESULT — a scalar mutated inside a
 *  top-level `for` loop, read afterward through an intermediate binding, and
 *  silently folded to its pre-loop value instead of refusing. See
 *  `ACCEPT_FLOOR`'s note for the full mechanism and
 *  `pine.forLoopReassignSilentWrongResult.test.js` for the permanent
 *  regression net. This is a correctness improvement lowering a headline
 *  number, not a capability regression — do not chase the number back up by
 *  reverting the fix. */
const FLOOR = 27

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
    // ⛔ BUILT FROM `UNSERVED`, never retyped — see that roster for why.
    const BLOCKED = new RegExp('\\b(?:' + UNSERVED.map(function (n) { return n.replace('.', '\\.') }).join('|') + ')\\b', 'g')
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
      // ⚰️ READ OFF THE REFUSAL, NOT OFF THE SOURCE. This scanned the script text
      // for roster names, which counts a name the script MENTIONS rather than one
      // that stops it. Measured 2026-09-04: that reported `request.security`
      // gating FOUR scripts while the engine served every shape they used — three
      // of the four were stopped by `ta.rising`, `ta.bbw` and `ta.cci`, and the
      // fourth by an exchange prefix. A histogram whose whole job is to direct
      // work sent it at a name that blocked nothing.
      for (const n of UNSERVED) {
        if (r.message.includes(n)) (stillBlocked[n] || (stillBlocked[n] = [])).push(r.name)
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

  it('⛔⛔ THE BLOCKER ROSTER IS NOT STALE — every name in it really does refuse', () => {
    const wrap = (body) => '//@version=6\nindicator("s")\n' + body + '\n'
    for (const [name, body] of Object.entries(UNSERVED_PROBES)) {
      const out = translatePine(wrap(body))
      expect(out.ok, name + ' is listed as unserved but TRANSLATES — every '
        + 'histogram above is overstating the gap by one name').toBe(false)
    }
    // ⛔ THE CONTROL, and it is what makes the loop above mean anything: a helper
    // that refused every input would pass a roster that had gone completely wrong.
    for (const [name, body] of Object.entries(SERVED_CONTROLS)) {
      const out = translatePine(wrap(body))
      expect(out.ok, 'control ' + name + ' should translate but refused: '
        + (out.ok ? '' : out.refusal.message)).toBe(true)
    }
    // ⛔ AND THE TWO SIDES MUST BE DISJOINT, or a name could sit in both and the
    // pair of loops above would contradict each other rather than check anything.
    for (const n of Object.keys(SERVED_CONTROLS)) expect(UNSERVED).not.toContain(n)
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
    // ⚰️ THIS USED `barstate.islast`, WHICH NOW TRANSLATES. Its refusal was
    // withdrawn on 2026-09-09 (the newest bar is the same bar at any fetch
    // depth), so the control had quietly become a test of a name that no longer
    // refuses — it would have gone red for the right reason and been "fixed" by
    // deleting it. `timeframe.period` is a REAL Pine built-in this engine still
    // holds no column for and has ruled nothing about, which is exactly the
    // property this control needs.
    const r = refuse('timeframe.period')
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
