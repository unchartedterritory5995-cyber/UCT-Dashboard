// screenerSection.busy.test.jsx — polish round 2026-10-14: while the Focus list's rows are a
// previous screen's (`busy`), the hub offers no symbol, so its row actions render disabled with
// the hub's own unmet-requirement reason rather than acting on a stale row.
import { renderHook } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

const setSymbol = vi.fn()
vi.mock('../HubContext', async (importOriginal) => ({ ...(await importOriginal()), useHubSetters: () => ({ setSymbol }) }))
import useScreenerHubSection from './screenerSection'

test('busy clears the shared symbol, and the row is offered again once it is not', () => {
  const rows = [{ ticker: 'MU' }, { ticker: 'ECO' }]
  const { rerender } = renderHook(({ busy }) => useScreenerHubSection({ displayRows: rows, busy }), { initialProps: { busy: false } })
  expect(setSymbol).toHaveBeenLastCalledWith('MU')
  rerender({ busy: true })
  expect(setSymbol).toHaveBeenLastCalledWith(null)
  rerender({ busy: false })
  expect(setSymbol).toHaveBeenLastCalledWith('MU')
})

test('without busy (ScannerShell) the symbol is never cleared', () => {
  setSymbol.mockClear()
  renderHook(() => useScreenerHubSection({ displayRows: [{ ticker: 'MU' }] }))
  expect(setSymbol.mock.calls.every(([v]) => v !== null)).toBe(true)
})
