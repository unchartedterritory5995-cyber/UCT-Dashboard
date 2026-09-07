import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

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

describe('⛔⛔ RISK-004 — the mintick offer SPAN is computed in the wrong index space on any CRLF, multi-line script', () => {
  // ⭐ ROOT CAUSE, confirmed by minimal reduction: `lexPine` normalizes
  // `\r\n?` → `\n` before tokenizing (pine.js `lexPine`, the very first line of
  // the function), so every token's `.index` — and therefore every
  // `spanOfNode(...)` result, including `mintickGuardOffer`'s `callSpan` — is a
  // character offset into the NORMALIZED text. But `translatePine`'s own
  // `source` parameter (the RAW string, `\r\n` intact) is threaded unchanged
  // into `new Resolver(..., { source, ... })` and become `this.source`, which
  // is what `mintickGuardOffer` slices to build its `suggest` text, and what
  // ANY caller (this corpus's own `acceptEveryOffer`, and — as far as this
  // decomposition can tell — the only production "take this offer" path) must
  // splice using `r.span` against the ORIGINAL string.
  //
  // Splicing a NORMALIZED-space span into the RAW string drifts by exactly one
  // character per CRLF line ending that precedes the flagged construct. All 48
  // blind-corpus fixtures are CRLF (Windows-authored), so on any one of them
  // whose `math.max(expr, syminfo.mintick)` sits past line 1, the applied
  // "fix" is NOT the offered `(expr)` — it is a garbled, syntactically
  // unrelated substring near the true location, shifted earlier by the
  // preceding line count.
  //
  // ⛔ THIS IS THE MEASURED CAUSE of the assisted-edit mechanism's zero uplift
  // on the real 48-script corpus: `ACCEPTED.length === PASSING.length`
  // (pine.blindCorpus.test.js, "the accepted floor moves one way too") is not
  // because every offer's fix is insufficient — the ONE offer that exists is
  // silently corrupted before it can be judged, on every corpus script but a
  // hypothetical single-line one.
  //
  // This is a PRODUCT bug in `pine.js` (the offer mechanism itself), not a
  // test/harness defect — RISK-004's decomposition tranche explicitly defers
  // remediation ("do not improve prompts or heuristics yet") to a future,
  // separately-authorized tranche. This test documents the CURRENT, confirmed,
  // reproducible defect so it cannot regress into "we forgot this was broken."

  it('CRLF + multi-line drifts the span by one character per preceding line ending (LF control: no drift)', () => {
    const lf = [
      '//@version=6', 'indicator("t")',
      'gapPct = (open - close[1]) / close[1] * 100',
      'priorHigh = ta.highest(high, 20)[1]',
      'barRange  = math.max(high - low, syminfo.mintick)',
      'plot(barRange > 0 ? 1 : 0)',
    ].join('\n')
    const crlf = lf.replace(/\n/g, '\r\n')

    const outLf = translatePine(lf)
    const outCrlf = translatePine(crlf)
    expect(outLf.ok).toBe(false)
    expect(outCrlf.ok).toBe(false)

    const spanLf = lf.slice(...outLf.refusal.span)
    const spanCrlf = crlf.slice(...outCrlf.refusal.span)

    // LF source: the span correctly covers the whole math.max(...) call.
    expect(spanLf).toBe('math.max(high - low, syminfo.mintick)')
    // CRLF source: the SAME logical script, same offer, but the span is spliced
    // against the un-normalized string — it does NOT cover the call at all.
    // ⚠️ If this assertion ever fails because spanCrlf now equals the correct
    // call text, the underlying bug has been fixed — update this test to assert
    // the CORRECT behavior instead of leaving a stale failing tripwire.
    expect(spanCrlf).not.toBe('math.max(high - low, syminfo.mintick)')

    // Applying the (corrupted) offer to the CRLF source does not reproduce the
    // clean, semantically-equivalent rewrite the LF source gets.
    const appliedLf = lf.slice(0, outLf.refusal.span[0]) + outLf.refusal.suggest + lf.slice(outLf.refusal.span[1])
    expect(translatePine(appliedLf).ok).toBe(true)

    const appliedCrlf = crlf.slice(0, outCrlf.refusal.span[0]) + outCrlf.refusal.suggest + crlf.slice(outCrlf.refusal.span[1])
    const afterCrlf = translatePine(appliedCrlf)
    // The corrupted splice still fails — it did not recover the script.
    expect(afterCrlf.ok).toBe(false)
  })

  it('the real corpus fixture reproduces the same drift (not an artifact of the hand-typed control)', () => {
    // Mirrors tests/fixtures/pine_blind/breakout-gap-up-holding.pine line 10
    // exactly (CRLF, 9 preceding lines) without committing the full fixture body.
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
    const spanText = crlf.slice(...out.refusal.span)
    expect(spanText).not.toContain('math.max(high - low, syminfo.mintick)')
    // The observed drift for this exact fixture shape: 9 characters early —
    // one per each of the 9 CRLF line endings preceding the flagged call.
    expect(spanText).toBe('Range  = math.max(high - low, syminfo')
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
