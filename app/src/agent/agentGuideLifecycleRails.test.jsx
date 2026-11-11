// ⭐ RAILS (AUDIT, teach-ship-2): the two lifecycle hooks this slice adds to shared code.
//   1. agent.guideEscapeBoard: a window-CAPTURE Escape observer. It never prevents or stops the key. While a selected drawing,
//      an armed tool, an open menu or dialog, or a focused field owns the press, Escape does NOT end the walkthrough and that
//      owner still acts (deselects, disarms, closes, clears). Plain Escape on the board ends it.
//   2. useAgent.send() → guideStore.endForNewRequest(): a new request ends a walkthrough on screen exactly once, leaves no
//      step, ring or card behind, and never ends the walkthrough the new request itself starts.
// The real AgentPanel and GuideOverlay (testing/panelHarness), with the scripted model: no model call. LOCAL / SIMULATED.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import * as store from './guide/guideStore'
import { SHORTCUTS } from '../pages/command/shortcutRegistry'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
// spy on the store's own endForNewRequest while every importer (useAgent, GuideOverlay) still gets the real one through it
vi.mock('./guide/guideStore', async (orig) => {
  const real = await orig()
  return { ...real, endForNewRequest: vi.fn(() => real.endForNewRequest()) }
})
registerBuiltins()

let p
let restore = []
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
beforeEach(() => {
  p = setupPanel()
  store._resetGuide()
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
  store.endForNewRequest.mockClear()
})
afterEach(() => { restore.forEach(f => f()); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); store._resetGuide() })

function controls() {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = `
    <button data-guide="workspace.widgets">Widgets ▾</button>
    <div data-widget-id="c" data-widget-type="chart">
      <div data-guide="chart.symbol">sym</div>
      <div data-guide="chart.timeframe"><button>D</button><button>W</button></div>
      <button data-guide="chart.timeframeMore" aria-label="More timeframes">v</button>
      <button data-guide="chart.settings" aria-label="Chart settings">gear</button>
      <div data-guide="chart.drawingTools"><button data-guide="chart.tool.trendline">t</button></div>
      <div data-guide="chart.plot"><canvas></canvas></div>
    </div>`
  document.body.appendChild(root)
  return root
}
const card = () => screen.queryByTestId('guide-card')
const ring = () => screen.queryByTestId('guide-ring')
const settled = () => new Promise(r => setTimeout(r, 60))
const start = async () => {
  const root = controls()
  const { say } = p.mount(...ONE())
  await say('where do I change the timeframe?')
  await waitFor(() => expect(card()).toBeTruthy())
  document.activeElement?.blur?.()
  return { root, say }
}
// a real Escape, its prevent/stop methods spied BEFORE anything hears it
const escape = (node = document.body) => {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  const spies = { prevent: vi.spyOn(ev, 'preventDefault'), stop: vi.spyOn(ev, 'stopPropagation'), stopNow: vi.spyOn(ev, 'stopImmediatePropagation') }
  act(() => { node.dispatchEvent(ev) })
  return spies
}
// the other owner of the press: a listener that acts on Escape the way the product's does (bubble phase, on the document)
const owner = (act) => { const fn = (e) => { if (e.key === 'Escape') act(e) }; document.addEventListener('keydown', fn); restore.push(() => document.removeEventListener('keydown', fn)); return fn }
const add = (html) => { const d = document.createElement('div'); d.setAttribute('data-fixture', ''); d.innerHTML = html; document.body.appendChild(d); return d.firstElementChild }

describe('1 · agent.guideEscapeBoard: window capture, never prevents or stops', () => {
  it('is declared on the window, in the capture phase, never in a field', () => {
    const d = SHORTCUTS.find(s => s.id === 'agent.guideEscapeBoard')
    expect(d).toBeTruthy()
    expect(d.target).toBe('window')
    expect(d.capture).toBe(true)
    expect(d.inEditable).toBe(false)
  })
  it('plain Escape on the board ends the walkthrough, and no handler prevented or stopped the key', async () => {
    await start()
    const s = escape()
    await waitFor(() => expect(card()).toBeNull())
    expect(ring()).toBeNull()
    expect(store.guideState()).toBeNull()
    expect(s.prevent).not.toHaveBeenCalled()
    expect(s.stop).not.toHaveBeenCalled()
    expect(s.stopNow).not.toHaveBeenCalled()
  }, 30000)
  it.each([
    ['a selected drawing (it deselects)', () => add('<div aria-label="Drawing actions">bar</div>'), (el) => el.remove(), (el) => !el.isConnected],
    ['an armed drawing tool (it disarms)', () => document.querySelector('[data-guide="chart.tool.trendline"]'), (el) => el.setAttribute('aria-pressed', 'false'), (el) => el.getAttribute('aria-pressed') === 'false', (el) => el.setAttribute('aria-pressed', 'true')],
    ['an open menu (it closes)', () => add('<div role="menu"><button>Reset view</button></div>'), (el) => el.remove(), (el) => !el.isConnected],
    ['an open dialog (it closes)', () => add('<div role="dialog" aria-modal="true"><button>OK</button></div>'), (el) => el.remove(), (el) => !el.isConnected],
  ])('%s: the walkthrough stays and the owner still acts, with the key never prevented or stopped', async (_what, make, onEsc, acted, arm) => {
    await start()
    const el = make()
    arm?.(el)
    owner(() => onEsc(el))
    const s = escape()
    await settled()
    expect(acted(el)).toBe(true)
    expect(card()).toBeTruthy()
    expect(store.guideState()).not.toBeNull()
    expect(s.prevent).not.toHaveBeenCalled()
    expect(s.stop).not.toHaveBeenCalled()
  }, 30000)
  it.each([['an input', '<input aria-label="Name" value="draft">'], ['a textarea', '<textarea aria-label="Note">draft</textarea>']])('focus in %s: the walkthrough stays and the field still acts (it clears)', async (_what, html) => {
    await start()
    const field = add(html)
    field.addEventListener('keydown', (e) => { if (e.key === 'Escape') field.value = '' })
    field.focus()
    const s = escape(field)
    await settled()
    expect(field.value).toBe('')
    expect(card()).toBeTruthy()
    expect(store.guideState()).not.toBeNull()
    expect(s.prevent).not.toHaveBeenCalled()
    expect(s.stop).not.toHaveBeenCalled()
  }, 30000)
})

describe('2 · send() → endForNewRequest: a new request ends the walkthrough once, and never the one it starts', () => {
  it('a command ends the walkthrough exactly once: no step, ring or card left', async () => {
    const { say } = await start()
    store.endForNewRequest.mockClear()
    await say('make this chart weekly')
    expect(store.endForNewRequest).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(card()).toBeNull())
    expect(ring()).toBeNull()
    expect(screen.queryByTestId('guide-text')).toBeNull()
    expect(store.guideState()).toBeNull()
  }, 30000)
  it('a new how-to ends the old walkthrough once and keeps the one it starts', async () => {
    const { say } = await start()
    const first = store.guideState()
    store.endForNewRequest.mockClear()
    await say('where do I open the chart settings?')
    expect(store.endForNewRequest).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(store.guideState()).not.toBeNull())
    expect(store.guideState()).not.toBe(first)
    expect(card()).toBeTruthy()
    await settled()
    expect(store.guideState()).not.toBeNull()
  }, 30000)
  it('with no walkthrough on screen it is called once and ends nothing', async () => {
    controls()
    const { say } = p.mount(...ONE())
    await say('make this chart weekly')
    expect(store.endForNewRequest).toHaveBeenCalledTimes(1)
    expect(store.guideState()).toBeNull()
  }, 30000)
})
