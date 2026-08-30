import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import HeatRibbonView from './HeatRibbonView'
import { ALL_METRICS_HIDDEN } from './breadthViewShared'

const mk = (key, tierFn) => ({ key, label: key, group: 'G', polarity: 'bull',
                               getFmt: r => String(r[key]), getTier: tierFn })
// Tier flips at row 3 — the fixture can tell a correctly-wired ribbon from a
// constant one, which a single-tier fixture could not.
const metrics = [mk('a', r => (r.a >= 50 ? 'g3' : 'r3'))]

// 🔴 THE FIXTURE USED TO RUN BACKWARDS. It built dates ASCENDING while the
// contract every caller honours (`BreadthViews.jsx` hands lenses a newest-first
// window) is newest-first — so "oldest at the left" asserted `2026-08-05`, the
// newest date in the fixture. The view was right and the test read as though it
// were not. Newest first, as shipped: rows[0] is 2026-08-05 at a=70.
const rows = [70, 60, 55, 20, 10].map((a, i) => ({ date: `2026-08-0${5 - i}`, a }))

describe('HeatRibbonView', () => {
  it('the fixture is newest-first, like the window the container passes', () => {
    // A control on the fixture itself: the assertions below only mean what they
    // say while this holds.
    expect(rows[0].date > rows[rows.length - 1].date).toBe(true)
  })

  it('draws one cell per session, oldest at the left', () => {
    const { container } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{ palette: 'ocean' }} />)
    const cells = container.querySelectorAll('[data-testid^="ribbon-cell-a-"]')
    expect(cells.length).toBe(5)
    expect(cells[0].getAttribute('title')).toContain('2026-08-01')          // oldest first
    expect(cells[cells.length - 1].getAttribute('title')).toContain('2026-08-05')  // newest last
  })

  it('colors each cell from that session own tier, not today tier', () => {
    const { container } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{ palette: 'ocean' }} />)
    const cells = [...container.querySelectorAll('[data-testid^="ribbon-cell-a-"]')]
    const bg = el => el.style.background.replace(/\s/g, '')
    // ocean g3 = #0891b2, ocean r3 = #e11d48
    expect(bg(cells[cells.length - 1])).toMatch(/#0891b2|rgb\(8,145,178\)/i)  // newest, a=70
    expect(bg(cells[0])).toMatch(/#e11d48|rgb\(225,29,72\)/i)                 // oldest, a=10
  })

  it('states the basis it actually read', () => {
    const { getByTestId } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(getByTestId('ribbon-basis').textContent).toMatch(/5 sessions · since 2026-08-01/)
  })

  /**
   * 🔴 THE RIBBON USED TO GET SHORTER AS YOU SCRUBBED BACK.
   *
   * It drew `rows.slice(rowIdx)`, so moving the cursor to an older session
   * removed the newer ones — during playback the strip GREW, which reads as
   * data arriving rather than as a cursor moving. The window is fixed now and
   * the cursor is a playhead sweeping across it.
   */
  describe('the cursor is a playhead, not a truncation', () => {
    const cells = (container) => [...container.querySelectorAll('[data-testid^="ribbon-cell-a-"]')]
    const draw = (rowIdx, props = {}) => render(<HeatRibbonView rows={rows} rowIdx={rowIdx}
      currentRow={rows[rowIdx]} metrics={metrics} onDrill={() => {}} options={{}}
      canSeek={() => true} {...props} />)

    it('holds the whole window at every cursor position', () => {
      // The old view drew 5, 3 and 1 cells for these three positions.
      for (const idx of [0, 2, 4]) {
        const { container, unmount } = draw(idx)
        expect(cells(container), `cursor ${idx} changed the length of the strip`).toHaveLength(5)
        unmount()
      }
    })

    it('moves the playhead to the cursor session instead', () => {
      // rows are newest-first and the strip runs oldest → newest, so rowIdx 2
      // of 5 is the middle column: 2026-08-03.
      const { getByTestId } = draw(2)
      expect(getByTestId('ribbon-playhead').getAttribute('data-playhead-date')).toBe('2026-08-03')
      expect(getByTestId('ribbon-basis').textContent).toMatch(/playhead 2026-08-03 \(3 of 5\)/)
    })

    it('draws the sessions ahead of it, visibly not yet current', () => {
      const { container } = draw(2)
      const drawn = cells(container)
      const dim = drawn.map(el => Number(el.style.opacity))
      // The two newest columns are ahead of the playhead…
      expect(drawn.slice(3).every(el => el.getAttribute('data-ahead') === 'true')).toBe(true)
      expect(drawn.slice(0, 3).every(el => el.getAttribute('data-ahead') === null)).toBe(true)
      // …and that is a difference the eye can see, without a second colour: the
      // tier fill is unchanged on both sides of the playhead.
      expect(Math.max(...dim.slice(3))).toBeLessThan(Math.min(...dim.slice(0, 3)))
      const bg = el => el.style.background.replace(/\s/g, '')
      expect(bg(drawn[4])).toBe(bg(drawn[3]))          // still their own tier
      expect(drawn.every(el => Number(el.style.opacity) > 0)).toBe(true)  // still drawn
    })

    it('lets the cursor move FORWARD by clicking a session ahead of it', () => {
      const onSeek = vi.fn()
      const { container } = draw(4, { onSeek })
      fireEvent.click(cells(container)[4])            // the newest session
      expect(onSeek).toHaveBeenCalledWith('2026-08-05')
    })
  })

  /**
   * 🔴 THE RIBBON DREW 13px BANDS WITH 400px OF BLACK UNDER THEM.
   *
   * `BreadthViews` hands every lens a `flex: 1; min-height: 0` box and this view
   * has always been `height: 100%` of it — the height was OFFERED. What declined
   * it was the content: every band was a fixed `cellH` px, so ten metrics drew
   * ~190px of ink into a ~600px panel and stopped. This is the view a reader
   * scrubs a playhead across, so it is the one most improved by the room.
   *
   * The rail is on the DECLARATION rather than a measured pixel because jsdom
   * has no layout engine — there is no height to measure. What it CAN see is
   * whether the band asked to flex, and that is the thing that regressed.
   */
  describe('the strip takes the height it is offered', () => {
    const draw = (options = {}) => render(<HeatRibbonView rows={rows} rowIdx={0}
      currentRow={rows[0]} metrics={metrics} onDrill={() => {}} options={options} />)
    // The band is the cell's grandparent: cell → grid → row.
    const band = (container) =>
      container.querySelector('[data-testid="ribbon-cell-a-0"]').parentElement.parentElement

    it('flexes its bands between a floor and a ceiling, and declares no height', () => {
      const { container } = draw()
      const row = band(container)
      expect(Number(row.style.flexGrow)).toBe(1)
      expect(Number.parseFloat(row.style.flexBasis)).toBe(0)
      const min = Number.parseFloat(row.style.minHeight)
      const max = Number.parseFloat(row.style.maxHeight)
      // The floor is what the band used to be PINNED at; the ceiling is what
      // stops a two-metric board drawing two slabs.
      expect(min).toBeLessThanOrEqual(16)
      expect(max).toBeGreaterThanOrEqual(3 * min)

      // …and the cell fills the band rather than declaring a size of its own —
      // the fixed `height: cellH` here is what the defect actually was.
      expect(container.querySelector('[data-testid="ribbon-cell-a-0"]').style.height).toBe('100%')
    })

    it('CONTROL: compact still means compact — the option moves BOTH bounds', () => {
      // Without this, the bounds above could be constants the density option no
      // longer reaches, and "compact" would be a control that moves nothing.
      const normal = band(draw({}).container)
      cleanup()
      const compact = band(draw({ density: 'compact' }).container)
      expect(Number.parseFloat(compact.style.minHeight))
        .toBeLessThan(Number.parseFloat(normal.style.minHeight))
      expect(Number.parseFloat(compact.style.maxHeight))
        .toBeLessThan(Number.parseFloat(normal.style.maxHeight))
    })
  })

  // 🔴 EVERY METRIC UNCHECKED USED TO RENDER `null`: a blank panel with nothing
  // to read, which looks exactly like a broken view.
  it('explains an empty board instead of going blank', () => {
    const { getByTestId, container } = render(<HeatRibbonView rows={rows} rowIdx={0}
      currentRow={rows[0]} metrics={[]} onDrill={() => {}} options={{}} />)
    expect(container.innerHTML).not.toBe('')
    expect(getByTestId('ribbon-refusal').textContent).toBe(ALL_METRICS_HIDDEN)
    expect(getByTestId('ribbon-refusal').textContent).toMatch(/customize/i)
  })
})
