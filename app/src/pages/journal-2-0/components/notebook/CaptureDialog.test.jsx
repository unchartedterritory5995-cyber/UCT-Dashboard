import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import CaptureDialog from './CaptureDialog'
import { captureDestination } from '../../lib/capture'

const DEST = captureDestination({ noteId: 'n1', ticker: 'NVDA', source: 'palette' })
const PASSAGE = 'Management expects gross margins to normalize.'

function ok(body = {}) {
  return { ok: true, status: 200,
           json: async () => ({ documentId: 'd1', excerptId: 'e1', deduped: false,
                                captureType: 'web_reference', ...body }) }
}
function fail(status, detail) {
  return { ok: false, status, json: async () => ({ detail }) }
}

function open(props = {}) {
  return render(<CaptureDialog open onClose={() => {}} destination={DEST} {...props} />)
}

/** The dialog now opens on the highest-frequency action -- a member-authored
 *  quick thought (ruling §8/§9). A door that supplies source material opens in
 *  source mode, which is what these web-capture tests exercise. */
function openSource(props = {}) {
  return open({ initial: { url: 'https://x.com/a', ...(props.initial || {}) }, ...props })
}

beforeEach(() => { global.fetch = vi.fn() })
afterEach(() => { vi.restoreAllMocks() })

describe('destination is obvious before saving (§4)', () => {
  it('names where the capture is going, on screen, without hunting', () => {
    open()
    expect(screen.getByTestId('capture-destination')).toHaveTextContent('NVDA Research')
  })

  it('falls back to Notebook rather than showing nothing', () => {
    render(<CaptureDialog open onClose={() => {}} destination={captureDestination({ noteId: 'n1' })} />)
    expect(screen.getByTestId('capture-destination')).toHaveTextContent('Notebook')
  })
})

describe('source material and member thought look different (§2)', () => {
  it('gives them two separate labelled controls', () => {
    openSource()
    expect(screen.getByLabelText('Selected passage')).toBeInTheDocument()
    expect(screen.getByLabelText('Your note')).toBeInTheDocument()
  })

  it('says in words which is which, not by styling alone', () => {
    openSource()
    expect(screen.getByText(/From the source, in its own words/i)).toBeInTheDocument()
    expect(screen.getByText(/Your own thinking — kept separate/i)).toBeInTheDocument()
  })

  it('submits them as two fields, never concatenated', async () => {
    global.fetch.mockResolvedValue(ok())
    openSource()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.change(screen.getByLabelText('Selected passage'), { target: { value: PASSAGE } })
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'Too optimistic.' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.passage).toBe(PASSAGE)
    expect(body.annotation).toBe('Too optimistic.')
    expect(body.passage).not.toContain('Too optimistic')
  })
})

describe('success says WHAT and WHERE (§10)', () => {
  it('names the destination, never a bare "Success"', async () => {
    global.fetch.mockResolvedValue(ok())
    openSource()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    // Kind-specific: a link capture says "link", a passage says "passage" --
    // never a generic word that hides which one happened.
    expect(await screen.findByText('Saved link to NVDA Research')).toBeInTheDocument()
    expect(screen.queryByText(/^success$/i)).toBeNull()
  })

  it('reports a server-resolved duplicate honestly (§9)', async () => {
    global.fetch.mockResolvedValue(ok({ deduped: true }))
    openSource()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    // ⛔ The client does not decide this; it reports the server's answer.
    expect(await screen.findByText('Already saved to NVDA Research')).toBeInTheDocument()
  })
})

