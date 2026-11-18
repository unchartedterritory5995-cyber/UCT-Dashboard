// STRUCTURAL anchor rule, the NEGATIVE side (AUDIT condition on #988; S2-B / probe-6 class): a relation word that belongs to a
// NON-chart noun (a drawn line, a level, an MA, a price, an alert) in the same sentence never withholds the click: "make this chart
// weekly; the 50-day is above the 200" and "this one to hourly, the level I drew next to it is support" act on the clicked chart.
// Built from the family: non-chart nouns × relation words × clause positions. Evidence: LOCAL native Windows Node v24, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const FOUR = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const tfs = (b) => b.state.widgets.map(x => x.opts?.tf || 'D').join('')
const planOn = (id) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }])

const NOUNS = ['the 50-day', 'the level I drew', 'the MA', 'the price', 'the alert', 'the trendline']
const RELS = ['above', 'below', 'next to', 'under', 'beside', 'far from']
// two clause positions: the click's own clause first, or the non-chart clause first
const SHAPES = [
  (noun, rel) => `make this chart weekly; ${noun} is ${rel} the 200`,
  (noun, rel) => `this one to weekly, ${noun} ${rel} it is support`,
  (noun, rel) => `${noun} is ${rel} it, so make this one weekly`,
]
const CASES = NOUNS.flatMap((noun, i) => SHAPES.map((shape, j) => shape(noun, RELS[(i + j) % RELS.length])))

describe('a relation word on a non-chart noun never withholds the click', () => {
  it.each(CASES)('"%s" (c1 clicked): the plan on the click runs there', async (t) => {
    const m = p.mount(FOUR, SYMS, { decorate: label })
    p.select('c1')
    p.st.envelopes.push(planOn('c1'))
    await m.say(t)
    expect(tfs(m.board), `${t} | ${transcript().slice(-240)}`).toBe('DWDD')
  }, 40000)
})

// full suite 1e820565ef (agentCompanyNames): a verb particle or a time word is not a relation word — "pull UP … on this one",
// "switch OVER to …", "the PAST year on this chart", "turn it DOWN": a bare pointer at the click, which is acted on
const PARTICLES = ['pull up weekly on this one', 'switch over to weekly on this chart', 'show the past year weekly on this chart',
  'bring up the weekly on this one', 'set it to weekly, i will turn down the noise later', 'at the end of the day make this one weekly']
describe('a verb particle or a time word is not a relation word', () => {
  it.each(PARTICLES)('"%s" (c1 clicked): the plan on the click runs there', async (t) => {
    const m = p.mount(FOUR, SYMS, { decorate: label })
    p.select('c1')
    p.st.envelopes.push(planOn('c1'))
    await m.say(t)
    expect(tfs(m.board), `${t} | ${transcript().slice(-240)}`).toBe('DWDD')
  }, 40000)
})
