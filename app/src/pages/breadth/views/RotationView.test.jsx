import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RotationView from './RotationView'
import { traceDomain } from './rotation'
import { PALETTES } from './breadthViewShared'

// jsdom serialises an inline colour as rgb(); derive the expectation from the
// palette rather than typing a literal that would outlive it.
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const BULL = rgb(PALETTES.classic.bull)
const BEAR = rgb(PALETTES.classic.bear)

// Newest-first: rsp/spy rising over the window = broadening.
const rows = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  rsp_spy_ratio: 0.70 - i * 0.002,
  iwm_qqq_ratio: 0.50 + i * 0.002,
  vix: 16, vxn: 21,
}))

describe('RotationView', () => {
  it('calls a rising equal-weight ratio broadening', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-verdict-rsp_spy_ratio').textContent).toMatch(/broadening/i)
  })

  it('calls a falling ratio narrowing', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-verdict-iwm_qqq_ratio').textContent).toMatch(/narrowing/i)
  })

  it('marks a series absent rather than drawing it as zero', () => {
    const noVxn = rows.map(r => ({ ...r, vxn: null }))
    const { getByTestId } = render(<RotationView rows={noVxn} rowIdx={0} currentRow={noVxn[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-verdict-vol_spread').textContent).toMatch(/not reported/i)
  })

  // 🔴 THE COLOUR MUST NOT CONTRADICT THE SENTENCE UNDER IT. `vol_spread`
  // inverts: a RISING VXN−VIX is "Narrowing — tech vol bid over the broad
  // market", so the uniform `delta >= 0 ? bull : bear` drew a green number and
  // a green sparkline directly above the word *Narrowing*.
  it('does NOT draw a rising vol spread bullish', () => {
    // Newest-first, so a spread that shrinks as i grows is RISING today.
    const widening = rows.map((r, i) => ({ ...r, vix: 16, vxn: 26 - i * 0.2 }))
    const { getByTestId, container } = render(<RotationView rows={widening} rowIdx={0}
      currentRow={widening[0]} onDrill={() => {}} options={{ lookback: 20, palette: 'classic' }} />)
    expect(getByTestId('rotation-delta-vol_spread').textContent).toMatch(/^\+/)      // it rose
    expect(getByTestId('rotation-verdict-vol_spread').textContent).toMatch(/narrowing/i)
    expect(getByTestId('rotation-delta-vol_spread').style.color).toBe(BEAR)
    expect(container.querySelector('[data-testid="rotation-spark-vol_spread"]').getAttribute('stroke'))
      .toBe(PALETTES.classic.bear)
  })

  it('still draws a rising equal-weight ratio bullish — the flag is per panel', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20, palette: 'classic' }} />)
    expect(getByTestId('rotation-verdict-rsp_spy_ratio').textContent).toMatch(/broadening/i)
    expect(getByTestId('rotation-delta-rsp_spy_ratio').style.color).toBe(BULL)
  })

  // 🔴 "/60d" OVER 12 SESSIONS IS A CLAIM ABOUT HISTORY THE LENS NEVER READ.
  it('states the span it actually measured, never the span it was asked for', () => {
    const short = rows.slice(0, 12)
    const { getByTestId } = render(<RotationView rows={short} rowIdx={0} currentRow={short[0]}
      onDrill={() => {}} options={{ lookback: 60 }} />)
    expect(getByTestId('rotation-delta-rsp_spy_ratio').textContent).toMatch(/\/ 11d$/)
    expect(getByTestId('rotation-delta-rsp_spy_ratio').textContent).not.toMatch(/60d/)
    expect(getByTestId('rotation-basis').textContent)
      .toMatch(/12 sessions · since 2026-08-29 · shorter than the 60-day setting/)
  })

  /**
   * ⭐ THE PANEL NOW DRAWS THE REFERENCE IT MEASURES FROM.
   *
   * A sparkline plus a delta asks the reader to take the delta on trust. The
   * dashed line sits at the reading `measured` sessions back and the panel names
   * that reading in words, so the number beside the trace is checkable off the
   * trace — the same "show the basis" discipline every other lens follows.
   *
   * ⛔ AND THE THREE NUMBERS MUST CLOSE. Reading / reference / delta are three
   * renderings of one subtraction; a rail that only checked they exist would
   * stay green while the reference named a different session than the delta was
   * taken from — which is exactly the drift the `measured` ruling exists for.
   */
  it('draws and names the reference the delta is measured from, and the three close', () => {
    const { getByTestId, container } = render(<RotationView rows={rows} rowIdx={0}
      currentRow={rows[0]} onDrill={() => {}} options={{ lookback: 20 }} />)

    // rows are newest-first with dates 2026-08-40 … 2026-08-01, so 20 sessions
    // back from the newest is 2026-08-20.
    const ref = getByTestId('rotation-reference-rsp_spy_ratio').textContent
    expect(ref).toMatch(/on 2026-08-20$/)
    expect(container.querySelector('[data-testid="rotation-baseline-rsp_spy_ratio"]')).toBeTruthy()

    const num = (s) => Number(String(s).match(/-?\d+\.\d+/)[0])
    const value = num(getByTestId('rotation-value-rsp_spy_ratio').textContent)
    const reference = num(ref)
    const delta = num(getByTestId('rotation-delta-rsp_spy_ratio').textContent)
    expect(value - reference).toBeCloseTo(delta, 3)
    expect(reference).not.toBeCloseTo(value, 3)   // the fixture actually moved
  })

  it('gives the trace a scale the reading can be placed on', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    const bounds = [...getByTestId('rotation-range-rsp_spy_ratio').querySelectorAll('span')]
      .map(s => Number(s.textContent))
    expect(bounds).toHaveLength(2)
    const value = Number(getByTestId('rotation-value-rsp_spy_ratio').textContent)
    const [max, min] = bounds
    expect(max).toBeGreaterThan(min)              // a real range, not a repeat
    expect(value).toBeLessThanOrEqual(max)
    expect(value).toBeGreaterThanOrEqual(min)
  })

  it('carries the basis line every sibling lens carries', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-basis').textContent)
      .toMatch(/40 sessions · since 2026-08-01 · changes measured over 20 sessions/)
  })

  /**
   * 🔴 ONE SESSION OWNED THE AXIS, AND THE OTHER THIRTY-NINE WERE DRAWN FLAT.
   *
   * The traces were scaled to their own min…max, so a single extreme reading
   * took the whole height of the plot and pressed the rest of the window into a
   * hairline on the floor. The lens looked like three mostly-empty rectangles
   * with a spike in each, and it looked that way because it WAS: the ink had
   * been squeezed into 1% of the box it was given.
   *
   * The fix is a Tukey fence intersected with the observed range, so an
   * ordinary series is untouched and only a real outlier moves the axis. Both
   * halves are pinned below, because a domain rule that always trims is as
   * wrong as one that never does.
   */
  describe('the drawn domain', () => {
    // 39 readings inside a four-thousandth band, and one at 2.5.
    const OUT = 9                                    // newest-first index of the spike
    const band = (i) => 0.600 + (i % 5) * 0.001
    const spiky = rows.map((r, i) => ({ ...r, rsp_spy_ratio: i === OUT ? 2.5 : band(i) }))

    // The drawn y of every session, in the polyline's own viewBox units,
    // oldest → newest — the same order the lens plots in.
    const drawnYs = (container, key = 'rsp_spy_ratio') =>
      container.querySelector(`[data-testid="rotation-spark-${key}"]`)
        .getAttribute('points').trim().split(/\s+/).map(p => Number(p.split(',')[1]))

    it('leaves an ordinary series on exactly its own min…max', () => {
      // ⛔ THE CONTROL FOR EVERYTHING BELOW. A fence that trimmed a well-behaved
      // window would be hiding data to make a picture, which is the opposite of
      // the trade this lens makes.
      const vals = Array.from({ length: 40 }, (_, i) => 0.6 + i * 0.001)
      const d = traceDomain(vals)
      expect(d.lo).toBe(Math.min(...vals))
      expect(d.hi).toBe(Math.max(...vals))
      expect(d.clipped).toBe(0)
    })

    it('excludes a single extreme reading, and counts it', () => {
      const vals = spiky.map(r => r.rsp_spy_ratio)
      const d = traceDomain(vals)
      expect(d.clipped).toBe(1)
      expect(d.hi).toBeLessThan(2.5)
      expect(d.max).toBe(2.5)          // the true extreme is still reported
      expect(d.lo).toBe(Math.min(...vals))
    })

    it('always holds the two numbers the panel prints', () => {
      // The reading and the reference are stated in words beside the trace; a
      // domain that excluded either would put the panel's own headline off its
      // own axis. Pin them at both ends of the fence.
      const vals = spiky.map(r => r.rsp_spy_ratio)
      const d = traceDomain(vals, [2.5, -1])
      expect(d.hi).toBeGreaterThanOrEqual(2.5)
      expect(d.lo).toBeLessThanOrEqual(-1)
    })

    it('spends the plot on the window, not on the spike', () => {
      const { container } = render(<RotationView rows={spiky} rowIdx={0} currentRow={spiky[0]}
        onDrill={() => {}} options={{ lookback: 20 }} />)
      const ys = drawnYs(container)
      // The lens plots oldest → newest, so the spike's drawn position is the
      // mirror of its newest-first index.
      const spikeAt = rows.length - 1 - OUT
      const plot = Math.max(...ys) - Math.min(...ys)
      const rest = ys.filter((_, i) => i !== spikeAt)
      const used = (Math.max(...rest) - Math.min(...rest)) / plot
      expect(used).toBeGreaterThan(0.5)

      // ⛔ CONTROL — the same 39 readings under min…max, derived from the
      // fixture rather than remembered: they would have used a fifth of one
      // percent of the plot, which is the flat line this test exists to refuse.
      const vals = spiky.map(r => r.rsp_spy_ratio)
      const rests = vals.filter((_, i) => i !== OUT)
      const naive = (Math.max(...rests) - Math.min(...rests))
        / (Math.max(...vals) - Math.min(...vals))
      expect(naive).toBeLessThan(0.01)
    })

    it('says a session sits outside the range it drew, and stays quiet when none does', () => {
      // ⛔ A TRIMMED AXIS WITH NO NOTICE IS A LIE THE SHAPE TELLS: the spike is
      // drawn held against the ceiling, which reads as a plateau unless the
      // panel says what it did.
      const { getByTestId, unmount } = render(<RotationView rows={spiky} rowIdx={0}
        currentRow={spiky[0]} onDrill={() => {}} options={{ lookback: 20 }} />)
      expect(getByTestId('rotation-clip-rsp_spy_ratio').textContent)
        .toMatch(/1 session outside the drawn range · full span 0\.600–2\.500/)
      unmount()

      // …and the ordinary fixture says nothing, or the notice would be noise.
      const { queryByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
        onDrill={() => {}} options={{ lookback: 20 }} />)
      expect(queryByTestId('rotation-clip-rsp_spy_ratio')).toBeNull()
    })

    it('widens the AXIS ON SCREEN to hold the reading, when today IS the extreme', () => {
      // ⛔ THE PURE-FUNCTION PIN TEST ABOVE IS NOT ENOUGH — it passes whatever
      // the view chooses to hand `traceDomain`. Dropping `[now, prior]` at the
      // call site left every other rail green (mutation-checked), so the pin has
      // to be asserted where it is USED: today's reading printed in 22px type
      // beside an axis that does not reach it is the defect.
      const todaySpike = rows.map((r, i) => (
        { ...r, rsp_spy_ratio: i === 0 ? 2.5 : band(i) }))
      const { getByTestId } = render(<RotationView rows={todaySpike} rowIdx={0}
        currentRow={todaySpike[0]} onDrill={() => {}} options={{ lookback: 20 }} />)
      const value = Number(getByTestId('rotation-value-rsp_spy_ratio').textContent)
      const [hi, lo] = [...getByTestId('rotation-range-rsp_spy_ratio').querySelectorAll('span')]
        .map(s => Number(s.textContent))
      expect(value).toBe(2.5)
      expect(hi).toBeGreaterThanOrEqual(value)
      expect(lo).toBeLessThanOrEqual(value)
      // CONTROL: the fence WOULD have excluded it — this fixture can tell a
      // pinned domain from an unpinned one.
      expect(traceDomain(todaySpike.map(r => r.rsp_spy_ratio)).hi).toBeLessThan(value)
    })

    it('prints the DRAWN bounds beside the trace, not the window extremes', () => {
      // The two numbers are an axis. When the fence has moved, an axis labelled
      // with the window's extremes describes a plot that was never drawn.
      const { getByTestId } = render(<RotationView rows={spiky} rowIdx={0} currentRow={spiky[0]}
        onDrill={() => {}} options={{ lookback: 20 }} />)
      const [hi, lo] = [...getByTestId('rotation-range-rsp_spy_ratio').querySelectorAll('span')]
        .map(s => Number(s.textContent))
      expect(hi).toBeLessThan(2.5)
      expect(hi).toBeGreaterThan(lo)
    })
  })

  /**
   * 🔴 THE LENS GREW A SCROLLBAR TO SHOW THREE NUMBERS.
   *
   * Stacking the panels was right; giving each a 132px floor was not. Three of
   * those plus the gaps and the basis line demanded ~460px before anything was
   * drawn, so the third panel fell below the fold on a 772px viewport and the
   * page scrolled.
   *
   * The number below is not a taste. A 2×2 compare pane on that viewport gets
   * roughly 270px of body, and this lens renders in one — so three panels plus
   * the basis have to fit inside that or the lens scrolls in the layout it is
   * most often seen in. Nothing in the panel may declare a height again.
   */
  it('demands less height than a quarter-size compare pane has', () => {
    const { container } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    const panels = [...container.querySelectorAll('[data-testid^="rotation-panel-"]')]
    expect(panels).toHaveLength(3)

    const demanded = panels.reduce((sum, el) => sum + Number.parseFloat(el.style.minHeight || 0), 0)
    // 240 leaves the basis line and the gaps inside 270. The shipped defect
    // demanded 396 here and would fail this line.
    expect(demanded).toBeLessThanOrEqual(240)
    for (const el of panels) {
      expect(Number(el.style.flexGrow)).toBe(1)
      expect(Number.parseFloat(el.style.flexBasis)).toBe(0)
      expect(el.style.height, 'a panel that declares a height cannot take the one it is offered').toBe('')
    }
  })

  /**
   * 🔴 THE FILL WAS ANCHORED TO THE FLOOR OF THE BOX.
   *
   * These are ratios oscillating in a narrow band; the bottom of the plot is an
   * axis position with no meaning for any of them. Filling to it rendered every
   * wiggle as a change in AREA against an arbitrary baseline, which is what
   * made the traces read as outlier-driven spikes rather than as leadership
   * drifting. A line and the reference it is measured from say the same thing
   * and claim less.
   */
  it('draws a line and its reference, not a filled mountain', () => {
    const { container, getByTestId } = render(<RotationView rows={rows} rowIdx={0}
      currentRow={rows[0]} onDrill={() => {}} options={{ lookback: 20 }} />)
    const panel = container.querySelector('[data-testid="rotation-panel-rsp_spy_ratio"]')
    expect(panel.querySelector('polygon')).toBeNull()
    expect(panel.querySelector('[data-testid="rotation-spark-rsp_spy_ratio"]')
      .getAttribute('fill')).toBe('none')
    expect(getByTestId('rotation-baseline-rsp_spy_ratio')).toBeTruthy()
  })
})
