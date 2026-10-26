// Wave 10 Task 10.20: the position size calculator block (W10-R8). Copy is asserted by rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'

// The hooks behind the block's read seam (hooks/usePositionSizingSources); the seam itself is real here. `save` and
// `setAccount` are spies that must NEVER be called: the block reads the account, its one write door is setParams.
const S = vi.hoisted(() => ({ settings: null, isLoading: false, save: null, error: undefined, refresh: null,
  accountId: 'a1', accounts: null, accountsLoading: false, accountsError: undefined }))
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: S.settings, isLoading: S.isLoading,
  save: S.save, error: S.error, refresh: S.refresh }) }))
vi.mock('../../../hooks/useJ2Accounts', () => ({ default: () => S.accounts }))
vi.mock('../../../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: S.accountId,
  isAllAccounts: false, isLoading: S.accountsLoading, accountsError: S.accountsError,
  accounts: S.accounts?.accounts ?? [], setAccount: S.save }) }))
vi.mock('../../../hooks/useJ2CurrentRegime', () => ({ default: () => ({ regime: null }) }))
import SizeCalcBlock from './SizeCalcBlock'

const W10 = () => latchNotebookFlags({ notebook_widgets_w10_enabled: true })
const spin = (name) => screen.getByRole('spinbutton', { name })

beforeEach(() => {
  S.settings = { accountSize: 50000 }
  S.isLoading = false
  S.save = vi.fn()
  S.error = undefined
  S.refresh = vi.fn()
  S.accountId = 'a1'
  S.accounts = { accounts: [{ id: 'a1', name: 'Main' }], refresh: vi.fn() }
  S.accountsLoading = false
  S.accountsError = undefined
  W10()
})
afterEach(() => { cleanup(); __resetNotebookFlags() })

