// ─── BARE `highestbars`/`lowestbars`/`pivothigh`/`pivotlow` REFUSED PINE'S
// REAL SHORT-ARGUMENT FORMS — THE NAMESPACED SPELLINGS ALREADY HANDLED THEM,
// BARE NEVER DID ──────────────────────────────────────────────────────────
//
// Pine lets `ta.highestbars(length)` default its source to `high` (`ta.
// lowestbars` to `low`) and `ta.pivothigh(leftbars, rightbars)` default its
// source to `high` (`ta.pivotlow` to `low`) — both already correctly
// translate via `PINE_NAMESPACED_TREE`'s `negatedBars`/`pivotAtConfirmation`
// (shipped 2026-09-11, `requests.md`'s "the 1-arg ta.highest/ta.lowest
// default needs an ARITY layer" thread). But `PINE_NAMESPACED_TREE` is keyed
// on the FULL Pine spelling and deliberately does not apply to the BARE
// name — "a member typing the bare name in OUR box means OUR vocabulary" —
// so a member who wrote `highestbars(20)`/`pivothigh(2, 2)` WITHOUT the
// `ta.` prefix (as real corpus scripts do) got a `pine:arity` refusal even
// though the shape is legal Pine and the intent is unambiguous.
//
// ⭐⭐ THE FIX IS TWO DIFFERENT MECHANISMS, NOT ONE, because the two pairs
// need different corrections:
//   - `highestbars`/`lowestbars`: ONLY a default-source fill. This table's
//     bare 2-argument form already reports the SAME positive-distance
//     convention Pine's namespaced form does (after `negatedBars`'
//     sign flip, which lives only on the namespaced side) — so a plain
//     `PINE_SHORT_FORM` entry (the same mechanism `highest`/`lowest`
//     already use) is the whole fix.
//   - `pivothigh`/`pivotlow`: a default-source fill AND a confirmation-bar
//     SHIFT, because this table's OWN bare 3-argument
//     `pivothigh(source, left, right)` reports the value AT THE PIVOT BAR
//     (unshifted — deliberately, "our own vocabulary"), while Pine's real
//     `ta.pivothigh(left, right)` reports it `right` bars LATER, at
//     confirmation. A plain default-fill would be A DIFFERENT, WRONG
//     ANSWER, not merely an incomplete one — the fix reuses
//     `pivotAtConfirmation`, the SAME function the namespaced form already
//     calls, gated on the NEW 2-argument bare arity so the existing
//     3-argument bare form (source written out) keeps its own unshifted
//     meaning, completely untouched.
//
// Measured against the real 266-script committed corpus, 2026-09-20: of the
// real scripts naming these as their CURRENT unmasked blocker,
// `nubia-auto-midas-anchored-vwap` (highestbars/lowestbars, 8 call sites)
// and `pivot-point-supertrend` (pivothigh/pivotlow) both clear the arity
// refusal and converge on separate, unrelated, pre-existing gaps (a
// multi-statement `if` block; an unfoldable `var` reassignment) — the SAME
// "moves, doesn't fully unlock" shape `timenow`/`time(<timeframe>)` shipped
// with. `cpr-with-mas-super-trend-vwap` (bare `vwap(source)`) is
// DELIBERATELY NOT in this slice — `requests.md` already flags it as a
// DIFFERENT problem (Pine passes a source our zero-argument `vwap` does not
// take, so the fix is a DROP not a FILL, and a previously-attempted drop
// mechanism was measured inert at the position it was tried and removed).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')

const S = (body) => `//@version=6\nindicator("t")\nplot(${body})\n`

