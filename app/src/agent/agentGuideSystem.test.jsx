// ── UCT Agent PRODUCT GUIDE: the engine, on its own ─────────────────────────────────────────────────────────
//
// The rules every walkthrough lives by, without a model or a board: where a card may sit, how a target is read, where a
// walkthrough starts, and what happens to it when the screen moves under it. Run for real (mouse, real workspace) by the
// browser pass: docs/agent/PHASE2-PRODUCT-GUIDE.md "Guide system".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import GuideOverlay from './guide/GuideOverlay'
import { startGuide, endGuide, guideState, onGuideDoIt, _resetGuide, endForNewRequest, escapeOnBoard } from './guide/guideStore'
import { placeCard, LOST_MS, LATE_MS, POLL_MS } from './guide/placement'
import { findTarget, startIndex, reachableAfter, earlierOnScreen, isDisabled, isOn, unclip, restoreClipped, exists } from './guide/targets'
import { stepsFor, titleFor, slotValues, readIndicator, readWidget, readSetting, settingRows } from './guide/slots'
import { GUIDE_FEATURES, guideFeature, matchFeature } from './guide/registry'

const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
let restore = []
beforeEach(() => {
  _resetGuide()
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

function dom(html) {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}
const F = { id: 't', title: 'T', control: 'that thing', doIt: { say: 'ok' } }
const text = () => screen.queryByTestId('guide-text')?.textContent || ''
const card = () => screen.queryByTestId('guide-card')
const notice = () => screen.queryByTestId('guide-notice')

describe('placeCard: the overlay never covers the needed control', () => {
  const hit = (c, r, h) => c.left < r.left + r.width && c.left + c.width > r.left && c.top < r.top + r.height && c.top + h > r.top
  it('anywhere on the screen, at any card height, in a normal window', () => {
    for (const vw of [1440, 1024]) for (const vh of [900, 700]) for (const cardH of [120, 190, 260]) {
      for (let top = 0; top < vh - 30; top += 37) for (let left = 0; left < vw - 40; left += 53) {
        const rect = { top, left, width: 40, height: 30 }
        const c = placeCard(rect, { vw, vh, cardH })
        expect(hit(c, rect, cardH), JSON.stringify({ vw, vh, cardH, rect, c })).toBe(false)
        expect(c.top).toBeGreaterThanOrEqual(0); expect(c.left).toBeGreaterThanOrEqual(0)
        expect(c.left + c.width).toBeLessThanOrEqual(vw); expect(c.top + cardH).toBeLessThanOrEqual(vh)
      }
    }
  })
  it('a tall control down the middle (a resize edge) gets the card beside it', () => {
    const rect = { top: 60, left: 380, width: 16, height: 800 }
    const c = placeCard(rect, { vw: 1440, vh: 900, cardH: 150 })
    expect(hit(c, rect, 150)).toBe(false)
  })
  it('it stays off the menu or window the control sits in when there is room', () => {
    const rect = { top: 300, left: 500, width: 40, height: 30 }
    const holder = { top: 120, left: 380, width: 680, height: 660 }
    const c = placeCard(rect, { vw: 1440, vh: 900, cardH: 150, avoid: [holder] })
    expect(hit(c, holder, 150)).toBe(false)
  })
  it('in a window too small for anything else it still stays off the control where that is possible', () => {
    const rect = { top: 10, left: 10, width: 60, height: 30 }
    const c = placeCard(rect, { vw: 340, vh: 320, cardH: 180 })
    expect(hit(c, rect, 180)).toBe(false)
  })
})

describe('targets', () => {
  it('reads state, instance, attribute, label, and a state gone', () => {
    dom(`<div data-guide="box">
      <button role="tab" aria-selected="false" data-guide="tab.a">A</button><button role="tab" aria-selected="true" data-guide="tab.b">B</button>
      <button data-row-primary="r1">EMA 20</button><button data-row-primary="r2" aria-current="true">RSI</button>
      <span>Grid</span></div>`)
    expect(findTarget({ id: 'tab.a', on: true })).toBeNull()
    expect(findTarget({ id: 'tab.b', on: true })).toBeTruthy()
    expect(findTarget({ within: 'box', attr: 'data-row-primary', text: 'rsi' }).getAttribute('data-row-primary')).toBe('r2')
    expect(findTarget({ within: 'box', attr: 'data-row-primary', text: 'ema', on: true })).toBeNull()
    expect(findTarget({ within: 'box', label: 'grid' }).tagName).toBe('SPAN')
    expect(findTarget({ not: { id: 'tab.a', on: true } })).toBeTruthy()
    expect(findTarget({ not: { id: 'tab.b', on: true } })).toBeNull()
  })
  it('isOn / isDisabled read the control itself', () => {
    const r = dom('<button id="a" disabled></button><button id="b" aria-disabled="true"></button><button id="c" data-guide-on="true"></button>')
    expect(isDisabled(r.querySelector('#a'))).toBe(true)
    expect(isDisabled(r.querySelector('#b'))).toBe(true)
    expect(isOn(r.querySelector('#c'))).toBe(true)
  })
  it('startIndex: the furthest step whose predecessor’s result is true; a result that is something ENDING proves nothing', () => {
    dom('<button data-guide="x"></button><button data-guide="y"></button><button data-guide="z"></button>')
    const steps = [{ target: 'x', waitFor: 'y' }, { target: 'y', waitFor: 'absent' }, { target: 'z' }]
    expect(startIndex(steps, {})).toBe(1)
    expect(startIndex([{ target: 'x', waitFor: 'y' }, { target: 'y', waitFor: 'z' }, { target: 'z' }], {})).toBe(2)
    expect(startIndex([{ target: 'x', waitFor: { not: { id: 'absent', on: true } } }, { target: 'y' }], {})).toBe(0)
  })
  it('reachableAfter / earlierOnScreen go to what is on screen, and to nothing that isn’t', () => {
    dom('<button data-guide="x"></button><button data-guide="z"></button>')
    const steps = [{ target: 'x' }, { target: 'missing' }, { target: 'z' }]
    expect(reachableAfter(steps, 0, {})).toBe(2)
    expect(reachableAfter(steps, 2, {})).toBeNull()
    expect(earlierOnScreen(steps, 2, {})).toBe(0)
  })
  it('a row squeezed to nothing: its neighbours step aside for the step, and come back', () => {
    const r = dom('<div id="row"><div id="strip" data-guide="chart.drawingTools"><button data-guide="tool"></button><button></button></div><div id="actions"></div></div>')
    const strip = r.querySelector('#strip')
    const actions = r.querySelector('#actions')
    const tool = strip.querySelector('button')
    const open = () => actions.style.display === 'none'
    strip.getClientRects = () => [{}]
    strip.getBoundingClientRect = () => ({ left: 0, right: open() ? 300 : 0, top: 0, bottom: 24, width: open() ? 300 : 0, height: 24 })
    tool.getClientRects = () => [{}]
    tool.getBoundingClientRect = () => (open() ? { left: 10, right: 34, top: 0, bottom: 24, width: 24, height: 24 } : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })
    expect(findTarget('tool')).toBeNull()
    expect(exists('tool', {})).toBe(true)
    expect(unclip('tool', {})).toBe(true)
    expect(findTarget('tool')).toBeTruthy()
    restoreClipped()
    expect(actions.style.display).toBe('')
  })
  it('unclip slides a clipping row to bring a control into view, and puts it back', () => {
    const r = dom('<div id="row"><button data-guide="gear"></button></div>')
    const row = r.querySelector('#row')
    const gear = row.querySelector('button')
    Object.defineProperty(row, 'scrollWidth', { value: 500 })
    Object.defineProperty(row, 'clientWidth', { value: 300 })
    row.style.overflowX = 'hidden'
    row.scrollLeft = 0
    row.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 30, width: 300, height: 30 })
    // past the row's right edge until the row slides
    gear.getBoundingClientRect = () => { const x = 400 - row.scrollLeft; return { left: x, right: x + 24, top: 0, bottom: 24, width: 24, height: 24 } }
    expect(findTarget('gear')).toBeNull()
    expect(unclip('gear', {})).toBe(true)
    expect(row.scrollLeft).toBeGreaterThan(0)
    expect(findTarget('gear')).toBeTruthy()
    restoreClipped()
    expect(row.scrollLeft).toBe(0)
    expect(findTarget('gear')).toBeNull()
  })
})

