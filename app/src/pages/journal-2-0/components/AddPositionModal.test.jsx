import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddPositionModal from './AddPositionModal'
import usePreTradeVerdict from '../hooks/usePreTradeVerdict'
import * as settleModule from '../lib/offline/settleNoteWrite'

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
