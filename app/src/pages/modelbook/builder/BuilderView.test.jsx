import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Keep the chart + TipTap stack out of jsdom: stubbing the entry page also
// stubs everything it pulls in (ChartExampleKit → StockChart, UpbRichEditor).
// These tests cover the mini-hub and section screens.
vi.mock('./UpbEntryPage', () => ({
  default: ({ entryId }) => <div data-testid="entry-page">entry:{entryId}</div>,
}))
// Belt-and-braces: never mount a real chart or editor even if the entry page
// stub is bypassed by a future refactor.
vi.mock('./UpbRichEditor', () => ({
  default: () => <div data-testid="upb-editor" />,
}))
vi.mock('../shared/ChartExampleKit', () => ({
  ExampleBlock: ({ ex }) => <div data-testid="example-block">{ex?.symbol}</div>,
  ExampleForm: () => <div data-testid="example-form" />,
  TickerSearchInput: () => <input />,
  buildExampleChartProps: () => ({}),
}))

// SWR keyed by URL — overview + a section's entries, both per-test mutable.
let mockOverview = null
let mockEntries = { entries: [] }
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/upb/overview') {
      return { data: mockOverview, mutate: vi.fn(() => Promise.resolve(mockOverview)) }
    }
    if (typeof key === 'string' && key.startsWith('/api/upb/sections/') && key.endsWith('/entries')) {
      return { data: mockEntries, mutate: vi.fn() }
    }
    return { data: null, mutate: vi.fn() }
  },
  preload: vi.fn(),
}))

import BuilderView from './BuilderView'

const SECTION = {
  id: 's1', title: 'My Setups', blurb: 'Patterns I actually trade.', accent: 'gold',
  sort_order: 0, entry_count: 2, chart_count: 5, updated_at: 1752300000,
}

beforeEach(() => {
  mockOverview = null
  mockEntries = { entries: [] }
})

test('renders the empty state safely with null data', () => {
  render(<BuilderView onExit={() => {}} />)
  expect(screen.getByRole('heading', { name: /my playbook/i })).toBeInTheDocument()
  // Positioning copy (Playbook ≠ Notebook) leads the cold start…
  expect(screen.getByText(/reference manual of setups/i)).toBeInTheDocument()
  // …with the three ghost suggestion cards as the primary CTAs.
  expect(screen.getByRole('button', { name: /my setups/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /trades that taught me/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /market studies/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /new section/i })).toBeInTheDocument()
  // The "Add to my playbook" activation hint points at the Setup Library.
  expect(screen.getByText(/add to my playbook/i)).toBeInTheDocument()
})

test('renders section cards from the overview; a created section drops its ghost', () => {
  mockOverview = { sections: [SECTION], totals: { sections: 1, entries: 2, charts: 5 } }
  render(<BuilderView onExit={() => {}} />)
  // Exactly ONE "My Setups" card — the user's real section, not the ghost too.
  expect(screen.getAllByRole('button', { name: /my setups/i }).length).toBe(1)
  expect(screen.getByText('Patterns I actually trade.')).toBeInTheDocument()
  // Header count badge + the card meta both carry the totals line.
  expect(screen.getAllByText(/2 entries · 5 charts/).length).toBeGreaterThan(0)
  // The other two suggestions stay as ghosts; no empty-state copy with content.
  expect(screen.getByRole('button', { name: /trades that taught me/i })).toBeInTheDocument()
  expect(screen.queryByText(/reference manual of setups/i)).toBeNull()
})

test('template picker appears on + New entry', () => {
  mockOverview = { sections: [SECTION], totals: { sections: 1, entries: 2, charts: 5 } }
  render(<BuilderView onExit={() => {}} />)
  // Open the section → its screen renders with the + New entry control.
  fireEvent.click(screen.getByRole('button', { name: /my setups/i }))
  const newEntry = screen.getByRole('button', { name: /new entry/i })
  expect(newEntry).toBeInTheDocument()
  // No templates visible until asked.
  expect(screen.queryByText('Setup definition')).toBeNull()
  fireEvent.click(newEntry)
  // The picker sheet lists all three entry templates.
  expect(screen.getByText('Blank')).toBeInTheDocument()
  expect(screen.getByText('Setup definition')).toBeInTheDocument()
  expect(screen.getByText('Trade recipe')).toBeInTheDocument()
})
