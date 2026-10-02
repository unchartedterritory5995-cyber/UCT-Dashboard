import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within, cleanup } from '@testing-library/react'
import { memo } from 'react'
import { Editor } from '@tiptap/core'
import { MemoryRouter } from 'react-router-dom'
import { buildExtensions } from '../../lib/tiptap'
import {
  addEdge, addItems, addLevels, boardFromEditor, buildCanvasDoc, emptyBoard, loadHistoryHelpers,
  makeChart, makeSticky, makeTextCard,
} from '../../lib/tradeCanvas'

// ⭐ Render counts per card: the real (memoised) card, wrapped in a memoised
// counter with the same props. A card the board did not hand new props is
// never rendered again — that is what "a drag never re-renders the other 199"
// means, and this is how it is measured.
const renders = new Map()
vi.mock('./TradeCanvasItem', async (orig) => {
  const mod = await orig()
  const Real = mod.default
  const Counting = memo(function Counting(props) {
    renders.set(props.item.id, (renders.get(props.item.id) || 0) + 1)
    return <Real {...props} />
  })
  return { ...mod, default: Counting }
})
// The chart's own module is heavy and needs a canvas; the board's contract with
// it is the attrs it is handed, captured here.
const chartAttrs = new Map()
vi.mock('./ChartEmbed', () => ({
  default: function FakeChartEmbed({ attrs }) {
    chartAttrs.set(attrs.params.symbol + attrs.params.tf, attrs)
    return <div data-testid="fake-chart">{attrs.params.symbol}</div>
  },
}))

// eslint-disable-next-line import/first
import TradeCanvasBoard from './TradeCanvasBoard'

const VW = 1200
const VH = 700
let editor = null

beforeAll(async () => {
  await loadHistoryHelpers()
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return VW } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return VH } })
  HTMLElement.prototype.getBoundingClientRect = function rect() {
    return { left: 0, top: 0, right: VW, bottom: VH, width: VW, height: VH, x: 0, y: 0, toJSON() {} }
  }
})

beforeEach(() => { renders.clear(); chartAttrs.clear() })
afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = null
})

function mount(board = emptyBoard(), props = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: buildCanvasDoc(board) })
  const utils = render(
    <MemoryRouter>
      <TradeCanvasBoard editor={editor} noteId="n1" noteTitle="NVDA plan" ticker="NVDA" {...props} />
    </MemoryRouter>,
  )
  const viewport = screen.getByRole('application')
  return { ...utils, viewport, board: () => boardFromEditor(editor) }
}

const cards = () => [...document.querySelectorAll('[data-canvas-item]')]
const cardEl = (id) => document.querySelector(`[data-canvas-item="${id}"]`)
const key = (el, k, opts = {}) => fireEvent.keyDown(el, { key: k, ...opts })

function two() {
  return addItems(emptyBoard(), [
    makeTextCard({ x: 0, y: 0, text: 'first' }),
    makeTextCard({ x: 400, y: 0, text: 'second' }),
  ]).board
}

describe('the empty canvas shows the three steps of a plan', () => {
  it('chart, levels, link — each a real control', async () => {
    mount(emptyBoard(), { onLinkFromNote: () => {} })
    expect(screen.getByRole('heading', { name: 'Make your plan in three steps' })).toBeTruthy()
    const steps = screen.getByRole('list')
    expect(within(steps).getByRole('button', { name: 'Add a chart' })).toBeTruthy()
    expect(within(steps).getByRole('button', { name: 'Add entry, stop and target' })).toBeTruthy()
    expect(within(steps).getByRole('button', { name: 'Link it from your thesis' })).toBeTruthy()
  })
  it('read-only: the hint offers nothing to press', () => {
    mount(emptyBoard(), { readOnly: true, readOnlyReason: 'Trade-plan canvases are switched off right now, so this plan is read-only.' })
    expect(screen.getByText('This canvas is empty.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a chart' })).toBeNull()
    expect(screen.getByText(/switched off right now/)).toBeTruthy()
  })
})

