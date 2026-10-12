import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddTradeModal from './AddTradeModal'

// Notebook P2a, Task 8: the Log Trade checklist's three switches -- the journal styles switch, the
// member's preference, and the `preEntryChecklist` prop only the two Log Trade doors pass. Each test
// below sets them; the cases above leave the prop off, so they never see a checklist.
const p2a = vi.hoisted(() => ({ styles: true, pref: 'on' }))
vi.mock('../lib/journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => p2a.styles }))
vi.mock('../../../hooks/usePreferences', async (orig) => ({
  ...(await orig()),
  default: () => ({ prefs: { notebook_log_trade_checklist: p2a.pref }, setPref: vi.fn(), loading: false }),
}))
// The checklist reads through its one seam; here the seam answers with an account's ready data.
vi.mock('../hooks/useChecklistSources', () => ({
  RETURN_KEYS: ['settings', 'settingsState', 'retrySettings', 'rules', 'rulesState'],
  default: () => ({
    settings: {
      setups: ['VCP', 'Breakout'],
      setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }], Breakout: [{ id: 'b1', label: 'Pivot break' }] },
    },
    settingsState: 'ready', retrySettings: () => {}, rules: [], rulesState: 'ready',
  }),
}))

// Seam 17 remainder: this file tests the MODAL's own save/validation
// behavior, not SecuritySymbolInput's own search/debounce/keyboard behavior
// (covered by its own test file) -- reduced to a plain controlled input so
// no real (unmocked) `/api/ticker-search` fetch fires mid-test and lands a
// state update outside any of these tests' own act() boundary, and so it
// never collides with this file's own per-test global.fetch stubs.
vi.mock('./SecuritySymbolInput', () => ({
  default: ({ value, onChange, placeholder, disabled, autoFocus, className }) => (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className={className}
    />
  ),
}))

const SETTINGS = {
  setups: ['VCP', 'Breakout'],
}

describe('AddTradeModal', () => {
  afterEach(() => {
    // Some tests stub global.fetch (verdict + discipline SWR + telemetry) —
    // don't leak it into the fetch-free tests.
    delete global.fetch
  })

  it('mounts with title', () => {
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Add Trade' })).toBeInTheDocument()
  })

  it('requires a symbol', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Symbol is required/)
  })

  it('submits with empty contextAtEntry', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.symbol).toBe('NVDA')
    expect(payload.contextAtEntry).toEqual({})
    // Optional time-of-day fields default to null when the inputs are blank.
    expect(payload.entryTimeEt).toBeNull()
    expect(payload.exitTimeEt).toBeNull()
  })

  it('includes entryTimeEt / exitTimeEt in the payload when the time inputs are filled', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
    fireEvent.change(screen.getByLabelText('Entry time (ET)'), { target: { value: '09:45' } })
    fireEvent.change(screen.getByLabelText('Exit time (ET)'), { target: { value: '10:30' } })

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.entryTimeEt).toBe('09:45')
    expect(payload.exitTimeEt).toBe('10:30')
  })

  it('rejects exit date before entry date', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'X')
    await user.type(screen.getByLabelText(/Shares \*/), '10')
    await user.type(screen.getByLabelText(/Entry Price \*/), '100')
    await user.type(screen.getByLabelText(/Exit Price \*/), '110')
    const entryDateInput = screen.getByLabelText(/Entry Date \*/)
    const exitDateInput = screen.getByLabelText(/Exit Date \*/)
    fireEvent.change(entryDateInput, { target: { value: '2026-04-10' } })
    fireEvent.change(exitDateInput, { target: { value: '2026-04-09' } })

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be before entry/)
  })

  it('shows live preview of P&L and R-multiple', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'YSS')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
    await user.type(screen.getByLabelText(/Original Stop/), '27.90')

    expect(screen.getByText(/\+\$493.00/)).toBeInTheDocument()
    expect(screen.getByText(/\+3.0R/)).toBeInTheDocument()
  })

  // ── Pre-trade verdict embed (Task 6) ────────────────────────────────────────

  it('shows the Check with Compass button for paid users', () => {
    // useIsPaid() returns true with no AuthProvider mounted.
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Check with Compass/i })).toBeInTheDocument()
  })

  it('disables Check with Compass until a stop is entered', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')

    const compassBtn = screen.getByRole('button', { name: /Check with Compass/i })
    expect(compassBtn).toBeDisabled()
    expect(compassBtn).toHaveAttribute('title', 'add a stop to check with Compass')

    // Once a stop is present, the button enables + the hint clears.
    await user.type(screen.getByLabelText(/Original Stop/), '27.90')
    expect(compassBtn).toBeEnabled()
    expect(compassBtn).not.toHaveAttribute('title')
  })

  it('attaches the Compass verdict to the submitted payload after a run', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn().mockResolvedValue({})
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/coach/pre-trade-verdict')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            verdict_id: 'v-123', label: 'GO', paragraph: 'Clean setup.', factors: [],
          }),
        })
      }
      // discipline-state SWR + telemetry + anything else
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(
      <AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} accountId="acc1" />,
    )

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Original Stop/), '27.90')

    await user.click(screen.getByRole('button', { name: /Check with Compass/i }))

    // Verdict card renders the label once the mocked verdict resolves.
    await screen.findByText('GO')

    // Telemetry fired for the run.
    expect(global.fetch.mock.calls.some((c) => c[0] === '/api/j2/telemetry')).toBe(true)

    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.contextAtEntry).toEqual({
      compass_verdict_id: 'v-123',
      compass_verdict_label: 'GO',
    })
  })
})

