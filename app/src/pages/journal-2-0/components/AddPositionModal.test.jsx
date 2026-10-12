import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddPositionModal from './AddPositionModal'
import usePreTradeVerdict from '../hooks/usePreTradeVerdict'
import * as settleModule from '../lib/offline/settleNoteWrite'

// Notebook P2a, Task 8: the Log Trade checklist's three switches -- the journal styles switch, the
// member's preference, and the `preEntryChecklist` prop only the two Log Trade doors pass. The cases
// that predate it leave the prop off, so they never see a checklist.
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
      setups: ['Breakout', 'VCP'],
      setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }], Breakout: [{ id: 'b1', label: 'Pivot break' }] },
    },
    settingsState: 'ready', retrySettings: () => {}, rules: [], rulesState: 'ready',
  }),
}))

// Control the verdict directly so the attachment branches are testable without
// wiring a live account + fetch.
vi.mock('../hooks/usePreTradeVerdict', () => ({
  default: vi.fn(),
}))

// Seam 17 remainder: this file tests the MODAL's own save/validation/thesis
// behavior, not SecuritySymbolInput's own search/debounce/keyboard behavior
// (covered by its own test file) -- reduced to a plain controlled input so
// no real (unmocked) `/api/ticker-search` fetch fires mid-test and lands a
// state update outside any of these tests' own act() boundary.
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

const NO_VERDICT = { run: vi.fn(), verdict: null, isLoading: false, error: null, reset: vi.fn() }

const BASE_SETTINGS = {
  accountSize: 100_000,
  defaultStop: { mode: 'custom' },
  setups: ['Breakout', 'VCP'],
  breakevenRange: { enabled: false, unit: '$', value: 0 },
}

