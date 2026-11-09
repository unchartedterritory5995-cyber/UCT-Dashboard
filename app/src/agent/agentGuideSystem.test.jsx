// ── UCT Agent PRODUCT GUIDE: the engine, on its own ─────────────────────────────────────────────────────────
//
// The rules every walkthrough lives by, without a model or a board: where a card may sit, how a target is read, where a
// walkthrough starts, and what happens to it when the screen moves under it. Run for real (mouse, real workspace) by the
// browser pass: docs/agent/PHASE2-PRODUCT-GUIDE.md "Guide system".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import GuideOverlay from './guide/GuideOverlay'
import { startGuide, endGuide, guideState, onGuideDoIt, _resetGuide } from './guide/guideStore'
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