// ── Notebook P2a, Task 8: the pre-entry checklist in Log Trade ──────────────────────────────────
describe('AddTradeModal: the pre-entry checklist (P2a)', () => {
  const ADHERENCE = '/api/j2/trades/NEW1/adherence'
  let putReply
  beforeEach(() => {
    p2a.styles = true
    p2a.pref = 'on'
    putReply = { ok: true, status: 200, json: () => Promise.resolve({}) }
    global.fetch = vi.fn((url, init) => (init?.method === 'PUT'
      ? Promise.resolve(putReply)
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
  })
  const puts = () => global.fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')
  // M-1: the body is a lazy chunk. Load it before any case, so "absent" cannot mean "not loaded yet",
  // and wait for it the way a present one is found: this throws if the checklist ever appears.
  beforeAll(async () => { await import('./LogTradeChecklist') })
  async function checklistNeverAppears(ms = 400) {
    let appeared = false
    try { await screen.findByRole('group', { name: 'Pre-entry checklist' }, { timeout: ms }); appeared = true } catch { /* not there */ }
    if (appeared) throw new Error('the pre-entry checklist appeared')
  }

  async function fillAndPickVcp(user) {
    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'VCP')
  }

  it('P2a: switch on, preference on, preEntryChecklist: the checklist shows, submit stays enabled, and a save writes the ticks under the created id', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn(async () => ({ id: 'NEW1', symbol: 'NVDA' }))
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    const group = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    await user.click(within(group).getByRole('checkbox', { name: 'Volume dry-up' }))
    const submit = screen.getByRole('button', { name: 'Add Trade' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(ADHERENCE, expect.objectContaining({ method: 'PUT' })))
    const [, init] = puts().find(([u]) => u === ADHERENCE)
    expect(JSON.parse(init.body)).toEqual({ setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 2 })
    expect(onSave).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('P2a: on-warn shows the soft warning; on does not', async () => {
    const user = userEvent.setup({ delay: null })
    p2a.pref = 'on-warn'
    const first = render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} preEntryChecklist />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'VCP')
    const group = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    expect(within(group).getByRole('status').textContent).toBe('2 checklist items not ticked. You can still log this trade.')
    expect(screen.getByRole('button', { name: 'Add Trade' })).toBeEnabled()
    first.unmount()

    p2a.pref = 'on'
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} preEntryChecklist />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'VCP')
    const again = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    expect(within(again).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(again).queryByRole('status')).toBeNull()
    expect(screen.queryByText(/You can still log this trade/)).toBeNull()
  })

  it('P2a: no preEntryChecklist prop (another surface): no checklist and no tick write', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={onClose} />)
    await fillAndPickVcp(user)
    await checklistNeverAppears()
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(puts()).toEqual([])
  })

  it('P2a: the switch off: no checklist and no tick write', async () => {
    const user = userEvent.setup({ delay: null })
    p2a.styles = false
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await checklistNeverAppears()
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(puts()).toEqual([])
  })

  it('P2a: the preference off: no checklist and no tick write', async () => {
    const user = userEvent.setup({ delay: null })
    p2a.pref = 'off'
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await checklistNeverAppears()
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(puts()).toEqual([])
  })

  it('P2a: CONTROL (M-1): the absence waiter sees a checklist that IS there', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} preEntryChecklist />)
    await fillAndPickVcp(user)
    await expect(checklistNeverAppears()).rejects.toThrow('the pre-entry checklist appeared')
  })

  it('P2a I-1: ticks on VCP, then Breakout picked and left untouched: nothing is written for Breakout', async () => {
    const user = userEvent.setup({ delay: null })
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn(async () => ({ id: 'NEW1' }))} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await user.click(within(await screen.findByRole('group', { name: 'Pre-entry checklist' })).getByRole('checkbox', { name: 'Volume dry-up' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'Breakout')
    expect((await screen.findByRole('checkbox', { name: 'Pivot break' })).checked).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(puts()).toEqual([])
  })

  it("P2a I-1: ticks on VCP, Breakout, back to VCP: VCP's ticks are written", async () => {
    const user = userEvent.setup({ delay: null })
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn(async () => ({ id: 'NEW1' }))} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await user.click(within(await screen.findByRole('group', { name: 'Pre-entry checklist' })).getByRole('checkbox', { name: 'Volume dry-up' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'Breakout')
    await screen.findByRole('checkbox', { name: 'Pivot break' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'VCP')
    expect((await screen.findByRole('checkbox', { name: 'Volume dry-up' })).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(puts().map(([u, init]) => [u, JSON.parse(init.body)]))
      .toEqual([[ADHERENCE, { setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 2 }]])
  })

  it('P2a I-2: a tick write nobody answers: after 10 s the dialog says it did not arrive, the trade stays logged, and Done works', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
      global.fetch = vi.fn((url, init) => (init?.method === 'PUT'
        ? new Promise(() => {})
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
      const onSave = vi.fn(async () => ({ id: 'NEW1' }))
      const onClose = vi.fn()
      render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
      await fillAndPickVcp(user)
      await user.click(within(await screen.findByRole('group', { name: 'Pre-entry checklist' })).getByRole('checkbox', { name: 'Volume dry-up' }))
      await user.click(screen.getByRole('button', { name: 'Add Trade' }))
      await waitFor(() => expect(puts()).toHaveLength(1))
      expect(screen.queryByRole('alert')).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect((await screen.findByRole('alert')).textContent)
        .toBe('Your trade is logged, but its pre-entry checklist was not saved. The request did not reach the server.')
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
      const done = screen.getByRole('button', { name: 'Done' })
      expect(done).toBeEnabled()
      await user.click(done)
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('P2a retry: a 5xx offers Try again; it re-sends the same ticks to the same id, and a success closes the dialog', async () => {
    const user = userEvent.setup({ delay: null })
    putReply = { ok: false, status: 503, json: () => Promise.resolve({}) }
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await user.click(within(await screen.findByRole('group', { name: 'Pre-entry checklist' })).getByRole('checkbox', { name: 'Tight closes' }))
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Your trade is logged, but its pre-entry checklist was not saved. The server answered with status 503.')
    putReply = { ok: true, status: 200, json: () => Promise.resolve({}) }
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const sent = puts().map(([u, init]) => [u, JSON.parse(init.body)])
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(sent[0]).toEqual([ADHERENCE, { setup: 'VCP', checkedRuleIds: ['s2'], totalRules: 2 }])
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('P2a retry: a retry that fails again keeps the dialog open with the new reason and the button', async () => {
    const user = userEvent.setup({ delay: null })
    putReply = { ok: false, status: 503, json: () => Promise.resolve({}) }
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn(async () => ({ id: 'NEW1' }))} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await user.click(within(await screen.findByRole('group', { name: 'Pre-entry checklist' })).getByRole('checkbox', { name: 'Tight closes' }))
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    await screen.findByRole('button', { name: 'Try again' })
    putReply = { ok: false, status: 502, json: () => Promise.resolve({}) }
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toBe('Your trade is logged, but its pre-entry checklist was not saved. The server answered with status 502.'))
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
    expect(puts()).toHaveLength(2)
  })

  it('P2a: a checklist nobody ticked writes nothing (no default answer)', async () => {
    const user = userEvent.setup({ delay: null })
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn(async () => ({ id: 'NEW1' }))} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await screen.findByRole('group', { name: 'Pre-entry checklist' })
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(puts()).toEqual([])
  })

  it('P2a: a create that failed writes no ticks', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn(async () => { throw new Error('500') })
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} preEntryChecklist />)
    await fillAndPickVcp(user)
    const group = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    await user.click(within(group).getByRole('checkbox', { name: 'Volume dry-up' }))
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(await screen.findByText("Couldn't save this trade. Nothing was changed — try again.")).toBeTruthy()
    expect(puts()).toEqual([])
  })

  it("P2a: a tick write that fails: the trade stays logged, the dialog says so in the server's words, and cannot log it twice", async () => {
    const user = userEvent.setup({ delay: null })
    putReply = { ok: false, status: 404, json: () => Promise.resolve({ detail: 'Trade not found' }) }
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    const group = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    await user.click(within(group).getByRole('checkbox', { name: 'Tight closes' }))
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Your trade is logged, but its pre-entry checklist was not saved. Trade not found.')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Add Trade' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()   // a 404's sentence stands
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
