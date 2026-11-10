// ⭐ RAILS (owner report 2026-11-09: the ring around a chart does not sit cleanly on it, and the ring on a resize corner LAGS a
// drag). Shared overlay geometry (guide/ringGeometry.js), for every walkthrough:
//   1. static alignment: the ring is the control's box plus RING.pad, clipped by every clipping ancestor on BOTH axes; a drag
//      handle gets a circle on its own centre
//   2. a moving control: the ring follows within one frame (a transform, no positional transition)
//   3. unmount: the ring hides and its frame loop stops
//   4. cancel: no frame is requested after the walkthrough ends
//   5. pointer-through: the ring never takes a press, so a highlighted handle stays draggable
// jsdom, measured boxes stubbed, frames driven by hand. LOCAL / SIMULATED (pl-auto measures the real browser).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RING, STILL_FRAMES, ringRect, visibleBox, isHandle, trackRing } from './guide/ringGeometry'
import { rectOf } from './guide/targets'
import { applyRing } from './guide/GuideOverlay'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import * as store from './guide/guideStore'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

// ── frames by hand: every requestAnimationFrame is queued, and `frame()` runs one ──
let queue
let rafCalls
const frame = () => { const q = queue; queue = []; q.forEach(([, fn]) => fn(0)) }
beforeEach(() => {
  queue = []
  rafCalls = 0
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (fn) => { rafCalls++; id++; queue.push([id, fn]); return id })
  vi.stubGlobal('cancelAnimationFrame', (n) => { queue = queue.filter(([i]) => i !== n) })
})
afterEach(() => { vi.unstubAllGlobals(); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()) })

