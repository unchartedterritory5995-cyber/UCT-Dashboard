import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { EditorContent, useEditor } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'

const refresh = vi.fn()
let hookExcerpts = []
vi.mock('../../hooks/useNoteExcerpts', () => ({
  default: () => ({ excerpts: hookExcerpts, isLoading: false, refresh }),
}))

import TweetCard from './TweetCard'
import { DocumentExcerpt } from '../../lib/documentExcerptNode'
import { priceLineParts, setPendingFocus, consumePendingFocus } from '../../lib/tweetImportHelpers'

// Fri Nov 6 2026, 3:47 PM in New York (EST, so 20:47 UTC).
const POSTED_AT = Date.UTC(2026, 10, 6, 20, 47) / 1000

const PRICE = { symbol: 'NVDA', price: 188.2, label: 'posted', sessionDate: '2026-11-06' }

function tweetExcerpt(over = {}, tweetOver = {}) {
  return {
    id: 'ex1',
    capturedText: 'My $NVDA thesis in one line, and $SMH sets up the same way.',
    annotation: null,
    ...over,
    tweet: {
      tweetId: '991',
      name: 'Alder Street Desk',
      handle: 'alderstreetdesk',
      avatarUrl: 'https://cdn.example.test/alder.png',
      url: 'https://x.com/alderstreetdesk/status/991',
      postedAt: POSTED_AT,
      media: ['/api/j2/notes/media/chart-a.png'],
      price: PRICE,
      removed: false,
      ...tweetOver,
    },
  }
}

let snapshot
let patchResponse
let requests

beforeEach(() => {
  refresh.mockClear()
  hookExcerpts = []
  snapshot = { close: 191.1, ext_price: null }
  patchResponse = () => new Response(JSON.stringify({ excerpt: {} }), { status: 200 })
  requests = []
  setPendingFocus(null)
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || 'GET', body: init.body, keepalive: init.keepalive })
    if (String(url).startsWith('/api/snapshot/')) {
      return new Response(JSON.stringify(snapshot), { status: 200 })
    }
    return patchResponse()
  }))
})

afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) // the snapshot's answer
  vi.unstubAllGlobals()
})

const snapshotCalls = () => requests.filter((r) => r.url.startsWith('/api/snapshot/'))
const patches = () => requests.filter((r) => r.method === 'PATCH')

function renderCard(excerpt = tweetExcerpt(), deleteNode = vi.fn()) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <TweetCard excerpt={excerpt} deleteNode={deleteNode} noteId="n1" />
    </SWRConfig>,
  )
}

const take = () => screen.getByLabelText('My take')