describe('families', () => {
  it('a family reads WHICH one from the words; a step for the other case is left out', () => {
    const f = guideFeature('drawing')
    const s = stepsFor(f, 'how do I draw a pitchfork')
    expect(s[0].target).toEqual(['chart.tool.pitchfork', 'chart.plot'])
    expect(s).toHaveLength(3)
    expect(titleFor(f, 'how do I draw a pitchfork')).toBe('Drawing a Pitchfork')
    expect(stepsFor(f, 'how do I use the drawing tools')[0].target).toEqual(['chart.drawingTools', 'chart.plot'])
    expect(titleFor(f, 'how do I use the drawing tools')).toBe('Basic drawing tools')
  })
  it('a slot with a default fills it, and no placeholder ever reaches the screen', () => {
    expect(slotValues(guideFeature('multiChart'), 'how do I set up multi chart').grid.id).toBe('2x2')
    for (const feature of GUIDE_FEATURES) {
      const words = ['', 'rsi trendline 3x3 news widget grid lines float period']
      for (const w of words) {
        for (const s of stepsFor(feature, w)) {
          const shown = [s.text, s.name, s.altText].filter(Boolean).join(' ')
          const named = (feature.slots || []).some(k => !slotValues(feature, w)[k])
          if (!named) expect(shown, `${feature.id}: ${shown}`).not.toMatch(/\{\w+\.\w+\}/)
        }
      }
    }
  })
  it('the longest indicator name wins, and an indicator’s own type is read as the member said it', () => {
    expect(readIndicator('how do I add stochastic rsi').name).toMatch(/Stochastic/)
    expect(readIndicator('the rsi').say).toBe('RSI')
    expect(readIndicator('change my ema').say).toBe('EMA')
    expect(readIndicator('how do I save a layout')).toBeNull()
  })
  it('widgets and settings come from the product’s own tables', () => {
    expect(readWidget('add options flow').id).toBe('optionsflow')
    expect(readSetting('hide the watermark').id).toMatch(/^watermark/)
    expect(settingRows().length).toBeGreaterThan(20)
  })
  it('routes nearby words to the right family', () => {
    expect(matchFeature('how do i draw an anchored vwap')?.id).toBe('drawing')
    expect(matchFeature('how do i add vwap')?.id).toBe('indicators')
    expect(matchFeature('how do i set a price alert')?.id).toBe('alertPrice')
    expect(matchFeature('how do i set an rsi alert')?.id).toBe('alertIndicator')
  })
})

