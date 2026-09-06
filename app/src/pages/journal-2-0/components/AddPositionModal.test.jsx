import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddPositionModal from './AddPositionModal'
import usePreTradeVerdict from '../hooks/usePreTradeVerdict'

// Control the verdict directly so the attachment branches are testable without
// wiring a live account + fetch.
vi.mock('../hooks/usePreTradeVerdict', () => ({
  default: vi.fn(),
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
