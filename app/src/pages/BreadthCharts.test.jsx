// app/src/pages/BreadthCharts.test.jsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import BreadthCharts from './BreadthCharts'

// Capture the option ECharts is actually handed — assert on the rendered
// artifact, not on component state.
let captured = null
vi.mock('echarts-for-react', () => ({
  default: (props) => { captured = props.option; return <div data-testid="echart" /> },
}))

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// 30 rows inside the component's default 90-day window.
const ROWS = Array.from({ length: 30 }, (_, i) => ({
  date: isoDaysAgo(29 - i),
  breadth_score: 60 + i,
  uct_exposure: 50 + i,
  pct_above_10sma: 40 + i,
  pct_above_20ema: 42 + i,
  pct_above_50sma: 45 + i,
  pct_above_200sma: 50 + i,
  up_4pct_today: 100 + i * 5,
  down_4pct_today: 60 - i,
  ratio_5day: 1 + i / 100,
  ratio_10day: 1.2 + i / 100,
  vix: 16 + (i % 5),
  cboe_putcall: 0.8 + i / 200,
  sp500_close: 6800 + i * 10,
  qqq_close: 600 + i,
  new_52w_highs: 100 + i,
  new_52w_lows: 10 + (i % 7),
  avg_10d_cpc: 0.85 + i / 400,
  up_vol_ratio: 0.9 + i / 50,
  // Two clusters: 5-6 adjacent, then 20 well clear of them.
  is_ftd: i === 5 || i === 6 || i === 20,
}))

beforeEach(() => {
  captured = null
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    if (String(url).includes('/api/breadth-monitor')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: ROWS }) })
    }
    if (String(url).includes('/api/auth/preferences')) {
      // GET → no stored state; POST → accepted
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts?.method === 'POST' ? { ok: true } : {}) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})

const chart = async () => {
  await waitFor(() => expect(screen.getByTestId('echart')).toBeInTheDocument())
  return captured
}
const seriesNamed = (opt, name) => opt.series.find(s => s.name === name)

// Synthetic series (__ma_extremes__, __ref_lines__, __ftd__, __live_now__) carry
// markLines, not data. Counting plotted metrics means excluding them.
const realSeries = opt => opt.series.filter(s => !s.name.startsWith('__'))

/** Presets without a `group` are pills; the rest live behind the More popover. */
const clickPreset = name => {
  const pill = screen.queryByRole('button', { name })
  if (pill) return fireEvent.click(pill)
  fireEvent.click(screen.getByRole('button', { name: /^More/ }))
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return fireEvent.click(screen.getByRole('option', { name: new RegExp(escaped) }))
}

