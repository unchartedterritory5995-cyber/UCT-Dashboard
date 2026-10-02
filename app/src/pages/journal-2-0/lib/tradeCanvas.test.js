import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions, extractPlainText } from './tiptap'
import {
  BIG_STEP, CANVAS_NODE, GRID, LIMITS, MIN_SIZE, addEdge, addItems, addLevels, boardFromEditor,
  boardSearchText, buildCanvasDoc, canvasNodeIn, cleanSymbol, commitBoard, duplicateItems, edgeLine,
  emptyBoard, extraBlockCount, fitCamera, isTradeCanvasDoc, loadHistoryHelpers, makeChart, makeSticky,
  makeTextCard, moveItems, normalizeBoard, readStoredBoard, readingOrder, removeEdge, removeItems,
  removeLevel, resizeItem, starterBoard, strictDay, updateItem, updateLevel, visibleIds, zoomAt,
} from './tradeCanvas'
import { citationLeafText } from './askCitation'

const at = (x, y) => ({ x, y })

function boardWith(...items) {
  return addItems(emptyBoard(), items).board
}

describe('the board model — normalisation never throws and reads anything as less', () => {
  it('a junk value is the empty board', () => {
    for (const junk of [null, undefined, 3, 'x', [], { items: 'no' }, { items: [null, 7, {}] }]) {
      expect(normalizeBoard(junk)).toEqual(emptyBoard())
    }
  })
  it('keeps valid items, drops duplicate ids, unknown kinds, and clamps sizes', () => {
    const b = normalizeBoard({ items: [
      { id: 'a', kind: 'text', x: 1.4, y: 2.6, w: 1, h: 99999, text: 'hi' },
      { id: 'a', kind: 'text', x: 0, y: 0 },
      { id: 'b', kind: 'video', x: 0, y: 0 },
      { id: 'c', kind: 'chart', symbol: '$nvda', tf: 'W', mode: 'frozen', asOf: '2026-09-24' },
    ] })
    expect(b.items.map((i) => i.id)).toEqual(['a', 'c'])
    expect(b.items[0]).toMatchObject({ x: 1, y: 3, w: MIN_SIZE.text.w, h: 1200 })
    expect(b.items[1]).toMatchObject({ symbol: 'NVDA', tf: 'W', mode: 'frozen', asOf: '2026-09-24' })
  })
  it('⛔ a frozen chart without a real as-of day reads as LIVE, never as a frozen chart of no date', () => {
    for (const asOf of [null, '', '2026-02-30', '24/09/2026', 20260924]) {
      const b = normalizeBoard({ items: [{ id: 'c', kind: 'chart', symbol: 'NVDA', mode: 'frozen', asOf }] })
      expect(b.items[0]).toMatchObject({ mode: 'live', asOf: null })
    }
  })
  it('edges must join two real, different items; levels need a positive finite price', () => {
    const b = normalizeBoard({
      items: [{ id: 'a', kind: 'text' }, { id: 'b', kind: 'chart', symbol: 'AMD' }],
      edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'a', to: 'a' }, { id: 'e3', from: 'a', to: 'zz' },
        { id: 'e4', from: 'a', to: 'b' }],
      levels: [{ id: 'l1', role: 'entry', price: 10, chartId: 'b' }, { id: 'l2', role: 'stop', price: -1 },
        { id: 'l3', role: 'weird', price: 5, chartId: 'a' }, { id: 'l4', price: 'NaN' }],
    })
    expect(b.edges.map((e) => e.id)).toEqual(['e1'])
    expect(b.levels).toEqual([
      { id: 'l1', role: 'entry', label: 'Entry', price: 10, chartId: 'b' },
      { id: 'l3', role: 'custom', label: 'Level', price: 5, chartId: null },
    ])
  })
  it('a newer client’s extra item fields ride along untouched', () => {
    const b = normalizeBoard({ items: [{ id: 'a', kind: 'text', futureField: { x: 1 } }] })
    expect(b.items[0].futureField).toEqual({ x: 1 })
  })
})