describe('the overlay', () => {
  const go = (steps, opts = {}) => { render(<GuideOverlay />); act(() => { startGuide(F, { steps, ...opts }) }) }

  it('🔴 a last click that closes its own control finishes quietly: no false "can’t see" notice', async () => {
    const r = dom('<button data-guide="item">Chart</button>')
    go([{ target: 'item', text: 'Click it.' }])
    await waitFor(() => expect(text()).toBe('Click it.'))
    fireEvent.pointerDown(r.querySelector('button'))
    r.querySelector('button').remove()
    await waitFor(() => expect(card()).toBeNull())
    expect(notice()).toBeNull()
    expect(guideState()).toBeNull()
  })
  it('🔴 Skip on a step the next depends on stays put and says why: never the lost notice', async () => {
    dom('<button data-guide="open">Widgets</button>')
    go([{ target: 'open', text: 'Open it.', waitFor: 'menu' }, { target: 'item', text: 'Click it.' }])
    await waitFor(() => expect(text()).toBe('Open it.'))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(text()).toMatch(/comes first/))
    await new Promise(res => setTimeout(res, LOST_MS / 2))
    expect(card()).toBeTruthy()
    expect(notice()).toBeNull()
  })
  it('a greyed-out control says why', async () => {
    dom('<button data-guide="eye" disabled></button>')
    go([{ target: 'eye', text: 'Click it.', off: 'It needs a drawing first.' }])
    await waitFor(() => expect(text()).toBe('It needs a drawing first.'))
  })
  it('skips a step whose result is already true, while running too', async () => {
    const r = dom('<button data-guide="a"></button><button role="tab" aria-selected="false" data-guide="tab"></button><button data-guide="c"></button>')
    go([{ target: 'a', text: 'A', nextLabel: 'Go' }, { target: 'tab', text: 'Tab', waitFor: { id: 'tab', on: true } }, { target: 'c', text: 'C' }])
    await waitFor(() => expect(text()).toBe('A'))
    r.querySelector('[data-guide="tab"]').setAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(text()).toBe('C'))
  })
  it('a `late` step that does not apply is passed in a moment, and one that does is shown', async () => {
    const r = dom('<button data-guide="a"></button>')
    go([{ target: 'a', text: 'A', nextLabel: 'Go' }, { target: 'place', text: 'Place', optional: true, late: true }, { target: 'a', text: 'End' }])
    await waitFor(() => expect(text()).toBe('A'))
    act(() => { guideState() })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(text()).toBe('End'))
    expect(r).toBeTruthy()
    expect(LATE_MS).toBeLessThan(LOST_MS)
  })
  it('Restart goes back to where the member stands now, not always to step one', async () => {
    dom('<button data-guide="a"></button><button data-guide="b"></button><button data-guide="c"></button>')
    go([{ target: 'a', text: 'A', waitFor: 'b' }, { target: 'b', text: 'B', nextLabel: 'Go' }, { target: 'c', text: 'C' }], { index: 1 })
    await waitFor(() => expect(text()).toBe('B'))
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(text()).toBe('C'))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(text()).toBe('B'))
  })
  it('the steps before the start stay in the count', async () => {
    dom('<button data-guide="a"></button><button data-guide="b"></button>')
    go([{ target: 'a', text: 'A', waitFor: 'b' }, { target: 'b', text: 'B' }], { index: 1 })
    await waitFor(() => expect(card().textContent).toMatch(/2 of 2/))
  })
  it('a step’s fallback target says so', async () => {
    dom('<button data-guide="plot"></button>')
    go([{ target: ['tool', 'plot'], text: 'Click the tool.', altText: 'Too narrow.' }])
    await waitFor(() => expect(text()).toBe('Too narrow.'))
  })
  it('Do it for me while the Agent is busy says so on the card, and a later press goes through', async () => {
    let busy = true
    const did = vi.fn(() => { if (busy) return false; return true })
    dom('<button data-guide="a"></button>')
    onGuideDoIt(did)
    go([{ target: 'a', text: 'A' }])
    await waitFor(() => expect(text()).toBe('A'))
    fireEvent.click(screen.getByRole('button', { name: 'Do it for me' }))
    expect(did).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(text()).toBe('I’m still working on your last request. Press Do it for me again when I’ve finished.'))
    busy = false
    fireEvent.click(screen.getByRole('button', { name: 'Do it for me' }))
    expect(did).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(text()).toBe('A'))
  })
  it('Do it for me asks the panel, and the card stays out of the way of its own listeners', async () => {
    dom('<button data-guide="a"></button>')
    const did = vi.fn()
    onGuideDoIt(did)
    go([{ target: 'a', text: 'A' }])
    await waitFor(() => expect(text()).toBe('A'))
    const outside = vi.fn()
    document.addEventListener('mousedown', outside)
    fireEvent.mouseDown(card())
    document.removeEventListener('mousedown', outside)
    expect(outside).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Do it for me' }))
    expect(did).toHaveBeenCalledTimes(1)
  })
  it('it stays live over a modal that makes the page behind it inert', async () => {
    dom('<button data-guide="a"></button>')
    go([{ target: 'a', text: 'A' }])
    await waitFor(() => expect(card()).toBeTruthy())
    expect(Number(card().getAttribute('data-sheet-keep-live'))).toBeGreaterThan(9000)
  })
  it('polls no faster than it needs, and every timer stops with it', async () => {
    expect(POLL_MS).toBeGreaterThanOrEqual(100)
    dom('<button data-guide="a"></button>')
    go([{ target: 'a', text: 'A' }])
    act(() => { endGuide('exit') })
    expect(card()).toBeNull()
  })
})

