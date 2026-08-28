import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { TABLE } from './parse.js'

/**
 * A NAME THE MEMBER BOUND MEANS WHAT THEY BOUND IT TO.
 *
 * ⚰️⚰️ THIS SHIPPED WRONG, ON THE GREEN ROSTER, IN TWO COMMUNITY SCRIPTS.
 * `resolveName` consulted `this.table.series` and then the manifest's 111 SCALARS
 * before it ever looked at the pasted script's own bindings. Those scalars are
 * SCREENER COLUMNS — our vocabulary, injected into the namespace as a
 * convenience. They are not Pine built-ins, and a member writing Pine has no idea
 * that `nr7` or `price` means something to us.
 *
 * So `nr7 = <seven-bar narrow range test>` followed by `plot(nr7)` translated to
 * the literal column `nr7`. The member's own arithmetic was DISCARDED and replaced
 * with our screener's answer to a similar-sounding question — silently, with no
 * refusal, under the member's own script title, and it SAVED and SCANNED that way.
 * `16-nr4-nr7` emitted a correct NR4 column beside a fabricated NR7 one in the
 * same script; every output of `21-ma-cross-alert-mtf-chartart` read our `price`
 * column instead of the source the author selected.
 *
 * ⛔ THIS IS THE THIRD INSTANCE OF ONE DEFECT CLASS IN THIS FILE. `ownSymbolNameOf`
 * was fixed for it, and its comment states the rule — "the binding is consulted
 * FIRST and the order is the whole guard". `ownTimeframeOf` was fixed for it the
 * same way after `period = "60"` read as the chart's own timeframe. Both fixes
 * were applied to a caller; neither was applied HERE, at the general name
 * resolver they are special cases of.
 */
describe('a member binding beats our vocabulary', () => {
  const src = (body) => `//@version=4\nstudy("t")\n${body}\n`

  const formulaOf = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = out.outputs.find((o) => o.refusal === null)
    expect(row, 'no output translated').toBeTruthy()
    return row.formula
  }

  // ─── the corpus is not empty of collisions, and that is the point ──────────

  it('⭐ the manifest really does declare the names these scripts bind', () => {
    // ⛔ THE NON-VACUITY CONTROL. Every assertion below is worthless if the names
    // it uses are not actually in our vocabulary — the test would pass on a
    // codebase where the bug is impossible. Derived from the manifest, never typed.
    const scalars = Object.keys(TABLE.scalars || {})
    expect(scalars.length).toBeGreaterThan(50)
    expect(scalars).toContain('nr7')
    expect(scalars).toContain('price')
  })

  // ─── the defect, minimally ────────────────────────────────────────────────

  it('⛔⛔ a bound name that collides with a SCALAR resolves to the binding', () => {
    // Before the fix this returned `nr7 ? 1 : 0` — our screener's narrow-range
    // flag — for a member who wrote a comparison of two bar fields.
    expect(formulaOf(translatePine(src(
      `nr7 = close > open
plot(nr7 ? 1 : 0)`)))).toBe('close > open ? 1 : 0')
  })

  it('⛔⛔ …and so does one that collides with a BAR FIELD', () => {
    // `close` is a real Pine built-in, so valid v5 cannot rebind it — but v2/v3
    // could, our door accepts those, and honouring what the script says is the
    // only reading that is right in both.
    expect(formulaOf(translatePine(src(
      `price = close * 2
plot(price)`)))).toBe('close * 2')
  })

  it('⭐ the binding wins even when it is only reachable through another binding', () => {
    // The resolver follows bindings; the bug was in the ORDER, so a name reached
    // at depth must not quietly fall back to the table either.
    expect(formulaOf(translatePine(src(
      `price = high - low
spread = price
plot(spread)`)))).toBe('high - low')
  })

  // ─── the controls: our vocabulary still works when NOT shadowed ────────────

  it('⭐ an UNBOUND scalar still resolves to our column', () => {
    // ⛔ THE CONTROL THAT STOPS THE FIX FROM BEING A DELETION. Reading manifest
    // scalars by name is a deliberate feature — a member may write `plot(nr7)` and
    // mean our column. Only a name they BOUND may take it away from them.
    expect(formulaOf(translatePine(src('plot(nr7 ? 1 : 0)')))).toBe('nr7 ? 1 : 0')
  })

  it('⭐ an UNBOUND bar field still resolves to the bar field', () => {
    expect(formulaOf(translatePine(src('plot(close)')))).toBe('close')
  })

  it('⭐ and a derived price series still expands', () => {
    // `hl2` is expanded from the table rather than declared; it sits between the
    // two lookups the fix reorders, so it needs its own control.
    expect(formulaOf(translatePine(src('plot(hl2)')))).toBe('(high + low) / 2')
  })

  it('⭐ …but a member who binds `hl2` gets their own', () => {
    expect(formulaOf(translatePine(src(
      `hl2 = close
plot(hl2)`)))).toBe('close')
  })

  // ─── the two real scripts ─────────────────────────────────────────────────

  it('⛔⛔ the NR7 column is the script\'s own arithmetic, not our flag', () => {
    // The narrower half of the real defect: this script's NR4 output was always
    // correct, so the script looked healthy. Only the second output was fabricated.
    const out = translatePine(src(
      `tr = max(high - low, max(abs(high - close[1]), abs(low - close[1])))
nr4 = (tr <= tr[1]) and (tr <= tr[2]) and (tr <= tr[3])
nr7 = nr4 and (tr <= tr[4])
plot(nr7 ? 1 : 0)`))
    const f = formulaOf(out)
    expect(f).not.toBe('nr7 ? 1 : 0')
    expect(f).toContain('high - low')
  })
})