describe('operations share structure — an untouched card keeps its identity', () => {
  it('moving one card returns the other cards as the SAME objects', () => {
    const a = makeTextCard(at(0, 0))
    const b = makeTextCard(at(400, 0))
    const board = boardWith(a, b)
    const moved = moveItems(board, [board.items[0].id], GRID, 0)
    expect(moved.items[0].x).toBe(board.items[0].x + GRID)
    expect(moved.items[1]).toBe(board.items[1])
    expect(readStoredBoard(moved)).toBe(moved) // read back as itself: no re-render of every card
  })
  it('CONTROL — a plain object (not produced here) is normalised once, then cached', () => {
    const raw = { v: 1, items: [{ id: 'x', kind: 'text' }], edges: [], levels: [] }
    const first = readStoredBoard(raw)
    expect(first).not.toBe(raw)
    expect(readStoredBoard(raw)).toBe(first)
  })
  it('the item cap is enforced and reported', () => {
    const many = Array.from({ length: LIMITS.items + 5 }, (_, i) => makeTextCard(at(i, 0)))
    const { board, added, refused } = addItems(emptyBoard(), many)
    expect(board.items).toHaveLength(LIMITS.items)
    expect(added).toHaveLength(LIMITS.items)
    expect(refused).toBe(5)
  })
  it('resize clamps to the kind’s minimum', () => {
    const board = boardWith(makeChart(at(0, 0)))
    const r = resizeItem(board, board.items[0].id, 10, 10)
    expect(r.items[0]).toMatchObject({ w: MIN_SIZE.chart.w, h: MIN_SIZE.chart.h })
  })
  it('removing a card removes its arrows and detaches its levels (the level is KEPT)', () => {
    let board = boardWith(makeChart(at(0, 0)), makeTextCard(at(600, 0)))
    const [c, t] = board.items
    board = addEdge(board, t.id, c.id, 'if it holds')
    board = addLevels(board, [{ role: 'stop', price: 100, chartId: c.id }])
    const after = removeItems(board, [c.id])
    expect(after.edges).toEqual([])
    expect(after.levels).toHaveLength(1)
    expect(after.levels[0]).toMatchObject({ role: 'stop', price: 100, chartId: null })
  })
  it('duplicate copies cards (new ids, offset) and the arrows between the copied cards', () => {
    let board = boardWith(makeTextCard(at(0, 0)), makeSticky(at(300, 0)))
    const [a, b] = board.items
    board = addEdge(board, a.id, b.id)
    const { board: d, ids } = duplicateItems(board, [a.id, b.id])
    expect(ids).toHaveLength(2)
    expect(d.items).toHaveLength(4)
    expect(d.items[2]).toMatchObject({ x: a.x + 24, y: a.y + 24, kind: 'text' })
    expect(d.edges).toHaveLength(2)
    expect(d.edges[1]).toMatchObject({ from: ids[0], to: ids[1] })
  })
  it('an arrow is refused onto itself, to a missing card, and twice', () => {
    const board = boardWith(makeTextCard(at(0, 0)), makeTextCard(at(400, 0)))
    const [a, b] = board.items
    expect(addEdge(board, a.id, a.id)).toBe(board)
    expect(addEdge(board, a.id, 'nope')).toBe(board)
    const once = addEdge(board, a.id, b.id)
    expect(addEdge(once, a.id, b.id)).toBe(once)
    expect(removeEdge(once, once.edges[0].id).edges).toEqual([])
  })
  it('levels: blank and bad prices are skipped; updates keep a valid chart only', () => {
    let board = boardWith(makeChart(at(0, 0)))
    const chart = board.items[0]
    board = addLevels(board, [
      { role: 'entry', price: '182.5', chartId: chart.id }, { role: 'stop', price: 'abc' }, { role: 'target', price: 0 },
    ])
    expect(board.levels).toHaveLength(1)
    const lv = board.levels[0]
    expect(lv).toMatchObject({ role: 'entry', label: 'Entry', price: 182.5, chartId: chart.id })
    const moved = updateLevel(board, lv.id, { price: 190, chartId: 'gone' })
    expect(moved.levels[0]).toMatchObject({ price: 190, chartId: null })
    expect(updateLevel(board, lv.id, { price: -3 })).toBe(board)
    expect(removeLevel(board, lv.id).levels).toEqual([])
  })
  it('updateItem changes one card and nothing else', () => {
    const board = boardWith(makeTextCard(at(0, 0)), makeTextCard(at(400, 0)))
    const next = updateItem(board, board.items[0].id, { text: 'Breakout over 182' })
    expect(next.items[0].text).toBe('Breakout over 182')
    expect(next.items[1]).toBe(board.items[1])
  })
})

