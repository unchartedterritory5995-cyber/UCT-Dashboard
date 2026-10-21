// Notebook widgets Task 10: the card a $TICKER chip opens. Loaded on the chip's event, inserted at the
// editor's selection, and a failed load is said in one sentence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../../lib/tiptap'
import { TICKER_CARD_EVENT } from '../../../lib/tickerChip'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import TickerCardPopover from './TickerCardPopover'
import TickerCardSlot from './TickerCardSlot'
// jsdom has no Range layout; ProseMirror's mousedown measures the text under the pointer.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const PAYLOAD = {
  asOf: '2026-10-20T13:14:00Z', source: 'mixed', symbol: 'NVDA', price: 187.4, changePct: 1.8,
  ma10: 181.2, ma50: 172.9, earningsDay: '2026-10-22', impliedMovePct: 7.1,
  history: { trades: 5, winRate: 0.6, netPnl: 1234.5 },
}

let editor
let host
let fetchSpy
beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_widgets_w1_enabled: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  editor = new Editor({ element: host, extensions: buildExtensions(), content: '<p>Watching $NVDA up</p>' })
})
afterEach(() => { editor.destroy(); vi.unstubAllGlobals(); __resetNotebookFlags(); host.remove() })

function stubFetch(impl) {
  fetchSpy = vi.fn(impl)
  vi.stubGlobal('fetch', fetchSpy)
}
const open = (symbol = 'NVDA', pos) => act(() => {
  editor.view.dom.dispatchEvent(new CustomEvent(TICKER_CARD_EVENT, {
    bubbles: true, detail: { symbol, pos, rect: { left: 10, top: 10, bottom: 30, right: 60, width: 50, height: 20 } },
  }))
})
// The document position of the first `$SYM` in the doc, and one inside the word (where a click leaves the caret).
function posOf(sym) {
  let at = null
  editor.state.doc.descendants((n, p) => {
    if (at == null && n.isText && n.text.includes(`$${sym}`)) at = p + n.text.indexOf(`$${sym}`)
  })
  return at
}
const caretInside = (sym) => { editor.commands.setTextSelection(posOf(sym) + 3) } // between $NV and DA
const topTypes = () => editor.getJSON().content.map((n) => n.type)
const embeds = () => (editor.getJSON().content || []).filter((n) => n.type === 'widgetEmbed')

