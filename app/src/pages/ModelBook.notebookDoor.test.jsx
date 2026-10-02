// G-040 ruling 3 — the Model Book's "Save to Notebook" control, in the REAL page
// (same harness as ModelBook.test.jsx). The send is the one seam mocked: the
// capture it is handed is the thing under test; the send path is railed by
// lib/offline/doorFamilies.settle.test.jsx.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'
import { normalizeParams, validateParams, isReconstructable } from '../widgets/registry'
import { buildModelBookCapture } from './modelbook/notebookCapture'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn(async () => 'NVDA 2025 (Model Book) sent to “Plan”') }))
vi.mock('./journal-2-0/lib/sendToJournal', () => ({ sendCaptureToJournal: sendMock }))

vi.mock('../components/StockChart', () => ({
  default: ({ sym }) => <div data-testid="stock-chart">chart:{sym}</div>,
}))
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ key: 'test', state: { mbView: 'years' } }),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'user' } }) }))
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/modelbook/years') return { data: { years: [2025] }, mutate: vi.fn() }
    if (typeof key === 'string' && key.startsWith('/api/modelbook/stocks')) {
      return { data: { year: 2025, stocks: [
        { id: 1, year: 2025, symbol: 'NVDA', company: 'NVIDIA Corp', sort_order: 1, gain_pct: 171, setup_count: 1 },
      ] }, mutate: vi.fn() }
    }
    if (typeof key === 'string' && key.startsWith('/api/modelbook/stock/')) {
      return { data: {
        id: 1, year: 2025, symbol: 'NVDA', company: 'NVIDIA Corp', gain_pct: 171, thesis: 'AI leader',
        setups: [{ id: 10, setup_type: 'VCP', label_date: '2025-03-14', grade: 'A+',
          entry_price: 120, stop_price: 110, target_price: 150, notes: 'textbook',
          marker_side: 'belowBar', marker_shape: 'arrowUp' }],
        catalysts: [{ id: 20, catalyst_date: '2025-09-04', title: 'Q3 earnings beat',
          description: 'Crushed estimates.', move_pct: 18.5, source: 'ai', sort_order: 0 }],
      }, mutate: vi.fn() }
    }
    return { data: null, mutate: vi.fn() }
  },
  preload: vi.fn(),
}))

import ModelBook from './ModelBook'

beforeEach(() => {
  sendMock.mockClear()
  try { localStorage.clear() } catch { /* ignore */ }
})

test('a real, named button; the member’s words ride along with a REFERENCE to the selected setup', async () => {
  render(<ModelBook />)
  const btn = screen.getByRole('button', { name: 'Save NVDA 2025 to Notebook' })
  expect(btn.tagName).toBe('BUTTON')
  expect(btn.getAttribute('type')).toBe('button')

  fireEvent.click(btn)
  const box = await screen.findByRole('textbox', { name: 'Your note on this (optional)' })
  expect(sendMock).not.toHaveBeenCalled()                   // nothing is sent before Save
  fireEvent.change(box, { target: { value: '  the textbook VCP  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
  const [widgetId, capture, opts] = sendMock.mock.calls[0]
  expect(widgetId).toBe('modelbook')
  expect(opts).toEqual({ label: 'NVDA 2025 (Model Book)' })
  expect(capture).toEqual({
    year: 2025, symbol: 'NVDA', setupId: 10, setupType: 'VCP', setupDate: '2025-03-14',
    title: 'NVDA 2025 — VCP 2025-03-14', annotation: 'the textbook VCP',
  })
  const params = normalizeParams('modelbook', capture)
  expect(validateParams('modelbook', params).ok).toBe(true)
  expect(isReconstructable('modelbook', params)).toBe(true)
  expect(await screen.findByText('NVDA 2025 (Model Book) sent to “Plan”')).toBeInTheDocument()
})

test('Cancel sends nothing', async () => {
  render(<ModelBook />)
  fireEvent.click(screen.getByRole('button', { name: 'Save NVDA 2025 to Notebook' }))
  await screen.findByRole('textbox', { name: 'Your note on this (optional)' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('textbox', { name: 'Your note on this (optional)' })).toBeNull()
  expect(sendMock).not.toHaveBeenCalled()
})

test('on the Catalysts tab no setup is selected, so the reference is the stock alone', async () => {
  render(<ModelBook />)
  fireEvent.click(screen.getByRole('button', { name: /catalysts/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Save NVDA 2025 to Notebook' }))
  await screen.findByRole('textbox', { name: 'Your note on this (optional)' })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))     // no words typed
  await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
  expect(sendMock.mock.calls[0][1]).toEqual({ year: 2025, symbol: 'NVDA', title: 'NVDA 2025' })
})

test('buildModelBookCapture: no stock, nothing to save', () => {
  expect(buildModelBookCapture(null)).toBeNull()
  expect(buildModelBookCapture({ year: 'x', symbol: 'NVDA' })).toBeNull()
})
