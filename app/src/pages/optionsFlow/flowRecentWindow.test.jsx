// Wave 5 client wiring: the Search fetch asks for `recent=1` and a windowed product is labelled.
//
//     cd app && npx vitest run src/pages/optionsFlow/flowRecentWindow.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fetchSearchProduct, searchWindowOf } from './flowRecentWindow'
import FlowRecentWindowNote from './FlowRecentWindowNote'

function response(body, headers) {
  const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
  return { ok: true, status: 200, json: async () => body, headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null } }
}

const product = () => ({ all_directional: [], TICKER_DB: [] })
const full = () => response({ ok: true, schema: 1, sym: 'NVDA', source: 'stocks', version: 'v9', product: product() }, { 'X-Flow-Version': 'v9' })
const windowed = () => response(
  { ok: true, schema: 1, sym: 'NVDA', source: 'stocks', version: 'v9', product: product(),
    window_dates: ['10/2/2026', '10/5/2026'], sessions_total: 180, basis_complete: false },
  { 'X-Flow-Version': 'v9', 'X-Flow-Window': 'recent' },
)

describe('fetchSearchProduct (the page import) asks for a labelled recent window', () => {
  it('sends recent=1 alongside warm_only=1', async () => {
    let asked = ''
    await fetchSearchProduct('NVDA', 'stocks', { fetchImpl: async (u) => { asked = u; return full() } })
    expect(asked).toContain('warm_only=1')
    expect(asked).toContain('&recent=1')
  })

  it('a windowed answer is accepted AND remembered against the exact product object', async () => {
    const got = await fetchSearchProduct('NVDA', 'stocks', { fetchImpl: async () => windowed() })
    expect(got.ok).toBe(true)
    expect(searchWindowOf(got.product)).toEqual(got.window)
    expect(searchWindowOf(got.window ? { ...got.product } : null)).toBe(null)
  })

  it('a full answer carries no window', async () => {
    const got = await fetchSearchProduct('NVDA', 'stocks', { fetchImpl: async () => full() })
    expect(got.ok).toBe(true)
    expect(searchWindowOf(got.product)).toBe(null)
  })

  it('a decline passes through untouched and never rejects', async () => {
    const got = await fetchSearchProduct('NVDA', 'stocks', { fetchImpl: async () => ({ ok: false, status: 503 }) })
    expect(got).toEqual({ ok: false, reason: 'http', status: 503 })
  })
})

describe('FlowRecentWindowNote', () => {
  it('labels a windowed product with the sessions it covers', async () => {
    const got = await fetchSearchProduct('NVDA', 'stocks', { fetchImpl: async () => windowed() })
    render(<FlowRecentWindowNote sym="NVDA" searchFull={{ sym: 'NVDA', data: got.product }} />)
    const note = screen.getByTestId('flow-recent-window-note')
    expect(note.textContent).toContain('Showing the most recent 2 of 180 sessions')
    expect(note.textContent).toContain('older prints are not counted')
    expect(note.textContent).not.toContain('—')
  })

  it('renders nothing for a full-history product, another ticker, or no product', async () => {
    const fullGot = await fetchSearchProduct('NVDA', 'stocks', { fetchImpl: async () => full() })
    const winGot = await fetchSearchProduct('NVDA', 'stocks', { fetchImpl: async () => windowed() })
    const { container, rerender } = render(<FlowRecentWindowNote sym="NVDA" searchFull={{ sym: 'NVDA', data: fullGot.product }} />)
    expect(container.innerHTML).toBe('')
    rerender(<FlowRecentWindowNote sym="AMD" searchFull={{ sym: 'NVDA', data: winGot.product }} />)
    expect(container.innerHTML).toBe('')
    rerender(<FlowRecentWindowNote sym="NVDA" searchFull={null} />)
    expect(container.innerHTML).toBe('')
  })
})