describe('TweetCard', () => {
  it('shows author, handle, text, time and View on X', async () => {
    const { container } = renderCard()
    expect(screen.getByText('Alder Street Desk')).toBeTruthy()
    expect(screen.getByText('@alderstreetdesk')).toBeTruthy()
    expect(container.textContent).toContain('My $NVDA thesis in one line')
    expect(container.textContent.replace(/ /g, ' ')).toContain('Fri Nov 6, 3:47 PM')
    const link = screen.getByRole('link', { name: 'View on X' })
    expect(link.getAttribute('href')).toBe('https://x.com/alderstreetdesk/status/991')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    await screen.findByText(/Now/)
  })

  it('price line for each label', async () => {
    expect(priceLineParts({ ...PRICE, label: 'posted' }, null).thenText).toBe('$NVDA when posted $188.20')
    expect(priceLineParts({ ...PRICE, label: 'premarket' }, null).thenText).toBe('$NVDA premarket $188.20')
    expect(priceLineParts({ ...PRICE, label: 'after_hours' }, null).thenText).toBe('$NVDA after hours $188.20')
    expect(priceLineParts({ ...PRICE, label: 'close', sessionDate: '2026-10-14' }, null).thenText)
      .toBe('$NVDA close on Oct 14 $188.20')

    renderCard(tweetExcerpt({}, { price: { ...PRICE, label: 'close', sessionDate: '2026-10-14' } }))
    await screen.findByText(/Now/)
    expect(document.body.textContent).toContain('$NVDA close on Oct 14 $188.20')
    expect(document.body.textContent).toContain('Now $191.10')
    expect(document.body.textContent).toContain('+1.5% since')
  })

  it('a price above 1000 keeps two decimals and no separator, both then and now', () => {
    const parts = priceLineParts({ ...PRICE, price: 1234.5 }, 1250)
    expect(parts.thenText).toBe('$NVDA when posted $1234.50')
    expect(parts.nowText).toBe('Now $1250.00')
  })

  it('no price line when price is null', async () => {
    renderCard(tweetExcerpt({}, { price: null }))
    expect(screen.queryByText(/when posted/)).toBeNull()
    expect(screen.queryByText(/Now/)).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(snapshotCalls()).toHaveLength(0)
    expect(priceLineParts(null, 190)).toBeNull()
  })

  it('then-only when Now is missing', async () => {
    snapshot = { close: 0, ext_price: null }
    renderCard()
    await waitFor(() => expect(snapshotCalls()).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(document.body.textContent).toContain('$NVDA when posted $188.20')
    expect(screen.queryByText(/Now/)).toBeNull()
    expect(screen.queryByText(/since/)).toBeNull()
    expect(priceLineParts(PRICE, undefined)).toEqual({
      thenText: '$NVDA when posted $188.20', nowText: null, pctText: null, tone: null,
    })
  })

  it('Now is ext_price when present, else close', async () => {
    snapshot = { close: 191.1, ext_price: 200 }
    renderCard()
    await screen.findByText(/Now/)
    expect(document.body.textContent).toContain('Now $200.00')
  })

  it('up and down tone', async () => {
    expect(priceLineParts(PRICE, 191.1).tone).toBe('up')
    expect(priceLineParts(PRICE, 191.1).pctText).toBe('+1.5% since')
    expect(priceLineParts(PRICE, 180).tone).toBe('down')
    expect(priceLineParts(PRICE, 180).pctText).toBe('-4.4% since')
    expect(priceLineParts(PRICE, 188.2).tone).toBe('up')

    snapshot = { close: 180, ext_price: null }
    renderCard()
    const pct = await screen.findByText('-4.4% since')
    expect(pct.getAttribute('data-tone')).toBe('down')
  })

  it('removed post hides words and images, keeps take', async () => {
    const { container } = renderCard(
      tweetExcerpt({ capturedText: '', annotation: 'Sold the rip.' }, { removed: true }),
    )
    expect(screen.getByText('This post is no longer on X.')).toBeTruthy()
    expect(container.querySelectorAll('img[src*="chart-a"]')).toHaveLength(0)
    expect(take().value).toBe('Sold the rip.')
    expect(screen.getByText('Alder Street Desk')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View on X' })).toBeTruthy()
    expect(document.body.textContent).toContain('$NVDA when posted $188.20')
  })

  it('a removed post keeps the whole price line', async () => {
    renderCard(tweetExcerpt({ capturedText: '' }, { removed: true }))
    await screen.findByText(/Now/)
    expect(document.body.textContent).toContain('$NVDA when posted $188.20')
    expect(document.body.textContent).toContain('Now $191.10')
    expect(document.body.textContent).toContain('+1.5% since')
    expect(snapshotCalls()).toHaveLength(1)
  })

  it('a removed post with no price fetches nothing', async () => {
    renderCard(tweetExcerpt({ capturedText: '' }, { removed: true, price: null }))
    expect(screen.queryByText(/when posted/)).toBeNull()
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(snapshotCalls()).toHaveLength(0)
  })

  it('renders the stored images when the post is live', () => {
    const { container } = renderCard()
    expect(container.querySelector('img[src="/api/j2/notes/media/chart-a.png"]')).toBeTruthy()
  })

  it('highlights cashtags and treats the post as plain text', () => {
    const { container } = renderCard(tweetExcerpt({ capturedText: '$NVDA <img src=x onerror=alert(1)> costs $5' }))
    const gold = [...container.querySelectorAll('[data-cashtag]')].map((n) => n.textContent)
    expect(gold).toEqual(['$NVDA'])
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('only an X link is offered as View on X', () => {
    renderCard(tweetExcerpt({}, { url: 'javascript:alert(1)' }))
    expect(screen.queryByRole('link', { name: 'View on X' })).toBeNull()
  })

  it('My take saves on blur', async () => {
    renderCard()
    fireEvent.change(take(), { target: { value: 'Holding the 21 EMA.' } })
    expect(patches()).toHaveLength(0)
    fireEvent.blur(take())
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].url).toBe('/api/j2/excerpts/ex1')
    expect(JSON.parse(patches()[0].body)).toEqual({ annotation: 'Holding the 21 EMA.' })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('does not save on blur when nothing changed', async () => {
    renderCard(tweetExcerpt({ annotation: 'Already said.' }))
    fireEvent.blur(take())
    fireEvent.change(take(), { target: { value: 'Already said.' } })
    fireEvent.blur(take())
    await act(async () => { await Promise.resolve() })
    expect(patches()).toHaveLength(0)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('a failed save keeps the words, says so, and the next blur tries again', async () => {
    patchResponse = () => new Response(JSON.stringify({ detail: 'nope' }), { status: 500 })
    renderCard()
    fireEvent.change(take(), { target: { value: 'Do not lose this.' } })
    fireEvent.blur(take())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/couldn.t save/i)
    expect(take().value).toBe('Do not lose this.')
    expect(refresh).not.toHaveBeenCalled()

    patchResponse = () => new Response(JSON.stringify({ excerpt: {} }), { status: 200 })
    fireEvent.blur(take())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(patches()).toHaveLength(2)
    expect(take().value).toBe('Do not lose this.')
  })

  it('a refresh with other words does not overwrite what the member is typing', () => {
    const { rerender } = renderCard()
    fireEvent.change(take(), { target: { value: 'Half a thought' } })
    rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <TweetCard excerpt={tweetExcerpt({ annotation: 'From another tab' })} deleteNode={vi.fn()} noteId="n1" />
      </SWRConfig>,
    )
    expect(take().value).toBe('Half a thought')
  })

  it('a refresh updates a take the member is not editing', () => {
    const { rerender } = renderCard()
    rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <TweetCard excerpt={tweetExcerpt({ annotation: 'From another tab' })} deleteNode={vi.fn()} noteId="n1" />
      </SWRConfig>,
    )
    expect(take().value).toBe('From another tab')
  })

  it('an unsaved take is saved when the card unmounts', async () => {
    const { unmount } = renderCard()
    fireEvent.change(take(), { target: { value: 'Typed, then left the note.' } })
    unmount()
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(JSON.parse(patches()[0].body)).toEqual({ annotation: 'Typed, then left the note.' })
  })

  it('pending focus lands in My take', () => {
    setPendingFocus('ex1')
    renderCard()
    expect(document.activeElement).toBe(take())
    expect(consumePendingFocus('ex1')).toBe(false)
  })

  it('a card that was not named does not take the cursor', () => {
    setPendingFocus('some-other-excerpt')
    renderCard()
    expect(document.activeElement).not.toBe(take())
    expect(consumePendingFocus('some-other-excerpt')).toBe(true)
  })

  it('avatar falls back to initials on error', () => {
    const { container } = renderCard()
    const img = container.querySelector('img[src="https://cdn.example.test/alder.png"]')
    expect(img).toBeTruthy()
    fireEvent.error(img)
    expect(container.querySelector('img[src="https://cdn.example.test/alder.png"]')).toBeNull()
    expect(screen.getByText('AS')).toBeTruthy()
  })

  it('the card is contentEditable false and the take is its own field', () => {
    const { container } = renderCard()
    expect(container.querySelector('[contenteditable="false"]')).toBeTruthy()
    expect(take().tagName).toBe('TEXTAREA')
  })

  it('remove takes the card out of the note', () => {
    const deleteNode = vi.fn()
    renderCard(tweetExcerpt(), deleteNode)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from note' }))
    expect(deleteNode).toHaveBeenCalledTimes(1)
  })

  it('two cards on one ticker share one snapshot request', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <TweetCard excerpt={tweetExcerpt({ id: 'ex1' })} deleteNode={vi.fn()} noteId="n1" />
        <TweetCard excerpt={tweetExcerpt({ id: 'ex2' })} deleteNode={vi.fn()} noteId="n1" />
      </SWRConfig>,
    )
    await waitFor(() => expect(screen.getAllByText(/Now/)).toHaveLength(2))
    expect(snapshotCalls()).toHaveLength(1)
    expect(snapshotCalls()[0].url).toBe('/api/snapshot/NVDA')
  })

  it('closing the tab with an unsaved take sends it with keepalive', () => {
    renderCard()
    fireEvent.change(take(), { target: { value: 'Typed, then the tab closed' } })
    fireEvent(window, new Event('pagehide'))
    const sent = requests.filter((r) => r.method === 'PATCH')
    expect(sent).toHaveLength(1)
    expect(sent[0].keepalive).toBe(true)
  })

  it('closing the tab with nothing typed sends nothing', () => {
    renderCard()
    fireEvent(window, new Event('pagehide'))
    expect(patches()).toHaveLength(0)
  })
})

describe('TweetCard inside a real editor', () => {
  let editor
  function Harness() {
    editor = useEditor({
      extensions: [Document, Paragraph, Text, DocumentExcerpt],
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Before the card' }] },
          { type: 'documentExcerpt', attrs: { excerptId: 'ex1' } },
        ],
      },
      onBeforeCreate: ({ editor: ed }) => {
        ed.storage.uctJournalWidgets = { noteId: 'n1' }
      },
    })
    return <EditorContent editor={editor} />
  }

  it('typing in My take moves neither the selection nor the document', async () => {
    hookExcerpts = [tweetExcerpt()]
    render(<SWRConfig value={{ provider: () => new Map() }}><Harness /></SWRConfig>)
    const field = await screen.findByLabelText('My take')

    act(() => { editor.commands.setTextSelection(4) })
    const selection = editor.state.selection.from
    const doc = editor.getJSON()

    field.focus()
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: 'Typed in the card' } })
    expect(editor.state.selection.from).toBe(selection)
    expect(editor.getJSON()).toEqual(doc)

    // CONTROL: the same key delivered to the editor itself does change the document.
    // (ProseMirror scrolls to the new selection, and jsdom has no layout to measure.)
    const rects = { getClientRects: () => [], getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) }
    const original = {
      getClientRects: Range.prototype.getClientRects,
      getBoundingClientRect: Range.prototype.getBoundingClientRect,
    }
    Object.assign(Range.prototype, rects)
    try {
      act(() => { fireEvent.keyDown(editor.view.dom, { key: 'Enter' }) })
    } finally {
      Object.assign(Range.prototype, original)
    }
    expect(editor.getJSON()).not.toEqual(doc)
  })

  const docFor = (excerptId) => ({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before the card' }] },
      { type: 'documentExcerpt', attrs: { excerptId } },
    ],
  })

  it('after a body swap to another excerpt, a blur saves to the new excerpt', async () => {
    hookExcerpts = [tweetExcerpt({ id: 'ex1' }), tweetExcerpt({ id: 'ex2', annotation: 'Second card.' })]
    render(<SWRConfig value={{ provider: () => new Map() }}><Harness /></SWRConfig>)
    await screen.findByLabelText('My take')

    act(() => { editor.commands.setContent(docFor('ex2')) })
    await waitFor(() => expect(take().value).toBe('Second card.'))

    fireEvent.change(take(), { target: { value: 'Landed on the second card.' } })
    fireEvent.blur(take())
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].url).toBe('/api/j2/excerpts/ex2')
    expect(JSON.parse(patches()[0].body)).toEqual({ annotation: 'Landed on the second card.' })
  })

  it('words not yet saved when the excerpt changes stay with the excerpt they were typed on', async () => {
    hookExcerpts = [tweetExcerpt({ id: 'ex1' }), tweetExcerpt({ id: 'ex2' })]
    render(<SWRConfig value={{ provider: () => new Map() }}><Harness /></SWRConfig>)
    fireEvent.change(await screen.findByLabelText('My take'), { target: { value: 'Typed on the first card.' } })

    act(() => { editor.commands.setContent(docFor('ex2')) })
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].url).toBe('/api/j2/excerpts/ex1')
    expect(JSON.parse(patches()[0].body)).toEqual({ annotation: 'Typed on the first card.' })
    await waitFor(() => expect(take().value).toBe(''))
  })
})
