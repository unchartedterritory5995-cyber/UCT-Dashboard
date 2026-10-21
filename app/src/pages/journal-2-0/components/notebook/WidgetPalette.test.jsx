// Widget palette — the point-and-click twin of the slash commands (owner ask:
// "click Charts → What ticker? What time frame? Boom — click, click, click").
// It must ride the SAME grammar (parseChartSlashArgs & friends) and the SAME
// node builder (chartInsertNodes) as the slash menu — a second hand-written
// insert payload is the "one grammar, four copies" defect.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import WidgetPalette from './WidgetPalette'
import { buildExtensions } from '../../lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
// jsdom has no Range layout; an editor focus() scrolls the caret into view on the next frame.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const makeEditor = () => {
  const calls = { content: null, focused: 0, ran: 0 }
  const chain = {
    focus: () => { calls.focused += 1; return chain },
    insertContent: (nodes) => { calls.content = nodes; return chain },
    caretAfterWidgetEmbed: () => chain,
    run: () => { calls.ran += 1 },
  }
  const editor = {
    chain: () => chain,
    storage: { uctJournalWidgets: { chartSettings: { background: '#abc123' } } },
  }
  return { editor, calls }
}

describe('WidgetPalette', () => {
  it('lists the chart type and the two composition presets', () => {
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    const panel = screen.getByRole('dialog', { name: 'Insert widget' })
    expect(within(panel).getByText('Chart')).toBeInTheDocument()
    expect(within(panel).getByText('MTF stack')).toBeInTheDocument()
    expect(within(panel).getByText('Before / after')).toBeInTheDocument()
  })

  it('chart flow: ticker → timeframe pill → insert lands the exact /chart payload, settings frozen', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'amd' } })
    fireEvent.click(screen.getByRole('button', { name: '15m' }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert chart' }))
    expect(calls.ran).toBe(1)
    expect(calls.content).toHaveLength(1)
    expect(calls.content[0].type).toBe('widgetEmbed')
    expect(calls.content[0].attrs.params).toMatchObject({ symbol: 'AMD', tf: '15' })
    expect(calls.content[0].attrs.params.settings).toEqual({ background: '#abc123' })
  })

  it('insert stays disabled until the ticker parses (same strictness as the slash grammar)', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    const insert = screen.getByRole('button', { name: 'Insert chart' })
    expect(insert).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: '123' } })
    expect(insert).toBeDisabled()
    fireEvent.click(insert)
    expect(calls.ran).toBe(0)
  })

  it('before/after requires a date; a valid one inserts the half-width pair', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Before / after'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'AMD' } })
    const insert = screen.getByRole('button', { name: 'Insert charts' })
    expect(insert).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Anchor date'), { target: { value: '2026-03-13' } })
    fireEvent.click(insert)
    expect(calls.content).toHaveLength(2)
    expect(calls.content[0].attrs.params.to).toBe('2026-03-13')
    expect(calls.content[0].attrs.layout.width).toBe('half')
    expect(calls.content[1].attrs.params.to == null).toBe(true)
  })

  it('steps OFF a pre-existing NodeSelection before inserting (the atom-replace trap)', () => {
    // Clicking an embed leaves a NodeSelection ON the atom; focus() restores
    // it, and insertContent over a NodeSelection REPLACES the node. The slash
    // path can't reach this (typing collapses the selection) — the palette
    // can, so its chain must caretAfterWidgetEmbed() BEFORE the insert too.
    const order = []
    const chain = {
      focus: () => { order.push('focus'); return chain },
      insertContent: () => { order.push('insertContent'); return chain },
      caretAfterWidgetEmbed: () => { order.push('caret'); return chain },
      run: () => { order.push('run') },
    }
    const editor = { chain: () => chain, storage: {} }
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'AMD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert chart' }))
    expect(order.indexOf('caret')).toBeGreaterThan(-1)
    expect(order.indexOf('caret')).toBeLessThan(order.indexOf('insertContent'))
    expect(order.filter((x) => x === 'caret').length).toBe(2) // before AND after
  })

  it('mtf flow inserts the three-chart stack', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('MTF stack'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'NVDA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert charts' }))
    expect(calls.content).toHaveLength(3)
    expect(calls.content.map((n) => n.attrs.params.tf)).toEqual(['D', '60', '15'])
  })
})