describe('SizeCalcBlock', () => {
  it('placeholder_account_size_not_used', () => {
    // IR-S9: the server's $100,000 default (and a size the server marks as its default) is not the member's
    for (const settings of [{ accountSize: 100000 }, { accountSize: 75000, accountSizeIsDefault: true }, {}]) {
      S.settings = settings
      render(<SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }} setParams={vi.fn()} editable />)
      expect(screen.getByText('Set your account size, or enter one for this note.'), JSON.stringify(settings)).toBeTruthy()
      expect(spin('Account size for this note')).toBeTruthy()
      expect(screen.queryByText(/shares? of NVDA/)).toBeNull()
      expect(screen.queryByText(/^Position value/)).toBeNull()
      cleanup()
    }
    // a size typed for this note sizes the trade
    S.settings = { accountSize: 100000 }
    render(<SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1, accountSize: 80000 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('160 shares of NVDA, $800 at risk (1% of the account).')).toBeTruthy()
    expect(screen.getByText("Sized against this note's $80,000.")).toBeTruthy()
  })

  it('the member\'s own size is read live and named, and offers no note-size input', () => {
    render(<SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Sized against Main: $50,000.')).toBeTruthy()
    expect(screen.queryByRole('spinbutton', { name: 'Account size for this note' })).toBeNull()
    cleanup()
    S.settings = { accountSize: 20000 }       // never stamped: the next render reads the new size
    render(<SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('40 shares of NVDA, $200 at risk (1% of the account).')).toBeTruthy()
  })

  it('I-1: accounts pending is LOADING: no account sentence, no note-size field, and nothing sized', () => {
    S.accountId = null
    S.accountsLoading = true
    S.accounts = { accounts: [], refresh: vi.fn() }
    const setParams = vi.fn(() => true)
    render(<SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }} setParams={setParams} editable />)
    expect(screen.getByText('Reading your account size…')).toBeTruthy()
    expect(screen.queryByText('Set your account size, or enter one for this note.')).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: 'Account size for this note' })).toBeNull()
    expect(screen.queryByText(/shares of NVDA/)).toBeNull()
    // a keystroke while pending is one write of what was typed, and the block still waits for the accounts
    fireEvent.change(spin('Entry'), { target: { value: '101' } })
    expect(setParams).toHaveBeenCalledTimes(1)
    expect(setParams).toHaveBeenCalledWith({ entry: 101 })
    expect(screen.queryByRole('spinbutton', { name: 'Account size for this note' })).toBeNull()
    expect(screen.queryByText('Set your account size, or enter one for this note.')).toBeNull()
  })

  it('I-1: accounts failed is its own state, with Try again re-reading the accounts', () => {
    S.accountId = null
    S.accountsError = new Error('503')
    S.accounts = { accounts: [], refresh: vi.fn() }
    render(<SizeCalcBlock params={{ entry: 100, stop: 95, riskPct: 1 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Your accounts could not be loaded just now.')).toBeTruthy()
    expect(screen.queryByText('Set your account size, or enter one for this note.')).toBeNull()
    expect(screen.queryByText('Reading your account size…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(S.accounts.refresh).toHaveBeenCalledTimes(1)
    expect(S.refresh).not.toHaveBeenCalled()                                   // the accounts, not the settings
  })

  it('I-1: accounts loaded with a size sizes against it, with no loading or failure line', () => {
    render(<SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('100 shares of NVDA, $500 at risk (1% of the account).')).toBeTruthy()
    expect(screen.queryByText('Reading your account size…')).toBeNull()
    expect(screen.queryByText('Your accounts could not be loaded just now.')).toBeNull()
  })

  it('m-3: never stamped -- a changed live size is followed, and params never gain an account size', () => {
    const setParams = vi.fn(() => true)
    const params = { symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }
    const { rerender } = render(<SizeCalcBlock params={params} setParams={setParams} editable />)
    expect(screen.getByText('100 shares of NVDA, $500 at risk (1% of the account).')).toBeTruthy()
    S.settings = { accountSize: 20000 }
    rerender(<SizeCalcBlock params={params} setParams={setParams} editable />)
    expect(screen.getByText('40 shares of NVDA, $200 at risk (1% of the account).')).toBeTruthy()
    expect(screen.getByText('Sized against Main: $20,000.')).toBeTruthy()
    expect(setParams).not.toHaveBeenCalled()
    expect(setParams.mock.calls.some(([p]) => Object.hasOwn(p || {}, 'accountSize'))).toBe(false)
    expect(Object.hasOwn(params, 'accountSize')).toBe(false)
  })

  it('m-2: the note-size field stays under the cursor while cleared, and an invalid draft sizes nothing', () => {
    const setParams = vi.fn(() => true)
    const { rerender } = render(<SizeCalcBlock params={{ entry: 100, stop: 95, riskPct: 1, accountSize: 80000 }}
      setParams={setParams} editable />)
    const field = spin('Account size for this note')
    field.focus()
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '' } })
    expect(setParams).toHaveBeenLastCalledWith({ accountSize: undefined })
    rerender(<SizeCalcBlock params={{ entry: 100, stop: 95, riskPct: 1 }} setParams={setParams} editable />)  // fed back
    const still = spin('Account size for this note')
    expect(still).toBe(field)
    expect(document.activeElement).toBe(field)
    // an invalid draft is still the note's override: the field stays and nothing sizes against the account
    fireEvent.blur(field)
    rerender(<SizeCalcBlock params={{ entry: 100, stop: 95, riskPct: 1, accountSize: -100 }} setParams={setParams} editable />)
    expect(spin('Account size for this note')).toBeTruthy()
    expect(screen.getByText('Set your account size, or enter one for this note.')).toBeTruthy()
    expect(screen.queryByText(/shares/)).toBeNull()
    expect(screen.queryByText(/Sized against Main/)).toBeNull()
    // blurred with no override and an own size: the field goes (control)
    rerender(<SizeCalcBlock params={{ entry: 100, stop: 95, riskPct: 1 }} setParams={setParams} editable />)
    expect(screen.queryByRole('spinbutton', { name: 'Account size for this note' })).toBeNull()
  })

  it('m-4: the risk placeholder only for a max risk between 0 and 10', () => {
    for (const [v, want] of [[1.5, '1.5'], [10, '10'], [15, null], [10.5, null], [0, null], [-1, null], ['x', null]]) {
      S.settings = { accountSize: 50000, maxRiskPerTradePct: v }
      render(<SizeCalcBlock params={{}} setParams={vi.fn()} editable />)
      expect(spin('Risk per trade (%)').getAttribute('placeholder'), String(v)).toBe(want)
      cleanup()
    }
  })

  it('max_risk_per_trade_is_a_placeholder_only', () => {
    S.settings = { accountSize: 50000, maxRiskPerTradePct: 1.5 }
    const setParams = vi.fn(() => true)
    render(<SizeCalcBlock params={{ entry: 100, stop: 95 }} setParams={setParams} editable />)
    const risk = spin('Risk per trade (%)')
    expect(risk.getAttribute('placeholder')).toBe('1.5')
    expect(risk.value).toBe('')
    expect(setParams).not.toHaveBeenCalled()                                    // never written until the member types
    expect(screen.getByText('Enter the risk per trade, up to 10%.')).toBeTruthy() // and never sized against
    expect(screen.queryByText(/shares/)).toBeNull()
    fireEvent.change(risk, { target: { value: '1.5' } })
    expect(setParams).toHaveBeenCalledTimes(1)
    expect(setParams).toHaveBeenCalledWith({ riskPct: 1.5 })
    cleanup()
    S.settings = { accountSize: 50000 }                                          // no setting: no placeholder
    render(<SizeCalcBlock params={{}} setParams={vi.fn()} editable />)
    expect(spin('Risk per trade (%)').getAttribute('placeholder')).toBeNull()
  })

  it('one_set_params_per_change', () => {
    S.settings = { accountSize: 100000 }
    const setParams = vi.fn(() => true)
    render(<SizeCalcBlock params={{}} setParams={setParams} editable />)
    const steps = [
      [screen.getByRole('textbox', { name: 'Symbol' }), 'nvda', { symbol: 'nvda' }],
      [spin('Entry'), '101.5', { entry: 101.5 }],
      [spin('Stop'), '99', { stop: 99 }],
      [spin('Risk per trade (%)'), '0.5', { riskPct: 0.5 }],
      [spin('Account size for this note'), '25000', { accountSize: 25000 }],
    ]
    steps.forEach(([el, value, patch], i) => {
      fireEvent.change(el, { target: { value } })
      expect(setParams).toHaveBeenCalledTimes(i + 1)
      expect(setParams).toHaveBeenLastCalledWith(patch)
    })
    cleanup()
    // clearing a field is one change too, and stores nothing in its place
    const clear = vi.fn(() => true)
    render(<SizeCalcBlock params={{ entry: 100 }} setParams={clear} editable />)
    fireEvent.change(spin('Entry'), { target: { value: '' } })
    expect(clear).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith({ entry: undefined })
    expect(S.save).not.toHaveBeenCalled()
    expect(S.refresh).not.toHaveBeenCalled()
  })

  it('read-only: the inputs are disabled and nothing is written', () => {
    const setParams = vi.fn()
    render(<SizeCalcBlock params={{ entry: 100 }} setParams={setParams} editable={false} />)
    expect(spin('Entry').disabled).toBe(true)
    fireEvent.change(spin('Entry'), { target: { value: '5' } })
    expect(setParams).not.toHaveBeenCalled()
  })

  it('flag_off_not_available', () => {
    __resetNotebookFlags()
    render(<SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Not available right now.')).toBeTruthy()
    expect(screen.queryAllByRole('spinbutton')).toEqual([])
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryByText(/shares/)).toBeNull()
    cleanup()
    W10()                                                                         // control: the same params, wave on
    render(<SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }} setParams={vi.fn()} editable />)
    expect(screen.queryByText('Not available right now.')).toBeNull()
    expect(screen.getAllByRole('spinbutton').length).toBeGreaterThan(0)
  })

  it('result_sentences_exact', () => {
    render(<SizeCalcBlock params={{ symbol: 'nvda', entry: 100, stop: 95, riskPct: 1 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('100 shares of NVDA, $500 at risk (1% of the account).')).toBeTruthy()
    expect(screen.getByText('Position value: $10,000 (20% of the account).')).toBeTruthy()
    cleanup()
    // one share; no symbol yet; a fractional percent
    render(<SizeCalcBlock params={{ entry: 300, stop: 297, riskPct: 0.01 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('1 share, $3.00 at risk (0.01% of the account).')).toBeTruthy()
    expect(screen.getByText('Position value: $300 (0.6% of the account).')).toBeTruthy()
    cleanup()
    // a short sizes the same way; whole shares floor the risk under what was asked
    render(<SizeCalcBlock params={{ symbol: 'TSLA', entry: 20, stop: 23, riskPct: 2 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('333 shares of TSLA, $999 at risk (2% of the account).')).toBeTruthy()
    expect(screen.getByText('Position value: $6,660 (13.32% of the account).')).toBeTruthy()
    cleanup()
    // under one share: the sentence, never "0 shares"
    render(<SizeCalcBlock params={{ entry: 100, stop: 50, riskPct: 0.05 }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Your risk is smaller than one share at this stop.')).toBeTruthy()
    expect(screen.queryByText(/0 shares|\$0\b|\b0%/)).toBeNull()
    cleanup()
    // a brand-new block: one sentence, no number
    render(<SizeCalcBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getByText('Enter an entry and a stop.')).toBeTruthy()
    expect(screen.queryByText(/\$0|\b0%|0 shares/)).toBeNull()
    cleanup()
    render(<SizeCalcBlock params={{ entry: 100, stop: 100, riskPct: 1 }} setParams={vi.fn()} editable />)
    expect(screen.getByText("Entry and stop can't be the same.")).toBeTruthy()
  })

  it('keyboard_labels_and_44px', () => {
    S.settings = { accountSize: 100000 }
    render(<SizeCalcBlock params={{}} setParams={vi.fn()} editable />)
    const fields = [screen.getByLabelText('Symbol'), screen.getByLabelText('Entry'), screen.getByLabelText('Stop'),
      screen.getByLabelText('Risk per trade (%)'), screen.getByLabelText('Account size for this note')]
    for (const el of fields) {
      expect(el.tagName).toBe('INPUT')
      expect(el.getAttribute('tabindex')).toBeNull()             // in the natural tab order
      el.focus()
      expect(document.activeElement).toBe(el)
    }
    expect(new Set(fields.map((el) => el.id)).size).toBe(fields.length)
    // every control reaches the 44px floor on touch (phone AND tablet: max-width 1024px)
    const css = readFileSync(join(__dirname, 'SizeCalcBlock.module.css'), 'utf8')
    const touch = /@media\s*\(max-width:\s*1024px\)\s*\{([^}]*)\}/.exec(css)
    expect(touch, 'a max-width 1024px block').toBeTruthy()
    expect(touch[1]).toMatch(/\.input[^{]*\{?[^}]*min-height:\s*var\(--tap-min\)/)
  })
})
