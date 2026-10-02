// app/src/pages/journal-2-0/a11y/tradeCanvas.a11y.test.jsx
//
// Wave 11, lane 11D: the trade-plan canvas through 8A's axe harness (the ONE way a Notebook
// rail asks axe-core; frozen exclusions, ruling D-A5), in each state a member reaches that holds
// controls: a working board (cards of every kind, a level list, an arrow, a selection with its
// action bar), the empty board's three-step hint, a read-only board, and each dialog (chart,
// levels, arrows, keys, link from a thesis). Each recipe proves the state it is about rendered
// before axe runs, so an empty or wrong screen can never pass as a clean one.
import { describe, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { buildExtensions } from '../lib/tiptap'
import {
  addEdge, addItems, addLevels, buildCanvasDoc, emptyBoard, loadHistoryHelpers, makeChart, makeSticky, makeTextCard,
} from '../lib/tradeCanvas'
import TradeCanvasBoard from '../components/notebook/TradeCanvasBoard'
import {
  ArrowDialog, ChartDialog, KeysDialog, LevelDialog, LinkThesisDialog,
} from '../components/notebook/TradeCanvasDialogs'

vi.mock('../components/notebook/ChartEmbed', () => ({
  default: ({ attrs }) => <div role="img" aria-label={`${attrs.params.symbol} chart`} />,
}))

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
let editor = null

function fullBoard() {
  let b = addItems(emptyBoard(), [
    makeChart({ x: 0, y: 0, symbol: 'NVDA', tf: 'D' }),
    makeChart({ x: 0, y: 340, symbol: 'NVDA', tf: '60', mode: 'frozen', asOf: '2026-09-24' }),
    makeTextCard({ x: 520, y: 0, text: 'Base breakout over the 50-day' }),
    makeSticky({ x: 520, y: 180, text: 'Earnings 10/28' }),
  ]).board
  b = addLevels(b, [
    { role: 'entry', price: 182.5, chartId: b.items[0].id },
    { role: 'stop', price: 171, chartId: b.items[0].id },
    { role: 'target', price: 205, chartId: b.items[0].id },
  ])
  return addEdge(b, b.items[2].id, b.items[0].id, 'if it holds')
}

function mountBoard(board, props = {}) {
  // The editor is the board's STORE; in the Notebook it is mounted hidden under the
  // board (named "Note body"). Here it stays detached, so axe sees only the board.
  const el = document.createElement('div')
  editor = new Editor({ element: el, extensions: buildExtensions(), content: buildCanvasDoc(board) })
  return render(
    <Providers>
      <TradeCanvasBoard editor={editor} noteId="n1" noteTitle="NVDA plan" ticker="NVDA" onLinkFromNote={() => {}} {...props} />
    </Providers>,
  )
}

describe('lane 11D surfaces', () => {
  beforeAll(async () => {
    await loadHistoryHelpers()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 1200 } })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 700 } })
  })
  beforeEach(() => { installFetch([[/^\/api\/j2\/notes\/switcher$/, { results: [{ id: 'n9', title: 'NVDA thesis' }] }]]) })
  afterEach(() => { editor?.destroy(); editor = null })

  axeSurface('trade-canvas', async () => {
    mountBoard(fullBoard())
    const app = screen.getByRole('application', { name: /Trade-plan canvas, 4 cards/ })
    const card = app.querySelector('[data-kind="text"]')
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 5, clientY: 5, button: 0 })
    fireEvent.pointerUp(app, { pointerId: 1, clientX: 5, clientY: 5 })
    screen.getByRole('toolbar', { name: 'Selected cards' })
    within(screen.getByRole('region', { name: 'Plan levels' })).getByText('182.50')
    await screen.findAllByRole('img', { name: 'NVDA chart' })
    await settle()
  })

  axeSurface('trade-canvas-empty', async () => {
    mountBoard(emptyBoard())
    screen.getByRole('heading', { name: 'Make your plan in three steps' })
    await settle()
  })

  axeSurface('trade-canvas-read-only', async () => {
    mountBoard(fullBoard(), { readOnly: true, readOnlyReason: 'Trade-plan canvases are switched off right now, so this plan is read-only.' })
    screen.getByText(/switched off right now/)
    await settle()
  })

  axeSurface('trade-canvas-dialogs', async () => {
    render(<Providers><ChartDialog open defaultSymbol="NVDA" onSubmit={() => {}} onClose={() => {}} /></Providers>)
    const dlg = await screen.findByRole('dialog', { name: 'Add a chart' })
    fireEvent.click(within(dlg).getByLabelText(/Frozen/))
    within(dlg).getByLabelText('Frozen as of')
    await settle()
  })

  axeSurface('trade-canvas-levels-dialog', async () => {
    const b = fullBoard()
    render(<Providers><LevelDialog open charts={b.items.filter((i) => i.kind === 'chart')} defaultChartId={b.items[0].id} onSubmit={() => {}} onClose={() => {}} /></Providers>)
    const dlg = await screen.findByRole('dialog', { name: 'Add price levels' })
    within(dlg).getByLabelText('Entry price')
    await settle()
  })

  axeSurface('trade-canvas-arrow-dialog', async () => {
    const b = fullBoard()
    render(<Providers><ArrowDialog open from={b.items[2]} items={b.items} edges={b.edges} onAdd={() => {}} onRemove={() => {}} onClose={() => {}} /></Providers>)
    const dlg = await screen.findByRole('dialog', { name: 'Arrows' })
    within(dlg).getByRole('list', { name: 'Arrows on this card' })
    await settle()
  })

  axeSurface('trade-canvas-keys-dialog', async () => {
    render(<Providers><KeysDialog open onClose={() => {}} /></Providers>)
    await screen.findByRole('dialog', { name: 'Canvas keys' })
    await settle()
  })

  axeSurface('trade-canvas-link-dialog', async () => {
    render(<Providers><LinkThesisDialog open canvasId="n1" onPick={() => {}} onClose={() => {}} /></Providers>)
    await screen.findByRole('dialog', { name: 'Link this plan from a note' })
    await settle()
  })
})