describe('preset chips', () => {
  it('renders every core preset as a one-click pill', async () => {
    render(<BreadthCharts />)
    await chart()
    for (const label of [
      'Market Health', 'Breadth vs Price', 'Participation', 'Breadth Thrust',
      'Volatility & Fear', 'A/D Line', 'Highs/Lows %',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  // Sixteen presets do not fit one band, so the rest sit behind More. Every one
  // of them must still be reachable — a preset nobody can click is not shipped.
  it('reaches every remaining preset through the More popover', async () => {
    render(<BreadthCharts />)
    await chart()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    for (const label of [
      'New Highs vs Lows', 'Trend Regime', 'Setup Supply',
      'Narrow Leadership', 'Risk Appetite',
      'Volume Thrust', 'Froth & Extension',
      'Vol Complex', 'Sentiment Extremes',
    ]) {
      expect(screen.getByRole('option', { name: new RegExp(label.replace('/', '\\/')) }))
        .toBeInTheDocument()
    }
  })

  it('marks the chip whose metrics match the current selection', async () => {
    render(<BreadthCharts />)
    await chart()

    const health = screen.getByRole('button', { name: 'Market Health' })
    expect(health).toHaveAttribute('aria-pressed', 'false')

    clickPreset('Market Health')
    await waitFor(() => expect(health).toHaveAttribute('aria-pressed', 'true'))
  })

  it('drops the active mark once the selection diverges', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Market Health')

    const health = screen.getByRole('button', { name: 'Market Health' })
    await waitFor(() => expect(health).toHaveAttribute('aria-pressed', 'true'))

    // Expand a group and tick one more metric — no longer the preset.
    fireEvent.click(screen.getByRole('button', { name: /^Regime/ }))
    fireEvent.click(screen.getByLabelText('VIX'))

    await waitFor(() => expect(health).toHaveAttribute('aria-pressed', 'false'))
  })
})

describe('preset plotting', () => {
  it('splits Breadth Thrust counts and ratios onto separate axes', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Breadth Thrust')

    // Adding up/down volume makes ratios the majority family 3-2, so they take
    // the left axis and the counts move right. That is wanted: the parity and
    // thrust reference lines sit on the ratio family and belong on the primary.
    await waitFor(() => expect(realSeries(captured)).toHaveLength(5))
    expect(seriesNamed(captured, '5D Ratio').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, '10D Ratio').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, 'Up/Down Volume').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, 'Up 4%+').yAxisIndex).toBe(1)
    expect(seriesNamed(captured, 'Dn 4%+').yAxisIndex).toBe(1)

    expect(captured.yAxis[1].show).toBe(true)
    expect(captured.yAxis[0].name).toBe('ratio')
    expect(captured.yAxis[1].name).toBe('stocks')
  })

  it('keeps 52W highs and lows on one axis so the crossover is readable', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('New Highs vs Lows')

    await waitFor(() => expect(realSeries(captured)).toHaveLength(2))
    expect(seriesNamed(captured, '52W Highs').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, '52W Lows').yAxisIndex).toBe(0)
    expect(captured.yAxis[1].show).toBe(false)
  })

  // The shipped defect: colour was PALETTE[seriesIndex], so index 1 was always
  // green and every crossover preset drew its deterioration line green.
  it('draws the deterioration line red on a crossover preset', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('New Highs vs Lows')

    await waitFor(() => expect(realSeries(captured)).toHaveLength(2))
    expect(seriesNamed(captured, '52W Highs').itemStyle.color).toBe('#34d399')
    expect(seriesNamed(captured, '52W Lows').itemStyle.color).toBe('#f87171')
  })

  it('puts index price opposite participation for Breadth vs Price', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Breadth vs Price')

    await waitFor(() => expect(captured.series).toHaveLength(3))
    expect(seriesNamed(captured, '% Above 50SMA').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, '% Above 200SMA').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, 'S&P 500').yAxisIndex).toBe(1)
    // QQQ is deliberately absent — see the index-pairing test in chartMetrics.
    expect(seriesNamed(captured, 'QQQ')).toBeUndefined()
    expect(captured.yAxis[0].name).toBe('%')
    expect(captured.yAxis[1].name).toBe('index')
  })
})

