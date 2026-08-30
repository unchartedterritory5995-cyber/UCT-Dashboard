import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PercentileLadderView, { markerX } from './PercentileLadderView'
import MetersView from './MetersView'
import { ALL_METRICS_HIDDEN } from './breadthViewShared'

const mk = (key) => ({ key, label: key, group: 'G', polarity: 'bull',
                       getFmt: r => String(r[key]), getTier: () => 'g2' })
const metrics = [mk('a')]
// 24 rows because the view refuses to rank below MIN_READINGS (20). Today
// (row 0) is the max of the window → 100th percentile; a fixture where today
// sat mid-range could not tell a correct rank from a constant.
const rows = [90, ...Array.from({ length: 23 }, (_, k) => k * 3)]
  .map((a, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, a }))

describe('PercentileLadderView', () => {
  it('ranks today against its own window, not against other metrics', () => {
    const { getByTestId } = render(<PercentileLadderView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(getByTestId('ladder-pctile-a').textContent).toBe('100')
  })

  // 🔴 `marker-{key}` WAS ALSO `MetersView`'s ID. Rendering both boards into one
  // document — which the registry rail does — made `marker-a` ambiguous, so a
  // query silently read whichever mounted first.
  it('namespaces its markers so MetersView markers stay distinguishable', () => {
    const meterMetric = { key: 'a', label: 'a', polarity: 'bull', drillKey: null,
                          getFmt: () => 'a', getTier: () => 'g3' }
    const { container } = render(
      <>
        <PercentileLadderView rows={rows} rowIdx={0} currentRow={rows[0]}
          metrics={metrics} onDrill={() => {}} options={{}} />
        <MetersView currentRow={rows[0]} metrics={[meterMetric]} normalize={() => 80}
          onDrill={() => {}} signalKey={null} notableKey={null} options={{}} />
      </>)
    expect(container.querySelectorAll('[data-testid="ladder-marker-a"]').length).toBe(1)
    expect(container.querySelectorAll('[data-testid="marker-a"]').length).toBe(1)
  })

  // 🔴 THE OLD ASSERTION DEFENDED THE DEFECT. It read `x ≈ 100`, which is the
  // value that put the 1.4-wide marker at x ∈ [100, 101.4] — entirely outside
  // `viewBox="0 0 100 26"`, so the svg clipped it and a reading at the top of
  // its own distribution drew NOTHING. Assert the RENDERED position instead.
  it('draws the 100th-percentile marker INSIDE the track rather than clipping it', () => {
    const { getByTestId } = render(<PercentileLadderView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    const rect = getByTestId('ladder-marker-a')
    const x = Number(rect.getAttribute('x'))
    const w = Number(rect.getAttribute('width'))
    expect(getByTestId('ladder-pctile-a').textContent).toBe('100')   // it IS the top reading
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x + w).toBeLessThanOrEqual(100)
  })

  it('still tracks the percentile in the middle of the range', () => {
    // The clamp must not flatten the scale — a rail that only checks the ends
    // would pass for a marker pinned at 0.
    expect(markerX(0)).toBe(0)
    expect(markerX(50)).toBeCloseTo(49.3, 5)
    expect(markerX(100)).toBeCloseTo(98.6, 5)
    expect(markerX(97)).toBeCloseTo(96.3, 5)
  })

  it('refuses a metric with too few readings instead of inventing a rank', () => {
    const thin = [{ date: '2026-08-01', a: 5 }]
    const { getByTestId, queryByTestId } = render(<PercentileLadderView rows={thin} rowIdx={0}
      currentRow={thin[0]} metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(queryByTestId('ladder-pctile-a')).toBeNull()
    expect(getByTestId('ladder-refusal-a').textContent).toMatch(/needs 20/i)
  })

  // 🔴 EVERY METRIC UNCHECKED USED TO RENDER `null` — a blank panel.
  it('explains an empty board instead of going blank', () => {
    const { getByTestId, container } = render(<PercentileLadderView rows={rows} rowIdx={0}
      currentRow={rows[0]} metrics={[]} onDrill={() => {}} options={{}} />)
    expect(container.innerHTML).not.toBe('')
    expect(getByTestId('ladder-refusal').textContent).toBe(ALL_METRICS_HIDDEN)
    expect(getByTestId('ladder-refusal').textContent).toMatch(/customize/i)
  })

  /**
   * 🔴 TEN FLAT BLOCKS DID NOT READ AS A DISTRIBUTION.
   *
   * The lens exists to answer "where does today sit in a SHAPE", and ten
   * separate rectangles could only ever answer "where does today sit". The
   * slices are finer and joined into one outline now — and the property worth
   * pinning is not that a `<polygon>` exists but that its vertices ARE the
   * counts: a fixture that could not tell a bimodal window from a uniform one
   * would prove nothing about the shape carrying the meaning.
   */
  describe('the distribution reads as a distribution', () => {
    // Two clusters at the ends of the range, nothing in between. 24 readings, so
    // it clears MIN_READINGS on its own.
    const bimodal = [100, 100, 100, 100, 100, 100, 100, 99, 99, 99, 98, 98,
                     2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0]
    // One reading per slice: the same count everywhere, so the outline is flat.
    const uniform = Array.from({ length: 24 }, (_, k) => 92 - k * 4)
    const mkRows = (values) => values.map((a, i) => ({
      date: `2026-08-${String(30 - i).padStart(2, '0')}`, a,
    }))
    const draw = (values) => render(<PercentileLadderView rows={mkRows(values)} rowIdx={0}
      currentRow={mkRows(values)[0]} metrics={metrics} onDrill={() => {}} options={{}} />)
    // The two anchors that close the silhouette on the floor are not counts.
    const heights = (container) => container.querySelector('[data-testid="ladder-shape-a"]')
      .getAttribute('points').trim().split(/\s+/).slice(1, -1)
      .map(p => Number(p.split(',')[1]))

    it('draws the shape of the window, not a row of similar blocks', () => {
      const h = heights(draw(bimodal).container)
      expect(h).toHaveLength(24)
      const floor = Math.max(...h)                 // y grows downward: floor = empty
      const ceiling = Math.min(...h)
      expect(h[0]).toBe(ceiling)                   // the low cluster
      expect(h[h.length - 1]).toBe(ceiling)        // the high cluster
      expect(h.slice(1, -1).every(y => y === floor),
             'the empty middle is not empty — the outline is not reading the counts').toBe(true)
      expect(ceiling).toBeLessThan(floor)
    })

    it('CONTROL: an evenly spread window draws a flat outline', () => {
      // Without this the assertions above could pass on a shape that is always
      // two spikes — `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
      const h = heights(draw(uniform).container)
      expect(new Set(h).size, 'an even spread did not draw an even outline').toBe(1)
      expect(h[0]).not.toBe(Math.max(...heights(draw(bimodal).container)))
    })

    it('marks the window median, and moves it with the window', () => {
      const midX = (container) =>
        Number(container.querySelector('[data-testid="ladder-median-a"]').getAttribute('x1'))
      // Symmetric clusters at 0-2 and 98-100 → the middle of the range.
      expect(midX(draw(bimodal).container)).toBeCloseTo(50, 1)
      // Pile the same span up against its floor and the median follows it down.
      const skewed = [100, ...Array.from({ length: 23 }, () => 0)]
      expect(midX(draw(skewed).container)).toBeLessThan(10)
    })
  })

  it('ranks against the window AS OF THE CURSOR, not every loaded row', () => {
    // Newest-first. Today is a spike; YESTERDAY is the highest reading in
    // everything before it. Scrubbing the cursor back one session must rank
    // yesterday at the top of its own window — a view ranking against all
    // loaded rows would still see today's spike sitting above it (96th).
    const cursor = [999, 80, ...Array.from({ length: 22 }, (_, k) => k * 3)]
      .map((a, i) => ({ date: `2026-08-${String(30 - i).padStart(2, '0')}`, a }))
    const { getByTestId } = render(<PercentileLadderView rows={cursor} rowIdx={1}
      currentRow={cursor[1]} metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(getByTestId('ladder-pctile-a').textContent).toBe('100')
    expect(getByTestId('ladder-basis').textContent).toMatch(/23 sessions · since 2026-08-07/)
  })
})