const boxes = new Map()
const setBox = (el, b) => {
  const r = { top: b.top, left: b.left, width: b.width, height: b.height, right: b.left + b.width, bottom: b.top + b.height, x: b.left, y: b.top }
  boxes.set(el, r)
  el.getBoundingClientRect = () => (el.isConnected ? { ...boxes.get(el) } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  el.getClientRects = () => (el.isConnected ? [boxes.get(el)] : [])
}
const fixture = (html) => { const d = document.createElement('div'); d.setAttribute('data-fixture', ''); d.innerHTML = html; document.body.appendChild(d); return d }

describe('1 · static alignment, per target type', () => {
  it('a control: its own box plus RING.pad on every side', () => {
    const d = fixture('<button data-guide="chart.settings">gear</button>')
    const b = d.querySelector('button')
    setBox(b, { top: 50, left: 100, width: 24, height: 30 })
    // 24×30 is too tall for a handle, and it is not dragged
    expect(ringRect(b)).toEqual({ top: 50 - RING.pad, left: 100 - RING.pad, width: 24 + RING.pad * 2, height: 30 + RING.pad * 2, round: false })
  })

  it('a chart plot taller than its cell: clipped at the cell\'s bottom as well as its sides (both axes, every clipping ancestor)', () => {
    const d = fixture('<div data-widget-id="c" style="overflow:hidden"><div style="overflow-x:hidden"><div data-guide="chart.plot"></div></div></div>')
    const cell = d.querySelector('[data-widget-id]')
    const row = cell.firstElementChild
    const plot = d.querySelector('[data-guide="chart.plot"]')
    setBox(cell, { top: 100, left: 0, width: 600, height: 400 })
    setBox(row, { top: 100, left: 20, width: 560, height: 600 })
    setBox(plot, { top: 130, left: 10, width: 620, height: 450 })   // spills past the cell's bottom (580 > 500) and both sides
    expect(visibleBox(plot)).toEqual({ top: 130, left: 20, width: 560, height: 370 })
    expect(rectOf(plot)).toEqual({ top: 130 - RING.pad, left: 20 - RING.pad, width: 560 + RING.pad * 2, height: 370 + RING.pad * 2 })
  })

  it('a drag handle (a widget\'s resize corner): a circle centred on the handle\'s own centre', () => {
    const d = fixture('<div data-guide="widget.resize.se"></div>')
    const h = d.firstElementChild
    setBox(h, { top: 490, left: 590, width: 12, height: 12 })
    expect(isHandle(h)).toBe(true)
    const r = ringRect(h)
    expect(r.round).toBe(true)
    expect(r.left + r.width / 2).toBe(596)
    expect(r.top + r.height / 2).toBe(496)
    expect(r.width).toBe(12 + RING.handlePad * 2)
  })

  it('nothing of it shows (clipped away, or not laid out): no ring', () => {
    const d = fixture('<div style="overflow:hidden"><button data-guide="x">x</button></div>')
    setBox(d.firstElementChild, { top: 0, left: 0, width: 100, height: 20 })
    const b = d.querySelector('button')
    setBox(b, { top: 0, left: 200, width: 20, height: 20 })
    expect(ringRect(b)).toBeNull()
  })

  it('applyRing writes a transform and a size, never top/left, and a handle is round', () => {
    const n = document.createElement('div')
    applyRing(n, { top: 10, left: 20, width: 30, height: 40, round: false })
    expect(n.style.transform).toBe('translate3d(20px, 10px, 0)')
    expect(n.style.top).toBe('')
    expect(n.style.left).toBe('')
    expect(n.style.width).toBe('30px')
    expect(n.style.borderRadius).toBe(`${RING.radius}px`)
    expect(n.style.opacity).toBe('1')
    applyRing(n, { top: 0, left: 0, width: 24, height: 24, round: true })
    expect(n.style.borderRadius).toBe('50%')
    applyRing(n, null)
    expect(n.style.opacity).toBe('0')
  })
})

describe('2 · a moving control: the ring follows within one frame', () => {
  it('a resize corner dragged: each frame of the drag moves the ring with it, and the loop stops when the drag ends and it is still', () => {
    const d = fixture('<div data-widget-id="w"><div data-guide="widget.resize.se"></div></div>')
    const h = d.querySelector('[data-guide]')
    setBox(h, { top: 100, left: 100, width: 12, height: 12 })
    const seen = []
    const tr = trackRing(h, (r) => seen.push(r))
    expect(seen.at(-1).left + seen.at(-1).width / 2).toBe(106)
    // the member presses the handle and drags
    window.dispatchEvent(new Event('pointerdown'))
    for (let i = 1; i <= 5; i++) {
      setBox(h, { top: 100 + i * 7, left: 100 + i * 11, width: 12, height: 12 })
      window.dispatchEvent(new Event('pointermove'))
      frame()
      const r = seen.at(-1)
      expect(r.left + r.width / 2).toBe(106 + i * 11)   // the frame after the move, not 120 ms later
      expect(r.top + r.height / 2).toBe(106 + i * 7)
    }
    window.dispatchEvent(new Event('pointerup'))
    for (let i = 0; i < STILL_FRAMES + 2; i++) frame()
    expect(tr.running).toBe(false)                       // still: no more frames
    tr.stop()
  })

  it('a board reflow that moves the cell by its style (no resize, the loop gone still): the ring follows in the SAME frame, before any frame runs', async () => {
    const d = fixture('<div class="board"><div data-widget-id="c"><div data-guide="widget.resize.se"></div></div></div>')
    const cell = d.querySelector('[data-widget-id]')
    const h = d.querySelector('[data-guide]')
    setBox(h, { top: 100, left: 100, width: 12, height: 12 })
    const seen = []
    const tr = trackRing(h, (r) => seen.push(r), { holder: cell })
    for (let i = 0; i < STILL_FRAMES + 2; i++) frame()
    expect(tr.running).toBe(false)                         // still: no frames
    // the grid writes the cell's new position (a debounced reflow), and the handle with it
    setBox(h, { top: 100, left: 80, width: 12, height: 12 })
    cell.style.transform = 'translate(-20px, 0px)'
    await Promise.resolve()                                // the observer's microtask: no frame has run
    expect(seen.at(-1).left + seen.at(-1).width / 2).toBe(86)
    tr.stop()
  })

  it('a scroll or a window resize starts the loop again for a moment; a still control asks for no frames', () => {
    const d = fixture('<button data-guide="chart.settings">g</button>')
    const b = d.firstElementChild
    setBox(b, { top: 40, left: 40, width: 30, height: 30 })
    const tr = trackRing(b, () => {})
    for (let i = 0; i < STILL_FRAMES + 2; i++) frame()
    const before = rafCalls
    for (let i = 0; i < 5; i++) frame()
    expect(rafCalls).toBe(before)                         // idle: nothing scheduled
    window.dispatchEvent(new Event('scroll'))
    expect(tr.running).toBe(true)
    tr.stop()
  })
})

describe('3 · unmount: the ring hides and stops', () => {
  it('the control leaves the page: the ring is told null, and no frame follows', () => {
    const d = fixture('<button data-guide="chart.settings">g</button>')
    const b = d.firstElementChild
    setBox(b, { top: 40, left: 40, width: 30, height: 30 })
    const seen = []
    const tr = trackRing(b, (r) => seen.push(r))
    b.remove()
    window.dispatchEvent(new Event('resize'))
    frame()
    expect(seen.at(-1)).toBeNull()
    expect(tr.running).toBe(false)
    tr.stop()
  })
})

describe('4 · cancel: no frame is requested after the walkthrough ends (the real overlay)', () => {
  let p
  let restoreProto
  const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
  beforeEach(() => {
    p = setupPanel()
    store._resetGuide()
    const rects = Element.prototype.getClientRects
    const box = Element.prototype.getBoundingClientRect
    Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
    Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
    Element.prototype.scrollIntoView = function () {}
    restoreProto = () => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }
  })
  afterEach(() => { restoreProto(); store._resetGuide() })

  it('the ring sits on the control by transform, follows it, and Exit leaves no frame loop or ring behind', async () => {
    fixture(`
      <div data-widget-id="c" data-widget-type="chart">
        <div data-guide="chart.symbol">sym</div>
        <div data-guide="chart.timeframe"><button>D</button><button>W</button></div>
        <button data-guide="chart.timeframeMore" aria-label="More timeframes">v</button>
        <div data-guide="chart.plot"><canvas></canvas></div>
      </div>`)
    const { say } = p.mount(...ONE())
    await say('where do I change the timeframe?')
    await waitFor(() => expect(screen.queryByTestId('guide-ring')).toBeTruthy())
    const ring = screen.getByTestId('guide-ring')
    await waitFor(() => expect(ring.style.transform).toBe(`translate3d(${40 - RING.pad}px, ${40 - RING.pad}px, 0)`))
    expect(ring.style.top).toBe('')
    // the control moves (a panel opened beside it): one frame later the ring is on it
    BOX.left = 90; BOX.right = 210
    act(() => { window.dispatchEvent(new Event('resize')); frame() })
    expect(ring.style.transform).toBe(`translate3d(${90 - RING.pad}px, ${40 - RING.pad}px, 0)`)
    // Exit
    fireEvent.click(screen.getByLabelText('Exit the guide'))
    await waitFor(() => expect(screen.queryByTestId('guide-ring')).toBeNull())
    const before = rafCalls
    act(() => { window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('pointerdown')); frame(); frame() })
    expect(rafCalls).toBe(before)
    expect(queue).toHaveLength(0)
    BOX.left = 40; BOX.right = 160
  })
})

