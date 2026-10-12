import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// The two hooks the body reads. `S` is mutated per test; `save` is a spy that must NEVER be called
// (the block reads settings, it never writes them: its one write door is setParams).
const S = vi.hoisted(() => ({ settings: null, isLoading: false, save: null, regime: null }))
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: S.settings, isLoading: S.isLoading, save: S.save }) }))
vi.mock('../../../hooks/useJ2CurrentRegime', () => ({ default: () => ({ regime: S.regime }) }))
import PositionSizingBlock from './PositionSizingBlock'

beforeEach(() => {
  S.settings = { accountSize: 50000 }
  S.isLoading = false
  S.save = vi.fn()
  S.regime = { regime: 'green', asOf: '2026-10-13' }
})

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
    expect(screen.getByText('25% of the account')).toBeTruthy()
    expect(screen.getByText('125 shares')).toBeTruthy()
    expect(screen.getByText('$625 at risk (1.25% of the account)')).toBeTruthy()
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
})