describe('words: the search line is the one authority for search, Ask and mentions', () => {
  it('names the charts as cashtags, the frozen date, the levels and the cards', () => {
    let board = boardWith(
      makeChart({ ...at(0, 0), symbol: 'NVDA', tf: 'D' }),
      makeChart({ ...at(0, 400), symbol: 'AMD', tf: '60', mode: 'frozen', asOf: '2026-09-24' }),
      makeTextCard({ ...at(600, 0), text: 'Base breakout\nover the 50-day' }),
    )
    board = addLevels(board, [{ role: 'target', price: 205 }, { role: 'entry', price: 182.5 }, { role: 'stop', price: 171 }])
    const s = boardSearchText(board)
    expect(s).toContain('$NVDA Daily chart')
    expect(s).toContain('$AMD 1 hour chart frozen as of 2026-09-24')
    expect(s.indexOf('Entry 182.50')).toBeLessThan(s.indexOf('Stop 171.00'))
    expect(s.indexOf('Stop 171.00')).toBeLessThan(s.indexOf('Target 205.00'))
    expect(s).toContain('Base breakout over the 50-day')
  })
})

describe('the note body — a canvas is a note whose first block is the canvas node', () => {
  it('buildCanvasDoc is recognised, carries the search line, and is buildable by the real schema', () => {
    const doc = buildCanvasDoc(starterBoard({ ticker: 'nvda' }))
    expect(isTradeCanvasDoc(doc)).toBe(true)
    expect(doc.content[0].attrs.searchText).toContain('$NVDA Daily chart')
    const ed = new Editor({ extensions: buildExtensions(), content: doc })
    try {
      expect(ed.getJSON().content[0].type).toBe(CANVAS_NODE)
      expect(ed.getJSON().content[0].attrs.board.items[0].symbol).toBe('NVDA')
      // ⛔ body_plain reads the search line (the parity fixture pins the server side)
      expect(extractPlainText(ed.getJSON())).toContain('$NVDA Daily chart')
      expect(citationLeafText(ed.state.doc.firstChild)).toContain('Trade-plan canvas')
    } finally { ed.destroy() }
  })
  it('CONTROL — an ordinary note is not a canvas', () => {
    expect(isTradeCanvasDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(false)
    expect(isTradeCanvasDoc(null)).toBe(false)
  })
})

describe('⛔ commitBoard — the board’s ONE write is one transaction on the canvas node', () => {
  function editorWith(board) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return new Editor({ element: el, extensions: buildExtensions(), content: buildCanvasDoc(board) })
  }

  it('writes the board AND the search line, fires one update, and undo restores the previous board', async () => {
    await loadHistoryHelpers()
    const ed = editorWith(emptyBoard())
    try {
      let updates = 0
      ed.on('update', () => { updates += 1 })
      const before = boardFromEditor(ed)
      const next = addItems(before, [makeTextCard({ x: 0, y: 0, text: 'plan' })]).board
      expect(commitBoard(ed, next)).toBe(true)
      expect(updates).toBe(1)
      expect(boardFromEditor(ed)).toBe(next)
      expect(canvasNodeIn(ed.state).node.attrs.searchText).toContain('plan')
      ed.commands.undo()
      expect(boardFromEditor(ed).items).toHaveLength(0)
      ed.commands.redo()
      expect(boardFromEditor(ed).items).toHaveLength(1)
    } finally { ed.destroy() }
  })
  it('⛔ writes NOTHING on a read-only (locked) editor', () => {
    const ed = editorWith(emptyBoard())
    try {
      ed.setEditable(false, false)
      let updates = 0
      ed.on('update', () => { updates += 1 })
      const next = addItems(boardFromEditor(ed), [makeTextCard()]).board
      expect(commitBoard(ed, next)).toBe(false)
      expect(updates).toBe(0)
      expect(boardFromEditor(ed).items).toHaveLength(0)
    } finally { ed.destroy() }
  })
  it('writes nothing to a note with no canvas node', () => {
    const el = document.createElement('div')
    const ed = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    try {
      expect(commitBoard(ed, starterBoard({ ticker: 'SPY' }))).toBe(false)
      expect(isTradeCanvasDoc(ed.getJSON())).toBe(false)
    } finally { ed.destroy() }
  })
  it('extraBlockCount ignores the trailing empty paragraph and counts real blocks', () => {
    const el = document.createElement('div')
    const doc = buildCanvasDoc(emptyBoard())
    doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'captured' }] })
    const ed = new Editor({ element: el, extensions: buildExtensions(), content: doc })
    try { expect(extraBlockCount(ed.state)).toBe(1) } finally { ed.destroy() }
  })
})

