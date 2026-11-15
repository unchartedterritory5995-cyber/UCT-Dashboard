// A MIDDLE chart named with its ROW or COLUMN (pl-auto unseen9 P2, pl-teach's trace): "the middle chart on the bottom row", "the bottom
// middle chart" on a 3×2 board asked "Which chart is the middle one here?" although the words name one cell. ordinalChart's middle
// branch now reads a row word (top / upper / bottom / lower) or a column word (left / right column) first, then the middle of that
// line when it has an odd number of charts; otherwise it asks, as before. The guide's namedChart uses the same function, so this
// covers walkthroughs and actions. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { ordinalChart } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const at = (ref, x, y, w = 8, h = 10) => ({ ref, label: `Chart (${ref})`, cell: { x, y, w, h } })
// 3×2: top row t0 t1 t2, bottom row b0 b1 b2
const SIX = [at('t0', 0, 0), at('t1', 8, 0), at('t2', 16, 0), at('b0', 0, 10), at('b1', 8, 10), at('b2', 16, 10)]
// 2×2 and one row of three
const FOUR = [at('c0', 0, 0, 12), at('c1', 12, 0, 12), at('c2', 0, 10, 12), at('c3', 12, 10, 12)]
const ROW3 = [at('r0', 0, 0), at('r1', 8, 0), at('r2', 16, 0)]
// a 2×3 column layout: left column l0 l1 l2, right column q0 q1 q2
const COLS = [at('l0', 0, 0, 12, 6), at('l1', 0, 6, 12, 6), at('l2', 0, 12, 12, 6), at('q0', 12, 0, 12, 6), at('q1', 12, 6, 12, 6), at('q2', 12, 12, 12, 6)]
const pick = (t, charts) => { const r = ordinalChart(t, charts); return r?.ref ?? (r?.ask ? 'ASK' : null) }

describe('ordinalChart: a middle chart by its row or column', () => {
  it.each([
    ['the middle chart on the bottom row', SIX, 'b1'], ['the bottom middle chart', SIX, 'b1'], ['the middle chart in the top row', SIX, 't1'],
    ['the upper middle one', SIX, 't1'], ['the lower middle chart', SIX, 'b1'],
    ['the middle chart', ROW3, 'r1'], ['the middle chart on the top row', ROW3, 'r1'],
    ['the middle chart in the left column', COLS, 'l1'], ['the middle one in the right column', COLS, 'q1'],
  ])('%s → %s', (t, charts, want) => expect(pick(t, charts)).toBe(want))
  it.each([
    ['the middle chart', SIX], ['the middle chart on the bottom row', FOUR], ['the top middle chart', FOUR], ['the middle chart', FOUR],
  ])('NEGATIVE %s: no single middle cell → asked (never a guess)', (t, charts) => expect(pick(t, charts)).toBe('ASK'))
})

describe('through the panel: "the middle chart on the bottom row on log" (SIX)', () => {
  const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 8, h: 10, color: 'N', opts: { settings: bareSettings() } })
  const W = [cell('t0', 0, 0), cell('t1', 8, 0), cell('t2', 16, 0), cell('b0', 0, 10), cell('b1', 8, 10), cell('b2', 16, 10)]
  const SYMS = Object.fromEntries(W.map((w, i) => [`N:${w.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA'][i]]))
  const logOf = (b, id) => !!b.state.widgets.find(w => w.id === id).opts?.settings?.logScale
  it('only the bottom-middle chart goes log; nothing is asked', async () => {
    const m = p.mount(W, SYMS, { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setScale', target: body.context.charts.find(c => c.label === 'Chart (b1)').ref, args: { scale: 'log' } }]))
    const out = await m.say('the middle chart on the bottom row on log')
    expect(W.map(w => logOf(m.board, w.id)), out).toEqual([false, false, false, false, true, false])
    expect(screen.getByTestId('agent-transcript').textContent).not.toMatch(/Which chart is the middle one/)
  }, 40000)
})
