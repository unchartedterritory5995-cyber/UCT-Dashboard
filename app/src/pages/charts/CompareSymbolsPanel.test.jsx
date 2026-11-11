import { useRef } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, beforeEach, afterEach } from 'vitest'
import { pickComparisonColor } from '../../components/chart/comparisonUtils'
import CompareSymbolsPanel from './CompareSymbolsPanel'

function makeApi(initial = []) {
  let comp = initial, pct = false
  return {
    getComparison: vi.fn(() => comp),
    setComparison: vi.fn((arr) => { comp = arr }),
    getPercentScale: vi.fn(() => pct),
    setPercentScale: vi.fn((on) => { pct = on }),
  }
}

// Wrap so chartApiById/activeChartRef are real refs pointing at one fake chart.
function Wrap({ api }) {
  const chartApiById = useRef(new Map([['chart-1', api]]))
  const activeChartRef = useRef('chart-1')
  return <CompareSymbolsPanel chartApiById={chartApiById} activeChartRef={activeChartRef} onClose={() => {}} />
}

test('adds a symbol on Enter and writes it to the active chart', () => {
  const api = makeApi()
  render(<Wrap api={api} />)
  const input = screen.getByPlaceholderText(/Add symbol/i)
  fireEvent.change(input, { target: { value: 'qqq' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(api.setComparison).toHaveBeenCalledWith([expect.objectContaining({ sym: 'QQQ', enabled: true })])
  expect(screen.getByText('QQQ')).toBeInTheDocument()
})

test('loads existing comparisons from the chart', () => {
  const api = makeApi([{ sym: 'SPY', enabled: true, color: '#60a5fa' }])
  render(<Wrap api={api} />)
  expect(screen.getByText('SPY')).toBeInTheDocument()
})

test('removing a symbol writes the pruned list', () => {
  const api = makeApi([{ sym: 'SPY', enabled: true, color: '#60a5fa' }])
  render(<Wrap api={api} />)
  fireEvent.click(screen.getByLabelText('Remove SPY'))
  expect(api.setComparison).toHaveBeenLastCalledWith([])
})

test('the per-symbol "Same % scale" toggle writes scaleMode to the chart', () => {
  const api = makeApi([{ sym: 'QQQ', enabled: true, color: '#60a5fa', scaleMode: 'new' }])
  render(<Wrap api={api} />)
  fireEvent.click(screen.getByText('Same % scale'))
  expect(api.setComparison).toHaveBeenLastCalledWith([expect.objectContaining({ sym: 'QQQ', scaleMode: 'same' })])
})

test('clears a chart stuck in % scale on open (retired "All %" cleanup)', () => {
  const api = makeApi()
  api.getPercentScale = vi.fn(() => true)
  render(<Wrap api={api} />)
  expect(api.setPercentScale).toHaveBeenCalledWith(false)
})

// ── Group controls (C1-035 / C1-037 / C1-040): the panel's OWN writes, pinned with literal lists so the
// panel's behaviour is fixed independently of the shared compareGroups helpers it now calls. ──
describe('group controls', () => {
  const QQQ = { sym: 'QQQ', enabled: true, color: '#60a5fa', scaleMode: 'new' }
  const g = (sym, color, group) => ({ sym, enabled: true, color, scaleMode: 'new', group })
  const SEMI = [g('AMD', '#000001', 'Semiconductors'), g('MU', '#000002', 'Semiconductors')]
  const SOFT = [g('MSFT', '#000003', 'Software')]
  let realFetch
  beforeEach(() => {
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn((url) => {
      const u = new URL(String(url), 'http://x')
      const body = u.pathname === '/api/compare/groups'
        ? { groups: u.searchParams.get('type') === 'industry' ? [{ name: 'Semiconductors', count: 3 }] : [] }
        : { name: 'Semiconductors', symbols: ['AMD', 'QQQ', 'MU'], total: 3, truncated: false }
      return Promise.resolve({ ok: true, status: 200, json: async () => body })
    })
  })
  afterEach(() => { globalThis.fetch = realFetch })

  test('add: picking a group appends its members not already compared, each a new colour on its own scale, tagged with the group', async () => {
    const api = makeApi([QQQ])
    render(<Wrap api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Industries' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Semiconductors\d/ }))
    await waitFor(() => expect(api.setComparison).toHaveBeenCalled())
    const c1 = pickComparisonColor(1, new Set(['#60a5fa']))
    const c2 = pickComparisonColor(2, new Set(['#60a5fa', c1.toLowerCase()]))
    expect(api.setComparison).toHaveBeenLastCalledWith([
      QQQ,
      { sym: 'AMD', enabled: true, color: c1, scaleMode: 'new', group: 'Semiconductors' },
      { sym: 'MU', enabled: true, color: c2, scaleMode: 'new', group: 'Semiconductors' },
    ])
    expect(new Set([QQQ.color, c1, c2].map(x => x.toLowerCase())).size).toBe(3)
  })

  test('add: a group whose members are all compared already writes nothing', async () => {
    const api = makeApi([QQQ, g('AMD', '#000001', 'X'), g('MU', '#000002', 'X')])
    render(<Wrap api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Industries' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Semiconductors\d/ }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('group-members')))
    await new Promise(r => setTimeout(r, 20))
    expect(api.setComparison).not.toHaveBeenCalled()
  })

  test("remove: the group row's × drops only that group; single tickers and other groups stay, in order", () => {
    const api = makeApi([...SEMI, QQQ, ...SOFT])
    render(<Wrap api={api} />)
    fireEvent.click(screen.getByLabelText('Remove Semiconductors'))
    expect(api.setComparison).toHaveBeenLastCalledWith([QQQ, ...SOFT])
  })

  test("scale: the group's Same % scale / New price scale set every member of that group only", () => {
    const api = makeApi([...SEMI, QQQ, ...SOFT])
    render(<Wrap api={api} />)
    fireEvent.click(screen.getAllByText('Same % scale')[0])   // the first group row (Semiconductors)
    expect(api.setComparison).toHaveBeenLastCalledWith([...SEMI.map(x => ({ ...x, scaleMode: 'same' })), QQQ, ...SOFT])
    fireEvent.click(screen.getAllByText('New price scale')[0])
    expect(api.setComparison).toHaveBeenLastCalledWith([...SEMI, QQQ, ...SOFT])
  })
})
