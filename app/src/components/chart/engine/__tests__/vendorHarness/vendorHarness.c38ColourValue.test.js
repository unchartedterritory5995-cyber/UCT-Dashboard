// ─── ⭐⭐ C38 — A COLOUR'S COMPONENT AS A PLOTTED VALUE, THROUGH THE MEMBER DOOR ──
//
// `vw-gradient-spy-1d-2026-09-30` plots colours as their COMPONENTS
// (`color.r/g/b/t`), so every reading is a number per bar. C29 scored
// `runtime/colours.js::fromGradient` against it with its own rail; at the door the
// probe refused `pine:colour-value` on its first `color.r`. It is graded here by
// the harness itself (`gradeCapture`: the real member door, the real comparator).
//
// ⚠️ WHAT THE DOOR CAN CARRY OF A 23-ROW PROBE. Every row depends on `bar_index`
// (TradingView's, 8175 on the window's first bar), so it is graded on
// TradingView's whole history (`c38Joined.js`). The member pane carries twelve
// visible rows and hides a constant one — both by ruling — so the probe's source
// is graded three ways: UNEDITED (the twelve rows the pane carries), and in two
// halves cut from it so each of the 22 component / control rows is carried. The
// second half lifts its six constant rows off the pane's constant rule with
// `+ close * 0` (C29's own device). Every number compared is the vendor's.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { gradeCapture } from './harness'
import { parent, joinedFromListing, keepPlotLines, vendorColumn } from './c38Joined'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const GRADIENT = 'vw-gradient-spy-1d-2026-09-30'
const CONTROL = 'G00_bar_index_CONTROL'
const cap = parent(GRADIENT)
const TITLES = cap.study.plots.filter((p) => p.title).map((p) => p.title)
const notMatch = (v) => (v.plots || []).filter((p) => p.verdict !== 'MATCH').map((p) => `${p.title}: ${p.verdict}`)
const plotOf = (v, title) => v.plots.find((p) => p.title === title)
/** The rows that read a colour's component (everything but the two inputs, the
 *  control and the plot that only WEARS a colour). */
const COMPONENT_ROWS = TITLES.filter((t) => !['G00_bar_index_CONTROL', 'G01_v', 'G06_w', 'G22_drawn_in_g1'].includes(t))
const CONSTANT_ROWS = ['G14_g3_t_new30', 'G17_new_red_70p5_t', 'G18_new_red_70p5_r',
  'G19_new_0064C8_70p5_t', 'G20_new_0064C8_70p4_t', 'G21_cA_t_CONTROL']