describe('reference lines', () => {
  it('turns MA extremes on for Participation', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Participation')

    await waitFor(() => expect(seriesNamed(captured, '__ma_extremes__')).toBeTruthy())
    const lines = seriesNamed(captured, '__ma_extremes__').markLine.data.map(d => d.yAxis)
    expect(lines).toEqual([90, 80, 70, 20, 15, 10, 5])
  })

  it('clears them when a different preset is applied', async () => {
    render(<BreadthCharts />)
    await chart()

    clickPreset('Participation')
    await waitFor(() => expect(seriesNamed(captured, '__ma_extremes__')).toBeTruthy())

    // Market Health is itself all-pct, so the hasPct guard CANNOT be what
    // removes the lines here — only applyPreset replacing the extremes state
    // can. Switching to a preset without pct metrics would pass either way.
    clickPreset('Market Health')
    await waitFor(() => expect(captured.series).toHaveLength(3))
    expect(seriesNamed(captured, '__ma_extremes__')).toBeUndefined()
  })

  it('omits them when nothing on the chart is a percentage', async () => {
    render(<BreadthCharts />)
    await chart()

    // Land on a selection with no pct metric FIRST, then switch the toggle on.
    // (Only one group is expanded, so the Notable Extremes query stays unique.)
    clickPreset('Volatility & Fear')
    await waitFor(() => expect(realSeries(captured)).toHaveLength(3))

    fireEvent.click(screen.getByRole('button', { name: /^MA Breadth/ }))
    fireEvent.click(screen.getByRole('button', { name: /Notable Extremes/ }))

    // The toggle is ON, yet no lines are drawn — 5–90 levels would be
    // meaningless over a VIX axis.
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Notable Extremes/ }).className,
    ).toMatch(/extremesBtnActive/))
    expect(realSeries(captured).map(s => s.name)).toEqual(['VIX', 'CBOE P/C', 'P/C 10D Avg'])
    expect(seriesNamed(captured, '__ma_extremes__')).toBeUndefined()
  })

  it('widens the axis so the 90 line is actually in frame', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Participation')
    await waitFor(() => expect(seriesNamed(captured, '__ma_extremes__')).toBeTruthy())

    // Participation data tops out near 70, so ECharts sized the axis to ~80 and
    // the topmost reference line never rendered.
    const axis = captured.yAxis[0]
    expect(typeof axis.max).toBe('function')
    expect(axis.max({ min: 21.8, max: 71.6 })).toBeGreaterThanOrEqual(90)
    expect(axis.min({ min: 21.8, max: 71.6 })).toBeLessThanOrEqual(5)
  })

  it('still lets a genuine outlier expand the axis past the band', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Participation')
    await waitFor(() => expect(captured.yAxis[0].max).toBeInstanceOf(Function))

    // uct_exposure reaches 102 and aaii_spread goes negative — the widening
    // must be a floor, not a clamp.
    expect(captured.yAxis[0].max({ min: -22, max: 102 })).toBe(102)
    expect(captured.yAxis[0].min({ min: -22, max: 102 })).toBe(-22)
  })

  it('leaves the axis alone when no reference lines are shown', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('New Highs vs Lows')

    await waitFor(() => expect(realSeries(captured)).toHaveLength(2))
    expect(captured.yAxis[0].max).toBeUndefined()
    expect(captured.yAxis[0].min).toBeUndefined()
  })

  it('draws them on whichever axis the percentage family landed on', async () => {
    render(<BreadthCharts />)
    await chart()

    // Default selection is two pct metrics; enable extremes on the left axis.
    fireEvent.click(screen.getByRole('button', { name: /^MA Breadth/ }))
    fireEvent.click(screen.getByRole('button', { name: /Notable Extremes/ }))
    await waitFor(() => expect(seriesNamed(captured, '__ma_extremes__')?.yAxisIndex).toBe(0))

    // Drop one pct metric, then add both index series. The catalog has exactly
    // two index metrics, so pct must fall to 1 for `index` to take the left
    // axis — at 2-2 the tie-break keeps pct there.
    fireEvent.click(screen.getByRole('button', { name: /^Score/ }))
    fireEvent.click(screen.getByLabelText('Health Score'))
    fireEvent.click(screen.getByRole('button', { name: /^Regime/ }))
    fireEvent.click(screen.getByLabelText('S&P 500'))
    fireEvent.click(screen.getByLabelText('QQQ'))

    // pct is now the minority family — the reference lines follow it right.
    await waitFor(() => expect(seriesNamed(captured, '__ma_extremes__').yAxisIndex).toBe(1))
    expect(seriesNamed(captured, '% Above 50SMA').yAxisIndex).toBe(1)
    expect(seriesNamed(captured, 'S&P 500').yAxisIndex).toBe(0)
  })
})

describe('axis framing', () => {
  it('frames an index axis to its data instead of anchoring it at zero', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Breadth vs Price')

    await waitFor(() => expect(realSeries(captured)).toHaveLength(3))
    // The S&P sits at 6,344-7,737; anchored at zero it lived in the top 18%.
    expect(captured.yAxis[1].scale).toBe(true)
    // Percentages are read against 0 and 100 and must stay anchored.
    expect(captured.yAxis[0].scale).toBe(false)
  })
})

describe('reference lines from a preset', () => {
  it('draws the parity and thrust levels on the ratio axis', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Breadth Thrust')

    await waitFor(() => expect(seriesNamed(captured, '__ref_lines__')).toBeTruthy())
    const ref = seriesNamed(captured, '__ref_lines__')
    expect(ref.markLine.data.map(d => d.yAxis)).toEqual([1.0, 2.0])
    // Ratios took the left axis, so the levels belong there.
    expect(ref.yAxisIndex).toBe(0)
  })

  it('suppresses a line that would expand an auto-framed axis', async () => {
    render(<BreadthCharts />)
    await chart()
    // The fixture has no adv_decline_cum, so the CUM extent is unknown. A zero
    // line drawn anyway would drag the framed axis back to zero.
    clickPreset('A/D Line')
    await waitFor(() => expect(realSeries(captured).length).toBeGreaterThan(0))
    expect(seriesNamed(captured, '__ref_lines__')).toBeUndefined()
  })
})