// pl-auto howto-10: a step with no result to wait for, whose control STAYS after the member presses it (a menu that does not
// close), must not leave its ring and card up over a thing already done
describe('a pressed control finishes its step, even when it stays on screen', () => {
  it('a middle step moves on, and the last step ends the walkthrough: no ring is left behind', async () => {
    dom('<button data-guide="a">A</button><button data-guide="b">B</button><input data-guide="c" />')
    render(<GuideOverlay />)
    act(() => { startGuide(F, { steps: [{ target: 'a', text: 'Click A.' }, { target: 'c', text: 'Type here.' }, { target: 'b', text: 'Click B.' }] }) })
    await waitFor(() => expect(text()).toBe('Click A.'))
    fireEvent.pointerDown(document.querySelector('[data-guide="a"]'), { button: 0 })
    await waitFor(() => expect(text()).toBe('Type here.'))
    // a click into a field is the start of typing, not the step done
    fireEvent.pointerDown(document.querySelector('[data-guide="c"]'), { button: 0 })
    await new Promise(r => setTimeout(r, POLL_MS * 4))
    expect(text()).toBe('Type here.')
    act(() => { guideState() && fireEvent.click(screen.getByText('Next')) })
    await waitFor(() => expect(text()).toBe('Click B.'))
    fireEvent.pointerDown(document.querySelector('[data-guide="b"]'), { button: 0 })
    await waitFor(() => expect(card()).toBeNull())
    expect(screen.queryByTestId('guide-ring')).toBeNull()
    expect(guideState()).toBeNull()
  })
  it('a right-click on the control does not count as the click the step asked for', async () => {
    dom('<button data-guide="a">A</button>')
    render(<GuideOverlay />)
    act(() => { startGuide(F, { steps: [{ target: 'a', text: 'Click A.' }, { target: 'a', text: 'Again.' }] }) })
    await waitFor(() => expect(text()).toBe('Click A.'))
    fireEvent.pointerDown(document.querySelector('[data-guide="a"]'), { button: 2 })
    await new Promise(r => setTimeout(r, POLL_MS * 4))
    expect(text()).toBe('Click A.')
  })
})