describe('C38 — vw-gradient: a colour component is a column', () => {
  it('the probe is no longer refused at the door (as captured, 300 bars)', () => {
    expect(TITLES.length).toBe(23)
    expect(COMPONENT_ROWS.length).toBe(19)
    const { verdict, ours } = gradeCapture(cap)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(verdict.reason).not.toMatch(/refused on our side/)
  })

  it('UNEDITED, on TradingView\'s history: the twelve rows the pane carries MATCH on all 300 bars', () => {
    const { verdict, integrity } = gradeCapture(joinedFromListing(cap, { control: CONTROL }))
    expect(integrity.ok, (integrity.errors || []).join('; ')).toBe(true)
    const matched = verdict.plots.filter((p) => p.verdict === 'MATCH').map((p) => p.title)
    expect(matched).toEqual(TITLES.slice(0, 12))
    for (const t of matched) {
      expect(plotOf(verdict, t).stats.matching, t).toBe(300)
      expect(plotOf(verdict, t).warmupBars, t).toBe(0)
    }
    // the rest are not WRONG, they are not carried: the pane's twelve-row ceiling,
    // and its rule that a constant row is hidden (its values still agree)
    for (const p of verdict.plots.filter((x) => x.verdict !== 'MATCH')) {
      expect(p.verdict, p.title).toBe('INCONCLUSIVE')
      if (CONSTANT_ROWS.includes(p.title)) {
        expect(p.reason, p.title).toMatch(/hidden \(constant\)/)
        expect(p.stats.matching, p.title).toBe(300)
      } else {
        expect(p.reason, p.title).toMatch(/did not carry this output/)
      }
    }
  })

  it('rows G00–G11 (g1, the clamped g2, g3\'s red): MATCH', () => {
    const keep = TITLES.slice(0, 12)
    const { verdict } = gradeCapture(joinedFromListing(cap, { control: CONTROL, id: 'a', keep, source: keepPlotLines(keep) }))
    expect(notMatch(verdict)).toEqual([])
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    expect(verdict.plots.map((p) => p.title)).toEqual(keep)
    for (const p of verdict.plots) expect(p.stats.matching, p.title).toBe(300)
  })

  /** The second half: the control, then rows G12–G22, the constant rows carried. */
  const secondHalf = (mutateVendor) => {
    const keep = [CONTROL, ...TITLES.slice(12)]
    const carried = (text) => keepPlotLines(keep)(text).split('\n').map((l) => {
      const m = /^plot\((color\.[rgbt]\([A-Za-z0-9]+\)),(\s*)("([A-Za-z0-9_]+)")\)$/.exec(l)
      return m && CONSTANT_ROWS.includes(m[4]) ? `plot(${m[1]} + close * 0,${m[2]}${m[3]})` : l
    }).join('\n')
    return { keep, joined: joinedFromListing(cap, { control: CONTROL, id: 'b', keep, source: carried, mutateVendor }) }
  }

  it('rows G12–G21 (g3, g4\'s transparency sweep, `color.new(c, 70.5)`): MATCH', () => {
    const { keep, joined } = secondHalf()
    for (const t of CONSTANT_ROWS) expect(joined.source.text, t).toContain(` + close * 0,`)
    const { verdict } = gradeCapture(joined)
    expect(verdict.plots.map((p) => p.title)).toEqual(keep)
    // ⭐ THE ONE ROW THAT IS NOT A COMPONENT READ: `plot(v, color = g1)` WEARS the
    // gradient. ⚰️ On C38's own branch this row was a DIVERGE on colour — a
    // gradient as a plot COLOUR was not carried (ruling R-G kept the line, in the
    // pane's gold). Wave 10 also carries C37's `colourGradientRule`, which draws
    // exactly that, so the row is TradingView's on every bar: value AND colour.
    // Measured on the merged tree; nothing in this capture is left not-MATCH.
    expect(notMatch(verdict)).toEqual([])
    const worn = plotOf(verdict, 'G22_drawn_in_g1')
    expect(worn.stats.valueMismatches + worn.stats.naMismatches).toBe(0)
    for (const p of verdict.plots) {
      expect(p.stats.matching, p.title).toBe(300)
    }
  })

  it('every one of the 19 component rows was graded MATCH by one of the two halves', () => {
    const a = gradeCapture(joinedFromListing(cap, { control: CONTROL, id: 'a', keep: TITLES.slice(0, 12), source: keepPlotLines(TITLES.slice(0, 12)) })).verdict
    const b = gradeCapture(secondHalf().joined).verdict
    const matched = new Set([...a.plots, ...b.plots].filter((p) => p.verdict === 'MATCH' && p.stats.matching === 300).map((p) => p.title))
    expect(COMPONENT_ROWS.filter((t) => !matched.has(t))).toEqual([])
  })

  it('NON-VACUITY — the capture really sweeps, clamps and truncates', () => {
    const r1 = vendorColumn(cap, 'G02_g1_r')
    expect(new Set(r1).size).toBeGreaterThan(90)                       // a sweep, not a constant
    expect(Math.min(...r1)).toBe(0)
    expect(Math.max(...r1)).toBe(255)
    const w = vendorColumn(cap, 'G06_w')
    expect(w.filter((x) => x < 0 || x > 1).length).toBeGreaterThan(50)  // the clamp is exercised
    const t4 = vendorColumn(cap, 'G15_g4_t_interp_0_to_100')
    expect(Math.min(...t4)).toBe(0)
    expect(Math.max(...t4)).toBe(100)
    expect(vendorColumn(cap, 'G17_new_red_70p5_t').every((x) => x === 70)).toBe(true)
  })

  it('CONTROL — the grade can fail: one vendor component moved by 1 is a DIVERGE at that bar', () => {
    const { joined } = secondHalf((fields, rows) => {
      const at = fields.indexOf(cap.study.plots.find((p) => p.title === 'G16_g4_r').id)
      rows[7][at] += 1
    })
    const { verdict } = gradeCapture(joined)
    // (G22 left this list in wave 10: C37 carries the gradient as a plot colour.)
    expect(notMatch(verdict)).toEqual(['G16_g4_r: DIVERGE'])
    expect(plotOf(verdict, 'G16_g4_r').stats.valueMismatches).toBe(1)
  })
})
