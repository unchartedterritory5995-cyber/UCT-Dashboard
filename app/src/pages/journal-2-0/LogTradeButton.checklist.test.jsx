// Notebook P2a, Task 8 (IR-S7): the "+ Log Trade" door must RESOLVE the row it created, or the dialog
// has no id to save the member's ticks under; and it is one of the two doors that asks its dialogs for
// the pre-entry checklist. Both dialogs are stood in for by buttons that call the real onSave the door
// hands them, so what the door resolves is read directly.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const seen = {}
vi.mock('./hooks/useJ2Settings', () => ({ default: () => ({ settings: { setups: ['VCP'] } }) }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', account: { name: 'Main' }, accounts: [{ id: 'a1', name: 'Main' }] }) }))
vi.mock('./components/AddTradeModal', () => ({
  default: ({ onSave, preEntryChecklist }) => (
    <button type="button" onClick={async () => { seen.trade = { checklist: preEntryChecklist, resolved: await onSave({ symbol: 'NVDA', side: 'Long' }) } }}>save trade</button>
  ),
}))
vi.mock('./components/AddPositionModal', () => ({
  default: ({ onSave, preEntryChecklist }) => (
    <button type="button" onClick={async () => { seen.position = { checklist: preEntryChecklist, resolved: await onSave({ symbol: 'NVDA', side: 'Long' }) } }}>save position</button>
  ),
}))
import LogTradeButton from './LogTradeButton'

describe('LogTradeButton resolves the row it created (IR-S7)', () => {
  beforeEach(() => {
    for (const k of Object.keys(seen)) delete seen[k]
    globalThis.fetch = vi.fn(async (url) => ({ ok: true, status: 200,
      json: async () => (String(url).includes('/api/j2/trades') ? { id: 't9', symbol: 'NVDA' } : { id: 'p9', symbol: 'NVDA' }) }))
  })
  it('a closed trade: onSave resolves { id } and the dialog is asked for the checklist', async () => {
    render(<MemoryRouter><LogTradeButton /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Log Trade' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Log closed trade/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'save trade' }))
    await waitFor(() => expect(seen.trade?.resolved).toEqual({ id: 't9', symbol: 'NVDA' }))
    expect(seen.trade.checklist).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trades', expect.objectContaining({ method: 'POST' }))
  })
  it('an open position: the same', async () => {
    render(<MemoryRouter><LogTradeButton /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Log Trade' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Log open position/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'save position' }))
    await waitFor(() => expect(seen.position?.resolved).toEqual({ id: 'p9', symbol: 'NVDA' }))
    expect(seen.position.checklist).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/positions', expect.objectContaining({ method: 'POST' }))
  })
})