// round 4 (Layouts ▾ → Multi Chart): a card placed under the member's pointer closes a hover menu (its onMouseLeave fires as
// the pointer is suddenly over the card). The card never lands under the pointer — with a control found, or still looking
describe('the card is never placed under the pointer', () => {
  const hit = (c, p, h) => c.left < p.left + p.width && c.left + c.width > p.left && c.top < p.top + p.height && c.top + h > p.top
  it('while still looking for the control (no rect): a corner away from the pointer', () => {
    const pointer = { top: 76, left: 220, width: 32, height: 32 }
    const c = placeCard(null, { vw: 1600, vh: 950, cardH: 120, pointer })
    expect(hit(c, pointer, 120)).toBe(false)
  })
  it('beside a control, never over the pointer either', () => {
    for (let x = 40; x < 1500; x += 97) for (let y = 40; y < 900; y += 83) {
      const pointer = { top: y - 16, left: x - 16, width: 32, height: 32 }
      const rect = { top: 300, left: 500, width: 120, height: 30 }
      const c = placeCard(rect, { vw: 1600, vh: 950, cardH: 140, pointer })
      expect(hit(c, pointer, 140), JSON.stringify({ x, y, c })).toBe(false)
    }
  })
})

// pl-auto tutorial batch, 2026-11-07 (BROWSER-MOCK): the walkthrough's chart, its own window, Escape on the board, a new request
describe('a walkthrough stays on ITS chart and ends when it should', () => {
  const two = () => dom(`
    <div data-widget-id="a"><button data-guide="chart.timeframe">A tf</button><button data-guide="chart.settings">A gear</button></div>
    <div data-widget-id="b"><button data-guide="chart.timeframe">B tf</button><button data-guide="chart.settings">B gear</button></div>`)
  it('P1 its chart closed: nothing on another chart stands in for it (it pauses, saying so)', async () => {
    const root = two()
    render(<GuideOverlay />)
    act(() => { startGuide(F, { chartRef: 'a', steps: [{ target: 'chart.timeframe', text: 'These buttons switch this chart’s timeframe.' }] }) })
    await waitFor(() => expect(text()).toMatch(/These buttons/))
    act(() => { root.querySelector('[data-widget-id="a"]').remove() })
    expect(findTarget('chart.timeframe', { chartRef: 'a' })).toBeNull()
    await waitFor(() => expect(text()).toMatch(/Looking for it|can’t see/), { timeout: LOST_MS + 2000 })
    expect(text()).not.toMatch(/These buttons/)
  }, 15000)
  it('P2 another chart opening its settings window does not advance this chart’s step; its own gear does', async () => {
    const root = two()
    render(<GuideOverlay />)
    act(() => { startGuide(F, { chartRef: 'a', steps: [{ target: 'chart.settings', text: 'Open the gear.', waitFor: 'chartSettings' }, { target: 'chart.timeframe', text: 'Step two.' }] }) })
    await waitFor(() => expect(text()).toBe('Open the gear.'))
    // a settings window opens that this step's own gear did not open (B's, from its keyboard shortcut: portalled, so nothing
    // ties it to a chart). (Pressing B itself now ends the walkthrough: the owner's rule, tested below.)
    const win = document.createElement('div'); win.setAttribute('data-guide', 'chartSettings'); win.setAttribute('data-fixture', ''); document.body.appendChild(win)
    await new Promise(r => setTimeout(r, POLL_MS * 4))
    expect(text()).toBe('Open the gear.')
    // its own gear
    win.remove()
    fireEvent.pointerDown(root.querySelector('[data-widget-id="a"] [data-guide="chart.settings"]'), { button: 0 })
    const win2 = document.createElement('div'); win2.setAttribute('data-guide', 'chartSettings'); win2.setAttribute('data-fixture', ''); document.body.appendChild(win2)
    await waitFor(() => expect(text()).toBe('Step two.'))
  }, 15000)
  it('P2 a new request sent with the Agent’s Send button ends the walkthrough', async () => {
    dom('<button data-guide="a">A</button><textarea aria-label="Message UCT Agent"></textarea><button aria-label="Send">Send</button>')
    render(<GuideOverlay />)
    act(() => { startGuide(F, { steps: [{ target: 'a', text: 'Click A.', waitFor: 'nothing-here' }] }) })
    await waitFor(() => expect(text()).toBe('Click A.'))
    document.querySelector('[aria-label="Message UCT Agent"]').value = 'make this chart weekly'
    fireEvent.pointerDown(document.querySelector('[aria-label="Send"]'), { button: 0 })
    await waitFor(() => expect(card()).toBeNull())
  }, 15000)
  it('endForNewRequest ends a running walkthrough, and is a no-op with none', () => {
    startGuide(F, { steps: [{ target: 'a', text: 'x' }] })
    endForNewRequest()
    expect(guideState()).toBeNull()
    expect(() => endForNewRequest()).not.toThrow()
  })
  it('escapeOnBoard: ends the walkthrough unless a field, a menu, a dialog, an armed tool or a selected drawing had the press', () => {
    const own = (html) => { const r = dom(html); startGuide(F, { steps: [{ target: 'a', text: 'x' }] }); const said = escapeOnBoard(); r.remove(); _resetGuide(); return said }
    expect(own('<div></div>')).toBe(true)
    expect(own('<div role="menu"></div>')).toBe(false)
    expect(own('<div role="dialog" aria-modal="true"></div>')).toBe(false)
    expect(own('<button data-guide="chart.tool.trendline" aria-pressed="true"></button>')).toBe(false)
    expect(own('<div aria-label="Drawing actions"></div>')).toBe(false)
  })
})