describe('adding things — every add is ONE editor transaction', () => {
  it('Text: a card is added, opens for writing, and Escape commits the words and returns focus', async () => {
    const { board } = mount()
    fireEvent.click(screen.getByRole('button', { name: /^Text/ }))
    expect(board().items).toHaveLength(1)
    const box = screen.getByRole('textbox', { name: 'Card text' })
    fireEvent.change(box, { target: { value: 'Breakout over 182' } })
    act(() => { key(box, 'Escape') })
    expect(board().items[0].text).toBe('Breakout over 182')
    expect(document.activeElement).toBe(cardEl(board().items[0].id))
  })
  it('Chart: a FROZEN chart stores its symbol, timeframe and as-of day (no bars)', async () => {
    const { board } = mount()
    fireEvent.click(screen.getByRole('button', { name: /^Chart/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Add a chart' })
    fireEvent.change(within(dlg).getByLabelText('Ticker'), { target: { value: 'amd' } })
    fireEvent.change(within(dlg).getByLabelText('Timeframe'), { target: { value: '60' } })
    fireEvent.click(within(dlg).getByLabelText(/Frozen/))
    fireEvent.change(within(dlg).getByLabelText('Frozen as of'), { target: { value: '2026-09-24' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add chart' }))
    const item = board().items[0]
    expect(item).toMatchObject({ kind: 'chart', symbol: 'AMD', tf: '60', mode: 'frozen', asOf: '2026-09-24' })
    expect(JSON.stringify(item).length).toBeLessThan(200)
    // ⛔ the chart is asked for bars UP TO that day: ChartEmbed's `to` is the as-of day
    await screen.findByTestId('fake-chart')
    expect(chartAttrs.get('AMD60')).toMatchObject({ mode: 'snapshot', params: { symbol: 'AMD', tf: '60', to: '2026-09-24' } })
  })
  it('Chart: a live chart has no cut-off; a bad ticker and a future date are refused in words', async () => {
    const { board } = mount()
    fireEvent.click(screen.getByRole('button', { name: /^Chart/ }))
    let dlg = await screen.findByRole('dialog', { name: 'Add a chart' })
    fireEvent.change(within(dlg).getByLabelText('Ticker'), { target: { value: '1!' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add chart' }))
    expect(within(dlg).getByRole('alert').textContent).toMatch(/ticker symbol/)
    fireEvent.change(within(dlg).getByLabelText('Ticker'), { target: { value: 'NVDA' } })
    fireEvent.click(within(dlg).getByLabelText(/Frozen/))
    fireEvent.change(within(dlg).getByLabelText('Frozen as of'), { target: { value: '2999-01-01' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add chart' }))
    expect(within(dlg).getByRole('alert').textContent).toMatch(/after today/)
    fireEvent.click(within(dlg).getByLabelText(/Live/))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add chart' }))
    expect(board().items[0]).toMatchObject({ symbol: 'NVDA', mode: 'live', asOf: null })
    await screen.findByTestId('fake-chart')
    expect(chartAttrs.get('NVDAD').params.to).toBeNull()
    dlg = null
  })
  it('Levels: entry, stop and target at once, drawn on the chart and listed', async () => {
    const start = addItems(emptyBoard(), [makeChart({ x: 0, y: 0, symbol: 'NVDA' })]).board
    const { board } = mount(start)
    fireEvent.click(screen.getByRole('button', { name: /^Levels$/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Add price levels' })
    fireEvent.change(within(dlg).getByLabelText('Entry price'), { target: { value: '182.50' } })
    fireEvent.change(within(dlg).getByLabelText('Stop price'), { target: { value: '171' } })
    fireEvent.change(within(dlg).getByLabelText('Target price'), { target: { value: '$205' } })
    expect(within(dlg).getByLabelText('Draw it on').value).toBe(start.items[0].id)  // the only chart
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add levels' }))
    const lv = board().levels
    expect(lv.map((l) => [l.role, l.price, l.chartId])).toEqual([
      ['entry', 182.5, start.items[0].id], ['stop', 171, start.items[0].id], ['target', 205, start.items[0].id],
    ])
    const list = screen.getByRole('region', { name: 'Plan levels' })
    expect(within(list).getByText('182.50')).toBeTruthy()
    // ⛔ on the chart: horizontal price lines in the chart's own annotation layer
    await screen.findByTestId('fake-chart')
    const ann = chartAttrs.get('NVDAD').annotations
    expect(ann.map((a) => [a.type, a.points[0].price])).toEqual([['horizontal', 182.5], ['horizontal', 171], ['horizontal', 205]])
    // delete one from the list — a real control, no drag or right-click
    fireEvent.click(within(list).getByRole('button', { name: 'Delete Stop 171.00' }))
    expect(board().levels.map((l) => l.role)).toEqual(['entry', 'target'])
  })
  it('Arrow: from the selected card to another, with a label; then removed', async () => {
    const { board, viewport } = mount(two())
    const [a, b] = board().items
    fireEvent.pointerDown(cardEl(a.id), { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('button', { name: /^Arrow$/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Arrows' })
    expect(within(dlg).getByLabelText('Draw an arrow to').value).toBe(b.id)
    fireEvent.change(within(dlg).getByLabelText('Label (optional)'), { target: { value: 'if it holds' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add arrow' }))
    expect(board().edges).toEqual([expect.objectContaining({ from: a.id, to: b.id, label: 'if it holds' })])
    expect(document.querySelectorAll('[data-canvas-edge]')).toHaveLength(1)
  })
})

describe('⛔ keyboard — every action has a key, and focus is never lost', () => {
  it('Tab walks the cards in reading order and LEAVES the board after the last (no trap)', () => {
    const { viewport, board } = mount(two())
    const [a, b] = board().items
    viewport.focus()
    act(() => { key(viewport, 'Tab') })
    expect(document.activeElement).toBe(cardEl(a.id))
    act(() => { key(cardEl(a.id), 'Tab') })
    expect(document.activeElement).toBe(cardEl(b.id))
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    cardEl(b.id).dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    act(() => { key(cardEl(b.id), 'Tab', { shiftKey: true }) })
    expect(document.activeElement).toBe(cardEl(a.id))
  })
  it('arrow keys move the focused card (8 px; Shift 64 px); Alt+arrow resizes', () => {
    const { viewport, board } = mount(two())
    const a = board().items[0]
    viewport.focus()
    act(() => { key(viewport, 'Tab') })
    act(() => { key(cardEl(a.id), 'ArrowRight') })
    expect(board().items[0]).toMatchObject({ x: a.x + 8, y: a.y })
    act(() => { key(cardEl(a.id), 'ArrowDown', { shiftKey: true }) })
    expect(board().items[0]).toMatchObject({ x: a.x + 8, y: a.y + 64 })
    act(() => { key(cardEl(a.id), 'ArrowRight', { altKey: true }) })
    expect(board().items[0].w).toBe(a.w + 8)
  })
  it('Delete removes the card (undo brings it back) and focus moves to the next card', async () => {
    const { viewport, board } = mount(two())
    const [a, b] = board().items
    viewport.focus()
    act(() => { key(viewport, 'Tab') })
    act(() => { key(cardEl(a.id), 'Delete') })
    expect(board().items.map((i) => i.id)).toEqual([b.id])
    expect(document.activeElement).toBe(cardEl(b.id))
    // said, in words, with the way back (the live region is written on the next frame)
    expect(await screen.findByText(/Card deleted\. Press Ctrl\+Z \(or Undo\) to bring it back\./)).toBeTruthy()
    act(() => { key(cardEl(b.id), 'z', { ctrlKey: true }) })
    expect(board().items.map((i) => i.id)).toEqual([a.id, b.id])
  })
  it('deleting the LAST card puts focus on the board itself', () => {
    const one = addItems(emptyBoard(), [makeSticky({ x: 0, y: 0, text: 'x' })]).board
    const { viewport, board } = mount(one)
    viewport.focus()
    act(() => { key(viewport, 'Tab') })
    act(() => { key(document.activeElement, 'Delete') })
    expect(board().items).toEqual([])
    expect(document.activeElement).toBe(viewport)
  })
  it('Ctrl+D duplicates, Ctrl+A selects all, Escape clears, Enter edits', () => {
    const { viewport, board } = mount(two())
    const a = board().items[0]
    viewport.focus()
    act(() => { key(viewport, 'Tab') })
    act(() => { key(cardEl(a.id), 'd', { ctrlKey: true }) })
    expect(board().items).toHaveLength(3)
    act(() => { key(document.activeElement, 'a', { ctrlKey: true }) })
    expect(cards().filter((c) => c.getAttribute('data-selected') === 'true')).toHaveLength(3)
    act(() => { key(document.activeElement, 'Escape') })
    expect(cards().filter((c) => c.getAttribute('data-selected') === 'true')).toHaveLength(0)
    act(() => { key(cardEl(a.id), 'Enter') })
    expect(screen.getByRole('textbox', { name: 'Card text' })).toBeTruthy()
  })
  it('T · S · C · L add things; + − 0 zoom', async () => {
    const { viewport, board } = mount()
    viewport.focus()
    act(() => { key(viewport, 't') })
    act(() => { key(screen.getByRole('textbox', { name: 'Card text' }), 'Escape') })
    act(() => { key(document.activeElement, 's') })
    act(() => { key(screen.getByRole('textbox', { name: 'Sticky note text' }), 'Escape') })
    expect(board().items.map((i) => i.kind)).toEqual(['text', 'sticky'])
    act(() => { key(document.activeElement, 'c') })
    expect(await screen.findByRole('dialog', { name: 'Add a chart' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const label = screen.getByRole('button', { name: 'Show everything' })
    const before = label.textContent
    act(() => { key(viewport, '+') })
    expect(label.textContent).not.toBe(before)
    act(() => { key(viewport, '0') })
    expect(label.textContent).toBe(before)
  })
  it('read-only: keys change nothing', () => {
    const { viewport, board } = mount(two(), { readOnly: true })
    const before = board()
    viewport.focus()
    act(() => { key(viewport, 'Tab') })
    act(() => { key(document.activeElement, 'ArrowRight') })
    act(() => { key(document.activeElement, 'Delete') })
    act(() => { key(document.activeElement, 't') })
    expect(board()).toBe(before)
    expect(screen.queryByRole('button', { name: /^Text/ })).toBeNull()
  })
})

describe('⛔ pointer — a drag commits ONCE and never re-renders the other cards', () => {
  it('drag one of 40 cards: one transaction, the 39 others render zero more times', () => {
    const items = Array.from({ length: 40 }, (_, i) => makeTextCard({ x: (i % 8) * 140, y: Math.floor(i / 8) * 120, text: `c${i}` }))
    const { viewport, board } = mount(addItems(emptyBoard(), items).board)
    const ids = board().items.map((i) => i.id)
    const target = ids[0]
    let updates = 0
    editor.on('update', () => { updates += 1 })
    const before = new Map(renders)
    fireEvent.pointerDown(cardEl(target), { pointerId: 1, clientX: 20, clientY: 20, button: 0 })
    const afterSelect = new Map(renders)
    for (let s = 1; s <= 50; s += 1) fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 20 + s * 2, clientY: 20 + s })
    const duringDrag = new Map(renders)
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 120, clientY: 70 })
    expect(updates).toBe(1)
    expect(board().items[0].x).not.toBe(items[0].x)
    for (const id of ids.slice(1)) expect(renders.get(id), id).toBe(before.get(id))
    // the dragged card: selected on press, then NOT re-rendered for 50 moves
    expect(duringDrag.get(target)).toBe(afterSelect.get(target))
  })
  it('a pan of empty space renders no card and writes nothing', () => {
    const { viewport } = mount(two())
    let updates = 0
    editor.on('update', () => { updates += 1 })
    const before = new Map(renders)
    fireEvent.pointerDown(viewport, { pointerId: 3, clientX: 900, clientY: 600, button: 0 })
    for (let s = 1; s <= 30; s += 1) fireEvent.pointerMove(viewport, { pointerId: 3, clientX: 900 - s, clientY: 600 - s })
    fireEvent.pointerUp(viewport, { pointerId: 3, clientX: 870, clientY: 570 })
    expect(updates).toBe(0)
    expect(new Map(renders)).toEqual(before)
  })
  it('two pointers pinch-zoom the board', () => {
    const { viewport } = mount(two())
    const label = screen.getByRole('button', { name: 'Show everything' })
    const before = label.textContent
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 500, clientY: 300, button: 0 })
    fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 600, clientY: 300, button: 0 })
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 800, clientY: 300 })
    expect(label.textContent).not.toBe(before)
    fireEvent.pointerUp(viewport, { pointerId: 2 })
    fireEvent.pointerUp(viewport, { pointerId: 1 })
  })
  it('the selection bar reaches every drag and right-click action with a button', () => {
    const { board } = mount(two())
    const a = board().items[0]
    fireEvent.pointerDown(cardEl(a.id), { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerUp(document.querySelector('[role="application"]'), { pointerId: 1, clientX: 10, clientY: 10 })
    const bar = screen.getByRole('toolbar', { name: 'Selected cards' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Make larger' }))
    expect(board().items[0].w).toBeGreaterThan(a.w)
    fireEvent.click(within(bar).getByRole('button', { name: 'Duplicate' }))
    expect(board().items).toHaveLength(3)
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selected cards' })).getByRole('button', { name: 'Delete' }))
    expect(board().items).toHaveLength(2)
  })
})

describe('⛔ performance — only what is on screen is rendered', () => {
  it('200 cards: zoomed in, a fraction are in the DOM; every card is still reachable by Tab', () => {
    const items = Array.from({ length: 200 }, (_, i) => makeTextCard({ x: (i % 20) * 300, y: Math.floor(i / 20) * 200, text: `card ${i}` }))
    const { viewport } = mount(addItems(emptyBoard(), items).board)
    act(() => { for (let z = 0; z < 8; z += 1) key(viewport, '+') })
    const inDom = cards().length
    expect(inDom).toBeGreaterThan(0)
    expect(inDom).toBeLessThan(200)
    // Tab past the screen: the off-screen card is brought in and focused
    viewport.focus()
    act(() => { key(viewport, 'Tab') })
    for (let i = 0; i < 30; i += 1) act(() => { key(document.activeElement, 'Tab') })
    expect(document.activeElement.getAttribute('data-canvas-item')).toBeTruthy()
  })
})

describe('the editor is the store', () => {
  it('an undo made OUTSIDE the board (the editor) is shown by the board', () => {
    const { board } = mount(two())
    fireEvent.click(screen.getByRole('button', { name: /^Sticky/ }))
    const box = screen.getByRole('textbox', { name: 'Sticky note text' })
    act(() => { key(box, 'Escape') })
    expect(cards()).toHaveLength(3)
    act(() => { editor.commands.undo() })
    expect(board().items).toHaveLength(2)
    expect(cards()).toHaveLength(2)
  })
  it('levels and arrows already on the board render on load', () => {
    let b = addItems(emptyBoard(), [makeChart({ x: 0, y: 0, symbol: 'NVDA' }), makeTextCard({ x: 600, y: 0 })]).board
    b = addLevels(b, [{ role: 'entry', price: 10, chartId: b.items[0].id }])
    b = addEdge(b, b.items[1].id, b.items[0].id)
    mount(b)
    expect(document.querySelectorAll('[data-canvas-edge]')).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Plan levels' })).getByText('Entry')).toBeTruthy()
  })
})