// ── pl-auto real-browser findings 2026-11-09, railed ──
describe('6–8 · a drag keeps its step alive; no poll while the control is gone; the chart is ringed as its cell (the real overlay)', () => {
  let p
  let restoreProto
  const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
  beforeEach(() => {
    p = setupPanel()
    store._resetGuide()
    const rects = Element.prototype.getClientRects
    const box = Element.prototype.getBoundingClientRect
    Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
    Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
    Element.prototype.scrollIntoView = function () {}
    restoreProto = () => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }
  })
  afterEach(() => { restoreProto(); store._resetGuide() })
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  const board = (extra = '') => fixture(`
    <div data-widget-id="c" data-widget-type="chart">
      <div data-guide="chart.symbol">sym</div>
      <div data-guide="chart.timeframe"><button>D</button></div>
      <div data-guide="chart.plot"><canvas></canvas></div>
      ${extra}
    </div>`)

  it('6 · a drag on a ringed resize edge or corner keeps its step until the drag ENDS, then the step is done', async () => {
    board('<div data-guide="widget.resize.e" style="cursor: ew-resize"></div><div data-guide="widget.resize.se" style="cursor: nwse-resize"></div>')
    const { say } = p.mount(...ONE())
    await say('how do I resize a widget')
    const text = () => screen.queryByTestId('guide-text')?.textContent || ''
    await waitFor(() => expect(text()).toMatch(/edge/))
    const press = (sel) => act(() => { document.querySelector(sel).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })) })
    const release = () => act(() => { window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })) })
    press('[data-guide="widget.resize.e"]')
    await act(() => wait(600))                                    // held well past the old 240 ms finish
    expect(text()).toMatch(/edge/)
    expect(screen.queryByTestId('guide-ring')).toBeTruthy()
    release()
    await waitFor(() => expect(text()).toMatch(/corner/))         // the drag ended: that step is done
    press('[data-guide="widget.resize.se"]')
    await act(() => wait(600))
    expect(screen.queryByTestId('guide-card')).toBeTruthy()       // the last step stays while its corner is held
    release()
    await waitFor(() => expect(screen.queryByTestId('guide-card')).toBeNull())
  })

  it('7 · the step\'s chart closes: the poll stops (no look until the page changes or a deadline is due), and it resumes when the chart is back', async () => {
    const root = board()
    const { say } = p.mount(...ONE())
    await say('how do I zoom in')
    await waitFor(() => expect(screen.queryByTestId('guide-ring')).toBeTruthy())
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const cell = root.querySelector('[data-widget-id]')
    act(() => { cell.remove() })
    act(() => { frame() })                                         // the page changed: one look, then nothing
    await act(() => wait(150))
    spy.mockClear()
    await act(() => wait(600))                                     // 5 old poll periods: no look at all now
    expect(spy).not.toHaveBeenCalled()
    // the chart back: the page change looks again at once, and the ring returns
    act(() => { root.appendChild(cell) })
    act(() => { frame() })
    await waitFor(() => expect(screen.queryByTestId('guide-ring')).toBeTruthy())
    spy.mockRestore()
  })

  it('8 · a step on the chart itself (chart.plot) rings the chart\'s whole cell, header and toolbar included', async () => {
    const root = board()
    const cell = root.querySelector('[data-widget-id]')
    const CELL = { top: 10, left: 20, width: 600, height: 400 }
    cell.getBoundingClientRect = () => ({ ...CELL, right: CELL.left + CELL.width, bottom: CELL.top + CELL.height, x: CELL.left, y: CELL.top })
    const { say } = p.mount(...ONE())
    await say('how do I zoom in')
    await waitFor(() => expect(screen.queryByTestId('guide-ring')).toBeTruthy())
    const ring = screen.getByTestId('guide-ring')
    await waitFor(() => expect(ring.style.transform).toBe(`translate3d(${CELL.left - RING.pad}px, ${CELL.top - RING.pad}px, 0)`))
    expect(ring.style.width).toBe(`${CELL.width + RING.pad * 2}px`)
    expect(ring.style.height).toBe(`${CELL.height + RING.pad * 2}px`)
  })
})

describe('5 · pointer-through: the ring never takes a press', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/agent/guide/GuideOverlay.module.css'), 'utf8')
  const ringBlock = /\.ring\s*\{([^}]*)\}/.exec(css)[1]
  it('the ring is pointer-events: none, with no positional transition (only its fade)', () => {
    expect(ringBlock).toMatch(/pointer-events:\s*none/)
    expect(ringBlock).not.toMatch(/transition:[^;]*\b(top|left|width|height|transform)\b/)
    expect(ringBlock).toMatch(/transition:\s*opacity/)
  })
  it('a press on a highlighted handle reaches the handle (the tracker only listens, passively)', () => {
    const d = fixture('<div data-guide="widget.resize.se"></div>')
    const h = d.firstElementChild
    setBox(h, { top: 100, left: 100, width: 12, height: 12 })
    const got = vi.fn()
    h.addEventListener('pointerdown', got)
    const tr = trackRing(h, () => {})
    const ev = new Event('pointerdown', { bubbles: true, cancelable: true })
    h.dispatchEvent(ev)
    expect(got).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(false)
    tr.stop()
  })
})
