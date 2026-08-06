/**
 * The strip answers the one question the table underneath cannot: what is TODAY
 * doing. So it must appear only while that question is still open — and never
 * once the collector has turned today into a row.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LiveSessionStrip from './LiveSessionStrip'

const path = vals => vals.map((v, i) => [1_000 + i * 60, v])

const live = (over = {}) => ({
  clock: '1:44 PM',
  measured: 2701,
  row: {
    breadth_score: 89.4, pct_above_50sma: 65.3, adv_decline: -370,
    up_4pct_today: 163, down_4pct_today: 61,
  },
  path: {
    breadth_score: path([84.0, 86.5, 89.4]),
    pct_above_50sma: path([68.1, 66.0, 65.3]),
    adv_decline: path([120, -80, -370]),
    up_4pct_today: path([40, 110, 163]),
    down_4pct_today: path([12, 35, 61]),
  },
  ...over,
})

describe('LiveSessionStrip', () => {
  it('renders nothing without a live reading', () => {
    // Also the superseded case: the hook nulls `row` once the collector has
    // written the day, and the table's top row IS the answer then. A
    // provisional summary above it would be a second opinion on a settled fact.
    const { container } = render(<LiveSessionStrip live={{ row: null }} />)
    expect(container).toBeEmptyDOMElement()
    expect(render(<LiveSessionStrip live={null} />).container).toBeEmptyDOMElement()
  })

  it('shows where each headline metric stands right now', () => {
    render(<LiveSessionStrip live={live()} />)
    expect(screen.getByText('89.4')).toBeInTheDocument()
    expect(screen.getByText('65.3%')).toBeInTheDocument()
    expect(screen.getByText('-370')).toBeInTheDocument()
    expect(screen.getByText(/LIVE · 1:44 PM/)).toBeInTheDocument()
  })

  it('draws the move since the open beside each one', () => {
    render(<LiveSessionStrip live={live()} />)
    expect(screen.getByTitle(/SCORE — opened 84.0, now 89.4 \(\+5.4 since the open\)/))
      .toBeInTheDocument()
    expect(screen.getByTitle(/% > 50-DAY — opened 68.1, now 65.3 \(-2.8 since the open\)/))
      .toBeInTheDocument()
  })

  it('still shows the readings when no path has accumulated yet', () => {
    // First sample of the day: a number with no shape behind it is honest;
    // an empty strip would hide a reading we actually have.
    render(<LiveSessionStrip live={live({ path: {} })} />)
    expect(screen.getByText('89.4')).toBeInTheDocument()
    expect(document.querySelectorAll('svg')).toHaveLength(0)
  })

  it('drops a metric the live read could not compute', () => {
    const l = live()
    l.row.adv_decline = null
    render(<LiveSessionStrip live={l} />)
    expect(screen.queryByText('ADV − DEC')).not.toBeInTheDocument()
    expect(screen.getByText('89.4')).toBeInTheDocument()
  })

  it('names the sample size it was computed across', () => {
    render(<LiveSessionStrip live={live()} />)
    expect(screen.getByTitle(/across 2701 names/)).toBeInTheDocument()
  })
})