describe('TickerCardPopover', () => {
  it('renders nothing and fetches nothing until a chip asks', () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => PAYLOAD }))
    const { container } = render(<TickerCardPopover editor={editor} />)
    expect(container.textContent).toBe('')
    expect(screen.queryByText('Insert card')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('loads the card for the symbol and Insert card inserts a tickerCard widgetEmbed', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => PAYLOAD }))
    render(<TickerCardPopover editor={editor} />)
    open()
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/tickerCard?symbol=NVDA')
    const history = (await screen.findByText('Your history')).closest('[data-card-row]')
    expect(history).toHaveTextContent('5 trades · 60% wins · +$1,234.50')
    expect(document.body.textContent).toContain('$187.40')
    fireEvent.click(screen.getByText('Insert card'))
    const got = embeds()
    expect(got).toHaveLength(1)
    expect(got[0].attrs.widgetId).toBe('tickerCard')
    expect(got[0].attrs.params.symbol).toBe('NVDA')
    expect(screen.queryByText('Insert card')).toBeNull()
    // The member's own text is still there.
    expect(editor.getText()).toContain('Watching $NVDA up')
  })

  it('Insert chart inserts a daily chart of the symbol with the stamped settings', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => PAYLOAD }))
    editor.storage.uctJournalWidgets = { ...(editor.storage.uctJournalWidgets || {}), chartSettings: { theme: 'x' } }
    render(<TickerCardPopover editor={editor} />)
    open()
    await screen.findByText('Insert chart')
    fireEvent.click(screen.getByText('Insert chart'))
    const got = embeds()
    expect(got).toHaveLength(1)
    expect(got[0].attrs.widgetId).toBe('chart')
    expect(got[0].attrs.params).toMatchObject({ symbol: 'NVDA', tf: 'D', settings: { theme: 'x' } })
  })

  it('a failed load says so with the symbol, and Insert card is not offered', async () => {
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    render(<TickerCardPopover editor={editor} />)
    open()
    await screen.findByText("Couldn't load NVDA right now.")
    expect(screen.getByText('Insert card').closest('button').disabled).toBe(true)
    fireEvent.click(screen.getByText('Insert card'))
    expect(embeds()).toHaveLength(0)
  })

  it('a slow answer for an earlier chip never fills a later one', async () => {
    let release
    stubFetch((url) => (String(url).includes('AMD')
      ? new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ ...PAYLOAD, symbol: 'AMD', price: 1 }) }) })
      : Promise.resolve({ ok: false, status: 500, json: async () => ({}) })))
    render(<TickerCardPopover editor={editor} />)
    open('AMD')
    open('NVDA')
    await screen.findByText("Couldn't load NVDA right now.")
    await act(async () => { release() })
    await waitFor(() => expect(screen.getByText("Couldn't load NVDA right now.")).toBeInTheDocument())
    expect(document.body.textContent).not.toContain('$1.00')
  })

  it('the slot NoteEditorPage mounts loads the card lazily and opens it on a chip press', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => PAYLOAD }))
    render(<TickerCardSlot editor={editor} />)
    await act(async () => { await import('./TickerCardPopover') })
    await waitFor(() => {
      open()
      expect(screen.getByText('Insert chart')).toBeInTheDocument()
    })
  })

  describe('inserting from a chip whose press left the caret inside $NVDA', () => {
    const load = () => stubFetch(async () => ({ ok: true, status: 200, json: async () => PAYLOAD }))

    it('Insert card goes after the paragraph, the sentence intact, the caret after the card', async () => {
      load()
      editor.commands.setContent('<p>Watching $NVDA up 4% today</p><p>next line</p>')
      caretInside('NVDA')
      render(<TickerCardPopover editor={editor} />)
      open('NVDA', posOf('NVDA'))
      await screen.findByText('Your history')
      fireEvent.click(screen.getByText('Insert card'))
      const doc = editor.getJSON().content
      expect(doc.map((n) => n.type)).toEqual(['paragraph', 'widgetEmbed', 'paragraph'])
      expect(editor.state.doc.child(0).textContent).toBe('Watching $NVDA up 4% today')
      expect(doc[1].attrs.widgetId).toBe('tickerCard')
      expect(editor.state.doc.child(2).textContent).toBe('next line')
      // The caret is after the card (in the next line), never on the card itself.
      const sel = editor.state.selection
      expect(sel.empty).toBe(true)
      expect(sel.from).toBeGreaterThan(editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize)
    })

    it('Insert chart goes after the paragraph too, and the paragraph keeps its text', async () => {
      load()
      editor.commands.setContent('<p>Watching $NVDA up 4% today</p>')
      caretInside('NVDA')
      render(<TickerCardPopover editor={editor} />)
      open('NVDA', posOf('NVDA'))
      fireEvent.click(await screen.findByText('Insert chart'))
      const doc = editor.getJSON().content
      expect(doc[0].type).toBe('paragraph')
      expect(editor.state.doc.child(0).textContent).toBe('Watching $NVDA up 4% today')
      expect(doc[1].type).toBe('widgetEmbed')
      expect(doc[1].attrs.widgetId).toBe('chart')
      // The embed was last, so a paragraph is minted for the caret after it.
      expect(doc.length).toBe(3)
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
      expect(editor.state.selection.from).toBeGreaterThan(editor.state.doc.child(0).nodeSize + 1)
    })

    it('a chip in a list item puts the card after the whole list, the item text intact', async () => {
      load()
      editor.commands.setContent('<ul><li><p>Buy $NVDA now</p></li><li><p>second</p></li></ul><p>after</p>')
      caretInside('NVDA')
      render(<TickerCardPopover editor={editor} />)
      open('NVDA', posOf('NVDA'))
      await screen.findByText('Your history')
      fireEvent.click(screen.getByText('Insert card'))
      expect(topTypes()).toEqual(['bulletList', 'widgetEmbed', 'paragraph'])
      expect(editor.state.doc.child(0).textContent).toBe('Buy $NVDA nowsecond')
      expect(editor.state.doc.child(0).childCount).toBe(2)
      expect(editor.state.doc.child(2).textContent).toBe('after')
    })

    it('a REAL chip press carries its position: the card lands after its paragraph', async () => {
      load()
      editor.commands.setContent('<p>first</p><p>Watching $NVDA up</p><p>last</p>')
      render(<TickerCardPopover editor={editor} />)
      const chip = await waitFor(() => {
        const c = editor.view.dom.querySelector('.tickerChip')
        expect(c).toBeTruthy()
        return c
      })
      caretInside('NVDA')
      act(() => { chip.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      await screen.findByText('Your history')
      fireEvent.click(screen.getByText('Insert card'))
      expect(topTypes()).toEqual(['paragraph', 'paragraph', 'widgetEmbed', 'paragraph'])
      expect(editor.state.doc.child(1).textContent).toBe('Watching $NVDA up')
      expect(editor.state.doc.child(3).textContent).toBe('last')
    })
  })
})

