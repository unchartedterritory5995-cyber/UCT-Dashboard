// app/src/pages/journal-2-0/tabs/OpenPositionsTab.deleteFocus.test.jsx
//
// ⛔⛔ Wave 10 follow-up F7, Part C (F4's review, Important 1). A position delete never drops
// focus to <body>. The row's own "Del" button opens ConfirmModal and the delete removes that
// row, so ConfirmModal's return-to-invoker had nothing to return to. OpenPositionsTab now
// records the rows around it (by the `data-hub-pos` id the table row already carries, in the
// order they SHOW -- the table sorts) and hands ConfirmModal a `fallbackFocus`.
//
// The REAL PositionsTable renders the rows (its markup is what the fallback looks up); the data
// hooks are faked, and the faked positions store REMEMBERS the delete, so the row is really
// gone when the dialog closes. Only the modules OpenPositionsTab imports are mocked.
import { useState, useSyncExternalStore } from 'react'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => {
  const s = { positions: [], listeners: new Set() }
  s.set = (next) => { s.positions = next; s.listeners.forEach((l) => l()) }
  return s
})

vi.mock('../hooks/useJ2Positions', () => ({
  default: () => {
    const positions = useSyncExternalStore(
      (l) => { store.listeners.add(l); return () => store.listeners.delete(l) },
      () => store.positions,
    )
    return { positions, isLoading: false, error: null, refresh: async () => store.set([...store.positions]) }
  },
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { id: 'a1', name: 'Test' }, accounts: [] }),
}))
vi.mock('../hooks/useJ2Nudges', () => ({ default: () => ({ nudges: null }) }))
vi.mock('../hooks/useBrokerWarming', () => ({ default: () => ({ warming: false, broker: null }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, isStreaming: false }) }))
vi.mock('../components/BrokerAccountHero', () => ({ default: () => null }))
vi.mock('../components/BrokerReviewNudge', () => ({ default: () => null }))
vi.mock('../components/NudgesBanner', () => ({ default: () => null }))
vi.mock('../components/trust/SyncTrustCenter', () => ({ default: () => null }))
vi.mock('../components/broker/BrokerEquityCurve', () => ({ default: () => null }))
vi.mock('../components/PortfolioAttentionBanner', () => ({ default: () => null }))
// TickerPopup pulls in AuthContext via useFlagged (PositionsTable.test.jsx stubs it the same way).
vi.mock('../../../components/TickerPopup', () => ({
  default: ({ as: Tag = 'span', className, children }) => {
    const [, setOpen] = useState(false)
    return <Tag className={className} onClick={() => setOpen(true)}>{children}</Tag>
  },
}))

import OpenPositionsTab from './OpenPositionsTab'

const pos = (id, symbol) => ({
  id, symbol, side: 'Long', shares: 10, originalShares: 10, entryPrice: 100, stopPrice: 95,
  entryDate: '2026-09-01T00:00:00Z', setup: null, notes: null, contextAtEntry: {},
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('uct.j2.openPositions.view', 'table')
  store.positions = [pos(1, 'AAPL'), pos(2, 'MSFT'), pos(3, 'NVDA')]
  global.fetch = vi.fn((url, opts) => {
    const path = String(url).split('?')[0]
    if (opts?.method === 'DELETE' && path.startsWith('/api/j2/positions/')) {
      const id = Number(path.split('/').pop())
      store.positions = store.positions.filter((p) => p.id !== id)   // the refresh publishes it
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
})

async function deletePosition(user, sym) {
  const opener = await screen.findByRole('button', { name: `Delete ${sym}` })
  await user.click(opener)
  const dialog = await screen.findByRole('dialog', { name: `Delete ${sym}?` })
  await user.click(within(dialog).getByRole('button', { name: 'Delete Position' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  // the invoker went with its row -- otherwise this rail proves nothing
  await waitFor(() => expect(screen.queryByRole('button', { name: `Delete ${sym}` })).toBeNull())
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
}

describe('position delete (OpenPositionsTab) -- focus goes to the neighbouring row', () => {
  it('deleting a row lands on the NEXT row as it shows, not <body>', async () => {
    const user = userEvent.setup()
    render(<OpenPositionsTab settings={{}} />)
    await deletePosition(user, 'AAPL')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement.getAttribute('data-hub-pos')).toBe('2')   // MSFT
  })

  it('deleting the last row lands on the row before it', async () => {
    const user = userEvent.setup()
    render(<OpenPositionsTab settings={{}} />)
    await deletePosition(user, 'NVDA')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement.getAttribute('data-hub-pos')).toBe('2')   // MSFT
  })

  it('deleting the only row lands on "+ Add Position"', async () => {
    store.positions = [pos(7, 'AMD')]
    const user = userEvent.setup()
    render(<OpenPositionsTab settings={{}} />)
    await deletePosition(user, 'AMD')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add Position' }))
  })
})
