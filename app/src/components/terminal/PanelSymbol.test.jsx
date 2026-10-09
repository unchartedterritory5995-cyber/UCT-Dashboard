// Wave 2 (audit 2026-10-08): a symbol in an embedded panel loads its name on click; outside a
// terminal panel it is the plain name, unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PanelListContext, PanelSymbol } from '.'

afterEach(cleanup)

describe('PanelSymbol', () => {
  it('inside a panel it is a button that runs `$SYM`', () => {
    const run = vi.fn()
    render(<PanelListContext.Provider value={{ run }}><PanelSymbol sym="nvda" /></PanelListContext.Provider>)
    const btn = screen.getByRole('button', { name: 'Load NVDA' })
    fireEvent.click(btn)
    expect(run).toHaveBeenCalledWith('$NVDA')
  })
  it('outside a panel it is plain text', () => {
    render(<PanelSymbol sym="NVDA" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('NVDA')).toBeTruthy()
  })
})
