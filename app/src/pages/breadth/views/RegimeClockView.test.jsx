import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RegimeClockView, { quadrantOf } from './RegimeClockView'
import { optionsSchema } from './viewMetricConfig'

const mkRows = (levels) => levels.map((v, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, pct_above_50sma: v }))

describe('quadrantOf', () => {
  it('names each of the four regimes', () => {
    expect(quadrantOf(70, 5)).toBe('Expansion')
    expect(quadrantOf(30, 5)).toBe('Recovery')
    expect(quadrantOf(70, -5)).toBe('Distribution')
    expect(quadrantOf(30, -5)).toBe('Contraction')
  })

  // The four cases above all sit 20 points clear of the level boundary, so
  // every one of them passes whether the comparison is `>= 50` or `> 50`. The
  // one reading that tells those apart is exactly 50 — the midpoint of a
  // participation percentage, and a value a real series lands on.
  it('treats a level of exactly 50 as the BROAD side, not the narrow one', () => {
    expect(quadrantOf(50, 5)).toBe('Expansion')
    expect(quadrantOf(50, -5)).toBe('Distribution')
    // …and the neighbouring reading is on the other side, so this is a
    // boundary, not a constant.
    expect(quadrantOf(49.9, 5)).toBe('Recovery')
    expect(quadrantOf(49.9, -5)).toBe('Contraction')
  })

  it('treats momentum of exactly 0 as improving, not deteriorating', () => {
    expect(quadrantOf(70, 0)).toBe('Expansion')
    expect(quadrantOf(30, 0)).toBe('Recovery')
    expect(quadrantOf(70, -0.1)).toBe('Distribution')
  })
})

describe('RegimeClockView', () => {
  // rows are newest-first: today 70, 20 sessions ago 40 → momentum +30, level 70.
  const rows = mkRows([70, ...Array.from({ length: 19 }, () => 55), 40, 38, 36])

  it('reports the regime from level and momentum together', () => {
    const { getByTestId } = render(<RegimeClockView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10 }} />)
    expect(getByTestId('clock-regime').textContent).toBe('Expansion')
    expect(getByTestId('clock-momentum').textContent).toBe('+30.0')
  })

  it('reads momentum from the option window, not a fixed one', () => {
    // 10 sessions ago is 55 → momentum +15, not +30.
    const { getByTestId } = render(<RegimeClockView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ rocWindow: 10, level: 'pct_above_50sma', trail: 10 }} />)
    expect(getByTestId('clock-momentum').textContent).toBe('+15.0')
  })

  it('refuses rather than guessing when the window is too short', () => {
    const { getByTestId, queryByTestId } = render(<RegimeClockView rows={mkRows([70, 60, 50])} rowIdx={0}
      currentRow={{ pct_above_50sma: 70 }} onDrill={() => {}}
      options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10 }} />)
    expect(queryByTestId('clock-regime')).toBeNull()
    expect(getByTestId('clock-refusal').textContent).toMatch(/needs 21 sessions/i)
  })

  /**
   * 🔴 "LEVEL 52.1 · MOMENTUM −4.3" WAS A CAPTION, NOT A PLOT.
   *
   * The clock drew a trail through an unlabelled box: you could see the path but
   * could not read a value off it, which is the one thing an xy plot is for.
   *
   * ⛔ AND THE Y AXIS IS SELF-SCALING (`maxMom = Math.max(10, …)`), so a
   * hardcoded ±10 axis would have been a LIE the first time momentum ran hotter
   * than ten points — a reading two thirds of the way up the box would be read
   * as +6.7. The ticks are derived from the same bound the dots are placed with,
   * and these two cases differ only in that bound.
   */
  describe('the plot carries a scale, derived from the bound it drew with', () => {
    const ticks = (container, axis) =>
      [...container.querySelectorAll(`[data-testid^="clock-tick-${axis}-"]`)].map(el => el.textContent)
    const draw = (rs, opts = {}) => render(<RegimeClockView rows={rs} rowIdx={0} currentRow={rs[0]}
      onDrill={() => {}} options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10, ...opts }} />)

    it('labels the momentum axis from the trail’s OWN bound', () => {
      const { container, getByTestId } = draw(rows)
      expect(getByTestId('clock-momentum').textContent).toBe('+30.0')   // the bound is 30
      expect(ticks(container, 'y')).toEqual(['+30', '+15', '0', '-15', '-30'])
      expect(getByTestId('clock-basis').textContent).toMatch(/y-axis 20d momentum ±30/)
    })

    it('falls back to the floor bound on a quiet trail, and the ticks follow', () => {
      // Momentum of +1 over the window: `maxMom` clamps to its floor of 10, and
      // an axis that ignored the bound would be indistinguishable from the case
      // above. Same component, same options, different scale.
      const calm = mkRows([51, ...Array.from({ length: 19 }, () => 50), 50, 50, 50])
      const { container, getByTestId } = draw(calm)
      expect(getByTestId('clock-momentum').textContent).toBe('+1.0')
      expect(ticks(container, 'y')).toEqual(['+10', '+5', '0', '-5', '-10'])
      expect(getByTestId('clock-basis').textContent).toMatch(/±10/)
    })

    it('ticks the level axis end to end, because that one IS a percentage', () => {
      const { container } = draw(rows)
      expect(ticks(container, 'x')).toEqual(['0', '25', '50', '75', '100'])
    })

    /**
     * The svg is `preserveAspectRatio="none"`, so anything inside it is
     * stretched by whatever shape the pane happens to be — the four quadrant
     * names were svg `<text>` and were being drawn several times wider than
     * tall. Every label is HTML now.
     */
    it('keeps its type out of the stretched svg', () => {
      const { container } = draw(rows)
      expect(container.querySelectorAll('svg text')).toHaveLength(0)
      // …and every name is still on screen. Contraction and Distribution are
      // neither the headline regime nor the note beneath it, so finding them
      // proves the CORNER labels survived the move rather than the header.
      for (const q of ['Recovery', 'Expansion', 'Contraction', 'Distribution']) {
        expect(container.textContent, `the ${q} corner lost its name`).toContain(q)
      }
      expect(container.textContent).toContain('PARTICIPATION LEVEL %')
    })
  })

  // The refusal used to read "Needs 21 sessions of pct_above_50sma" — the raw
  // field key, at a reader the Customize panel has only ever shown "% above 50
  // SMA" to. One series, two names, and the internal one was on screen.
  it('names the series the way the option schema names it, not by field key', () => {
    const { getByTestId } = render(<RegimeClockView rows={mkRows([70, 60, 50])} rowIdx={0}
      currentRow={{ pct_above_50sma: 70 }} onDrill={() => {}}
      options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10 }} />)
    const text = getByTestId('clock-refusal').textContent
    const label = optionsSchema('clock').find(o => o.name === 'level')
      .choices.find(c => c.value === 'pct_above_50sma').label
    expect(text).toContain(label)
    expect(text).not.toContain('pct_above_50sma')
  })
})
