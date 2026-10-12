import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// The two hooks the body reads. `S` is mutated per test; `save` is a spy that must NEVER be called
// (the block reads settings, it never writes them: its one write door is setParams).
const S = vi.hoisted(() => ({ settings: null, isLoading: false, save: null, regime: null, error: undefined, refresh: null,
  accountName: 'Main', accountId: 'a1', accounts: null }))
// `isAllAccounts` mirrors the real hook (`accountId == null`); the block must not depend on it (R-T11-2 N-1).
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: S.settings, isLoading: S.isLoading, save: S.save,
  error: S.error, refresh: S.refresh, accountName: S.accountName, accountId: S.accountId, isAllAccounts: S.isAllAccounts ?? S.accountId == null }) }))
vi.mock('../../../hooks/useJ2Accounts', () => ({ default: () => S.accounts }))
vi.mock('../../../hooks/useJ2CurrentRegime', () => ({ default: () => ({ regime: S.regime }) }))
import PositionSizingBlock from './PositionSizingBlock'

beforeEach(() => {
  S.settings = { accountSize: 50000 }
  S.isLoading = false
  S.save = vi.fn()
  S.regime = { regime: 'green', asOf: '2026-10-13' }
  S.error = undefined
  S.refresh = vi.fn()
  S.accountName = 'Main'
  S.accountId = 'a1'
  S.isAllAccounts = undefined
  S.accounts = { accounts: [{ id: 'a1', name: 'Main' }], isLoading: false, error: undefined, refresh: vi.fn() }
})
afterEach(() => { vi.useRealTimers() })