// OWNER DECISION 2026-11-07: pressing ANOTHER chart ends a walkthrough on a chart, cleanly, and never restarts it there.
// Its own chart, the card, a portalled menu and a widget that is not a chart (a watchlist) do not end it.
describe('pressing another chart ends the walkthrough', () => {
  const board = () => dom(`
    <div data-widget-id="a" data-widget-type="chart"><button data-guide="chart.timeframe">A tf</button><canvas></canvas></div>
    <div data-widget-id="b" data-widget-type="chart"><button data-guide="chart.timeframe">B tf</button><canvas></canvas></div>
    <div data-widget-id="g1" data-grid-cell-id="g1"><canvas></canvas></div>
    <div data-widget-id="w" data-widget-type="watchlist"><span data-watch-sym="NVDA">NVDA</span></div>
    <div data-guide="chart.contextMenu"><button>Reset view</button></div>`)
  const start = async () => {
    render(<GuideOverlay />)
    act(() => { startGuide(F, { chartRef: 'a', steps: [{ target: 'chart.timeframe', text: 'These buttons.' }, { target: 'chart.timeframe', text: 'Again.' }] }) })
    await waitFor(() => expect(text()).toBe('These buttons.'))
  }
  it('another board chart: ended, ring and card gone, no notice, nothing restarted on the chart pressed', async () => {
    const root = board(); await start()
    fireEvent.pointerDown(root.querySelector('[data-widget-id="b"] canvas'), { button: 0 })
    await waitFor(() => expect(card()).toBeNull())
    expect(screen.queryByTestId('guide-ring')).toBeNull()
    expect(notice()).toBeNull()
    expect(guideState()).toBeNull()
  })
  it('another Multi Chart cell ends it too', async () => {
    const root = board(); await start()
    fireEvent.pointerDown(root.querySelector('[data-grid-cell-id="g1"] canvas'), { button: 0 })
    await waitFor(() => expect(guideState()).toBeNull())
  })
  it.each([
    ['its own chart', '[data-widget-id="a"] canvas'],
    ['a watchlist row (it changes what a linked chart shows, not which chart the walkthrough is on)', '[data-watch-sym="NVDA"]'],
    ['a menu outside any board cell', '[data-guide="chart.contextMenu"] button'],
  ])('a press on %s does not end it', async (_what, sel) => {
    const root = board(); await start()
    fireEvent.pointerDown(root.querySelector(sel), { button: 0 })
    await new Promise(r => setTimeout(r, POLL_MS * 3))
    expect(guideState()).not.toBeNull()
  })
  it('a board-level walkthrough (no chart) is not ended by pressing a chart', async () => {
    const root = board()
    render(<GuideOverlay />)
    act(() => { startGuide(F, { steps: [{ target: 'chart.timeframe', text: 'Board step.' }] }) })
    fireEvent.pointerDown(root.querySelector('[data-widget-id="b"] canvas'), { button: 0 })
    await new Promise(r => setTimeout(r, POLL_MS * 3))
    expect(guideState()).not.toBeNull()
  })
})