// R58 (UX I-14): on a desktop pointer a click places the caret and a ~300 ms hover opens the card; a touch tap opens.
describe('TickerCardPopover: hover intent and the click', () => {
  const realMatchMedia = window.matchMedia
  const desktop = (fine) => {
    window.matchMedia = vi.fn((q) => ({ matches: fine && q === '(hover: hover) and (pointer: fine)', media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  }
  afterEach(() => { window.matchMedia = realMatchMedia; vi.useRealTimers() })
  const chipEl = () => waitFor(() => {
    const c = editor.view.dom.querySelector('.tickerChip')
    expect(c).toBeTruthy()
    return c
  })
  const click = (el, pointerType) => {
    const ev = new MouseEvent('click', { bubbles: true })
    if (pointerType !== undefined) Object.defineProperty(ev, 'pointerType', { value: pointerType })
    act(() => { el.dispatchEvent(ev) })
  }
  const ok = () => stubFetch(async () => ({ ok: true, status: 200, json: async () => PAYLOAD }))

  it('desktop: a mouse click on the chip opens nothing (it places the caret)', async () => {
    desktop(true)
    ok()
    render(<TickerCardPopover editor={editor} />)
    const chip = await chipEl()
    click(chip, 'mouse')
    click(chip)                      // a click that does not say its pointer, on a desktop pointer
    expect(screen.queryByText('Loading NVDA…')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('desktop: resting on the chip for 300 ms opens the card; leaving sooner opens nothing', async () => {
    desktop(true)
    ok()
    render(<TickerCardPopover editor={editor} />)
    const chip = await chipEl()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.mouseOver(chip)
    act(() => { vi.advanceTimersByTime(200) })
    fireEvent.mouseOut(chip, { relatedTarget: editor.view.dom })
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByText('Loading NVDA…')).toBeNull()
    fireEvent.mouseOver(chip)
    act(() => { vi.advanceTimersByTime(299) })
    expect(screen.queryByText('Loading NVDA…')).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByText('Loading NVDA…')).toBeInTheDocument()
    vi.useRealTimers()
    expect(await screen.findByText('Your history')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('review I-1: mouseover, then a mouse click inside the hover window, opens nothing, and the editor keeps focus', async () => {
    desktop(true)
    ok()
    render(<TickerCardPopover editor={editor} />)
    const chip = await chipEl()
    editor.view.dom.focus()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.mouseOver(chip)                              // a real browser sends this before every click
    act(() => { vi.advanceTimersByTime(150) })
    // jsdom has no hit testing; ProseMirror's own mousedown asks for it.
    const hadHit = document.elementFromPoint
    document.elementFromPoint = () => chip
    try { fireEvent.mouseDown(chip) } finally { document.elementFromPoint = hadHit }
    click(chip, 'mouse')
    act(() => { vi.advanceTimersByTime(600) })
    expect(screen.queryByText('Loading NVDA…')).toBeNull()
    expect(screen.queryByText('Insert chart')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(editor.view.dom)
  })

  it('review I-1: an edit or a caret move cancels a pending hover, and a chip redrawn while typing starts none', async () => {
    desktop(true)
    ok()
    render(<TickerCardPopover editor={editor} />)
    const chip = await chipEl()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.mouseOver(chip)
    act(() => { vi.advanceTimersByTime(100) })
    act(() => { editor.commands.insertContentAt(1, 'x') })          // the member types
    fireEvent.mouseOver(editor.view.dom.querySelector('.tickerChip'))  // the redrawn chip under the resting mouse
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('Loading NVDA…')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('review m-9: hovering the chip whose card is already open does not fetch it again', async () => {
    desktop(true)
    ok()
    render(<TickerCardPopover editor={editor} />)
    const chip = await chipEl()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.mouseOver(chip)
    act(() => { vi.advanceTimersByTime(300) })
    vi.useRealTimers()
    expect(await screen.findByText('Your history')).toBeInTheDocument()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.mouseOut(chip, { relatedTarget: editor.view.dom })
    fireEvent.mouseOver(chip)
    act(() => { vi.advanceTimersByTime(600) })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('touch: a tap opens the card, and a hover means nothing there', async () => {
    desktop(false)
    ok()
    render(<TickerCardPopover editor={editor} />)
    const chip = await chipEl()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.mouseOver(chip)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('Loading NVDA…')).toBeNull()
    vi.useRealTimers()
    click(chip, 'touch')
    expect(await screen.findByText('Your history')).toBeInTheDocument()
  })

  it('a touch tap opens even on a laptop whose main pointer is a mouse', async () => {
    desktop(true)
    ok()
    render(<TickerCardPopover editor={editor} />)
    click(await chipEl(), 'touch')
    expect(await screen.findByText('Your history')).toBeInTheDocument()
  })
})
