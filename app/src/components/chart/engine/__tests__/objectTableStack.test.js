// Stabilization 2 — tables that share a corner STACK, and stay inside their pane.
//
// ⚰️ Measured on prod 2026-10-08: an RSI/EMA table and a position calculator, two
// indicators at `top_right`, painted on top of each other; a calculator in its own
// pane put `bottom_left` over two other panes. Driven through real object layers
// (`createObjectLayer`) on one container, as the chart does.
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createObjectLayer } from '../objectLayer'
import { TABLE_MARGIN } from '../objectCanvas'
import { TABLE_STACK_GAP, restackTables } from '../objectTableStack'

const H = { a: 40, b: 60, c: 25 } // rendered heights, by first cell text

/** jsdom lays nothing out: report each table's height from its first cell. */
const measure = (root) => {
  for (const el of root.querySelectorAll('[data-uct-object-table]')) {
    const h = H[el.textContent.trim()[0]] || 10
    el.getBoundingClientRect = () => ({ height: h, width: 100, top: 0, left: 0 })
  }
}

const cells = (text) => [{ col: 0, row: 0, text, text_color: '#fff', text_size: 'normal' }]
const state = (...tables) => ({ lines: [], labels: [], boxes: [], fills: [], tables })

function mount(container, id, pane = null) {
  const frames = []
  const layer = createObjectLayer({
    instanceId: id, container, doc: document, insets: { top: 30 },
    raf: (cb) => { frames.push(cb); return frames.length }, cancel: () => {},
    mapping: () => ({ width: 800, height: 600, rightInset: 60, timeToX: () => 0, priceToY: () => 0, pane }),
  })
  return { layer, flush: () => frames.splice(0).forEach((f) => f()) }
}

const topOf = (container, text) => [...container.querySelectorAll('[data-uct-object-table]')]
  .find((el) => el.textContent.trim().startsWith(text)).style

afterEach(() => { document.body.innerHTML = '' })

describe('two indicators, one corner', () => {
  it('the first table keeps its place; the second starts below it (top) — across layers', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const one = mount(container, 'i1')
    const two = mount(container, 'i2')
    one.layer.set(state({ id: 1, position: 'top_right', cells: cells('a RSI') }), 's1')
    two.layer.set(state({ id: 1, position: 'top_right', cells: cells('b Calc') }), 's1')
    container.querySelectorAll('[data-uct-table-layer]').forEach(measure)
    restackTables(container)
    expect(topOf(container, 'a').top).toBe(`${TABLE_MARGIN}px`)
    expect(topOf(container, 'b').top).toBe(`${TABLE_MARGIN + H.a + TABLE_STACK_GAP}px`)
  })

  it('bottom corners stack upward; different corners are independent', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const one = mount(container, 'i1')
    const two = mount(container, 'i2')
    one.layer.set(state({ id: 1, position: 'bottom_left', cells: cells('a') },
      { id: 2, position: 'top_left', cells: cells('c') }), 's1')
    two.layer.set(state({ id: 1, position: 'bottom_left', cells: cells('b') }), 's1')
    container.querySelectorAll('[data-uct-table-layer]').forEach(measure)
    restackTables(container)
    expect(topOf(container, 'a').bottom).toBe(`${TABLE_MARGIN}px`)
    expect(topOf(container, 'b').bottom).toBe(`${TABLE_MARGIN + H.a + TABLE_STACK_GAP}px`)
    expect(topOf(container, 'c').top).toBe(`${TABLE_MARGIN}px`)
  })

  it('two tables of ONE program at one corner stack too', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const one = mount(container, 'i1')
    one.layer.set(state({ id: 1, position: 'top_left', cells: cells('a') },
      { id: 2, position: 'top_left', cells: cells('b') }), 's1')
    container.querySelectorAll('[data-uct-table-layer]').forEach(measure)
    restackTables(container)
    expect(topOf(container, 'b').top).toBe(`${TABLE_MARGIN + H.a + TABLE_STACK_GAP}px`)
  })

  it('removing the first indicator moves the second back to the corner', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const one = mount(container, 'i1')
    const two = mount(container, 'i2')
    one.layer.set(state({ id: 1, position: 'top_right', cells: cells('a') }), 's1')
    two.layer.set(state({ id: 1, position: 'top_right', cells: cells('b') }), 's1')
    container.querySelectorAll('[data-uct-table-layer]').forEach(measure)
    restackTables(container)
    one.layer.clear()
    expect(topOf(container, 'b').top).toBe(`${TABLE_MARGIN}px`)
  })

  it('a lone table is exactly where it always was', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    mount(container, 'i1').layer.set(state({ id: 1, position: 'middle_center', cells: cells('a') }), 's1')
    expect(topOf(container, 'a').top).toBe('50%')
  })
})

describe('a table stays in its indicator\'s pane', () => {
  it('the layer is inset to the reported pane; tables in different panes do not stack together', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const price = mount(container, 'p', { top: 0, height: 300 })
    const calc = mount(container, 'c', { top: 400, height: 150 })
    price.layer.set(state({ id: 1, position: 'bottom_left', cells: cells('a') }), 's1')
    calc.layer.set(state({ id: 1, position: 'bottom_left', cells: cells('b') }), 's1')
    price.flush(); calc.flush()
    const roots = [...container.querySelectorAll('[data-uct-table-layer]')]
    roots.forEach(measure)
    restackTables(container)
    const [pr, cr] = roots
    expect(pr.style.top).toBe('30px')            // the toolbar inset still applies in the top pane
    expect(pr.style.bottom).toBe('300px')        // 600 − (0 + 300)
    expect(cr.style.top).toBe('400px')
    expect(cr.style.bottom).toBe('50px')         // 600 − (400 + 150)
    // each is the only table at its pane's corner → both at the margin
    expect(topOf(container, 'a').bottom).toBe(`${TABLE_MARGIN}px`)
    expect(topOf(container, 'b').bottom).toBe(`${TABLE_MARGIN}px`)
  })

  it('no pane reported → the whole container, as before', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const h = mount(container, 'x')
    h.layer.set(state({ id: 1, position: 'top_right', cells: cells('a') }), 's1')
    h.flush()
    const root = container.querySelector('[data-uct-table-layer]')
    expect(root.style.top).toBe('30px')
    expect(root.style.bottom).toBe('0px')
  })
})