// ── Review round 2: input hardening ──
describe('WidgetPalette input hardening', () => {
  it('the ticker field is ONE token — whitespace never smuggles grammar slots', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'AMD 3/13' } })
    // Whitespace is stripped on input; the mangled remainder fails the symbol
    // grammar, so nothing silently fills the (visibly empty) Date field.
    expect(screen.getByLabelText('Ticker').value).not.toContain(' ')
    expect(screen.getByRole('button', { name: 'Insert chart' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Insert chart' }))
    expect(calls.ran).toBe(0)
  })

  it('a FUTURE date never arms the insert (identical before/after halves trap)', () => {
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Before / after'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'AMD' } })
    fireEvent.change(screen.getByLabelText('Anchor date'), { target: { value: '2030-01-02' } })
    expect(screen.getByRole('button', { name: 'Insert charts' })).toBeDisabled()
  })

  it('an anchor past the timeframe ceiling is refused with the house line, not inserted dead', () => {
    const { editor, calls } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'AMD' } })
    fireEvent.click(screen.getByRole('button', { name: '1m' }))
    fireEvent.change(screen.getByLabelText('Date (optional)'), { target: { value: '2026-01-05' } }) // >60d back
    expect(screen.getByRole('button', { name: 'Insert chart' })).toBeDisabled()
    expect(screen.getByText('no data that far back at that timeframe')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Insert chart' }))
    expect(calls.ran).toBe(0)
  })
})

/**
 * ⛔⛔ THIS WAS A role="dialog" WITH NO KEYBOARD ESCAPE HATCH AT ALL — a real
 * WAI-ARIA dialog-pattern violation. Competitive audit finding UX #13,
 * 2026-09-22.
 */
describe('WidgetPalette keyboard escape (UX #13)', () => {
  it('Escape calls onClose', () => {
    const { editor } = makeEditor()
    const onClose = vi.fn()
    render(<WidgetPalette editor={editor} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape works from inside the ticker form too, not just the type list', () => {
    const { editor } = makeEditor()
    const onClose = vi.fn()
    render(<WidgetPalette editor={editor} onClose={onClose} />)
    fireEvent.click(screen.getByText('Chart'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('⛔ CONTROL — an unrelated key does not call onClose', () => {
    const { editor } = makeEditor()
    const onClose = vi.fn()
    render(<WidgetPalette editor={editor} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Tab from the last focusable element wraps to the first (focus trap)', () => {
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} onClose={vi.fn()} />)
    const panel = screen.getByRole('dialog', { name: 'Insert widget' })
    const focusables = panel.querySelectorAll(
      'button:not([disabled]), input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')
    const last = focusables[focusables.length - 1]
    const first = focusables[0]
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })
})

/**
 * 13Q-3 (Q20 click-budget fix): this dialog is mounted from inside the note editor's phone
 * "Format" disclosure (NoteEditorPage.jsx's `.formatRun` spans toggle `display:none` ->
 * `display:contents` on open). A real-browser keyboard walk measured that a plain forward
 * Tab out of that just-revealed region does not reliably land inside this dialog at phone
 * width -- it ran out a 600-press Tab budget hunting for "Chart" that cost 2 presses on
 * desktop (docs/notebook/evidence/wave13-13q3/q20-dialog-diagnosis/). Moving focus into the
 * dialog on open removes the dependency on that natural tab order at every width.
 */
describe('WidgetPalette autofocus on open (13Q-3, Q20)', () => {
  it('focuses the first type button the moment the dialog opens -- no Tab required', () => {
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    expect(document.activeElement).toBe(screen.getByText('Chart').closest('button'))
  })

  it('"Back" from the ticker form returns focus to the first type button', () => {
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('Chart'))
    expect(document.activeElement).toBe(screen.getByLabelText('Ticker'))
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }))
    expect(document.activeElement).toBe(screen.getByText('Chart').closest('button'))
  })

  it('opening the ticker form still focuses the ticker field (unchanged)', () => {
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    fireEvent.click(screen.getByText('MTF stack'))
    expect(document.activeElement).toBe(screen.getByLabelText('Ticker'))
  })
})