describe('a failed save never eats the member input (§8)', () => {
  const scenarios = [
    ['network failure', () => { global.fetch.mockRejectedValue(new Error('offline')) }],
    ['server error', () => { global.fetch.mockResolvedValue(fail(500, '')) }],
    ['stale destination', () => { global.fetch.mockResolvedValue(fail(404, 'gone')) }],
    ['validation refusal', () => { global.fetch.mockResolvedValue(fail(400, 'a captured source needs a URL')) }],
  ]

  it.each(scenarios)('%s leaves passage, note and link recoverable', async (_name, arrange) => {
    arrange()
    openSource()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.change(screen.getByLabelText('Selected passage'), { target: { value: PASSAGE } })
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'my thinking' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    await screen.findByRole('alert')
    // Everything the member typed is still there — retry must not mean retype.
    expect(screen.getByLabelText('Selected passage')).toHaveValue(PASSAGE)
    expect(screen.getByLabelText('Your note')).toHaveValue('my thinking')
    expect(screen.getByLabelText('Source link')).toHaveValue('https://x.com/a')
  })

  it('the dialog does NOT close before durable success', async () => {
    const onClose = vi.fn()
    global.fetch.mockResolvedValue(fail(500, ''))
    render(<CaptureDialog open onClose={onClose} destination={DEST}
                          initial={{ url: 'https://x.com/a' }} />)
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    await screen.findByRole('alert')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('the rights refusal is explained, never silently downgraded (§7)', () => {
  beforeEach(() => {
    global.fetch.mockResolvedValue(fail(422,
      'full-page capture is not permitted: Wave L stores a reference and the passages the member selected.'))
  })

  it('shows a truthful explanation instead of a status code', async () => {
    openSource()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not permitted/i)
    expect(alert).not.toHaveTextContent(/422/)
    expect(alert).not.toHaveTextContent(/Unprocessable/i)
  })

  it('offers the permitted alternative as an explicit CHOICE', async () => {
    openSource()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.change(screen.getByLabelText('Selected passage'), { target: { value: PASSAGE } })
    fireEvent.click(screen.getByTestId('capture-save'))
    const alert = await screen.findByRole('alert')
    const alt = within(alert).getByRole('button', { name: /save the link only/i })
    // ⛔ It did not happen automatically. The member has to choose it.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    global.fetch.mockResolvedValue(ok())
    fireEvent.click(alt)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    const second = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(second.tier).toBe('reference')
    expect(second.passage).toBe('')
  })
})

describe('hostile source strings stay inert (§19)', () => {
  const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)>'

  it('renders hostile title and passage as text, executing nothing', () => {
    openSource({ initial: { title: HOSTILE, passage: HOSTILE, url: 'https://x.com/a' } })
    // Present as literal characters in the field value...
    expect(screen.getByLabelText('Source title')).toHaveValue(HOSTILE)
    // ...and no element was created from it.
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img[onerror]')).toBeNull()
  })

  it('a hostile server refusal message is shown as text, not markup', async () => {
    global.fetch.mockResolvedValue(fail(422, '<img src=x onerror=alert(1)> not permitted'))
    openSource()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(alert.querySelector('img')).toBeNull()
  })
})

describe('accessibility (§15)', () => {
  it('is a labelled modal dialog', () => {
    open()
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(within(dlg).getByRole('heading', { name: 'Capture' })).toBeInTheDocument()
  })

  it('takes initial focus into the first field', async () => {
    open()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Quick thought')))
  })

  it('Escape closes', () => {
    const onClose = vi.fn()
    render(<CaptureDialog open onClose={onClose} destination={DEST} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('announces saving, errors and success to a screen reader', async () => {
    global.fetch.mockResolvedValue(ok())
    openSource()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    // The blocker/saving line is a live region...
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy()
    fireEvent.click(screen.getByTestId('capture-save'))
    // ...and success is a status role, errors an alert role.
    expect(await screen.findByRole('status')).toHaveTextContent('Saved link to NVDA Research')
  })

  it('says what is missing rather than only disabling Save', () => {
    open()
    expect(screen.getByTestId('capture-save')).toBeDisabled()
    expect(screen.getByText(/Needs something to save/i)).toBeInTheDocument()
  })

  it('uses member language, never implementation words (§17)', () => {
    open()
    const text = screen.getByRole('dialog').textContent
    for (const forbidden of ['capture_type', 'coverage', 'source_kind', 'document_page', 'excerpt']) {
      expect(text).not.toContain(forbidden)
    }
  })
})

// ── The member-authored kind (architecture ruling §1C / §6) ─────────────────

describe('quick thought: no URL, no source semantics', () => {
  it('opens on the thought, because that is the highest-frequency action', () => {
    open()
    expect(screen.getByLabelText('Quick thought')).toBeInTheDocument()
    expect(screen.queryByLabelText('Source link')).toBeNull()
    expect(screen.queryByLabelText('Selected passage')).toBeNull()
  })

  it('saves with NO url — the measured blocker is gone', async () => {
    const created = vi.fn().mockResolvedValue({ id: 'n9', title: 'A thought' })
    vi.doMock('../../lib/noteCreation', () => ({ createNoteViaApi: created }))
    open()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: 'Margins look peaky.' } })
    expect(screen.getByTestId('capture-save')).not.toBeDisabled()
  })

  it('a thought never posts to the web capture endpoint', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ note: { id: 'n9' } }) })
    open()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: 'Margins look peaky.' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // ⛔ The member-authored path, not /api/j2/capture.
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes')
  })

  it('says what is missing in thought language, not web language', () => {
    open()
    expect(screen.getByText(/Needs something to save/i)).toBeInTheDocument()
    expect(screen.queryByText(/source URL/i)).toBeNull()
  })
})

