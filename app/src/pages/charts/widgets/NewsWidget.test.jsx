import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { vi, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import NewsWidget from './NewsWidget'
import * as drawingsStore from '../../../components/chart/drawingsStore'

let mockNews = { status: 'ready', events: [] }
vi.mock('../../../hooks/useNewsCatalysts', () => ({ default: () => mockNews }))
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn() }),
  parsePref: () => null,
}))
vi.mock('./NewsSettingsPanel', () => ({ default: () => <div data-testid="news-settings">SETTINGS</div> }))
vi.mock('../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))
vi.mock('../../../components/chart/drawingsStore', () => ({ addDrawing: vi.fn(() => 'id-1') }))

function Wrap({ color = 'A', groups = { A: 'NVDA', B: null, C: null, D: null }, opts = {} }) {
  const [groupSyms] = useState(groups)
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym: vi.fn() }}>
      <NewsWidget color={color} opts={opts} onOptsChange={vi.fn()} />
    </WorkspaceContext.Provider>
  )
}

beforeEach(() => { mockNews = { status: 'ready', events: [] }; drawingsStore.addDrawing.mockClear() })

test('renders event rows with title + signed move', () => {
  mockNews = {
    status: 'ready',
    events: [
      { date: '2026-03-10', type: 'earnings', direction: 'up', title: 'Q3 earnings — beat', description: 'EPS 1.2', move_pct: 12.5, source: 'earnings' },
      { date: '2026-01-05', type: 'catalyst', direction: 'down', title: 'Guidance cut', description: null, move_pct: -10, source: '@DeItaone' },
    ],
  }
  render(<Wrap />)
  expect(screen.getByText('Q3 earnings — beat')).toBeInTheDocument()
  expect(screen.getByText('Guidance cut')).toBeInTheDocument()
  expect(screen.getByText('+12.5%')).toBeInTheDocument()
  expect(screen.getByText('-10%')).toBeInTheDocument()
})

test('shows the generating state', () => {
  mockNews = { status: 'generating', events: [] }
  render(<Wrap />)
  expect(screen.getByText(/Finding significant catalysts/i)).toBeInTheDocument()
})

test('empty state when no symbol is linked', () => {
  render(<Wrap color="A" groups={{ A: null, B: null, C: null, D: null }} />)
  expect(screen.getByText(/Link this widget's color group/i)).toBeInTheDocument()
})

test('gear button opens the settings panel', () => {
  render(<Wrap />)
  expect(screen.queryByTestId('news-settings')).toBeNull()
  fireEvent.click(screen.getByTitle('News widget settings'))
  expect(screen.getByTestId('news-settings')).toBeInTheDocument()
})

test('very-thin mode: row is click-to-reveal; the reveal is the inline description', () => {
  const orig = global.ResizeObserver
  let cb
  global.ResizeObserver = class {
    constructor(c) { cb = c }
    observe() { cb([{ contentRect: { width: 300 } }]) }   // < 320 → very-thin
    disconnect() {}
  }
  mockNews = {
    status: 'ready',
    events: [
      { date: '2026-03-10', type: 'earnings', direction: 'up', title: 'Q3 earnings — beat',
        description: 'EPS 1.20 vs 1.10 est; Revenue $40.6B vs $39.9B est', move_pct: 8.8, source: 'earnings' },
    ],
  }
  render(<Wrap />)
  expect(screen.queryByText(/Revenue \$40\.6B/)).toBeNull()          // hidden until clicked
  fireEvent.click(screen.getByText('Q3 earnings — beat'))
  expect(screen.getByText(/Revenue \$40\.6B/)).toBeInTheDocument()   // same plain .desc revealed
  global.ResizeObserver = orig
})

test('date includes the year', () => {
  mockNews = { status: 'ready', events: [
    { date: '2026-03-10', type: 'catalyst', direction: 'up', title: 'X', move_pct: 5, source: 'ai' },
  ] }
  render(<Wrap />)
  expect(screen.getByText('Mar 10, 2026')).toBeInTheDocument()
})

test('place drops TWO separate, linked drawings: a text label + a trendline leader', () => {
  mockNews = { status: 'ready', events: [
    { date: '2026-03-10', type: 'catalyst', direction: 'up', title: 'AI supply deal', move_pct: 12, source: 'web' },
  ] }
  render(<Wrap />)
  fireEvent.click(screen.getByTitle('Place headline on chart'))
  expect(drawingsStore.addDrawing).toHaveBeenCalledTimes(2)
  const [symA, label] = drawingsStore.addDrawing.mock.calls[0]
  const [symB, line] = drawingsStore.addDrawing.mock.calls[1]
  expect(symA).toBe('NVDA'); expect(symB).toBe('NVDA')
  expect(label).toMatchObject({
    type: 'text', text: 'AI supply deal', calloutRole: 'label',
    calloutAnchorTime: '2026-03-10', calloutAutoPlace: true,
  })
  expect(line).toMatchObject({ type: 'trendline', calloutRole: 'line', calloutAutoPlace: true })
  // Linked by a shared id, but two independent drawings; overlay fills their points.
  expect(label.calloutId).toBeTruthy()
  expect(line.calloutId).toBe(label.calloutId)
  expect(label.points).toEqual([]); expect(line.points).toEqual([])
  // Color/width are NOT set here — the chart's overlay stamps its own drawing default.
  expect(label.color).toBeUndefined(); expect(line.color).toBeUndefined()
})

test('place is a one-time action, not a toggle — clicking twice places two catalysts (4 drawings)', () => {
  mockNews = { status: 'ready', events: [
    { date: '2026-03-10', type: 'catalyst', direction: 'up', title: 'AI supply deal', move_pct: 12, source: 'web' },
  ] }
  render(<Wrap />)
  const btn = screen.getByTitle('Place headline on chart')
  fireEvent.click(btn)
  fireEvent.click(btn)
  expect(drawingsStore.addDrawing).toHaveBeenCalledTimes(4)   // 2 drawings × 2 clicks
  // No persistent pressed/toggled state (it's not aria-pressed).
  expect(btn.getAttribute('aria-pressed')).toBeNull()
})

test('no place button when no symbol is linked', () => {
  mockNews = { status: 'ready', events: [
    { date: '2026-03-10', type: 'catalyst', direction: 'up', title: 'X', move_pct: 5, source: 'ai' },
  ] }
  render(<Wrap color="A" groups={{ A: null, B: null, C: null, D: null }} />)
  expect(screen.queryByTitle('Place headline on chart')).toBeNull()
})

test('up filter shows only up-direction events', () => {
  mockNews = {
    status: 'ready',
    events: [
      { date: '2026-03-10', type: 'earnings', direction: 'up', title: 'Beat', move_pct: 12, source: 'earnings' },
      { date: '2026-01-05', type: 'catalyst', direction: 'down', title: 'Cut', move_pct: -10, source: 'ai' },
    ],
  }
  render(<Wrap opts={{ filter: 'up' }} />)
  expect(screen.getByText('Beat')).toBeInTheDocument()
  expect(screen.queryByText('Cut')).toBeNull()
})
