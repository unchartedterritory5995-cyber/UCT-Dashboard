// RAILS: three walkthrough-gap families (2026-11-10), each a family rather than one sentence. LOCAL (jsdom).
//   1. a control in a menu a widget PORTALS to the page: `portaled` targets look outside the cell, never in another widget
//   2. a signal's own options: the walkthrough types a yes/no formula and chooses Signal in the sheet it opened, first
//   3. "which line / plot / series an alert watches" is an indicator's line (the alert form's Plot), never a drawn line
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { matchFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'
import { findTarget } from './guide/targets'
import { ALERT_LINE_ASK } from './guide/actions'
// the Signal step names the product's own label for the choice (a copy change there must move the walkthrough too)
import { INTENT_LABELS } from '../components/chart/builder/authoringIntent'

beforeAll(() => { registerBuiltins() })
afterEach(() => { document.body.innerHTML = '' })
const walk = (q) => { const f = matchFeature(q, null, 'charts'); return { id: f && f.id, steps: f ? guideSteps(f, q).steps : [] } }

describe('1 · portaled menus', () => {
  const board = () => {
    document.body.innerHTML = `
      <div data-widget-id="w-surge" data-widget-type="volumescan"><button data-guide="volumeScan.scope">Lists</button></div>
      <div data-widget-id="w-other" data-widget-type="watchlist"><button title="Delete list">x</button></div>
      <div role="menu" data-portal><button title="Delete list">bin</button></div>`
  }
  it('a portaled target finds the control in the menu on the page, outside every board cell', () => {
    board()
    const el = findTarget({ present: true, widgetType: 'volumescan', portaled: true, attr: 'title', value: 'Delete list' })
    expect(el?.textContent).toBe('bin')
  })
  it('without the flag the widget-scoped target finds nothing there (the old behaviour)', () => {
    board()
    expect(findTarget({ present: true, widgetType: 'volumescan', attr: 'title', value: 'Delete list' })).toBeNull()
  })
  it('never the same control inside ANOTHER widget, and nothing when the widget is not on the board', () => {
    board()
    document.querySelector('[data-portal]').remove()
    expect(findTarget({ present: true, widgetType: 'volumescan', portaled: true, attr: 'title', value: 'Delete list' })).toBeNull()
    document.body.innerHTML = '<div role="menu"><button title="Delete list">bin</button></div>'
    expect(findTarget({ present: true, widgetType: 'volumescan', portaled: true, attr: 'title', value: 'Delete list' })).toBeNull()
  })
  it.each([['how do I rename a Volume Surge list', 'Rename'], ['how do I delete one of my Volume Surge lists', 'Delete list'], ['how do I create, rename or delete a scope list', 'Delete list']])('"%s": the picker is opened, then the portaled %s', (q, title) => {
    const { steps } = walk(q)
    const n = steps.length
    expect(steps[n - 2].target).toEqual({ widgetType: 'volumescan', guide: 'volumeScan.scope' })
    expect(JSON.stringify(steps[n - 1].target)).toContain(`"portaled":true,"attr":"title","value":"${title}"`)
  })
})

describe('2 · a signal’s options come after its formula and Signal', () => {
  it.each(['show me how to put a green arrow under the bar when true', 'show me how to paint the candles gold when true', 'how do I put a dot above the bar when my formula is true', 'how do I shade the background when the formula is true'])('"%s"', (q) => {
    const { id, steps } = walk(q)
    expect(id).toBe('builderAction')
    const t = steps.map(s => JSON.stringify(s.target))
    const formula = t.indexOf('"builder.formula"')
    const signal = t.findIndex(x => x.includes(INTENT_LABELS.signal))
    expect(formula).toBeGreaterThan(-1)
    expect(signal).toBe(formula + 1)
    expect(steps[formula].text).toMatch(/such as close > open/)
    expect(steps[signal].waitFor).toBe('builder.signalLook')
    expect(t.at(-1)).toContain('builder.signalLook')
  })
})

describe('3 · which line an alert watches', () => {
  it.each(['how do I pick which line my alert watches', 'how do I choose which line an alert follows', 'how do I change which plot my alert uses', 'how do I set an alert on the MACD signal line'])('"%s" → the alert form’s Plot', (q) => {
    const { id, steps } = walk(q)
    expect(id).toBe('alertAction')
    expect(JSON.stringify(steps.at(-1).target)).toContain('"aria":"Plot"')
  })
  it.each(['how do I set an alert on my trend line', 'how do I put an alert on a drawing line', 'how do I make an alert follow my line'])('"%s" stays a drawn line', (q) => {
    expect(ALERT_LINE_ASK.test(q.toLowerCase())).toBe(false)
    expect(walk(q).id).toBe('drawingEdit')
  })
})