describe('⭐ bare highestbars/lowestbars 1-argument short form fills the default source', () => {
  it('highestbars(length) fills high, exactly like the already-shipped namespaced form', () => {
    const t = translatePine(S('highestbars(20)'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('highestbars(high, 20)')
  })

  it('lowestbars(length) fills low', () => {
    const t = translatePine(S('lowestbars(20)'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('lowestbars(low, 20)')
  })

  it('⛔⛔ the EXISTING 2-argument bare form is UNCHANGED — same formula, no shift, no sign flip', () => {
    const short = translatePine(S('highestbars(20)'), { strict: true })
    const full = translatePine(S('highestbars(high, 20)'), { strict: true })
    expect(full.ok, JSON.stringify(full.refusal)).toBe(true)
    expect(full.outputs[full.selected].formula).toBe(short.outputs[short.selected].formula)
  })

  it('⛔ a named argument is NOT eligible for the short form — same refusal as before', () => {
    // Refused even earlier than arity, at the named-argument gate — this
    // table carries no evidenced parameter name for `highestbars`, so a
    // named call meets that refusal before the short form is ever consulted.
    const t = translatePine(S('highestbars(period = 20)'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:named-argument')
  })

  it('⛔ any other argument count still refuses pine:arity', () => {
    const t = translatePine(S('highestbars(close, 20, 5)'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:arity')
  })
})

describe('⭐⭐ bare pivothigh/pivotlow 2-argument short form fills the source AND shifts to confirmation', () => {
  it('pivothigh(left, right) fills high and shifts by `right` bars, exactly like the namespaced form', () => {
    const t = translatePine(S('pivothigh(2, 3)'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('pivothigh(high, 2, 3)[3]')
  })

  it('pivotlow(left, right) fills low and shifts by `right` bars', () => {
    const t = translatePine(S('pivotlow(2, 3)'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('pivotlow(low, 2, 3)[3]')
  })

  it('a zero right-bars offset needs no shift node, exactly like the namespaced form', () => {
    const t = translatePine(S('pivothigh(2, 0)'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('pivothigh(high, 2, 0)')
  })

  // ⛔⛔ THE MOST IMPORTANT REGRESSION THIS FIX MUST NOT CAUSE: the EXISTING
  // 3-argument bare form (source written out) must keep its own, UNSHIFTED
  // meaning -- this table's own vocabulary, exactly as it worked before this
  // fix. A shift applied here would silently move every already-correct
  // script's pivot value by `right` bars.
  it('⛔⛔ the EXISTING 3-argument bare form is UNCHANGED — no shift applied, our own vocabulary', () => {
    const t = translatePine(S('pivothigh(close, 2, 3)'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('pivothigh(close, 2, 3)')
  })

  it('⛔ a named argument is NOT eligible for the short form', () => {
    const t = translatePine(S('pivothigh(leftbars = 2, rightbars = 3)'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:named-argument')
  })

  it('⛔ a non-literal rightbars still refuses — the shift needs a known bar count', () => {
    const t = translatePine(S('pivothigh(2, bar_index > 100 ? 3 : 5)'), { strict: true })
    expect(t.ok).toBe(false)
  })

  it('⛔ any other argument count still refuses pine:arity', () => {
    const t = translatePine(S('pivothigh(2)'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:arity')
  })
})

describe('⭐⭐ the real corpus: both blockers move, neither fully unlocks (same shape as timenow)', () => {
  it('nubia-auto-midas-anchored-vwap clears highestbars/lowestbars, converges on an unrelated multi-statement `if`', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'nubia-auto-midas-anchored-vwap-xdecow__MOpN5jQbSn.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.message).not.toMatch(/highestbars|lowestbars/)
  })

  it('pivot-point-supertrend clears pivothigh/pivotlow, converges on an unrelated unfoldable `var`', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'pivot-point-supertrend__HN4w1eNW3B.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:state')
    expect(t.refusal.message).not.toMatch(/pivothigh|pivotlow/)
  })

  // ⛔⛔ `vwap` IS DELIBERATELY OUT OF SCOPE — CONFIRMED STILL REFUSING,
  // UNCHANGED, EXACTLY AS `requests.md` DOCUMENTS IT.
  it('⛔ cpr-with-mas-super-trend-vwap (bare vwap(source)) is UNCHANGED — still refuses pine:arity on vwap', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'cpr-with-mas-super-trend-vwap-by-guruprasadmeduri__htrxxqBqNz.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:arity')
    expect(t.refusal.message).toMatch(/vwap/)
  })

  it('⛔ CONTROL — a genuinely unimplemented function (ta.nvi) still refuses pine:function', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'smart-money-volume-index-algoalpha__6663950b80.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:function')
    expect(t.refusal.message).toMatch(/ta\.nvi/)
  })
})
