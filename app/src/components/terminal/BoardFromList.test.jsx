// The shared scan-to-board control: nothing outside a terminal panel, and inside one it hands the
// shell exactly the list it was given, as the function the member picked.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BoardFromList, PanelListContext } from './index'

afterEach(cleanup)

const CODES = [{ code: 'GP', label: 'Price chart' }, { code: 'DES', label: 'Description / overview' }]
const withShell = (api, ui) => render(<PanelListContext.Provider value={api}>{ui}</PanelListContext.Provider>)

describe('BoardFromList', () => {
  it('renders nothing outside a terminal panel (the screener page, the /charts widget)', () => {
    const { container } = render(<BoardFromList syms={['NVDA']} label="screener results" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the list as the picked function, and says how many of how many', () => {
    const openBoard = vi.fn()
    withShell({ openBoard, codes: CODES, pageSize: 4 },
      <BoardFromList syms={['A', 'B', 'C', 'D', 'E', 'F']} label="MOST gainers" />)
    const btn = screen.getByTestId('terminal-board-from-list-open')
    expect(btn).toHaveTextContent('Open 4 of 6')
    expect(btn).toHaveAccessibleName(/MOST gainers as a board of GP: 4 of 6 names, 4 panels at a time/)
    fireEvent.change(screen.getByTestId('terminal-board-from-list-code'), { target: { value: 'DES' } })
    fireEvent.click(btn)
    expect(openBoard).toHaveBeenCalledWith({ code: 'DES', syms: ['A', 'B', 'C', 'D', 'E', 'F'], label: 'MOST gainers', total: null })
  })

  it('an empty list is a disabled button that says so, never a board of nothing', () => {
    const openBoard = vi.fn()
    withShell({ openBoard, codes: CODES, pageSize: 4 }, <BoardFromList syms={[]} label="x" />)
    const btn = screen.getByTestId('terminal-board-from-list-open')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Nothing to open')
  })

  it('no usable function for this member: no control', () => {
    const { container } = withShell({ openBoard: vi.fn(), codes: [] }, <BoardFromList syms={['A']} label="x" />)
    expect(container).toBeEmptyDOMElement()
  })
})
