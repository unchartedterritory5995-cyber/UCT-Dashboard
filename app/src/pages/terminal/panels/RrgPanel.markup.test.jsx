// RRG — the rendered markup control (UCT RS Phase 3, unit 3-12).
//
// ⛔ The Terminal's graph was extracted into `components/rotation/RrgGraph.jsx` so the Compare
// panel's Rotation tab can draw the SAME graph. That extraction promised NO behaviour change, and
// this file is the proof: the snapshot below was written by the panel BEFORE the extraction, and
// the extracted panel must render it byte for byte for the same input (weekly and daily, a crowded
// graph whose labels move and draw leader lines, and an uncrowded one).
//
// CSS-module class names carry a hash of the stylesheet's path (`_chart_1a2b3c`), and the graph's
// rules moved to their own stylesheet, so each class is compared by its LOCAL name (`chart`). The
// rules themselves moved verbatim; every element, attribute, coordinate and word is compared as is.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import RrgPanel from './RrgPanel'
import { clearClosesCache } from './useCloses'
import { fakeBarsFetch, fridays, series, weekdays, wiggle } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
beforeEach(() => { clearClosesCache() })
afterEach(() => { globalThis.fetch = realFetch })

/** CSS-module class `_name_hash` → `name`, so the markup compares by role, not by file path. */
const localClasses = (html) => html.replace(/class="([^"]*)"/g, (_, cls) => (
  `class="${cls.split(/\s+/).filter(Boolean).map((c) => c.replace(/^_(.+)_[0-9a-z]{4,}$/i, '$1')).join(' ')}"`
))

describe('RRG markup', () => {
  it('a crowded weekly graph (moved labels, leader lines) renders exactly as before', async () => {
    const dates = fridays(60)
    const bench = series(dates, (i) => 0.002 * wiggle(i, 9))
    const by = { SPY: bench }
    // XLE runs away; the other four sit almost on top of each other, so their labels collide.
    ;['XLK', 'XLF', 'XLV', 'XLI'].forEach((s, k) => {
      by[s] = series(dates, (i) => 0.002 * wiggle(i, 9) + 0.0000004 * k * i)
    })
    by.XLE = series(dates, (i) => 0.002 * wiggle(i, 9) + 0.0006 * Math.sin(i / 7))
    globalThis.fetch = fakeBarsFetch(by)
    const { container } = render(<RrgPanel with0="XLK" with1="XLF" with2="XLV" with3="XLE" with4="XLI" />)
    await screen.findByTestId('terminal-rrg')
    expect(localClasses(container.innerHTML)).toMatchSnapshot()
  })

  it('a daily graph with a leader and a laggard renders exactly as before', async () => {
    const dates = weekdays(80)
    const bench = series(dates, (i) => 0.003 * wiggle(i, 2))
    globalThis.fetch = fakeBarsFetch({
      SPY: bench,
      SMH: series(dates, (i) => 0.003 * wiggle(i, 2) + 0.0006 * Math.sin(i / 9)),
      IGV: series(dates, (i) => 0.003 * wiggle(i, 2) - 0.0004),
    })
    const { container } = render(<RrgPanel tf="D" with0="SMH" with1="IGV" />)
    await screen.findByTestId('terminal-rrg')
    expect(localClasses(container.innerHTML)).toMatchSnapshot()
  })
})
