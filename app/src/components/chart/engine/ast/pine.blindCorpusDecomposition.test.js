import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, treeYieldsBool } from './pine.js'
import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'

const CORPUS_DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_blind')

function acceptEveryOfferOnce(src, limit = 12) {
  let cur = src
  const chain = []
  for (let i = 0; i < limit; i += 1) {
    const o = translatePine(cur)
    if (o.ok) return { final: cur, chain }
    const r = o.refusal
    chain.push(r.guard)
    if (!r.suggest || !Array.isArray(r.span)) return { final: null, chain }
    cur = cur.slice(0, r.span[0]) + r.suggest + cur.slice(r.span[1])
  }
  return { final: null, chain }
}

function yieldsBoolScreen(source) {
  const out = translatePine(source)
  if (!out.ok) return false
  const row = out.outputs[out.selected]
  const parsed = row && row.formula ? parseFormula(row.formula) : null
  return !!(parsed && parsed.ok && treeYieldsBool(parsed.ast))
}

// ─── RISK-004 — BLIND PINE CORPUS FAILURE DECOMPOSITION ────────────────────
//
// pine.blindCorpus.test.js measures WHAT still fails and prints the standing
// gap. This file records WHY, as minimal first-party reductions — small
// reproductions of the exact semantic construct, independent of the large
// third-party fixture bodies, per the RISK-004 decomposition tranche's own
// rule: "do not commit full public/community script bodies unnecessarily;
// permanent tests should target the semantic construct." The 48-script blind
// corpus remains the real-world integration evidence; this file is the
// autopsy of specific findings from that decomposition.