// Notebook widgets Task 8: the palette offers the same snapshot items as the / menu, built by the SAME
// builder (SlashMenu.snapshotWidgetItems), under the same moment labels.
describe('WidgetPalette snapshot widgets (Task 8)', () => {
  const realFetch = global.fetch
  let ed
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); ed?.destroy(); ed = null })
  const mount = () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    ed = new Editor({ element: el, extensions: buildExtensions(), content: '<p>Plan</p>' })
    return ed
  }
  const embeds = () => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') o.push(n) }); return o }
  const ok = (body) => ({ ok: true, status: 200, json: async () => ({ asOf: '2026-10-20T14:00:00Z', source: 'market', ...body }) })

  it('offers no snapshot widgets while every wave is off', () => {
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    expect(screen.queryByText('Before the open')).toBeNull()
    expect(screen.queryByText('My watchlist today')).toBeNull()
    expect(screen.queryByText('Ticker card')).toBeNull()
  })

  it('lists the wave-on snapshot widgets under the moment labels, in order', () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    const panel = screen.getByRole('dialog', { name: 'Insert widget' })
    const text = panel.textContent
    for (const t of ['Before the open', 'My watchlist today', 'Planning a trade', 'Ticker card', 'Reviewing', 'My P&L and stats']) {
      expect(text, t).toContain(t)
    }
    expect(text.indexOf('Before the open')).toBeLessThan(text.indexOf('Planning a trade'))
    expect(text.indexOf('Planning a trade')).toBeLessThan(text.indexOf('Reviewing'))
    expect(text).not.toContain('My rules check')   // wave 2 is off
    // The first-focus target is still the first chart type.
    expect(document.activeElement).toBe(screen.getByText('Chart').closest('button'))
  })

  it('wave 2 on lists both new kinds under Reviewing', () => {
    latchNotebookFlags({ notebook_widgets_w2_enabled: true })
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    const text = screen.getByRole('dialog', { name: 'Insert widget' }).textContent
    expect(text).toContain('Reviewing')
    expect(text).toContain('My rules check')
    expect(text).toContain('My recurring mistakes')
    expect(text.indexOf('Reviewing')).toBeLessThan(text.indexOf('My rules check'))
  })

  it('wave 3 on lists Market on my names under Before the open and the flow item under Planning a trade', () => {
    latchNotebookFlags({ notebook_widgets_w3_enabled: true })
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    const text = screen.getByRole('dialog', { name: 'Insert widget' }).textContent
    expect(text).toContain('Market on my names')
    expect(text).toContain('Options flow on a ticker')
    expect(text.indexOf('Before the open')).toBeLessThan(text.indexOf('Market on my names'))
    expect(text.indexOf('Planning a trade')).toBeLessThan(text.indexOf('Options flow on a ticker'))
  })

  it('wave 3 off lists neither wave-3 kind', () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true, notebook_widgets_w2_enabled: true })
    const { editor } = makeEditor()
    render(<WidgetPalette editor={editor} />)
    const text = screen.getByRole('dialog', { name: 'Insert widget' }).textContent
    expect(text).not.toContain('Market on my names')
    expect(text).not.toContain('Options flow on a ticker')
    expect(text).toContain('My watchlist today')
  })

  it('a click fetches the snapshot and inserts the frozen widget, then says so', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    global.fetch.mockResolvedValue(ok({ listLabel: 'Watchlist', rows: [], truncated: 0 }))
    render(<WidgetPalette editor={mount()} />)
    fireEvent.click(screen.getByText('My watchlist today'))
    expect(await screen.findByText('My watchlist today inserted')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notebook-widgets/myWatchlistToday', expect.anything())
    expect(embeds().map((n) => n.attrs.widgetId)).toEqual(['myWatchlistToday'])
  })

  it('R58 I-2: says "Adding …" while the fetch runs, and a second click adds nothing', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    let answer
    global.fetch.mockReturnValue(new Promise((r) => { answer = r }))
    render(<WidgetPalette editor={mount()} />)
    fireEvent.click(screen.getByText('My watchlist today'))
    expect(await screen.findByText('Adding My watchlist today…')).toBeInTheDocument()
    fireEvent.click(screen.getByText('My watchlist today'))
    answer(ok({ listLabel: 'Watchlist', rows: [], truncated: 0 }))
    expect(await screen.findByText('My watchlist today inserted')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(embeds()).toHaveLength(1)
  })

  it('a failed fetch inserts nothing and says nothing was inserted', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    render(<WidgetPalette editor={mount()} />)
    fireEvent.click(screen.getByText('My watchlist today'))
    expect(await screen.findByText('My watchlist today could not be loaded just now, so nothing was added.')).toBeInTheDocument()
    expect(embeds()).toHaveLength(0)
  })

  it('Ticker card asks for a ticker and inserts the card for it', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    global.fetch.mockResolvedValue(ok({ symbol: 'AMD', price: 150 }))
    render(<WidgetPalette editor={mount()} />)
    fireEvent.click(screen.getByText('Ticker card'))
    const insert = screen.getByRole('button', { name: 'Insert ticker card' })
    expect(insert).toBeDisabled()
    expect(screen.queryByText('Timeframe')).toBeNull()
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: '123' } })
    expect(insert).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'amd' } })
    expect(insert).not.toBeDisabled()
    fireEvent.click(insert)
    expect(await screen.findByText('Ticker card — AMD inserted')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notebook-widgets/tickerCard?symbol=AMD', expect.anything())
    expect(embeds().map((n) => n.attrs.params.symbol)).toEqual(['AMD'])
  })
})
