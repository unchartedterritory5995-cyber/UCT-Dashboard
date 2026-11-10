// The QUESTION FILTER (#988, GO bar (3)): every deictic / unnamed question drops the constraint check's exclusions — a chart the
// words exclude, and a relation's ANCHOR that is not a target — whatever the resolver put in it. The resolvers already leave the
// anchor out, so this rail FORCES a resolver output that lists every chart (screenDeicticOps stubbed: the defence must hold even
// when a resolver regresses). LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

// the forced resolver output: a question that offers EVERY chart on the board (including the anchor / the excluded chart)
const forced = { on: false }
vi.mock('./deixis', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    screenDeicticOps: (args) => (forced.on
      ? { ask: { text: 'Which chart do you mean?', choices: (args.host?.charts?.list?.() || []).map(c => ({ ref: c.ref, label: c.label })) } }
      : real.screenDeicticOps(args)),
  }
})
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel(); forced.on = true })
afterEach(() => { forced.on = false; vi.restoreAllMocks(); cleanup() })

const W = 8, H = 10
const SYMS = ['SPY', 'QQQ', 'NVDA', 'AMD', 'TSLA', 'META']
const grid = (rows) => rows.flatMap((ids, r) => ids.map((id, c) => ({ id, x: c * W, y: r * H, w: W, h: H })))
const BOARDS = { '2x2': grid([['TL', 'TR'], ['BL', 'BR']]), '2x3': grid([['TL', 'TM', 'TR'], ['BL', 'BM', 'BR']]) }
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const mount = (g, sel) => {
  const widgets = BOARDS[g].map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
  p.select(sel)
  return m
}
const planOn = (id) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }])

// [words, board, clicked, a chart the plan aims at, the charts no question may offer]
const CASES = [
  ['could you make the chart above this one weekly', '2x2', 'BL', 'TR', ['BL']],                    // the click is the anchor
  ['could you make the chart to the right of this one weekly', '2x3', 'TM', 'BL', ['TM']],
  ['the one below this chart to weekly please', '2x3', 'TR', 'TL', ['TR']],
  ['could you put everything except SPY on weekly', '2x2', 'BR', 'TR', ['TL']],                    // SPY = TL is excluded
  ['everything but the bottom row on weekly please', '2x3', 'TL', 'TM', ['BL', 'BM', 'BR']],       // a whole excluded line
  ['could you put this row except the QQQ one on weekly', '2x3', 'TL', 'TR', ['TM']],
  // the singular "every / each chart but …" is an exclusion too (it offered the excluded row on d4273558b4)
  ['every chart but the bottom row on weekly please', '2x3', 'TL', 'TM', ['BL', 'BM', 'BR']],
  ['each chart but the top row on weekly please', '2x3', 'BL', 'BM', ['TL', 'TM', 'TR']],
]
describe('a forced question listing every chart: the filter removes the anchor and every excluded chart', () => {
  it.each(CASES)('"%s" (%s, clicked %s)', async (t, g, sel, aim, never) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(aim))
    await m.say(t)
    const shown = offered()
    expect(shown.length, transcript()).toBeGreaterThan(0)                // the forced question was asked…
    for (const id of never) expect(shown, `${id} offered: ${transcript()}`).not.toContain(id)   // …without them
  }, 40000)
  it('a question with no relation and no exclusion keeps every chart (nothing removed that the words do not exclude)', async () => {
    const m = mount('2x2', 'TL')
    p.st.envelopes.push(planOn('TR'))
    await m.say('could you make the NVDA one weekly')
    expect(offered().sort(), transcript()).toEqual(['BL', 'BR', 'TL', 'TR'])
  }, 40000)
})