// OWNER RULE (2026-11-07, pl-auto watchlist-row-loads): the walkthrough chart's symbol changed from outside its own steps (a
// linked watchlist row loaded into it): the walkthrough ends cleanly. Read from the chart's own label, not the click.
describe('the walkthrough chart loads another symbol from outside', () => {
  const chartCell = () => dom('<div data-widget-id="a" data-widget-type="chart"><span data-testid="sym-label">SPY</span><button data-guide="chart.timeframe">tf</button></div>')
  it('ends it: ring and card gone, no notice, no restart', async () => {
    const root = chartCell()
    render(<GuideOverlay />)
    act(() => { startGuide(F, { chartRef: 'a', steps: [{ target: 'chart.timeframe', text: 'These buttons.' }, { target: 'chart.timeframe', text: 'Again.' }] }) })
    await waitFor(() => expect(text()).toBe('These buttons.'))
    act(() => { root.querySelector('[data-testid="sym-label"]').textContent = 'NVDA' })
    await waitFor(() => expect(card()).toBeNull())
    expect(notice()).toBeNull()
    expect(guideState()).toBeNull()
  })
  it('a walkthrough whose own steps change the symbol (the symbol search) carries on', async () => {
    const root = chartCell()
    render(<GuideOverlay />)
    act(() => { startGuide({ ...F, id: 'symbol' }, { chartRef: 'a', steps: [{ target: 'chart.timeframe', text: 'Type a ticker.' }] }) })
    await waitFor(() => expect(text()).toBe('Type a ticker.'))
    act(() => { root.querySelector('[data-testid="sym-label"]').textContent = 'NVDA' })
    await new Promise(r => setTimeout(r, POLL_MS * 4))
    expect(guideState()).not.toBeNull()
  })
})

