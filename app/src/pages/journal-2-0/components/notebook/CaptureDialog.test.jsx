import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import CaptureDialog from './CaptureDialog'
import { captureDestination } from '../../lib/capture'

const DEST = captureDestination({ noteId: 'n1', ticker: 'NVDA', source: 'palette' })
const PASSAGE = 'Management expects gross margins to normalize.'

function ok(body = {}) {
  return { ok: true, status: 200, json: async () => ({ documentId: 'd1', excerptId: 'e1', deduped: false, ...body }) }
}
function fail(status, detail) {
  return { ok: false, status, json: async () => ({ detail }) }
}

function open(props = {}) {
  return render(<CaptureDialog open onClose={() => {}} destination={DEST} {...props} />)
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
    open()
    expect(screen.getByLabelText('Selected passage')).toBeInTheDocument()
    expect(screen.getByLabelText('Your note')).toBeInTheDocument()
  })

  it('says in words which is which, not by styling alone', () => {
    open()
    expect(screen.getByText(/From the source, in its own words/i)).toBeInTheDocument()
    expect(screen.getByText(/Your own thinking — kept separate/i)).toBeInTheDocument()
  })

  it('submits them as two fields, never concatenated', async () => {
    global.fetch.mockResolvedValue(ok())
    open()
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
    open()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    expect(await screen.findByText('Saved to NVDA Research')).toBeInTheDocument()
    expect(screen.queryByText(/^success$/i)).toBeNull()
  })

  it('reports a server-resolved duplicate honestly (§9)', async () => {
    global.fetch.mockResolvedValue(ok({ deduped: true }))
    open()
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
    open()
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
    render(<CaptureDialog open onClose={onClose} destination={DEST} />)
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
    open()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not permitted/i)
    expect(alert).not.toHaveTextContent(/422/)
    expect(alert).not.toHaveTextContent(/Unprocessable/i)
  })

  it('offers the permitted alternative as an explicit CHOICE', async () => {
    open()
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
    open({ initial: { title: HOSTILE, passage: HOSTILE, url: 'https://x.com/a' } })
    // Present as literal characters in the field value...
    expect(screen.getByLabelText('Source title')).toHaveValue(HOSTILE)
    // ...and no element was created from it.
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img[onerror]')).toBeNull()
  })

  it('a hostile server refusal message is shown as text, not markup', async () => {
    global.fetch.mockResolvedValue(fail(422, '<img src=x onerror=alert(1)> not permitted'))
    open()
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
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Source link')))
  })

  it('Escape closes', () => {
    const onClose = vi.fn()
    render(<CaptureDialog open onClose={onClose} destination={DEST} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('announces saving, errors and success to a screen reader', async () => {
    global.fetch.mockResolvedValue(ok())
    open()
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://x.com/a' } })
    // The blocker/saving line is a live region...
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy()
    fireEvent.click(screen.getByTestId('capture-save'))
    // ...and success is a status role, errors an alert role.
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to NVDA Research')
  })

  it('says what is missing rather than only disabling Save', () => {
    open()
    expect(screen.getByTestId('capture-save')).toBeDisabled()
    expect(screen.getByText(/Needs a source URL/i)).toBeInTheDocument()
  })

  it('uses member language, never implementation words (§17)', () => {
    open()
    const text = screen.getByRole('dialog').textContent
    for (const forbidden of ['capture_type', 'coverage', 'source_kind', 'document_page', 'excerpt']) {
      expect(text).not.toContain(forbidden)
    }
  })
})