describe('the source/thought transition is explicit, never silent (§10)', () => {
  it('a pasted link OFFERS the switch and does not take it', () => {
    open()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: 'https://example.com/a' } })
    // Still a thought until the member says otherwise.
    expect(screen.getByLabelText('Quick thought')).toBeInTheDocument()
    expect(screen.getByText(/looks like a link/i)).toBeInTheDocument()
  })

  it('taking the offer moves the link into the source field', () => {
    open()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: 'https://example.com/a' } })
    fireEvent.click(screen.getByRole('button', { name: /save it as a source instead/i }))
    expect(screen.getByLabelText('Source link')).toHaveValue('https://example.com/a')
    expect(screen.queryByLabelText('Quick thought')).toBeNull()
  })

  it('member prose is NEVER carried into the source passage field', () => {
    open()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: 'I think margins peak here' } })
    fireEvent.click(screen.getByRole('button', { name: /capture a source/i }))
    // The switch happened, but the member's words did not become a quotation.
    expect(screen.getByLabelText('Selected passage')).toHaveValue('')
  })

  it('can switch back to a thought', () => {
    openSource()
    fireEvent.click(screen.getByRole('button', { name: /write a note instead/i }))
    expect(screen.getByLabelText('Quick thought')).toBeInTheDocument()
  })
})

describe('the global destination picker (§5)', () => {
  const NO_CONTEXT = captureDestination({})
  const RECENTS = [{ id: 'r1', title: 'Earnings Notes' }, { id: 'r2', title: 'Weekly review' }]

  it('asks for a destination when context genuinely does not know one', () => {
    render(<CaptureDialog open onClose={() => {}} destination={NO_CONTEXT} recentDestinations={RECENTS} />)
    expect(screen.getByTestId('capture-destination-picker')).toBeInTheDocument()
  })

  it('picking one unblocks the save — the measured blocker is gone', () => {
    render(<CaptureDialog open onClose={() => {}} destination={NO_CONTEXT} recentDestinations={RECENTS} />)
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: 'a thought' } })
    expect(screen.getByTestId('capture-save')).toBeDisabled()
    fireEvent.change(screen.getByTestId('capture-destination-picker'), { target: { value: 'r1' } })
    expect(screen.getByTestId('capture-save')).not.toBeDisabled()
    expect(screen.getByTestId('capture-destination')).toHaveTextContent('Earnings Notes')
  })

  it('a strong context is prefilled and NOT re-asked', () => {
    open({ recentDestinations: RECENTS })
    expect(screen.queryByTestId('capture-destination-picker')).toBeNull()
    expect(screen.getByTestId('capture-destination')).toHaveTextContent('NVDA Research')
  })

  it('...but stays changeable', () => {
    open({ recentDestinations: RECENTS })
    fireEvent.click(screen.getByRole('button', { name: /change/i }))
    expect(screen.getByTestId('capture-destination-picker')).toBeInTheDocument()
  })
})
