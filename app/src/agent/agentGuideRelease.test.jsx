// ⭐ RAIL: a walkthrough to a control behind a release switch never says something false about the live UI (guide/releases.js).
// The switch is read through the widget's own accessor (widgets/captureRelease.js captureEnabled, per browser).
//   OFF → nothing is rung, no walkthrough starts, and the member is told it isn't available yet (never "Pick a scan first").
//   ON  → the walkthrough runs as designed, ending on the scan's own Send to Journal button.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideState, _resetGuide } from './guide/guideStore'
import { CAPTURE_FLAG_KEY, captureEnabled } from '../widgets/captureRelease'
import { releasedOnly, RELEASES } from './guide/releases'
import { stepsFor } from './guide/slots'
import { guideFeature } from './guide/registry'

beforeAll(() => { registerBuiltins() })
afterEach(() => { try { localStorage.removeItem(CAPTURE_FLAG_KEY) } catch { /* none */ } _resetGuide?.(); document.body.innerHTML = '' })

const ASKS = ['how do I send a scan to Journal', 'how do I send this scan to my journal', 'show me how to save the scan results to my journal']
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const host = { surface: 'charts', charts: { list: () => [], selected: () => null } }
const answer = (q) => { const g = route(q); return getCapability('guide.show').answer({}, g, host) }

describe('the scan’s Send to Journal follows the capture release switch', () => {
  it.each(ASKS)('routes to the scan Journal row: %s', (q) => {
    expect(route(q)?.feature).toBe('widgetAction')
    const steps = stepsFor(guideFeature('widgetAction'), q)
    expect(steps.at(-1).release).toBe('capture')
  })
  it.each(ASKS)('OFF (the default): said plainly, nothing rung: %s', (q) => {
    localStorage.setItem(CAPTURE_FLAG_KEY, '0')
    expect(captureEnabled()).toBe(false)
    const said = answer(q)
    expect(said).toBe(RELEASES.capture.off)
    expect(said).not.toMatch(/pick a scan/i)
    expect(guideState()).toBeNull()
  })
  it('OFF with no switch set at all: the release default (off) is honoured', () => {
    expect(captureEnabled()).toBe(false)
    expect(answer(ASKS[0])).toBe(RELEASES.capture.off)
    expect(guideState()).toBeNull()
  })
  it.each(ASKS)('ON: the walkthrough runs as designed: %s', (q) => {
    localStorage.setItem(CAPTURE_FLAG_KEY, '1')
    expect(captureEnabled()).toBe(true)
    const steps = stepsFor(guideFeature('widgetAction'), q)
    expect(releasedOnly(steps)).toBe(steps)
    expect(JSON.stringify(steps.at(-1).target)).toContain('Send this scan to Journal')
    // no board in this test: the walkthrough's own first-step check answers (the browser run proves the ring), never the off sentence
    expect(answer(q)).not.toBe(RELEASES.capture.off)
  })
  it('a walkthrough with no release step is untouched, and an accessor that throws counts as off', () => {
    const plain = [{ target: 'a' }, { target: 'b' }]
    expect(releasedOnly(plain)).toBe(plain)
    const was = RELEASES.capture.on
    RELEASES.capture.on = () => { throw new Error('storage blocked') }
    try { expect(releasedOnly([{ target: 'x', release: 'capture' }])).toBe(RELEASES.capture.off) } finally { RELEASES.capture.on = was }
  })
})

describe('a widget the capture switch keeps off the board (Indexes, Market Context) is never pointed at while it is off', () => {
  const ASK = ['how do I hide or restore an index', 'show me how to send index levels to journal', 'how do I add the indexes widget', 'how do I send the market context to my journal']
  it.each(ASK)('OFF: said plainly, nothing rung, never "I can’t see": %s', (q) => {
    localStorage.setItem(CAPTURE_FLAG_KEY, '0')
    const g = route(q)
    expect(g).toBeTruthy()
    const said = getCapability('guide.show').answer({}, g, host)
    expect(said).toMatch(/^The (Indexes|Market Context) widget isn’t available yet\./)
    expect(said).not.toMatch(/can’t see/)
    expect(guideState()).toBeNull()
  })
  it.each(ASK)('ON: the walkthrough is built as designed: %s', (q) => {
    localStorage.setItem(CAPTURE_FLAG_KEY, '1')
    const g = route(q)
    const steps = stepsFor(guideFeature(g.feature), g.detail || q)
    expect(releasedOnly(steps)).toBe(steps)
  })
  it('a walkthrough on a released widget is untouched while the switch is off', () => {
    localStorage.setItem(CAPTURE_FLAG_KEY, '0')
    const steps = [{ target: { widgetType: 'breadth', guide: 'widget.settings' } }]
    expect(releasedOnly(steps)).toBe(steps)
  })
})
