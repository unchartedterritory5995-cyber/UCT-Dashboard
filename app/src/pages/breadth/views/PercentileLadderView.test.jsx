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
