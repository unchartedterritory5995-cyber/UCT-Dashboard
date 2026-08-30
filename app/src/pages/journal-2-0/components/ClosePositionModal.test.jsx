import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ClosePositionModal from './ClosePositionModal'

const YSS = {
  id: 'yss-1',
  userId: 'u1',
  symbol: 'YSS',
  side: 'Long',
  entryDate: '2026-04-09T00:00:00Z',
  shares: 250,
  originalShares: 250,
  entryPrice: 29.57,
  stopPrice: 27.9,
  breakevenStop: null,
  raiseToBreakeven: false,
  setup: 'VCP',
  notes: null,
  contextAtEntry: {},
  createdAt: '2026-04-09T00:00:00Z',
  updatedAt: '2026-04-09T00:00:00Z',
  closedAt: null,
}

describe('ClosePositionModal', () => {
  it('defaults shares-to-close to remaining', () => {
    render(<ClosePositionModal position={YSS} currentPrice={35.53} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('250')).toBeInTheDocument()
  })

  it('defaults exit price to the current live price', () => {
    render(<ClosePositionModal position={YSS} currentPrice={35.53} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('35.53')).toBeInTheDocument()
  })

  it('submits a YSS partial-close payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(<ClosePositionModal position={YSS} currentPrice={35.53} onSave={onSave} onClose={vi.fn()} />)

    // Change shares to 100 and exit to 34.50
    const sharesInput = screen.getByDisplayValue('250')
    await user.clear(sharesInput)
    await user.type(sharesInput, '100')
    const priceInput = screen.getByDisplayValue('35.53')
    await user.clear(priceInput)
    await user.type(priceInput, '34.50')

    await user.click(screen.getByRole('button', { name: /Close Position/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.shares).toBe(100)
    expect(payload.exitPrice).toBe(34.5)
    expect(payload.exitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('rejects closing more shares than remaining', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ClosePositionModal position={YSS} currentPrice={35.53} onSave={onSave} onClose={vi.fn()} />)

    const sharesInput = screen.getByDisplayValue('250')
    await user.clear(sharesInput)
    await user.type(sharesInput, '300')

    await user.click(screen.getByRole('button', { name: /Close Position/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/more than 250/)
  })

  it('rejects zero shares', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ClosePositionModal position={YSS} currentPrice={35.53} onSave={onSave} onClose={vi.fn()} />)

    const sharesInput = screen.getByDisplayValue('250')
    await user.clear(sharesInput)
    await user.type(sharesInput, '0')

    await user.click(screen.getByRole('button', { name: /Close Position/i }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows preview of P&L and R-multiple', async () => {
    const user = userEvent.setup()
    render(<ClosePositionModal position={YSS} currentPrice={35.53} onSave={vi.fn()} onClose={vi.fn()} />)

    // With defaults (250 shares @ 35.53): P&L = (35.53 - 29.57) * 250 = $1,490
    expect(screen.getByText(/\+\$1,490.00/)).toBeInTheDocument()
  })

  it('preview updates for YSS partial-close scenario', async () => {
    const user = userEvent.setup()
    render(<ClosePositionModal position={YSS} currentPrice={35.53} onSave={vi.fn()} onClose={vi.fn()} />)

    const sharesInput = screen.getByDisplayValue('250')
    await user.clear(sharesInput)
    await user.type(sharesInput, '100')
    const priceInput = screen.getByDisplayValue('35.53')
    await user.clear(priceInput)
    await user.type(priceInput, '34.50')

    // §14.7: partial close 100 @ 34.50 → P&L $493.00, R +3.0R
    expect(screen.getByText(/\+\$493.00/)).toBeInTheDocument()
    expect(screen.getByText(/\+3.0R/)).toBeInTheDocument()
  })
})

// ─── 🔴 THE LAST SURFACE HOLDING THE OTHER ANSWER ABOUT A $0 STOP ───────────
//
// `calculations.js` now says `realStop` is "the predicate every surface should
// ask", and this dialog was the one that made that claim false: it rendered
// `activeStop(position)` unguarded, so a manual row created without a stop
// (positions.py seeds `stop_price = 0.0`; the column is NOT NULL) showed
// **Stop: $0.00** — in the one place a member acts on the number.
describe('ClosePositionModal — a position with no real stop', () => {
  const NO_STOP = { ...YSS, id: 'nostop-1', entryPrice: 100, stopPrice: 0 }

  it('renders a dash, never "$0.00", for a stop that does not exist', () => {
    render(<ClosePositionModal position={NO_STOP} currentPrice={110} onSave={vi.fn()} onClose={vi.fn()} />)
    const banner = document.querySelector('[class*="infoBanner"]')
    expect(banner, 'the info banner is gone').not.toBeNull()
    expect(banner.textContent).toMatch(/Stop:\s*—/)
    expect(banner.textContent,
      'a $0.00 stop is presented as protection in the close dialog — the cockpit '
      + 'and the Positions tab both call this row unstopped').not.toMatch(/Stop:\s*\$0\.00/)
  })

  it('a BROKER placeholder stop reads the same way', () => {
    const placeholder = { ...YSS, id: 'ph-1', entryPrice: 100, stopPrice: 100, source: 'broker' }
    render(<ClosePositionModal position={placeholder} currentPrice={110} onSave={vi.fn()} onClose={vi.fn()} />)
    const banner = document.querySelector('[class*="infoBanner"]')
    expect(banner.textContent).toMatch(/Stop:\s*—/)
  })

  it('CONTROL: a REAL stop still renders its price', () => {
    // Without this, the assertions above are satisfied by a dialog that never
    // shows a stop at all.
    render(<ClosePositionModal position={YSS} currentPrice={35.53} onSave={vi.fn()} onClose={vi.fn()} />)
    const banner = document.querySelector('[class*="infoBanner"]')
    expect(banner.textContent).toMatch(/Stop:\s*\$27\.90/)
  })
})
