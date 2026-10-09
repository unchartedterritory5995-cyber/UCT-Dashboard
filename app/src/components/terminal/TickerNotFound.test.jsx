// Wave 4 #1: the one drawing of the wave-2 `not_found` marker.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PanelListContext } from './terminalPanel'
import TickerNotFound, { notFoundOf } from './TickerNotFound'

afterEach(cleanup)

const marker = { not_found: true, message: 'No data for ZZQXV — check the ticker', suggestions: ['ZQXV', 'zzqx', 'ZZQXV', '<b>'] }

describe('notFoundOf', () => {
  it('reads the marker, normalises and dedupes suggestions, drops the symbol itself and junk', () => {
    expect(notFoundOf(marker, 'zzqxv')).toEqual({ message: 'No data for ZZQXV — check the ticker', suggestions: ['ZQXV', 'ZZQX'] })
  })
  it('null without the marker (an empty but real answer is not "not found")', () => {
    expect(notFoundOf({ name: null, sector: null })).toBeNull()
    expect(notFoundOf(null)).toBeNull()
    expect(notFoundOf({ not_found: 'yes' })).toBeNull()
  })
  it('falls back to a message when the server sent none', () => {
    expect(notFoundOf({ not_found: true }, 'abc').message).toBe('No data for ABC — check the ticker')
  })
})

describe('<TickerNotFound>', () => {
  it('inside a terminal panel a suggestion LOADS the name', () => {
    const run = vi.fn()
    render(
      <PanelListContext.Provider value={{ run }}>
        <TickerNotFound sym="ZZQXV" payload={marker} />
      </PanelListContext.Provider>,
    )
    expect(screen.getByRole('status').textContent).toContain('No data for ZZQXV — check the ticker')
    fireEvent.click(screen.getByRole('button', { name: 'Load ZZQX' }))
    expect(run).toHaveBeenCalledWith('$ZZQX')
  })
  it('renders nothing for a payload without the marker', () => {
    const { container } = render(<TickerNotFound sym="AAPL" payload={{ name: 'Apple' }} />)
    expect(container.textContent).toBe('')
  })
  it('no suggestions → the message alone', () => {
    render(<TickerNotFound sym="ZZQXV" payload={{ not_found: true, message: 'No data for ZZQXV — check the ticker' }} />)
    expect(screen.queryByTestId('ticker-not-found-suggestions')).toBeNull()
    expect(screen.getByTestId('ticker-not-found').textContent).toContain('check the ticker')
  })
})
