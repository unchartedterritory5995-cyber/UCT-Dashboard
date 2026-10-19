import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Net-change colouring (owner, 2026-10-18 Sunday Scans: "I hate open vs close
// colors instead of net change"). Every /r/chart render — the Substack letter and
// Discord /chart — colours candles and volume by close vs PREVIOUS close.
// `?net=0` opts out; a parity capture (?fixedbars=) keeps close-vs-open unless
// it asks with `?net=1`.

vi.mock('../components/StockChart', () => ({
  default: (props) => (
    <canvas
      data-testid="stock-chart"
      data-net={String(props.colorByNetChange)}
      width={8}
      height={8}
    />
  ),
}))

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}
const net = () => screen.getByTestId('stock-chart').getAttribute('data-net')

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ChartRender net-change colouring', () => {
  it('passes colorByNetChange=true by default', () => {
    mount('sym=NVDA&tf=D')
    expect(net()).toBe('true')
  })

  it('passes colorByNetChange=false with ?net=0', () => {
    mount('sym=NVDA&tf=D&net=0')
    expect(net()).toBe('false')
  })

  it('keeps a parity capture (?fixedbars=) on close-vs-open', () => {
    mount('sym=PARITY&tf=D&fixedbars=nvda-d')
    expect(net()).toBe('false')
  })

  it('lets a parity capture opt in with ?net=1', () => {
    mount('sym=PARITY&tf=D&fixedbars=nvda-d&net=1')
    expect(net()).toBe('true')
  })
})