describe('PositionSizingBlock', () => {
  it('named inputs; an input change is one setParams carrying the regime it was sized in', () => {
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ grade: 'A+' }} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Entry' }), { target: { value: '100' } })
    expect(setParams).toHaveBeenCalledWith({ entry: 100, regimeId: 'green', regimeAsOf: '2026-10-13' })
    expect(setParams).toHaveBeenCalledTimes(1)
  })
  it('shows size, shares and risk from the house formula', () => {
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('House size: 25% of the account')).toBeTruthy()
    expect(screen.getByText('125 shares')).toBeTruthy()
    expect(screen.getByText('$625 at risk (1.25% of the account)')).toBeTruthy()
    expect(screen.queryByText(/^Whole shares:/)).toBeNull()                  // 125 x $100 IS 25% of $50,000
  })
  it('the default account size is not an account size: says where to set it, sizes nothing, offers a size for this note (IR-S9)', () => {
    S.settings = { accountSize: 100000 }
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'green' }} setParams={setParams} editable />)
    expect(screen.getByText('Set your account size in Settings.')).toBeTruthy()
    expect(screen.getByText('Your account size is still the $100,000 default, so this block does not size against it.')).toBeTruthy()
    expect(screen.queryByText(/shares$/)).toBeNull()
    expect(screen.queryByText(/of the account$/)).toBeNull()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Account size for this note' }), { target: { value: '80000' } })
    expect(setParams).toHaveBeenCalledWith({ accountSize: 80000 })
  })
  it('an UNSET account size sizes nothing either, and says why (S9)', () => {
    S.settings = {}
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Your account size is not set yet.')).toBeTruthy()
    expect(screen.getByText('Set your account size in Settings.')).toBeTruthy()
    expect(screen.queryByText(/shares$/)).toBeNull()
  })
  it('while settings are still loading it neither sizes nor claims the account is unset', () => {
    S.settings = undefined
    S.isLoading = true
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.queryByText('Set your account size in Settings.')).toBeNull()
    expect(screen.queryByText(/shares$/)).toBeNull()
  })
  it('a size typed into the note sizes the trade, and its input stays put while typing', () => {
    S.settings = { accountSize: 100000 }
    const { rerender } = render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green', accountSize: 8 }}
      setParams={vi.fn()} editable />)
    expect(screen.getByRole('spinbutton', { name: 'Account size for this note' })).toBeTruthy()   // not unmounted mid-typing
    rerender(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green', accountSize: 80000 }}
      setParams={vi.fn()} editable />)
    expect(screen.getByText('200 shares')).toBeTruthy()                                           // 25% of 80,000 / 100
    expect(screen.getByRole('spinbutton', { name: 'Account size for this note' }).value).toBe('80000')
  })
  it("sized in an older regime: says so and offers today's", () => {
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'orange', regimeAsOf: '2026-10-01' }} setParams={setParams} editable />)
    expect(screen.getByText('Sized for an ORANGE market (as of 2026-10-01).')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "Use today's regime (GREEN)" }))
    expect(setParams).toHaveBeenCalledWith({ regimeId: 'green', regimeAsOf: '2026-10-13' })
  })
  it('B in ORANGE renders skip, never a size, even before any price is entered', () => {
    render(<PositionSizingBlock params={{ grade: 'B', regimeId: 'orange' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('The house rules skip a B setup in an ORANGE market.')).toBeTruthy()
    expect(screen.queryByText(/of the account$/)).toBeNull()
    expect(screen.queryByText(/shares$/)).toBeNull()
  })
  it('a stop equal to the entry is refused with a sentence and no size', () => {
    render(<PositionSizingBlock params={{ entry: 100, stop: 100, grade: 'A', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Entry and stop are the same price.')).toBeTruthy()
    expect(screen.queryByText(/shares$/)).toBeNull()
  })
  it('no regime known: says so and sizes nothing (never a guessed regime)', () => {
    S.regime = undefined
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A' }} setParams={vi.fn()} editable />)
    expect(screen.getAllByText('The market regime is not known yet.').length).toBeGreaterThan(0)
    expect(screen.queryByText(/shares$/)).toBeNull()
  })
  it('read-only: every input is disabled and no regime button is offered', () => {
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'orange' }} setParams={vi.fn()} editable={false} />)
    for (const name of ['Entry', 'Stop']) expect(screen.getByRole('spinbutton', { name }).disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Setup grade' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /today's regime/ })).toBeNull()
  })
  it('the block never writes settings: its only door is setParams', () => {
    S.settings = { accountSize: 100000 }
    const setParams = vi.fn(() => true)
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'orange' }} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stop' }), { target: { value: '94' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Setup grade' }), { target: { value: 'A+' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Account size for this note' }), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: "Use today's regime (GREEN)" }))
    expect(setParams).toHaveBeenCalledTimes(4)
    expect(S.save).not.toHaveBeenCalled()
  })

  // ── Fix round 1 (R-T11-1) ──────────────────────────────────────────────────────────────────────
  it('C-1: All Accounts (or no account picked yet) is not an account size: no shares, says why, keeps the note input', () => {
    S.accountId = null
    S.settings = { accountSize: 25000 }                       // the frozen legacy j2_settings row
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Pick one account to size against, or enter a size for this note.')).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'Account size for this note' })).toBeTruthy()
    expect(screen.queryByText(/shares$/)).toBeNull()
    expect(screen.queryByText(/of the account$/)).toBeNull()
    expect(screen.queryByText(/25,000/)).toBeNull()
  })
  it("C-1: with no account picked, a size typed into the note still sizes, and says it is the note's", () => {
    S.accountId = null
    S.settings = { accountSize: 25000 }
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green', accountSize: 80000 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('200 shares')).toBeTruthy()
    expect(screen.getByText("Sized against this note's $80,000.")).toBeTruthy()
  })
  it('I-1: the house size is labelled as such, and the real whole-share percent is shown when it differs', () => {
    S.settings = { accountSize: 7000 }
    render(<PositionSizingBlock params={{ entry: 1000, stop: 950, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('House size: 25% of the account')).toBeTruthy()
    expect(screen.getByText('1 share')).toBeTruthy()
    expect(screen.getByText('$1,000 position')).toBeTruthy()
    expect(screen.getByText('Whole shares: 14.29% of the account')).toBeTruthy()
  })
  it('I-2: says which account and amount it sized against, live, and never stamps the size into params', () => {
    const setParams = vi.fn(() => true)
    const { rerender } = render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={setParams} editable />)
    expect(screen.getByText('Sized against Main: $50,000.')).toBeTruthy()
    S.settings = { accountSize: 60000 }
    rerender(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={setParams} editable />)
    expect(screen.getByText('Sized against Main: $60,000.')).toBeTruthy()
    expect(screen.getByText('150 shares')).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stop' }), { target: { value: '94' } })
    expect(setParams).toHaveBeenCalledWith({ stop: 94 })
    for (const [patch] of setParams.mock.calls) expect(Object.keys(patch)).not.toContain('accountSize')
  })
  it('a sub-dollar risk shows its cents and never reads "$0 at risk (0% of the account)"', () => {
    S.settings = { accountSize: 100001 }
    render(<PositionSizingBlock params={{ entry: 1000, stop: 999.999, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('$0.02 at risk (under 0.01% of the account)')).toBeTruthy()
    expect(screen.queryByText(/^\$0 at risk/)).toBeNull()
  })
  it('a failed settings read says so and offers Try again; it never claims the size is unset', () => {
    S.settings = undefined
    S.error = new Error('500')
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Your account size could not be read just now.')).toBeTruthy()
    expect(screen.queryByText('Your account size is not set yet.')).toBeNull()
    expect(screen.queryByText(/shares$/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(S.refresh).toHaveBeenCalledTimes(1)
  })
  it('above the preferred 1% and within 2%: one quiet note; at or under 1%: none', () => {
    const { rerender } = render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('$625 at risk (1.25% of the account)')).toBeTruthy()
    expect(screen.getAllByText('Above the house preference of under 1% risk per trade.')).toHaveLength(1)
    rerender(<PositionSizingBlock params={{ entry: 50, stop: 47, grade: 'A+', regimeId: 'amber' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('$450 at risk (0.9% of the account)')).toBeTruthy()
    expect(screen.queryByText(/preference of under 1%/)).toBeNull()
  })
  it('the live region announces only the SETTLED result, not every keystroke', () => {
    vi.useFakeTimers()
    const { rerender } = render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    const live = screen.getByTestId('sizing-announce')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('list', { name: 'Position size' }).closest('[aria-live]')).toBeNull()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(live.textContent).toBe('125 shares, $625 at risk.')
    for (const stop of [9, 90.5, 90]) {
      rerender(<PositionSizingBlock params={{ entry: 100, stop, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
      act(() => { vi.advanceTimersByTime(200) })
      expect(live.textContent).toBe('125 shares, $625 at risk.')                  // still the settled one
    }
    act(() => { vi.advanceTimersByTime(1000) })
    expect(live.textContent).toBe('100 shares, $1,000 at risk.')
  })

  // ── R-T11-2 ──────────────────────────────────────────────────────────────────────────────────
  it('N-2: before the first pick, while accounts load: "Loading your accounts…", never "Pick one", no size', () => {
    S.accountId = null
    S.accounts = { accounts: [], isLoading: true, error: undefined, refresh: vi.fn() }
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Loading your accounts…')).toBeTruthy()
    expect(screen.queryByText(/^Pick one account/)).toBeNull()
    expect(screen.queryByText(/shares$/)).toBeNull()
  })
  it('N-2: accounts that fail to load say so, with Try again, never "Pick one", no size', () => {
    S.accountId = null
    S.accounts = { accounts: [], isLoading: false, error: new Error('500'), refresh: vi.fn() }
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Your accounts could not be loaded just now.')).toBeTruthy()
    expect(screen.queryByText(/^Pick one account/)).toBeNull()
    expect(screen.queryByText(/shares$/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(S.accounts.refresh).toHaveBeenCalledTimes(1)
  })
  it('N-2: no accounts at all says so and sizes nothing', () => {
    S.accountId = null
    S.accounts = { accounts: [], isLoading: false, error: undefined, refresh: vi.fn() }
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('You have no accounts yet. Enter a size for this note.')).toBeTruthy()
    expect(screen.queryByText(/^Pick one account/)).toBeNull()
    expect(screen.queryByText(/shares$/)).toBeNull()
  })
  it('N-1: "no specific account" is accountId == null, whatever isAllAccounts says', () => {
    S.accountId = 'a1'
    S.isAllAccounts = true                     // a key that disagrees: it may only pick a sentence, never the rule
    render(<PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('125 shares')).toBeTruthy()
  })
  it('N-6: a risk under one cent reads "under $0.01" inside the sentence', () => {
    vi.useFakeTimers()
    S.settings = { accountSize: 100001 }
    render(<PositionSizingBlock params={{ entry: 1000, stop: 999.9999, grade: 'A+', regimeId: 'green' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Under $0.01 at risk (under 0.01% of the account)')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByTestId('sizing-announce').textContent).toBe('25 shares, under $0.01 at risk.')
  })
})