describe('AddPositionModal', () => {
  beforeEach(() => {
    usePreTradeVerdict.mockReturnValue(NO_VERDICT)
  })

  it('mounts', () => {
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    // Use the heading specifically (button also says "Add Position")
    expect(screen.getByRole('heading', { name: 'Add Position' })).toBeInTheDocument()
  })

  it('requires a symbol', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Symbol is required/)
  })

  it('submits a normalized payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    await user.type(screen.getByLabelText(/Shares \*/i), '100')
    // Entry Price — use the second number input (first was Shares)
    const numberInputs = screen.getAllByRole('spinbutton')
    // 0=Shares, 1=Entry Price, 2=Stop Price
    await user.type(numberInputs[1], '500')
    // Stop Price (optional) left blank

    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.symbol).toBe('NVDA')
    expect(payload.side).toBe('Long')
    expect(payload.shares).toBe(100)
    expect(payload.entryPrice).toBe(500)
    expect(payload.stopPrice).toBeNull()
    // No verdict run → empty attachment.
    expect(payload.contextAtEntry).toEqual({})
  })

  it('attaches the Compass verdict to the submitted payload when one has run', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    usePreTradeVerdict.mockReturnValue({
      ...NO_VERDICT,
      verdict: { verdict_id: 'v-9', label: 'GO', paragraph: 'Clean.', factors: [] },
    })
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const numberInputs = screen.getAllByRole('spinbutton')
    await user.type(numberInputs[0], '100')  // shares
    await user.type(numberInputs[1], '500')  // entry

    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.contextAtEntry).toEqual({
      compass_verdict_id: 'v-9',
      compass_verdict_label: 'GO',
    })
  })

  it('rejects Long stop above entry', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')      // shares
    await user.type(inputs[1], '100')      // entry
    await user.type(inputs[2], '105')      // stop — invalid for Long

    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/below entry/)
  })

  it('prefills stop for fixed_percent_distance on blur', async () => {
    const user = userEvent.setup()
    const settings = {
      ...BASE_SETTINGS,
      defaultStop: { mode: 'fixed_percent_distance', percent: 5 },
    }
    render(<AddPositionModal settings={settings} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
    await user.tab()  // blur entry price → prefill fires

    // Stop field should now show 475 (500 * 0.95)
    expect(inputs[2]).toHaveValue(475)
  })

  it('prefills stop for fixed_dollar_risk on blur', async () => {
    const user = userEvent.setup()
    const settings = {
      ...BASE_SETTINGS,
      defaultStop: { mode: 'fixed_dollar_risk', amount: 500 },
    }
    render(<AddPositionModal settings={settings} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
    await user.tab()

    // Stop = 500 - (500 / 100) = 495
    expect(inputs[2]).toHaveValue(495)
  })

  it('does not overwrite a user-typed stop', async () => {
    const user = userEvent.setup()
    const settings = {
      ...BASE_SETTINGS,
      defaultStop: { mode: 'fixed_percent_distance', percent: 5 },
    }
    render(<AddPositionModal settings={settings} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[2], '480')  // user types stop first
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
    await user.tab()

    // Stop should remain 480 (user-edited), not overwritten to 475
    expect(inputs[2]).toHaveValue(480)
  })

  it('Esc calls onClose', () => {
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

// Wave 3 (Thesis-Trade Link) — the pre-trade thesis flow: CREATE/SELECT
// THESIS NOTE -> CREATE THE POSITION -> obtain its real id -> attach the
// typed reference. No fake tradeRef is ever written before the position's
// real id exists (onSave's resolved value is the only source of that id).
describe('AddPositionModal — pre-trade thesis flow (Wave 3)', () => {
  beforeEach(() => {
    usePreTradeVerdict.mockReturnValue(NO_VERDICT)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function fillRequiredFields(user) {
    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
  }

  it('creates a new thesis note, then links it to the position using its real persisted id', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({ id: 'pos-1', symbol: 'NVDA' })
    const onClose = vi.fn()
    const fetchMock = vi.fn(async (url, opts) => {
      if (url === '/api/j2/notes' && opts?.method === 'POST') {
        return { ok: true, json: async () => ({ note: { id: 'note-1', title: 'My thesis' } }) }
      }
      if (url === '/api/j2/notes/note-1/embeds' && opts?.method === 'POST') {
        return { ok: true, json: async () => ({ note: {} }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} />)
    await fillRequiredFields(user)

    await user.type(screen.getByPlaceholderText('Search your notes, or type a new title…'), 'My thesis')
    await user.click(await screen.findByText('+ Create new note: "My thesis"'))
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(onSave).toHaveBeenCalledTimes(1)

    const noteCall = fetchMock.mock.calls.find(([u]) => u === '/api/j2/notes')
    expect(JSON.parse(noteCall[1].body)).toEqual({ title: 'My thesis', tags: ['thesis'] })

    const embedCall = fetchMock.mock.calls.find(([u]) => u === '/api/j2/notes/note-1/embeds')
    expect(embedCall).toBeTruthy()
    const embedAttrs = JSON.parse(embedCall[1].body).attrs
    expect(embedAttrs.tradeRef).toBe('pos-1')
    expect(embedAttrs.tradeRefType).toBe('position')
    expect(embedAttrs.widgetId).toBe('chart')
    expect(embedAttrs.params.symbol).toBe('NVDA')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('links an EXISTING selected note without creating a new one', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({ id: 'pos-2', symbol: 'NVDA' })
    const onClose = vi.fn()
    const fetchMock = vi.fn(async (url, opts) => {
      if (url.startsWith('/api/j2/notes?')) {
        return { ok: true, json: async () => ({ notes: [{ id: 'note-9', title: 'Existing research' }] }) }
      }
      if (url === '/api/j2/notes/note-9/embeds' && opts?.method === 'POST') {
        return { ok: true, json: async () => ({ note: {} }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} />)
    await fillRequiredFields(user)

    await user.type(screen.getByPlaceholderText('Search your notes, or type a new title…'), 'Existing')
    await user.click(await screen.findByText('Existing research'))
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(onSave).toHaveBeenCalledTimes(1)
    // No note CREATE — only the search GET and the embed POST touch /api/j2/notes*.
    expect(fetchMock.mock.calls.some(([u, o]) => u === '/api/j2/notes' && o?.method === 'POST')).toBe(false)
    const embedCall = fetchMock.mock.calls.find(([u]) => u === '/api/j2/notes/note-9/embeds')
    expect(embedCall).toBeTruthy()
  })

  it('a link failure preserves the saved position and offers Retry without re-submitting it', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({ id: 'pos-3', symbol: 'NVDA' })
    const onClose = vi.fn()
    let embedAttempts = 0
    const fetchMock = vi.fn(async (url, opts) => {
      if (url === '/api/j2/notes' && opts?.method === 'POST') {
        return { ok: true, json: async () => ({ note: { id: 'note-3', title: 'Flaky note' } }) }
      }
      if (url === '/api/j2/notes/note-3/embeds' && opts?.method === 'POST') {
        embedAttempts += 1
        if (embedAttempts === 1) return { ok: false, status: 500, json: async () => ({}) }
        return { ok: true, json: async () => ({ note: {} }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} />)
    await fillRequiredFields(user)
    await user.type(screen.getByPlaceholderText('Search your notes, or type a new title…'), 'Flaky note')
    await user.click(await screen.findByText('+ Create new note: "Flaky note"'))
    await user.click(screen.getByRole('button', { name: 'Add Position' }))

    // The position save already happened; only the link failed.
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/linking your thesis note failed/)
    expect(screen.getByRole('button', { name: 'Retry linking' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry linking' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    // Retrying links — it must NOT create a second position.
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(embedAttempts).toBe(2)
  })

  it('with no thesis note involved, behaves exactly as before (no /api/j2/notes* calls at all)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({ id: 'pos-4', symbol: 'NVDA' })
    const onClose = vi.fn()
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} />)
    await fillRequiredFields(user)
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(onSave).toHaveBeenCalledTimes(1)
    // Other background hooks (account/regime/interventions) legitimately call
    // fetch on their own — the thesis-flow contract is that NONE of them are
    // /api/j2/notes* when no thesis note was selected.
    expect(fetchMock.mock.calls.some(([u]) => typeof u === 'string' && u.startsWith('/api/j2/notes'))).toBe(false)
  })
})

/**
 * ⛔⛔ THE TRADE MODAL OPENS TWO DOORS ON ONE NOTE.
 *
 * Linking a position to a thesis note POSTs `/embeds` (`append_widget_embed`),
 * and setting the research type PUTs the note (`update_note`). Both advance the
 * note's revision, and this surface is where a member is most likely to be
 * working fast — create the thesis, link the trade, keep typing. Unlanded, the
 * next drain meets two revisions it has never heard of.
 *
 * ⭐ These own "the modal settles each door it opens, for that note". That the
 * settle lands the right revision is owned in
 * `lib/offline/doorFamilies.settle.test.jsx`.
 */
describe('⛔ both of the trade modal\'s note doors land their revision', () => {
  const T2 = '2026-09-12T14:00:00.000000+00:00'

  // ⛔ Its own copy: the harness's helper is scoped to another describe.
  async function fillRequiredFields(user) {
    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
  }

  const linkANewThesis = async (fetchMock) => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({ id: 'pos-1', symbol: 'NVDA' })
    const onClose = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} />)
    await fillRequiredFields(user)
    await user.type(screen.getByPlaceholderText('Search your notes, or type a new title…'), 'My thesis')
    await user.click(await screen.findByText('+ Create new note: "My thesis"'))
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    // ⛔ Wait for THE DOOR, not for the modal closing. A refused link keeps the
    // modal open on purpose (it offers a retry), so waiting on `onClose` would
    // make the control time out for a reason that has nothing to do with the
    // settle — and a rail that fails for the wrong reason still reads as red.
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/embeds'))).toBe(true))
  }

  const okFetch = vi.fn(async (url, opts) => {
    if (url === '/api/j2/notes' && opts?.method === 'POST') {
      return { ok: true, json: async () => ({ note: { id: 'note-1', title: 'My thesis', updatedAt: T2 } }) }
    }
    return { ok: true, json: async () => ({ note: { id: 'note-1', updatedAt: T2 } }) }
  })

  it('BOTH doors are settled — the append AND the properties PUT', async () => {
    // ⛔⛔ THE COUNT IS THE ASSERTION, NOT "was it called".
    // ⚰️ Both doors write the SAME note, so `toHaveBeenCalledWith('note-1')`
    // stays green when one of the two settles is deleted — the gauntlet said so:
    // removing the /embeds settle left this rail passing and only the structural
    // enumeration rail red. Two doors, two settles, counted.
    const spy = vi.spyOn(settleModule, 'settleNoteWrite').mockResolvedValue(T2)
    await linkANewThesis(okFetch)

    await waitFor(() => expect(spy, '⛔ a trade-modal door did not land its revision').toHaveBeenCalledTimes(2))
    expect(new Set(spy.mock.calls.map((c) => c[0]))).toEqual(new Set(['note-1']))
    spy.mockRestore()
  })

  it('⛔ CONTROL — the REFUSED door settles nothing, and the door beside it still does', async () => {
    // ⭐ THE SHARP VERSION. Both doors write the same note, so "was the settle
    // called" cannot tell them apart. Failing ONE and leaving the other healthy
    // pins the count: the properties PUT still lands, the refused append does
    // not. A blanket `not.toHaveBeenCalled()` here was wrong and said so — the
    // PUT had legitimately succeeded.
    const spy = vi.spyOn(settleModule, 'settleNoteWrite').mockResolvedValue(T2)
    const embedRefused = vi.fn(async (url, opts) => {
      if (url === '/api/j2/notes' && opts?.method === 'POST') {
        return { ok: true, json: async () => ({ note: { id: 'note-1', title: 'My thesis', updatedAt: T2 } }) }
      }
      if (String(url).endsWith('/embeds')) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => ({ note: { id: 'note-1', updatedAt: T2 } }) }
    })
    await linkANewThesis(embedRefused)

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy, 'the surviving settle is the properties PUT, not the refused append').toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('⛔ CONTROL — with BOTH note writes refused, nothing settles at all', async () => {
    const spy = vi.spyOn(settleModule, 'settleNoteWrite').mockResolvedValue(T2)
    const allRefused = vi.fn(async (url, opts) => {
      if (url === '/api/j2/notes' && opts?.method === 'POST') {
        return { ok: true, json: async () => ({ note: { id: 'note-1', title: 'My thesis' } }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    await linkANewThesis(allRefused)

    expect(spy, 'a write that did not happen has no revision').not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ── Notebook P2a, Task 8: the pre-entry checklist in Log Trade ──────────────────────────────────
describe('AddPositionModal: the pre-entry checklist (P2a)', () => {
  const PRE_ENTRY = '/api/j2/trader-blocks/positions/NEW1/pre-entry'
  let putReply
  beforeEach(() => {
    usePreTradeVerdict.mockReturnValue(NO_VERDICT)
    p2a.styles = true
    p2a.pref = 'on'
    putReply = { ok: true, status: 200, json: () => Promise.resolve({}) }
    vi.stubGlobal('fetch', vi.fn((url, init) => (init?.method === 'PUT'
      ? Promise.resolve(putReply)
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))))
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const puts = () => globalThis.fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')
  // M-1: the body is a lazy chunk. Load it before any case, so "absent" cannot mean "not loaded yet",
  // and wait for it the way a present one is found: this throws if the checklist ever appears.
  beforeAll(async () => { await import('./LogTradeChecklist') })
  async function checklistNeverAppears(ms = 400) {
    let appeared = false
    try { await screen.findByRole('group', { name: 'Pre-entry checklist' }, { timeout: ms }); appeared = true } catch { /* not there */ }
    if (appeared) throw new Error('the pre-entry checklist appeared')
  }

  async function fillAndPickVcp(user) {
    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'VCP')
  }

  it('P2a: switch on, preference on, preEntryChecklist: the checklist shows, submit stays enabled, and a save writes the ticks under the created id', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    const group = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    await user.click(within(group).getByRole('checkbox', { name: 'Volume dry-up' }))
    const submit = screen.getByRole('button', { name: 'Add Position' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(PRE_ENTRY, expect.objectContaining({ method: 'PUT' })))
    const [, init] = puts().find(([u]) => u === PRE_ENTRY)
    expect(JSON.parse(init.body)).toEqual({ setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 1 })
    expect(onSave).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('P2a: on-warn shows the soft warning; on does not', async () => {
    const user = userEvent.setup()
    p2a.pref = 'on-warn'
    const first = render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} preEntryChecklist />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'VCP')
    const group = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    expect(within(group).getByRole('status').textContent).toBe('1 checklist item not ticked. You can still log this trade.')
    expect(screen.getByRole('button', { name: 'Add Position' })).toBeEnabled()
    first.unmount()

    p2a.pref = 'on'
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} preEntryChecklist />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'VCP')
    const again = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    expect(within(again).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(again).queryByRole('status')).toBeNull()
    expect(screen.queryByText(/You can still log this trade/)).toBeNull()
  })

  it('P2a: no preEntryChecklist prop (another surface): no checklist and no tick write', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} />)
    await fillAndPickVcp(user)
    await checklistNeverAppears()
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(puts()).toEqual([])
  })

  it('P2a: the switch off: no checklist and no tick write', async () => {
    const user = userEvent.setup()
    p2a.styles = false
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await checklistNeverAppears()
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(puts()).toEqual([])
  })

  it('P2a: CONTROL (M-1): the absence waiter sees a checklist that IS there', async () => {
    const user = userEvent.setup()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} preEntryChecklist />)
    await fillAndPickVcp(user)
    await expect(checklistNeverAppears()).rejects.toThrow('the pre-entry checklist appeared')
  })

  it('P2a I-1: ticks on VCP, then Breakout picked and left untouched: nothing is written for Breakout', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn(async () => ({ id: 'NEW1' }))} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await user.click(within(await screen.findByRole('group', { name: 'Pre-entry checklist' })).getByRole('checkbox', { name: 'Volume dry-up' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'Breakout')
    expect((await screen.findByRole('checkbox', { name: 'Pivot break' })).checked).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(puts()).toEqual([])
  })

  it("P2a I-1: ticks on VCP, Breakout, back to VCP: VCP's ticks are written", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn(async () => ({ id: 'NEW1' }))} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await user.click(within(await screen.findByRole('group', { name: 'Pre-entry checklist' })).getByRole('checkbox', { name: 'Volume dry-up' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'Breakout')
    await screen.findByRole('checkbox', { name: 'Pivot break' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Setup' }), 'VCP')
    expect((await screen.findByRole('checkbox', { name: 'Volume dry-up' })).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(puts().map(([u, init]) => [u, JSON.parse(init.body)]))
      .toEqual([[PRE_ENTRY, { setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 1 }]])
  })

  it('P2a retry: no answer offers Try again; it re-sends the same ticks to the same position, and a success closes the dialog', async () => {
    const user = userEvent.setup()
    let failNext = true
    globalThis.fetch.mockImplementation((url, init) => {
      if (init?.method !== 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
      if (failNext) { failNext = false; return Promise.reject(new TypeError('Failed to fetch')) }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
    })
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    await user.click(within(await screen.findByRole('group', { name: 'Pre-entry checklist' })).getByRole('checkbox', { name: 'Volume dry-up' }))
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Your trade is logged, but its pre-entry checklist was not saved. The request did not reach the server.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const sent = puts().map(([u, init]) => [u, JSON.parse(init.body)])
    expect(sent).toEqual([
      [PRE_ENTRY, { setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 1 }],
      [PRE_ENTRY, { setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 1 }],
    ])
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('P2a: a create that failed writes no ticks', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => { throw new Error('500') })
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} preEntryChecklist />)
    await fillAndPickVcp(user)
    const group = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    await user.click(within(group).getByRole('checkbox', { name: 'Volume dry-up' }))
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(await screen.findByText("Couldn't save this position. Nothing was changed — try again.")).toBeTruthy()
    expect(puts()).toEqual([])
  })

  it("P2a: 409 from the pre-entry route: the position stays logged, the server's sentence is shown, and it cannot be logged twice", async () => {
    const user = userEvent.setup()
    const detail = 'This trade is already closed or partly closed. Record its rules on the trade instead.'
    putReply = { ok: false, status: 409, json: () => Promise.resolve({ detail }) }
    const onSave = vi.fn(async () => ({ id: 'NEW1' }))
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={onClose} preEntryChecklist />)
    await fillAndPickVcp(user)
    const group = await screen.findByRole('group', { name: 'Pre-entry checklist' })
    await user.click(within(group).getByRole('checkbox', { name: 'Volume dry-up' }))
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe(`Your trade is logged, but its pre-entry checklist was not saved. ${detail}`)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Add Position' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()   // a 409's sentence stands
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
