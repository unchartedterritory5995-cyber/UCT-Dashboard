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
const open = (symbol = 'NVDA') => act(() => {
  editor.view.dom.dispatchEvent(new CustomEvent(TICKER_CARD_EVENT, {
    bubbles: true, detail: { symbol, rect: { left: 10, top: 10, bottom: 30, right: 60, width: 50, height: 20 } },
  }))
})
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
})
