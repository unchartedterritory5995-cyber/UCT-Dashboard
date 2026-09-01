import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `window.__chartBarCount` — how many candles are ON the chart, published for the
// Discord renderer to read back through X-Chart-Probe.
//
// On 2026-08-31 three charts with no candles in them were posted to the public
// #TSDR channel. Nothing detected it: readiness only says the bars question
// SETTLED (it is satisfied by an empty answer, deliberately, so a dead ticker
// cannot hang a capture), and the pixel judge behind it measures grey-level
// variance of the chart body — which a resolved symbol's watermark, subtitle,
// grid and stats strip clear on their own. Those three frames measured 8.4–16.7
// against a threshold of 6.0. Ink is not data, so the page states the count.

vi.mock('../components/StockChart', async () => {
  const React = await import('react')
  return {
    default: (props) => {
      React.useEffect(() => {
        if (globalThis.__barCounts) globalThis.__barCounts.forEach(n => props.onDrawnBarCount?.(n))
      }, [])
      return <canvas data-testid="stock-chart" width={8} height={8} />
    },
  }
})

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}

beforeEach(() => { window.__chartBarCount = 999 })   // a previous page's answer
afterEach(() => { cleanup(); delete globalThis.__barCounts })

describe('ChartRender window.__chartBarCount', () => {
  it('resets to null on mount so a probe can never read the last render\'s count', () => {
    globalThis.__barCounts = null
    mount('sym=SMH&tf=D')
    // null, NOT 0: "the page has not answered" and "the page answered none" are
    // different facts, and only one of them should discard a render.
    expect(window.__chartBarCount).toBe(null)
  })

  it('reports the number of candles the chart was handed', () => {
    globalThis.__barCounts = [120]
    mount('sym=SMH&tf=D')
    expect(window.__chartBarCount).toBe(120)
  })

  it('reports 0 for the frame that shipped blank — the whole point', () => {
    globalThis.__barCounts = [0]
    mount('sym=SMH&tf=D')
    expect(window.__chartBarCount).toBe(0)
  })

  it('follows the count up when a late fetch lands, rather than latching the first answer', () => {
    // A latch taken at first settle would pin 0 on a chart that recovers on the
    // next SWR refresh, and we would discard a perfectly good render.
    globalThis.__barCounts = [0, 120]
    mount('sym=SMH&tf=D')
    expect(window.__chartBarCount).toBe(120)
  })

  it('treats a non-numeric report as no answer', () => {
    globalThis.__barCounts = [undefined]
    mount('sym=SMH&tf=D')
    expect(window.__chartBarCount).toBe(null)
  })
})
