import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import AskPanel from './AskPanel'
import { MQ } from '../../../../styles/breakpoints'

// ⛔ A CITATION THAT CANNOT BE OPENED IS SAID INSIDE THE PANEL.
//
// On touch the panel is an aria-modal Sheet over a scrim, and it stays open
// when a citation is tapped. A host that reported "that passage is gone" in its
// own page chrome reported it BEHIND the scrim: the member tapped and nothing
// changed, and a screen reader never heard it. So `onNavigate` returns the
// sentence and the panel shows it, in a live region inside the dialog.

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

const A = {
  n: 1, type: 'document_excerpt', label: 'Q3 filing.pdf · p.4', citation: 'exact',
  snippet: 'gross margin', navigation: { kind: 'excerpt', excerpt_id: 'ex1' },
  location: {}, payload: {}, stance: null, truncated: false,
}
const B = { ...A, n: 2, label: 'Q2 filing.pdf · p.9', navigation: { kind: 'excerpt', excerpt_id: 'ex2' } }

function stream(answer = 'Margins fell [1] and [2].') {
  return {
    ok: true, status: 200, json: async () => ({}),
    body: sse([
      { type: 'sources', scope: 'security', scopeLabel: 'NVDA research', sources: [A, B], coverageNotice: null },
      { type: 'final', answer },
    ]),
  }
}

async function renderAndAsk(onNavigate) {
  global.fetch = vi.fn(async () => stream())
  render(<AskPanel scope="security" target="NVDA" autoOpen onNavigate={onNavigate} />)
  const dialog = await screen.findByRole('dialog', { name: /Ask/ })
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
  await within(dialog).findByRole('button', { name: `Source 1: ${A.label}` })
  return dialog
}

const tap = (dialog, src) =>
  fireEvent.click(within(dialog).getByRole('button', { name: `Source ${src.n}: ${src.label}` }))

const notice = (dialog) => within(dialog).getByTestId('ask-nav-notice')

const realMatchMedia = window.matchMedia
afterEach(() => { window.matchMedia = realMatchMedia; vi.restoreAllMocks() })

describe('AskPanel — what a tapped citation could not open', () => {
  it('shows the sentence the host returned, inside the panel, in a status region', async () => {
    const dialog = await renderAndAsk(async () => 'That passage is no longer available.')
    tap(dialog, A)
    expect(await within(dialog).findByText('That passage is no longer available.')).toBeInTheDocument()
    expect(notice(dialog)).toHaveAttribute('role', 'status')
    expect(notice(dialog)).toHaveTextContent('That passage is no longer available.')
  })

  it('accepts `{ message }` as well as a bare string', async () => {
    const dialog = await renderAndAsk(() => ({ message: "That source can't be opened from here." }))
    tap(dialog, A)
    expect(await within(dialog).findByText("That source can't be opened from here.")).toBeInTheDocument()
  })

  it('says nothing when the host opened the source', async () => {
    const dialog = await renderAndAsk(async () => null)
    tap(dialog, A)
    await act(async () => {})
    expect(notice(dialog)).toBeEmptyDOMElement()
  })

  it('a host that THROWS is not a silent click either', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dialog = await renderAndAsk(async () => { throw new Error('boom') })
    tap(dialog, A)
    expect(await within(dialog).findByText("Couldn't open that source — try again.")).toBeInTheDocument()
    expect(err).toHaveBeenCalled()
  })

  it('the next tap clears the notice', async () => {
    const replies = ['That passage is no longer available.', null]
    const dialog = await renderAndAsk(async () => replies.shift())
    tap(dialog, A)
    await within(dialog).findByText('That passage is no longer available.')
    tap(dialog, B)
    await act(async () => {})
    expect(notice(dialog)).toBeEmptyDOMElement()
  })

  it('a new question clears the notice', async () => {
    const dialog = await renderAndAsk(async () => 'That passage is no longer available.')
    tap(dialog, A)
    await within(dialog).findByText('That passage is no longer available.')
    global.fetch = vi.fn(async () => stream())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    expect(notice(dialog)).toBeEmptyDOMElement()
  })

  it('an EARLIER tap answering late never overwrites the later one', async () => {
    let releaseA
    const dialog = await renderAndAsk((src) => (src.n === 1
      ? new Promise((r) => { releaseA = () => r('That passage is no longer available.') })
      : "That source can't be opened from here."))
    tap(dialog, A)
    tap(dialog, B)
    await within(dialog).findByText("That source can't be opened from here.")
    await act(async () => { releaseA() })
    expect(notice(dialog)).toHaveTextContent("That source can't be opened from here.")
    expect(within(dialog).queryByText('That passage is no longer available.')).toBeNull()
  })

  it('each tap hands onNavigate a signal, and the NEXT tap aborts the previous one', async () => {
    const signals = []
    const dialog = await renderAndAsk((_src, _resolved, ctx) => { signals.push(ctx.signal); return null })
    tap(dialog, A)
    tap(dialog, B)
    await act(async () => {})
    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it('a new question aborts a tap still in flight', async () => {
    const signals = []
    const dialog = await renderAndAsk((_src, _resolved, ctx) => { signals.push(ctx.signal); return new Promise(() => {}) })
    tap(dialog, A)
    global.fetch = vi.fn(async () => stream())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    expect(signals[0].aborted).toBe(true)
  })

  it('on TOUCH the notice is inside the modal Sheet, not behind it', async () => {
    window.matchMedia = (query) => ({
      matches: query === MQ.touchDown, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false },
    })
    const dialog = await renderAndAsk(async () => 'That passage is no longer available.')
    // Non-vacuity: this really is the touch branch -- the Sheet, aria-modal.
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    tap(dialog, A)
    const line = await within(dialog).findByText('That passage is no longer available.')
    expect(dialog.contains(line)).toBe(true)
    expect(notice(dialog)).toHaveAttribute('role', 'status')
  })

  it('on DESKTOP the popover is not modal, and the notice is inside it too', async () => {
    const dialog = await renderAndAsk(async () => 'That passage is no longer available.')
    expect(dialog).not.toHaveAttribute('aria-modal')
    tap(dialog, A)
    const line = await within(dialog).findByText('That passage is no longer available.')
    expect(dialog.contains(line)).toBe(true)
  })
})

