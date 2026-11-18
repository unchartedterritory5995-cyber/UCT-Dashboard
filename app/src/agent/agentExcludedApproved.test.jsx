// #988 (AUDIT GO on 08fb7314ba, the approved-path question): an APPROVED card is re-checked by the excluded-chart gate, with
// the words it was PROPOSED from — "do it" / "yes" / the Apply click name no chart, so the card's own request is what is read.
// The proposal-time gate AND the constraint check are FORCED off while the card is made (a producer regression: a card that
// carries the excluded chart); the approval alone must then refuse it — nothing runs, the excluded chart is never applied.
// Every way to approve: the Apply button, typed "do it", "yes", "apply it". LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom,
// scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

const forced = { on: false, check: false }
vi.mock('./spatialCheck', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    checkSpatialConstraints: (args) => (forced.on || forced.check ? null : real.checkSpatialConstraints(args)),
    withoutExcludedCharts: (ops, ...rest) => (forced.on ? { ops, dropped: 0 } : real.withoutExcludedCharts(ops, ...rest)),
  }
})
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel(); forced.on = false; forced.check = false })
afterEach(() => { forced.on = false; forced.check = false; vi.restoreAllMocks(); cleanup() })

const W = 8, H = 10
const IDS = [['TL', 'TM', 'TR'], ['ML', 'MM', 'MR'], ['BL', 'BM', 'BR']]
const SYMS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD']
const BOARD = IDS.flatMap((ids, r) => ids.map((id, c) => ({ id, x: c * W, y: r * H, w: W, h: H, r })))
const rowOf = (id) => BOARD.filter(x => x.r === BOARD.find(c => c.id === id).r).map(x => x.id)

const transcript = () => screen.getByTestId('agent-transcript').textContent
const carded = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const logged = (b) => b.state.widgets.filter(x => x.opts?.settings?.logScale).map(x => x.id).sort()
const mount = (sel) => {
  const widgets = BOARD.map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
  p.select(sel)
  return m
}
const scaleOn = (disp, ...ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setScale', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { scale: 'log' } })))

const SCOPES = [['ML', 'ML'], ['MM', 'ML'], ['BL', 'BM']]
// ("put this row on log scale except the TSLA chart" is not here: an earlier screen asks which chart before any card, forced or not)
const WORDS = ['log on this row except the TSLA one', 'log scale on this row except the TSLA one']
const APPROVALS = [['the Apply button', null], ['typed "do it"', 'do it'], ['typed "yes"', 'yes'], ['typed "apply it"', 'apply it']]
const CASES = SCOPES.flatMap(([sel, ex]) => WORDS.flatMap(t => APPROVALS.map(([how, said]) => [t, sel, ex, how, said])))

describe('an approved card that carries an excluded chart never runs', () => {
  it.each(CASES)('"%s" (clicked %s, %s excluded), approved by %s', async (t, sel, ex, _how, said) => {
    const m = mount(sel)
    forced.on = true                                       // the card is made with every proposal-time check off
    p.st.envelopes.push(scaleOn('propose', ...rowOf(sel)))
    await m.say(t)
    forced.on = false
    expect(carded(), `the forced card must carry ${ex}: ${transcript()}`).toContain(`Chart (${ex})`)
    expect(logged(m.board)).toEqual([])
    if (said) await m.say(said)
    else await m.click('Apply')
    expect(logged(m.board), `${ex} applied: ${transcript()}`).not.toContain(ex)
    expect(logged(m.board), `the card ran in part: ${transcript()}`).toEqual([])
    expect(transcript()).toMatch(/excludes/)
  }, 40000)
  it.each(SCOPES)('control: a card WITHOUT the excluded chart (clicked %s, %s excluded) is applied as approved', async (sel, ex) => {
    const m = mount(sel)
    forced.check = true                                    // the card is the GATE's work alone (the constraint check would ask)
    p.st.envelopes.push(scaleOn('propose', ...rowOf(sel)))
    await m.say(WORDS[0])
    forced.check = false
    expect(carded(), transcript()).not.toContain(`Chart (${ex})`)
    await m.say('do it')
    expect(logged(m.board), transcript()).toEqual(rowOf(sel).filter(id => id !== ex).sort())
  }, 40000)
})
