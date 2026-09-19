// app/src/components/chart/engine/ast/pine.hiddenOnly.test.js
//
// ─── ⛔⛔ RULING 1.2 — A HELPER THE AUTHOR HID IS NOT A COLUMN ───────────────
//
// ⚰️ THE MEASUREMENT THAT MADE IT A RULING. After R-F,
// `high_engagement__03-supertrend-kivancozbilgic` refused on all nine of its
// visible outputs and kept exactly one: line 29,
//
//     mPlot = plot(ohlc4, title="", style=plot.style_circles, linewidth=0)
//     fill(mPlot, pPlot, …)
//
// — the author's untitled band edge. The door OFFERED it, and selected it, so an
// import produced a saveable definition named after a Supertrend that computes
// `(open + high + low + close) / 4`. Owner, 2026-09-12: *"a column offered under
// the script's title that is actually the author's hidden ohlc4 fill edge is a
// mistranslation wearing a label."*
//
// ⭐ THE ENGINE ALREADY REFUSED THE OTHER SPELLING OF THIS. `outputHidden` reads
// `display = display.none` and its own comment cites the Butterworth case, where
// a member was offered a saveable `(high + low + close) / 3` under the title of a
// spectral trend filter. This is the same class arriving as a `fill()` anchor,
// which is why it rides the same `hidden` flag rather than a second mechanism.
//
// ⛔ AND THE TWO TESTS ARE ANDed. Untitled ALONE would refuse a real column the
// author simply did not name; filled ALONE would refuse a named series the author
// plots and also fills against. The controls below hold both directions.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, REFUSALS } from './pine.js'

const REPO = path.resolve(process.cwd(), '..')
const OOS = path.join(REPO, 'tools/c0_oos_fixtures')
const FIX = path.join(REPO, 'tests/fixtures/pine')
const read = (p) => fs.readFileSync(p, 'utf8')
const guardsOf = (r) => [...new Set((r.refusals || []).map((x) => x.guard))]
const HEAD = '//@version=5\nindicator("Band demo")\n'

describe('⛔ branch A — every survivor is a helper the author hid', () => {
  it('⭐⭐ the script that made this a ruling refuses instead of offering `ohlc4`', () => {
    const r = translatePine(read(path.join(OOS, 'high_engagement__03-supertrend-kivancozbilgic.pine')))
    expect(guardsOf(r).sort()).toEqual(['pine:hidden-only', 'pine:state'])
    expect(r.ok).toBe(false)
    // ⛔ NOTHING IS SELECTED. Before the ruling this was output 6 — the fill edge —
    // and the definition a member saved would have been named for a Supertrend.
    expect(r.selected).toBe(-1)
    const anchor = r.outputs[6]
    expect(anchor.formula).toBe('(open + high + low + close) / 4')
    expect(anchor.hidden).toBe(true)
    expect(anchor.hiddenReason).toBe('fill-anchor')
    expect(anchor.handle).toBe('mPlot')
  })

  it('⭐ the visible plots keep their own refusals — the line is ADDED, not substituted', () => {
    // The member needs both halves: what failed, and why the survivor is not offered.
    const r = translatePine(read(path.join(OOS, 'high_engagement__03-supertrend-kivancozbilgic.pine')))
    const state = (r.refusals || []).filter((x) => x.guard === 'pine:state')
    expect(state).toHaveLength(9)
    const hidden = (r.refusals || []).filter((x) => x.guard === 'pine:hidden-only')
    expect(hidden).toHaveLength(1)
    expect(hidden[0].message).toBe(REFUSALS['pine:hidden-only'])
    expect(hidden[0].message).toMatch(/helper series the author hid/)
    expect(hidden[0].line).toBe(29)
  })

  it('⭐ and the `display.none` spelling reaches the same sentence', () => {
    // `10-supertrend.pine:71` is `plot(ohlc4, …, display = display.none)`. Same
    // class, different spelling — it used to decline in silence on this point.
    const r = translatePine(read(path.join(FIX, '10-supertrend.pine')))
    expect(guardsOf(r)).toContain('pine:hidden-only')
    expect(r.selected).toBe(-1)
    expect(r.outputs.find((o) => o.formula).hiddenReason).toBe('author')
  })

  it('a written minimum: one refusing column beside one untitled fill anchor', () => {
    const r = translatePine(`${HEAD}var float m = na
m := math.max(m, close)
edge = plot(ohlc4, "")
top = plot(m, "Top")
fill(edge, top)
`)
    expect(guardsOf(r).sort()).toEqual(['pine:hidden-only', 'pine:state'])
    expect(r.selected).toBe(-1)
  })
})

describe('⭐ branch B — a helper beside a real column is shown, never offered', () => {
  const SRC = `${HEAD}edge = plot(ohlc4, "")
band = plot(ta.sma(close, 20), "Band")
fill(edge, band)
`

  it('the visible column is selected and the anchor is hidden by its own reason', () => {
    const r = translatePine(SRC)
    expect(r.ok).toBe(true)
    expect(guardsOf(r)).not.toContain('pine:hidden-only')
    const sel = r.outputs[r.selected]
    expect(sel.title).toBe('Band')
    expect(sel.formula).toBe('sma(close, 20)')
    const anchor = r.outputs.find((o) => o.handle === 'edge')
    expect(anchor.hidden).toBe(true)
    expect(anchor.hiddenReason).toBe('fill-anchor')
    // ⭐ THE LABEL IS THE AUTHOR'S OWN NAME. `title` is null because the author gave
    // none; the row carries the HANDLE so the renderer never has to fall back to the
    // script's title, which is the fallback that made branch A a mistranslation.
    expect(anchor.title).toBe(null)
    expect(anchor.handle).toBe('edge')
  })
})

describe('⛔ CONTROLS — the two halves of the test, each on its own', () => {
  it('a NAMED plot handed to `fill()` is still a column', () => {
    // Filling against a series does not stop it being one. If this ever refuses,
    // the predicate has been narrowed to "is filled" and it will cost real columns:
    // 33 of the 35 `fill()` calls over the frozen 60 join two plot handles.
    const r = translatePine(`${HEAD}lo = plot(ta.lowest(low, 20), "Lower")
hi = plot(ta.highest(high, 20), "Upper")
fill(lo, hi)
`)
    expect(r.ok).toBe(true)
    expect(guardsOf(r)).not.toContain('pine:hidden-only')
    expect(r.outputs.filter((o) => o.hidden)).toHaveLength(0)
    expect(r.outputs[r.selected].title).toBe('Lower')
  })

  it('an UNTITLED plot that nothing fills is still a column', () => {
    // The commonest shape in the corpus is `plot(x)` with no title at all. Refusing
    // those would empty the door.
    const r = translatePine(`${HEAD}plot(ta.sma(close, 10))
`)
    expect(r.ok).toBe(true)
    expect(guardsOf(r)).not.toContain('pine:hidden-only')
    expect(r.outputs[0].hidden).toBe(false)
    expect(r.selected).toBe(0)
  })

  it('a CONSTANT-only script keeps its own sentence, not this one', () => {
    // ⛔ `pine:constant-only` and `pine:presentation-only` are this engine's judgement
    // about screening; `pine:hidden-only` is about the AUTHOR's own scaffolding. Making
    // the new guard swallow them would replace two precise sentences with a vaguer one.
    const r = translatePine(`${HEAD}plot(42)
`)
    expect(guardsOf(r)).toContain('pine:constant-only')
    expect(guardsOf(r)).not.toContain('pine:hidden-only')
  })
})