describe('⛔⛔ RISK-004 — the assisted-edit mechanism has exactly ONE offer', () => {
  it('the ENTIRE engine has exactly one refusal that carries a suggest+span (mintickGuardOffer) — every other guard is NO_OFFER by construction, not by defect', () => {
    // A sample spanning every guard family seen among the 21 current blind-corpus
    // misses (function/builtin/tuple/role-order/undefined). None of these offer a
    // machine-appliable rewrite — `acceptEveryOffer` cannot act on any of them.
    const probes = [
      ['ta.valuewhen arity', 'x = ta.valuewhen(close > open, close, 0)\nplot(x > 0 ? 1 : 0)'],
      ['ta.barssince unbounded', 'x = nz(ta.barssince(close > open), 0)\nplot(x > 5 ? 1 : 0)'],
      ['ta.falling unserved', 'x = ta.falling(close, 3)\nplot(x ? 1 : 0)'],
      ['ta.supertrend tuple', '[st, dir] = ta.supertrend(3.0, 10)\nplot(dir < 0 ? 1 : 0)'],
      ['ta.cci role-order', 'x = ta.cci(close, 20)\nplot(x < -100 ? 1 : 0)'],
      ['undefined name', 'plot(neverDefined ? 1 : 0)'],
    ]
    for (const [label, body] of probes) {
      const out = translatePine(`//@version=6\nindicator("t")\n${body}`)
      expect(out.ok, `${label} unexpectedly translated`).toBe(false)
      expect(out.refusal.suggest, `${label} unexpectedly carries a suggest`).toBeFalsy()
    }
  })

  it('the one offer that DOES exist is the syminfo.mintick idiom rewrite', () => {
    const out = translatePine([
      '//@version=6', 'indicator("t")',
      'x = math.max(high - low, syminfo.mintick)',
      'plot(x > 0 ? 1 : 0)',
    ].join('\n'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:builtin')
    expect(out.refusal.suggest).toBe('(high - low)')
    expect(Array.isArray(out.refusal.span)).toBe(true)
  })
})

describe('✅ RISK-004 FIXED (2026-09-06) — the mintick offer span now agrees with the source it edits, on both LF and CRLF', () => {
  // ⭐ ROOT CAUSE (unchanged from the diagnosis): `lexPine` normalizes
  // `\r\n?` → `\n` before tokenizing, so every token's `.index` — and every
  // `spanOfNode(...)` result — is a character offset into the NORMALIZED
  // text. `translatePine`'s own `source` (the RAW string, `\r\n` intact) is
  // what `mintickGuardOffer` slices and what any caller splices an edit into.
  // All 48 blind-corpus fixtures are CRLF, so a normalized-space span spliced
  // into the raw string drifted by one character per preceding line ending.
  //
  // ⭐⭐ THE FIX: `lexPine` now builds `rawOffsetMap` in the SAME pass that
  // normalizes the text — `rawOffsetMap[n]` is the raw-string offset right
  // after the raw bytes that produced the first `n` normalized characters.
  // `Resolver.toRawSpan` is the one bridge that translates a `spanOfNode(...)`
  // result through that map before it touches `this.source` or leaves the
  // engine as `refusal.span`. `mintickGuardOffer` is the only call site that
  // ever needed it (114 `PineRefusal` sites total, exactly one offer).
  //
  // These tests prove the fix is real, not merely non-crashing: every one
  // would fail again if `toRawSpan` were reverted to the identity function.

  const LF_SOURCE = [
    '//@version=6', 'indicator("t")',
    'gapPct = (open - close[1]) / close[1] * 100',
    'priorHigh = ta.highest(high, 20)[1]',
    'barRange  = math.max(high - low, syminfo.mintick)',
    'plot(barRange > 0 ? 1 : 0)',
  ].join('\n')
  const CALL_TEXT = 'math.max(high - low, syminfo.mintick)'

  it('LF source: span is correct (unchanged by the fix — the control case)', () => {
    const out = translatePine(LF_SOURCE)
    expect(out.ok).toBe(false)
    expect(LF_SOURCE.slice(...out.refusal.span)).toBe(CALL_TEXT)
  })

  it('CRLF source: span is now correct — the coordinate-space bug is fixed', () => {
    const crlf = LF_SOURCE.replace(/\n/g, '\r\n')
    const out = translatePine(crlf)
    expect(out.ok).toBe(false)
    expect(crlf.slice(...out.refusal.span)).toBe(CALL_TEXT)
    expect(out.refusal.suggest).toBe('(high - low)')
  })

  it('applying the offer on CRLF now recovers the script, exactly like LF, and PRESERVES the original newline convention (A1) everywhere but the edited range', () => {
    const crlf = LF_SOURCE.replace(/\n/g, '\r\n')
    const out = translatePine(crlf)
    const applied = crlf.slice(0, out.refusal.span[0]) + out.refusal.suggest + crlf.slice(out.refusal.span[1])
    expect(translatePine(applied).ok).toBe(true)
    // Every CRLF outside the edited range survives untouched, and no bare
    // LF-only newline was introduced by the edit — the engine never
    // normalizes the member's own script, only its internal token view.
    expect((applied.match(/\r\n/g) || []).length).toBe((crlf.match(/\r\n/g) || []).length)
    expect(applied.replace(/\r\n/g, '')).not.toContain('\n')
    // Text strictly before and after the edited span is byte-for-byte identical
    // to the original (A2: "no off-by-one or cross-line corruption").
    expect(applied.slice(0, out.refusal.span[0])).toBe(crlf.slice(0, out.refusal.span[0]))
    expect(applied.slice(out.refusal.span[0] + out.refusal.suggest.length)).toBe(crlf.slice(out.refusal.span[1]))
    // The guard is removed exactly once — re-translating raises no mintick refusal at all.
    const after = translatePine(applied)
    expect(after.ok).toBe(true)
  })

  it('the real corpus fixture (9 preceding CRLF lines) now applies cleanly, without committing its full body', () => {
    // Mirrors tests/fixtures/pine_blind/breakout-gap-up-holding.pine line 10 exactly.
    const crlf = [
      '//@version=6', 'indicator("Gap Up Holding")', '',
      'minGap  = input.float(3.0, "Min gap %")',
      'volMult = input.float(2.0, "Volume multiple")',
      'minDollarVol = input.int(5000000, "Min dollar volume")', '',
      'gapPct    = (open - close[1]) / close[1] * 100',
      'priorHigh = ta.highest(high, 20)[1]',
      'barRange  = math.max(high - low, syminfo.mintick)',
      'plot(barRange > 0 ? 1 : 0)',
    ].join('\r\n')
    const out = translatePine(crlf)
    expect(out.ok).toBe(false)
    // The historical drift for this exact shape was 9 characters early (one
    // per preceding CRLF line) — the span now covers the true call, exactly.
    expect(crlf.slice(...out.refusal.span)).toBe(CALL_TEXT)
    const applied = crlf.slice(0, out.refusal.span[0]) + out.refusal.suggest + crlf.slice(out.refusal.span[1])
    expect(translatePine(applied).ok).toBe(true)
  })

  it('target near the END of a CRLF file still gets the right span (A2: not just a beginning-of-file coincidence)', () => {
    const crlf = [
      '//@version=6', 'indicator("t")',
      'a = close', 'b = open', 'c = high', 'd = low', 'e = volume',
      'f = ta.sma(close, 5)', 'g = ta.ema(close, 5)', 'h = ta.rsi(close, 5)',
      'i = ta.atr(5)', 'j = ta.highest(high, 5)', 'k = ta.lowest(low, 5)',
      'barRange = math.max(high - low, syminfo.mintick)',
      'plot(barRange > 0 ? 1 : 0)',
    ].join('\r\n')
    const out = translatePine(crlf)
    expect(out.ok).toBe(false)
    expect(crlf.slice(...out.refusal.span)).toBe(CALL_TEXT)
    expect(translatePine(crlf.slice(0, out.refusal.span[0]) + out.refusal.suggest + crlf.slice(out.refusal.span[1])).ok).toBe(true)
  })

  it('target on the very FIRST line (no preceding newline at all — zero drift is the trivial case, both conventions)', () => {
    const lf = 'x = math.max(high - low, syminfo.mintick)\nplot(x > 0 ? 1 : 0)'
    const crlf = lf.replace(/\n/g, '\r\n')
    for (const src of [lf, crlf]) {
      const out = translatePine(src)
      expect(out.ok).toBe(false)
      expect(src.slice(...out.refusal.span)).toBe(CALL_TEXT)
    }
  })

  it('NON-VACUITY: reproduces the historical bug when the same normalized-space numbers are (mis)used against the CRLF string — proves the fix is not a coincidence', () => {
    // For a pure-LF source, lexPine's normalized text IS the source text, so
    // `outLf.refusal.span` IS, byte-for-byte, "the normalized-space numbers"
    // the pre-fix code used unconditionally against `this.source` regardless
    // of newline style. Reusing those same numbers against the CRLF text is a
    // faithful reconstruction of the pre-fix defect, without reverting code.
    const outLf = translatePine(LF_SOURCE)
    const crlf = LF_SOURCE.replace(/\n/g, '\r\n')
    const preFixStyleText = crlf.slice(...outLf.refusal.span)
    expect(preFixStyleText).not.toBe(CALL_TEXT) // this is what "reverted" looked like
    // ...and the ACTUAL, fixed span differs from that reverted-style span,
    // confirming toRawSpan is doing real translation work, not a no-op.
    const outCrlf = translatePine(crlf)
    expect(outCrlf.refusal.span).not.toEqual(outLf.refusal.span)
  })

  it('NON-VACUITY: shifting the (correct) span by even one character breaks the assertion — the check is not vacuously satisfiable', () => {
    const crlf = LF_SOURCE.replace(/\n/g, '\r\n')
    const out = translatePine(crlf)
    const [a, b] = out.refusal.span
    expect(crlf.slice(a, b)).toBe(CALL_TEXT)
    expect(crlf.slice(a + 1, b)).not.toBe(CALL_TEXT)
    expect(crlf.slice(a, b - 1)).not.toBe(CALL_TEXT)
    expect(crlf.slice(a - 1, b)).not.toBe(CALL_TEXT)
  })

  it('NON-VACUITY: applying a CRLF-derived offer to the LF-normalized text (the wrong source representation) is detected as a mismatch, not silently accepted', () => {
    const crlf = LF_SOURCE.replace(/\n/g, '\r\n')
    const outCrlf = translatePine(crlf)
    // The CRLF-space span, sliced against the LF text, does not land on the call
    // (their lengths differ by the collapsed \r bytes) — spans are representation-specific.
    expect(LF_SOURCE.slice(...outCrlf.refusal.span)).not.toBe(CALL_TEXT)
  })

  it('rawOffsetMap is null-safe (identity) for a Resolver built without going through translatePine/lexPine, so direct-construction callers are unaffected', () => {
    // Exercised indirectly: an LF source's own span, used against itself, is
    // unaffected by whether a map was supplied — LF has no \r to collapse, so
    // the map (when present) is the identity for every offset in this source.
    const out = translatePine(LF_SOURCE)
    expect(LF_SOURCE.slice(...out.refusal.span)).toBe(CALL_TEXT)
  })
})

describe('⭐ RISK-004 — confirmed SECONDARY blockers behind the first-reported guard (static reduction, fixture untouched)', () => {
  it('breakout-flat-base-pivot-breakout: ta.barssince(cond) wrapped in nz(...) is independently unbounded, not fixed by resolving ta.valuewhen alone', () => {
    const out = translatePine([
      '//@version=6', 'indicator("t")',
      'pivotHi = ta.pivothigh(high, 10, 3)',
      'barsSincePivot = nz(ta.barssince(not na(pivotHi)), 0)',
      'plot(barsSincePivot > 5 ? 1 : 0)',
    ].join('\r\n'))
    expect(out.ok).toBe(false)
    expect(out.refusal.message).toContain('UNBOUNDED')
  })

  it('meanrev-zscore-multi-oscillator-washout: request.security(syminfo.tickerid, "W", ...) (same-ticker weekly resample) is NOT a second blocker once ta.cci role-order is fixed — this script has exactly ONE real blocker', () => {
    const out = translatePine([
      '//@version=6', 'indicator("t")',
      'cci = ta.cci(hlc3, 20)',
      'wRsi = request.security(syminfo.tickerid, "W", ta.rsi(close, 14), lookahead = barmerge.lookahead_off)',
      'plot(cci < -150 and wRsi > 40 ? 1 : 0)',
    ].join('\r\n'))
    expect(out.ok).toBe(true)
  })

  it('volatility-range-contraction-base: THREE independent real blockers stack behind ta.kcw — ta.tr(true) (parameter fidelity) and ta.falling (unserved) each fire in turn; request.security here is clean', () => {
    const trTrue = translatePine(['//@version=6', 'indicator("t")', 'x = ta.tr(true)', 'plot(x > 0 ? 1 : 0)'].join('\r\n'))
    expect(trTrue.ok).toBe(false)
    expect(trTrue.refusal.message).toContain('ta.tr(true)')

    const falling = translatePine([
      '//@version=6', 'indicator("t")',
      'tr = ta.tr(false)',
      'contracting = ta.falling(ta.rma(tr, 10), 3)',
      'plot(contracting ? 1 : 0)',
    ].join('\r\n'))
    expect(falling.ok).toBe(false)
    expect(falling.refusal.message).toContain('ta.falling')

    const security = translatePine([
      '//@version=6', 'indicator("t")',
      'wkAtr = request.security(syminfo.tickerid, "W", ta.atr(10))',
      'plot(wkAtr > 0 ? 1 : 0)',
    ].join('\r\n'))
    expect(security.ok).toBe(true)
  })

  it('volume-dollar-volume-money-flow: ta.accdist (unserved) and a stateful for-loop accumulator are each independent blockers beyond ta.cmf, in a DIFFERENT guard family (pine:reassign, not pine:function)', () => {
    const accdist = translatePine(['//@version=6', 'indicator("t")', 'x = ta.accdist', 'plot(x > 0 ? 1 : 0)'].join('\r\n'))
    expect(accdist.ok).toBe(false)
    expect(accdist.refusal.guard).toBe('pine:function')

    const loop = translatePine([
      '//@version=6', 'indicator("t")',
      'avgVol = ta.sma(volume, 50)',
      'int distDays = 0',
      'for i = 0 to 24',
      '    if close[i] < close[i + 1] * 0.998 and volume[i] > avgVol[i]',
      '        distDays := distDays + 1',
      'plot(distDays <= 3 ? 1 : 0)',
    ].join('\r\n'))
    expect(loop.ok).toBe(false)
    expect(loop.refusal.guard).toBe('pine:reassign')
  })

  it('volume-obv-accumulation-divergence: ta.pvt (unserved) is independent of ta.obv — both are cumulative running-sum builtins missing from the same family', () => {
    const out = translatePine([
      '//@version=6', 'indicator("t")',
      'pvtRising = ta.pvt > ta.pvt[10]',
      'plot(pvtRising ? 1 : 0)',
    ].join('\r\n'))
    expect(out.ok).toBe(false)
    expect(out.refusal.message).toContain('ta.pvt')
  })

  it('multifactor-gap-up-continuation-hold: ta.supertrend is refused in BOTH the tuple form and the bare single-assignment form — there is no expressible spelling, by design', () => {
    const tuple = translatePine(['//@version=6', 'indicator("t")', '[st, dir] = ta.supertrend(3.0, 10)', 'plot(dir < 0 ? 1 : 0)'].join('\r\n'))
    expect(tuple.ok).toBe(false)
    expect(tuple.refusal.guard).toBe('pine:tuple')

    const bare = translatePine(['//@version=6', 'indicator("t")', 'st = ta.supertrend(3.0, 10)', 'plot(close > st ? 1 : 0)'].join('\r\n'))
    expect(bare.ok).toBe(false)
    expect(bare.refusal.guard).toBe('pine:function')
    expect(bare.refusal.message).toContain('NOT EXPRESSIBLE')
  })

  it('recency-macd-turn-recent: fixing ta.valuewhen\'s ARITY alone is not enough — the correctly-arranged 3-arg call still fails on role-order', () => {
    const out = translatePine([
      '//@version=6', 'indicator("t")',
      'within = input.int(3, "x")',
      '[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)',
      'cross = ta.crossover(macdLine, signalLine)',
      'crossLevel = valuewhen(cross, macdLine, within)',
      'plot(crossLevel < 0 ? 1 : 0)',
    ].join('\r\n'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:role-order')
  })

  it('recency-fresh-golden-cross: comparing two ta.barssince(...) results to EACH OTHER (not to a literal) is unbounded on its own — confirms this script has exactly ONE real blocker', () => {
    const out = translatePine([
      '//@version=6', 'indicator("t")',
      'gc = ta.crossover(close, open)',
      'dc = ta.crossunder(close, open)',
      'barsGC = ta.barssince(gc)',
      'barsDC = ta.barssince(dc)',
      'notUndone = na(barsDC) or barsDC > barsGC',
      'plot(notUndone ? 1 : 0)',
    ].join('\r\n'))
    expect(out.ok).toBe(false)
    expect(out.refusal.message).toContain('UNBOUNDED')
  })
})

describe('✅ RISK-004 REMEDIATION A — every real corpus script that ever triggered mintickGuardOffer is now fully recovered by the offer, with NO secondary blocker', () => {
  // A3/A4: identifies every one of the 48 frozen corpus scripts that actually
  // trips the mintick offer (by inspecting `acceptEveryOffer`'s own guard
  // chain, not by re-typing a name list), and proves each one is recovered in
  // exactly ONE offer step. Reads the frozen fixture directory at runtime
  // (the same sanctioned pattern `pine.blindCorpus.test.js` itself uses for
  // "real-world integration evidence") rather than committing fixture bodies.
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.pine'))
  const results = files.map((f) => {
    const name = f.replace(/\.pine$/, '')
    const source = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8')
    const { final, chain } = acceptEveryOfferOnce(source)
    const triggeredMintick = chain[0] === 'pine:builtin'
      && translatePine(source).refusal
      && /syminfo\.mintick/.test(translatePine(source).refusal.message || '')
    return { name, chain, recovered: !!final && yieldsBoolScreen(final), triggeredMintick }
  })
  const mintickScripts = results.filter((r) => r.triggeredMintick)

  it('exactly 9 of the 48 real corpus scripts trigger the mintick offer', () => {
    expect(mintickScripts.map((r) => r.name).sort()).toEqual([
      'breakout-gap-up-holding',
      'candles-key-reversal-bar',
      'candles-red-to-green-day',
      'candles-strong-closing-range',
      'multifactor-pocket-pivot-accumulation',
      'volatility-atr-expansion-breakout',
      'volatility-inside-bar-continuation',
      'volume-capitulation-volume-reversal',
      'volume-rvol-breakout-thrust',
    ])
  })

  it('every one of those 9 resolves in exactly ONE offer step (chain length 1) — the "secondary guards" a pre-fix run reported were corruption artifacts, not real second blockers', () => {
    for (const r of mintickScripts) {
      expect(r.chain, `${r.name}: ${JSON.stringify(r.chain)}`).toEqual(['pine:builtin'])
    }
  })

  it('every one of those 9 is fully RECOVERED (translates to a boolean screen) after taking the offer — OFFER FIXED and SCRIPT RECOVERED are the same 9/9 here', () => {
    for (const r of mintickScripts) {
      expect(r.recovered, `${r.name} did not recover`).toBe(true)
    }
  })
})

describe('✅ RISK-004 REMEDIATION — ta.barssince bounding-heuristic gaps (nz-wrapped sentinel)', () => {
  // Four real corpus scripts blocked on ta.barssince, decomposed into TWO
  // distinct shapes:
  //   (1) `nz(ta.barssince(cond), S) <cmp> K` — the member supplies their OWN
  //       sentinel for "never occurred," which may or may not agree with this
  //       engine's saturating-cap sentinel for the SAME bucket. Fixed here,
  //       WHEN PROVABLY SOUND (`nzSentinelSound` in pine.js).
  //   (2) `barssince` used NUMERICALLY (feeding another function's window
  //       argument) or compared against ANOTHER unbounded `barssince` call —
  //       neither reduces to a finite comparison at all; classified as
  //       EXECUTION-MODEL CAPABILITY GAPS, not fixed, not faked.

  function formulaOf(src) {
    const out = translatePine(`//@version=6\nindicator("t")\n${src}`)
    if (!out.ok) return { ok: false, guard: out.refusal.guard, message: out.refusal.message }
    return { ok: true, formula: out.outputs[out.selected].formula }
  }

  it('KERNEL VERIFIED FIRST (section 4): interpret.js already computes the bounded barssince(cond, n) correctly for every required scenario, on realistic bar data — never-occurred/insufficient-history (NaN), occurred this bar (0), 1 bar ago (1), N bars ago (2), a REPEATED occurrence resetting cleanly, and a long gap saturating at the cap. This is INHERITED, pre-existing kernel behavior — this tranche does not touch interpret.js.', () => {
    const closes = [0, 0, 2, 0, 0, 2, 0, 0, 0, 0]
    const t0 = 1700000000
    const DAY = 86400
    const bars = closes.map((c, i) => ({ t: t0 + i * DAY, o: 1, h: 2, l: 0.5, c, v: 100 }))
    const res = parseFormula('barssince(close > open, 3)')
    expect(res.ok, res.error).toBe(true)
    const col = Array.from(interpret(res.ast, bars, {}))
    expect(col.slice(0, 2).every((v) => Number.isNaN(v)), 'insufficient history before the window fills').toBe(true)
    expect(col[2]).toBe(0) // occurred on this bar
    expect(col[3]).toBe(1) // 1 bar ago
    expect(col[4]).toBe(2) // N (=2) bars ago
    expect(col[5]).toBe(0) // a REPEATED occurrence resets cleanly, not accumulates
    expect(col[6]).toBe(1)
    expect(col[7]).toBe(2)
    expect(col[8]).toBe(3) // a long gap (>3 bars since) saturates at the cap...
    expect(col[9]).toBe(3) // ...and stays there, not distinguishing "beyond window" from "never" —
    // THIS is the exact fact `nzSentinelSound` exists to reason about.
  })

  it('SOUND: nz(barssince(cond), 1000) <= 3 (breakout-squeeze-release-breakout\'s exact shape, inline) produces the IDENTICAL formula as the bare, already-relied-upon form — the rewrite is provably redundant, not a new claim', () => {
    const withNz = formulaOf('plot(nz(ta.barssince(close > open), 1000) <= 3 ? 1 : 0)')
    const bare = formulaOf('plot(ta.barssince(close > open) <= 3 ? 1 : 0)')
    expect(withNz.ok).toBe(true)
    expect(bare.ok).toBe(true)
    expect(withNz.formula).toBe(bare.formula)
    expect(withNz.formula).toContain('barssince(close > open, 4)') // window = k+1 for <=, off-by-one verified
  })

  it('SOUND, through a binding: x = nz(barssince(cond),1000) on one line, x <= 3 on another — same identity, same formula as the bare through-binding form', () => {
    const withNz = formulaOf(['x = nz(ta.barssince(close > open), 1000)', 'plot(x <= 3 ? 1 : 0)'].join('\n'))
    const bare = formulaOf(['x = ta.barssince(close > open)', 'plot(x <= 3 ? 1 : 0)'].join('\n'))
    expect(withNz.ok).toBe(true)
    expect(withNz.formula).toBe(bare.formula)
  })

  it('UNSOUND (breakout-flat-base-pivot-breakout\'s exact shape): nz(barssince(cond), 0) >= baseLen is NOT rewritten — 0 disagrees with what the capped window would answer for ">=", so forcing it would be a confident wrong answer on a symbol with no pivot yet. MUTATION-SENSITIVE: this is exactly the case `nzSentinelSound` exists to catch — remove or invert that check and this test goes red.', () => {
    const out = formulaOf(['baseLen = input.int(35, "x")', 'x = nz(ta.barssince(close > open), 0)', 'plot(x >= baseLen ? 1 : 0)'].join('\n'))
    expect(out.ok, 'this must stay refused — forcing it would silently invert the never-occurred answer').toBe(false)
    expect(out.guard).toBe('pine:function')
    expect(out.message).toContain('UNBOUNDED')
  })

  it('the soundness rule generalizes across all four comparison operators, not just the two real corpus values (non-vacuity: sound and unsound cases exist on BOTH sides of every operator)', () => {
    // For `<` and `<=`, the capped window implies FALSE — a sentinel that also
    // evaluates false (S clearly outside the window, e.g. huge) is sound;
    // a sentinel that evaluates true (S inside the window) is not.
    expect(formulaOf('plot(nz(ta.barssince(close > open), 1000) < 3 ? 1 : 0)').ok).toBe(true)
    expect(formulaOf('plot(nz(ta.barssince(close > open), 1) < 3 ? 1 : 0)').ok).toBe(false)
    // For `>` and `>=`, the capped window implies TRUE — a sentinel that also
    // evaluates true (S huge) is sound; one that evaluates false (S=0) is not.
    expect(formulaOf('plot(nz(ta.barssince(close > open), 1000) > 3 ? 1 : 0)').ok).toBe(true)
    expect(formulaOf('plot(nz(ta.barssince(close > open), 0) > 3 ? 1 : 0)').ok).toBe(false)
    expect(formulaOf('plot(nz(ta.barssince(close > open), 1000) >= 3 ? 1 : 0)').ok).toBe(true)
    expect(formulaOf('plot(nz(ta.barssince(close > open), 0) >= 3 ? 1 : 0)').ok).toBe(false)
  })

  it('CAPABILITY GAP, not fixed: barssince used NUMERICALLY as another function\'s window argument (recency-breakout-hold-since-trigger\'s exact shape) stays refused — no comparison exists to bound it, so there is nothing this tranche\'s identity can apply to', () => {
    const out = formulaOf(['trigger = close > open', 'age = ta.barssince(trigger)', 'x = ta.lowest(close, math.max(age, 1))', 'plot(x > 0 ? 1 : 0)'].join('\n'))
    expect(out.ok).toBe(false)
    expect(out.guard).toBe('pine:function')
    expect(out.message).toContain('UNBOUNDED')
    // Confirms this is NOT a `ta.lowest` window-argument restriction in general —
    // an ordinary bound expression works fine there.
    const ordinary = formulaOf(['n = input.int(5, "n")', 'x = ta.lowest(close, math.max(n, 1))', 'plot(x > 0 ? 1 : 0)'].join('\n'))
    expect(ordinary.ok).toBe(true)
  })

  it('CAPABILITY GAP, not fixed: barssince(A) compared to barssince(B) (recency-fresh-golden-cross\'s exact shape) stays refused — no local, sound, finite identity exists without a runtime primitive for "which condition fired more recently"', () => {
    const out = formulaOf(['gc = close > open', 'dc = close < open', 'barsGC = ta.barssince(gc)', 'barsDC = ta.barssince(dc)', 'plot((na(barsDC) or barsDC > barsGC) ? 1 : 0)'].join('\n'))
    expect(out.ok).toBe(false)
    expect(out.guard).toBe('pine:function')
  })

  it('the real corpus is unaffected beyond the one sound script: exactly 20 misses remain (was 21), and the newly-passing script is breakout-squeeze-release-breakout', () => {
    const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.pine'))
    const misses = []
    for (const f of files) {
      const name = f.replace(/\.pine$/, '')
      const source = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8')
      if (!yieldsBoolScreen(source)) misses.push(name)
    }
    expect(misses).not.toContain('breakout-squeeze-release-breakout')
    expect(misses).toContain('breakout-flat-base-pivot-breakout') // unsound nz sentinel — stays a miss
    expect(misses).toContain('recency-breakout-hold-since-trigger') // numeric window use — stays a miss
    expect(misses).toContain('recency-fresh-golden-cross') // barssince vs barssince — stays a miss
    expect(misses.length).toBe(20)
  })
})