describe('follow-through days', () => {
  it('stays off until asked, then marks the sessions', async () => {
    render(<BreadthCharts />)
    await chart()
    expect(seriesNamed(captured, '__ftd__')).toBeUndefined()

    fireEvent.click(screen.getByLabelText(/Follow-through days/))
    await waitFor(() => expect(seriesNamed(captured, '__ftd__')).toBeTruthy())

    const marks = seriesNamed(captured, '__ftd__').markLine.data
    // Every hit draws a line...
    expect(marks.map(d => d.xAxis)).toEqual([ROWS[5].date, ROWS[6].date, ROWS[20].date])
    // ...but the adjacent pair contributes one label, not two.
    expect(marks.map(d => d.showLabel)).toEqual([true, false, true])
  })
})

describe('metric readout', () => {
  it('reports each series with its value and window percentile', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('New Highs vs Lows')
    await waitFor(() => expect(realSeries(captured)).toHaveLength(2))
    // Fixture 52W highs run 100..129, so the last point is the highest.
    expect(screen.getByRole('button', { name: '52W Highs, 129, 100th percentile' }))
      .toBeInTheDocument()
    // 52W lows cycle 10..16, so the last value sits mid-range, not at an extreme.
    expect(screen.getByRole('button', { name: /^52W Lows, 11, \d+\w\w percentile$/ }))
      .toBeInTheDocument()
  })

  // ReactECharts has notMerge, so a new option rebuilds the chart and its
  // legend selection resets to all-visible. A stale `hidden` entry would dim a
  // readout row for a line the chart is actually drawing.
  it('does not keep a series dimmed after the selection changes', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('New Highs vs Lows')
    await waitFor(() => expect(realSeries(captured)).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: /52W Lows/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /52W Lows/ }))
      .toHaveAttribute('aria-pressed', 'false'))

    clickPreset('Trend Regime')
    await waitFor(() => expect(realSeries(captured)).toHaveLength(2))
    clickPreset('New Highs vs Lows')
    await waitFor(() => expect(realSeries(captured)).toHaveLength(2))

    expect(screen.getByRole('button', { name: /52W Lows/ }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('clears a dimmed row when a metric is ticked by hand', async () => {
    render(<BreadthCharts />)
    await chart()
    fireEvent.click(screen.getByRole('button', { name: /Health Score/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Health Score/ }))
      .toHaveAttribute('aria-pressed', 'false'))

    fireEvent.click(screen.getByRole('button', { name: /^Regime/ }))
    fireEvent.click(screen.getByLabelText('VIX'))

    await waitFor(() => expect(screen.getByRole('button', { name: /Health Score/ }))
      .toHaveAttribute('aria-pressed', 'true'))
  })
})

describe('stored selection', () => {
  it('restores a saved selection over the default', async () => {
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      if (String(url).includes('/api/breadth-monitor')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: ROWS }) })
      }
      if (String(url).includes('/api/auth/preferences')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(opts?.method === 'POST' ? { ok: true } : {
            breadth_charts_state: JSON.stringify({
              selected: ['vix', 'cboe_putcall', 'avg_10d_cpc'], extremes: {},
            }),
          }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))

    render(<BreadthCharts />)
    await waitFor(() => expect(captured && realSeries(captured).map(s => s.name))
      .toEqual(['VIX', 'CBOE P/C', 'P/C 10D Avg']))
    expect(screen.getByRole('button', { name: 'Volatility & Fear' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('does not write back on a plain load, but does after a change', async () => {
    render(<BreadthCharts />)
    await chart()

    const posts = () => fetch.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/auth/preferences') && opts?.method === 'POST',
    )

    // Past the 600ms debounce with no interaction — nothing should be saved.
    await new Promise(r => setTimeout(r, 700))
    expect(posts()).toHaveLength(0)

    clickPreset('Breadth Thrust')
    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 2000 })
    expect(JSON.parse(JSON.parse(posts()[0][1].body).value).selected)
      .toEqual(['up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day', 'up_vol_ratio'])
  })

  it('ignores a stored metric that no longer exists', async () => {
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      if (String(url).includes('/api/breadth-monitor')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: ROWS }) })
      }
      if (String(url).includes('/api/auth/preferences')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(opts?.method === 'POST' ? { ok: true } : {
            breadth_charts_state: JSON.stringify({
              selected: ['vix', 'metric_removed_in_a_later_release'], extremes: {},
            }),
          }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))

    render(<BreadthCharts />)
    await waitFor(() => expect(captured?.series?.map(s => s.name)).toEqual(['VIX']))
  })
})
