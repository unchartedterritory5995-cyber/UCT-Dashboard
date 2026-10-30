// UCT Agent PHASE 3 — WORKSTREAM 3, PRODUCT GUIDE EXPANSION. Through the REAL panel (AgentPanel + useAgent + registry,
// planner, runtime, receipts and Undo) over a fixture board, with the board's controls present in the document as the
// product renders them — each `data-guide` below is on a real control (agentGuideTargets.test.js rails the source).
// jsdom lays nothing out, so each control is given a box. The model is a stand-in none of these turns reaches.
//
//   new walkthroughs   link colours (the widget header's dot), hiding drawings (the drawing toolbar's eye), the chart's
//                      Canvas settings tab, the layout library's own menu
//   do it for me       the link colour through the existing widget.setLink — asked, receipted, undoable
//   explain            a chart setting from the product's descriptor table; "these settings" from the OPEN tab
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { _resetGuide } from './guide/guideStore'
import { explainTopic, settingRow } from './guide/explain'
import { matchFeature, GUIDE_FEATURES } from './guide/registry'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
let restore = []
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
beforeEach(() => {
  p = setupPanel()
  _resetGuide()
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); vi.restoreAllMocks(); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

/** The controls as the product renders them (WidgetHeader's link dot, ChartToolbar's eye, LayoutDock's library). */
function controls({ settingsOpen = null, library = false } = {}) {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = `
    <div data-guide="workspace.layouts" role="toolbar" aria-label="Saved layouts"><button data-guide="workspace.layoutLibrary" aria-label="Layout library">+</button></div>
    ${library ? '<div role="menu" aria-label="Layout library" data-guide="workspace.layoutLibraryMenu"><button role="menuitem">＋ New layout</button></div>' : ''}
    <div data-widget-id="c" data-widget-type="chart">
      <button data-guide="widget.link" aria-label="Color group N (click to cycle)"></button>
      <button data-guide="chart.settings" aria-label="Chart settings">gear</button>
      <div data-guide="chart.drawingTools"><button data-guide="chart.tool.horizontal">h</button></div>
      <button data-guide="chart.drawingsHide" aria-label="Hide all drawings">eye</button>
    </div>
    ${settingsOpen ? `<div data-guide="chartSettings" role="dialog">
      ${['price', 'canvas', 'indicators', 'header', 'markers'].map(id => `<button role="tab" aria-selected="${id === settingsOpen}" data-guide="chartSettings.tab.${id}">${{ price: 'Price Style', canvas: 'Canvas', indicators: 'Indicators', header: 'Header', markers: 'Markers' }[id]}</button>`).join('')}
    </div>` : ''}`
  document.body.appendChild(root)
  return root
}
const cardText = () => screen.queryByTestId('guide-text')?.textContent || ''
const boardJson = (board) => JSON.stringify(board.state.widgets)

describe('Show me — the new walkthroughs point at one real control each and change nothing', () => {
  it.each([
    ['how do I link my charts?', /This dot is the chart’s link colour/],
    ['how do i hide my drawings', /This eye hides all the drawings on this chart/],
    ['where do I change the chart background?', /Open this chart’s settings with the gear/],
  ])('"%s"', async (q, card) => {
    controls()
    const { board, say } = p.mount(...ONE())
    const before = boardJson(board)
    const out = await say(q)
    expect(out).toMatch(/I’ve highlighted it — follow the card .* Nothing on your board has changed\./)
    await waitFor(() => expect(cardText()).toMatch(card))
    expect(screen.getByTestId('guide-ring')).toBeTruthy()
    expect(boardJson(board)).toBe(before)
    expect(p.turns()).toBe(0)
  }, 30000)

  it('the Canvas walkthrough starts at the Canvas tab when Chart Settings is already open', async () => {
    controls({ settingsOpen: 'price' })
    const { say } = p.mount(...ONE())
    const out = await say('show me where the grid lines setting is')
    expect(out).toMatch(/already part of the way there/)
    await waitFor(() => expect(cardText()).toMatch(/Open Canvas — the background, grid, crosshair/))
  }, 30000)

  it('the layouts walkthrough reaches the library\'s own menu (and says where save / rename / duplicate are)', () => {
    const f = GUIDE_FEATURES.find(x => x.id === 'layouts')
    expect(f.steps.map(s => s.target)).toEqual(['workspace.layouts', 'workspace.layoutLibrary', 'workspace.layoutLibraryMenu'])
    expect(f.steps[2].text).toMatch(/To save, rename or duplicate a layout, open its own menu on the bar/)
  })

  it('more specific features win over the general ones whose words they share', () => {
    expect(matchFeature('how do I link my charts')?.id).toBe('link')
    expect(matchFeature('how do i hide my drawings')?.id).toBe('hideDrawings')
    expect(matchFeature('where is the crosshair setting')?.id).toBe('canvas')
    expect(matchFeature('how do i draw a trendline')?.id).toBe('drawing')
    expect(matchFeature('where are the chart settings')?.id).toBe('settings')
    expect(matchFeature('how do i change the symbol')?.id).toBe('symbol')
  })
})

describe('Do it for me — the link colour through widget.setLink (asked, receipted, undoable)', () => {
  it('"how do I link my charts?" → "do it for me" → which colour? → Blue: the chart\'s link colour is set; Undo puts it back', async () => {
    controls()
    const { board, say, click } = p.mount(...ONE())
    await say('how do I link my charts?')
    const q = await say('do it for me')
    expect(q).toMatch(/Which link colour\? \(on Chart \(QQQ\)\)/)
    await click('Blue')
    await waitFor(() => expect(board.state.widgets[0].color).toBe('B'))
    await say('undo')
    await waitFor(() => expect(board.state.widgets[0].color).toBe('N'))
    expect(p.turns()).toBe(0)
  }, 40000)

  it('hiding drawings says what to ask for — nothing runs on a guess', async () => {
    controls()
    const { board, say } = p.mount(...ONE())
    await say('how do i hide my drawings')
    const before = boardJson(board)
    const out = await say('do it for me')
    expect(out).toMatch(/say “hide all my drawings”/)
    expect(boardJson(board)).toBe(before)
  }, 30000)
})

describe('Explain — chart settings from the product\'s descriptor table (never invented)', () => {
  it('one setting by name: where it is, its values, its prerequisite, and whether I can change it', () => {
    const t = explainTopic('the bar-close countdown')
    expect(t.text).toBe('Bar-close countdown — Chart Settings → Markers → Countdown (intraday). It is on or off. I can change it for you — just say the new value.')
    const thin = explainTopic('thin bars setting')
    expect(thin.text).toMatch(/^Thin bars — Chart Settings → Price Style → Bar thickness \(Bars \/ HLC only\)\. It is on or off\. Bar thickness only applies to Bars and HLC charts/)
    expect(settingRow('magnet')?.id).toBe('crosshair.magnet')
  })

  it('"what does this setting do?" with no settings open asks which, in one sentence', () => {
    expect(explainTopic('this setting').text).toMatch(/^Open the chart’s settings \(the gear on its header\) and ask me again on the tab you’re looking at/)
  })

  it('"explain these settings" with Chart Settings open on Canvas: that tab\'s own rows, grouped where they sit', () => {
    controls({ settingsOpen: 'canvas' })
    const t = explainTopic('these settings')
    expect(t.title).toBe('Chart Settings → Canvas')
    expect(t.text).toMatch(/^The Canvas tab: /)
    expect(t.text).toMatch(/Grid: Grid lines, Grid color/)
    expect(t.text).toMatch(/Crosshair/)
    expect(t.text).not.toMatch(/Countdown|Swing labels/)                    // another tab's rows are never listed
  })

  it('…on the Indicators tab it points at the indicators themselves (Indicators\' own settings, not a table here)', () => {
    controls({ settingsOpen: 'indicators' })
    expect(explainTopic('these options').text).toMatch(/^The Indicators tab lists the indicators on this chart/)
  })

  it('through the panel: "What does the bar-close countdown do?" — instant, and nothing changes', async () => {
    const { board, say } = p.mount(...ONE())
    const before = boardJson(board)
    const out = await say('What does the bar-close countdown do?')
    expect(out).toMatch(/Bar-close countdown — Chart Settings → Markers → Countdown \(intraday\)/)
    expect(boardJson(board)).toBe(before)
    expect(p.turns()).toBe(0)
  }, 30000)

  it('a word the table does not describe is not explained here (it stays the model\'s)', () => {
    expect(explainTopic('the flux capacitor setting')).toBeNull()
  })
})
