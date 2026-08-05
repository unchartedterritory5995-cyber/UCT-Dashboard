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
const clickPreset = name => fireEvent.click(screen.getByRole('button', { name }))

describe('preset chips', () => {
  it('renders every preset', async () => {
    render(<BreadthCharts />)
    await chart()
    for (const label of [
      'Market Health', 'Breadth vs Price', 'Participation', 'Breadth Thrust',
      'New Highs vs Lows', 'Trend Regime', 'Froth & Extension',
      'Volatility & Fear', 'Sentiment Extremes',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
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

    await waitFor(() => expect(captured.series).toHaveLength(4))
    expect(seriesNamed(captured, 'Up 4%+').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, 'Dn 4%+').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, '5D Ratio').yAxisIndex).toBe(1)
    expect(seriesNamed(captured, '10D Ratio').yAxisIndex).toBe(1)

    expect(captured.yAxis[1].show).toBe(true)
    expect(captured.yAxis[0].name).toBe('stocks')
    expect(captured.yAxis[1].name).toBe('ratio')
  })

  it('keeps 52W highs and lows on one axis so the crossover is readable', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('New Highs vs Lows')

    await waitFor(() => expect(captured.series).toHaveLength(2))
    expect(seriesNamed(captured, '52W Highs').yAxisIndex).toBe(0)
    expect(seriesNamed(captured, '52W Lows').yAxisIndex).toBe(0)
    expect(captured.yAxis[1].show).toBe(false)
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
    await waitFor(() => expect(captured.series).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: /^MA Breadth/ }))
    fireEvent.click(screen.getByRole('button', { name: /Notable Extremes/ }))

    // The toggle is ON, yet no lines are drawn — 5–90 levels would be
    // meaningless over a VIX axis.
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Notable Extremes/ }).className,
    ).toMatch(/extremesBtnActive/))
    expect(captured.series.map(s => s.name)).toEqual(['VIX', 'CBOE P/C'])
    expect(seriesNamed(captured, '__ma_extremes__')).toBeUndefined()
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
              selected: ['vix', 'cboe_putcall'], extremes: {},
            }),
          }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))

    render(<BreadthCharts />)
    await waitFor(() => expect(captured?.series?.map(s => s.name)).toEqual(['VIX', 'CBOE P/C']))
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
      .toEqual(['up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day'])
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
