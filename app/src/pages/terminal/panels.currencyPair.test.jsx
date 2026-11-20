// The terminal's pair check (panels.jsx `panelComponent`): which component a panel draws.
//   * a stock, the fund BTC and a panel with no security draw the panel's OWN component with
//     the props it was given, and ask the server NOTHING about pairs;
//   * BTCUSD with the switch off (404), with a failed read, or for a member the list does not
//     name draws the panel's own component too: exactly what a member sees today;
//   * BTCUSD the server admits is handed to CurrencyPairPanel with the panel's name, the pair,
//     the panel's own component and every prop the shell passed;
//   * one `lazy()` per name, ever: the same component comes back each time.
import { Suspense } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../utils/jsonFetcher', () => ({ default: vi.fn() }))
const { ownSpy, pairSpy } = vi.hoisted(() => ({ ownSpy: vi.fn(), pairSpy: vi.fn() }))
vi.mock('./panels/ChartPanel', () => ({ default: (p) => { ownSpy('Chart', p); return <div data-testid="own-Chart" /> } }))
vi.mock('./panels/OverviewPanel', () => ({ default: (p) => { ownSpy('Overview', p); return <div data-testid="own-Overview" /> } }))
vi.mock('../../components/research/fmpDepth/FinancialsDeep', () => ({ default: (p) => { ownSpy('Financials', p); return <div data-testid="own-Financials" /> } }))
vi.mock('./panels/CurrencyPairPanel', () => ({ default: (p) => { pairSpy(p); return <div data-testid="pair-panel" data-panel={p.panel} /> } }))
import jsonFetcher from '../../utils/jsonFetcher'
import { panelComponent } from './panels'

const PAIRS = { source: 'FMP', pairs: [{ symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', quote: 'USD' }] }
const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
const draw = (name, props) => {
  const Comp = panelComponent(name)
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Suspense fallback={<div data-testid="lazy" />}><Comp {...props} /></Suspense>
    </SWRConfig>,
  )
}

beforeEach(() => { jsonFetcher.mockReset(); ownSpy.mockReset(); pairSpy.mockReset() })
afterEach(cleanup)

describe('a security that is not a pair', () => {
  it.each([['NVDA'], ['BTC'], ['SPY'], [undefined], ['']])('%s draws the panel\'s own component and asks nothing', async (sym) => {
    draw('Chart', { sym, tf: '5', extra: 1 })
    await screen.findByTestId('own-Chart')
    expect(ownSpy.mock.calls.at(-1)).toEqual(['Chart', { sym, tf: '5', extra: 1 }])
    await new Promise((r) => setTimeout(r, 20))
    expect(jsonFetcher).not.toHaveBeenCalled()
    expect(pairSpy).not.toHaveBeenCalled()
  })
})

describe('BTCUSD the server does not admit', () => {
  it.each([
    ['the switch off (404)', () => Promise.reject(fail(404))],
    ['a failed read', () => Promise.reject(fail(500))],
    ['an empty list', () => Promise.resolve({ source: 'FMP', pairs: [] })],
    ['a read still in flight', () => new Promise(() => {})],
  ])('%s: the panel\'s own component, as today', async (_name, answer) => {
    jsonFetcher.mockImplementation(answer)
    draw('Financials', { sym: 'BTCUSD' })
    await screen.findByTestId('own-Financials')
    await waitFor(() => expect(jsonFetcher).toHaveBeenCalledWith('/api/crypto/pairs'))
    await new Promise((r) => setTimeout(r, 20))
    expect(ownSpy.mock.calls.at(-1)).toEqual(['Financials', { sym: 'BTCUSD' }])
    expect(pairSpy).not.toHaveBeenCalled()
    expect(screen.queryByTestId('pair-panel')).toBeNull()
  })
})

describe('BTCUSD the server admits', () => {
  it.each(['Chart', 'Overview', 'Financials'])('%s is handed to the pair panel with its name, the pair and the shell\'s props', async (name) => {
    jsonFetcher.mockResolvedValue(PAIRS)
    draw(name, { sym: 'BTCUSD', tf: 'W', onRun: 'x' })
    const box = await screen.findByTestId('pair-panel')
    expect(box.getAttribute('data-panel')).toBe(name)
    const got = pairSpy.mock.calls.at(-1)[0]
    expect(got.pair).toEqual({ symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', quote: 'USD', source: 'FMP' })
    expect([got.sym, got.tf, got.onRun, got.panel]).toEqual(['BTCUSD', 'W', 'x', name])
    expect(typeof got.Panel).toBe('object')                 // the panel's own lazy component, for GP to draw
    expect(screen.queryByTestId(`own-${name}`)).toBeNull()
    expect(jsonFetcher.mock.calls.map(([u]) => u)).toEqual(['/api/crypto/pairs'])
  })

  it('a lower-case symbol is the same pair', async () => {
    jsonFetcher.mockResolvedValue(PAIRS)
    draw('Overview', { sym: 'btcusd' })
    await screen.findByTestId('pair-panel')
    expect(pairSpy.mock.calls.at(-1)[0].pair.symbol).toBe('BTCUSD')
  })
})

describe('the resolver itself', () => {
  it('returns the same component for a name every time, and null for a name nothing binds', () => {
    expect(panelComponent('Chart')).toBe(panelComponent('Chart'))
    expect(panelComponent('Chart')).not.toBe(panelComponent('Overview'))
    expect(panelComponent('NoSuchPanel')).toBe(null)
    expect(panelComponent('Chart').displayName).toBe('PairAware(Chart)')
  })
})