describe('the camera', () => {
  it('zoomAt keeps the point under the pointer still', () => {
    const cam = { x: 100, y: 50, z: 1 }
    const next = zoomAt(cam, 2, 300, 250)
    const wx = (300 - cam.x) / cam.z
    expect(next.z).toBe(2)
    expect(wx * next.z + next.x).toBeCloseTo(300)
  })
  it('fitCamera shows every card, never past 100%', () => {
    const items = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 4000, y: 3000, w: 100, h: 100 }]
    const cam = fitCamera(items, 1000, 600)
    expect(cam.z).toBeLessThan(1)
    expect(visibleIds(items.map((it, i) => ({ ...it, id: String(i) })), cam, 1000, 600, 0)).toEqual(['0', '1'])
    expect(fitCamera([{ x: 0, y: 0, w: 10, h: 10 }], 1000, 600).z).toBe(1)
  })
  it('⛔ only cards on screen are rendered (culling)', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, x: (i % 20) * 300, y: Math.floor(i / 20) * 200, w: 240, h: 140 }))
    const ids = visibleIds(items, { x: 0, y: 0, z: 1 }, 1200, 700, 0)
    expect(ids.length).toBeGreaterThan(5)
    expect(ids.length).toBeLessThan(40)
  })
  it('reading order is top-to-bottom then left-to-right', () => {
    const order = readingOrder([{ id: 'b', x: 500, y: 0 }, { id: 'c', x: 0, y: 400 }, { id: 'a', x: 0, y: 4 }])
    expect(order.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
  it('an arrow runs edge to edge', () => {
    const l = edgeLine({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 0, w: 100, h: 100 })
    expect(l).toMatchObject({ x1: 100, y1: 50, x2: 300, y2: 50 })
  })
})

describe('small helpers', () => {
  it('strictDay refuses impossible dates and loose formats', () => {
    expect(strictDay('2026-09-24')).toBe('2026-09-24')
    expect(strictDay('2026-02-29')).toBeNull()
    expect(strictDay('2026-9-24')).toBeNull()
  })
  it('cleanSymbol upper-cases, drops a leading $, and refuses junk', () => {
    expect(cleanSymbol(' $nvda ')).toBe('NVDA')
    expect(cleanSymbol('BRK.B')).toBe('BRK.B')
    expect(cleanSymbol('1abc')).toBeNull()
    expect(cleanSymbol('')).toBeNull()
  })
  it('the big step is a whole number of grid steps', () => {
    expect(BIG_STEP % GRID).toBe(0)
  })
})