// pl-auto tut9 (SIX, 3×2): a walkthrough on the top-left chart, then a press on the bottom-middle chart, ends it cleanly
describe('pressing another chart on a six-chart board ends the walkthrough', () => {
  const SIX = ['tl', 'tm', 'tr', 'bl', 'bm', 'br']
  const board = () => dom(SIX.map(id => `<div data-widget-id="${id}" data-widget-type="chart"><button data-guide="chart.timeframe">${id} tf</button><canvas></canvas></div>`).join(''))
  it.each(SIX.filter(id => id !== 'tl'))('a press on %s ends it: ring and card gone, no notice, nothing restarted', async (id) => {
    const root = board()
    render(<GuideOverlay />)
    act(() => { startGuide(F, { chartRef: 'tl', steps: [{ target: 'chart.timeframe', text: 'These buttons.' }, { target: 'chart.timeframe', text: 'Again.' }] }) })
    await waitFor(() => expect(text()).toBe('These buttons.'))
    fireEvent.pointerDown(root.querySelector(`[data-widget-id="${id}"] canvas`), { button: 0 })
    await waitFor(() => expect(card()).toBeNull())
    expect(screen.queryByTestId('guide-ring')).toBeNull()
    expect(notice()).toBeNull()
    expect(guideState()).toBeNull()
  })
  it('a press on its own chart (top-left) does not end it', async () => {
    const root = board()
    render(<GuideOverlay />)
    act(() => { startGuide(F, { chartRef: 'tl', steps: [{ target: 'chart.timeframe', text: 'These buttons.' }] }) })
    await waitFor(() => expect(text()).toBe('These buttons.'))
    fireEvent.pointerDown(root.querySelector('[data-widget-id="tl"] canvas'), { button: 0 })
    await new Promise(r => setTimeout(r, POLL_MS * 3))
    expect(guideState()).not.toBeNull()
  })
})
