// usePanelRows / usePanelSymbolRows — the embedded-component twin of the `onRows` prop. A page or
// tab the shell renders unforked (U20, FREC, CATH, RISK, OSCR, WIRE) publishes its numbered rows
// and its list through PanelListContext; outside a terminal panel both hooks do nothing.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PanelListContext, usePanelRows, usePanelSymbolRows } from './terminalPanel'

afterEach(cleanup)

function harness() {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4 }
  const wrapper = ({ children }) => <PanelListContext.Provider value={api}>{children}</PanelListContext.Provider>
  return { api, wrapper }
}

function Rows({ rows }) { usePanelRows(rows); return null }
function SymRows({ syms, label, total, onUnique }) {
  const unique = usePanelSymbolRows(syms, label, { total })
  onUnique?.(unique)
  return null
}

describe('usePanelRows', () => {
  it('publishes the rows to the shell, and an absent list as no rows', () => {
    const { api, wrapper } = harness()
    const { rerender } = render(<Rows rows={['$AMD', 'NVDA GP']} />, { wrapper })
    expect(api.publishRows).toHaveBeenLastCalledWith(['$AMD', 'NVDA GP'])
    rerender(<Rows rows={null} />)
    expect(api.publishRows).toHaveBeenLastCalledWith([])
  })

  it('re-publishes only when the rows change, not on every render', () => {
    const { api, wrapper } = harness()
    const { rerender } = render(<Rows rows={['$AMD']} />, { wrapper })
    rerender(<Rows rows={['$AMD']} />)
    rerender(<Rows rows={['$AMD']} />)
    expect(api.publishRows).toHaveBeenCalledTimes(1)
  })

  it('is a harmless no-op outside a terminal panel (no provider) and while unfocused (no publishRows)', () => {
    expect(() => render(<Rows rows={['$AMD']} />)).not.toThrow()
    const api = { publish: vi.fn() }
    expect(() => render(<Rows rows={['$AMD']} />, {
      wrapper: ({ children }) => <PanelListContext.Provider value={api}>{children}</PanelListContext.Provider>,
    })).not.toThrow()
  })
})

describe('usePanelSymbolRows', () => {
  it('one `$SYM` row per visible row (duplicates kept: row N is the Nth row), the list de-duplicated', () => {
    const { api, wrapper } = harness()
    let unique
    render(<SymRows syms={['nvda', 'AMD', 'NVDA', '', null, ' tsla ']} label="test list" onUnique={(u) => { unique = u }} />, { wrapper })
    expect(api.publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD', '$NVDA', '$TSLA'])
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['NVDA', 'AMD', 'TSLA'], label: 'test list' })
    expect(unique).toEqual(['NVDA', 'AMD', 'TSLA'])
  })

  it('carries a total when given, and an empty list publishes no list (null) and no rows', () => {
    const { api, wrapper } = harness()
    const { rerender } = render(<SymRows syms={['AMD']} label="x" total={40} />, { wrapper })
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['AMD'], label: 'x', total: 40 })
    rerender(<SymRows syms={[]} label="x" />)
    expect(api.publish).toHaveBeenLastCalledWith(null)
    expect(api.publishRows).toHaveBeenLastCalledWith([])
  })

  it('clears its list on unmount, so a closed panel never leaves one behind', () => {
    const { api, wrapper } = harness()
    const { unmount } = render(<SymRows syms={['AMD']} label="x" />, { wrapper })
    unmount()
    expect(api.publish).toHaveBeenLastCalledWith(null)
  })
})
