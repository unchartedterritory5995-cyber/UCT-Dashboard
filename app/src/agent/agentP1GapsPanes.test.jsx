// P1 GAPS, batch 4 (pl-exec, agent/pl/exec-p1-gaps): through the REAL panel on the fixture board, read back from the chart's
// own stored state through the product's own readers, with Undo. Held-out: agentP1GapsHeldOut (committed first, 4ca35f20db).
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): native Windows Node v24, jsdom, scripted plans where the model is asked.
//   C1-094  resize ONE indicator pane (its divider): the pane's stored share reads back (paneKeysOf); Undo exact; a size the
//           divider cannot reach, or a "pane" that is not one, is refused and nothing is written
//   C1-104  "toggle X" — the chords' VISIBILITY rule (StockChart toggleIndicatorById) as a family over every indicator, decided
//           on the chart's real state with no model call on a one-chart board; elsewhere the model is asked (never guessed)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO, MODEL_SENTINEL } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import * as R from '../components/chart/engine/nativeRegistry'
import { addInstance, setInstanceHidden } from '../components/chart/engine/instanceControls'
import { setPaneSize } from '../components/chart/engine/paneSizes'
import { paneKeysOf } from '../components/chart/builder/agentPanes'
import { defIdOfWords, toggleOp } from './capabilities/indicatorEdits'
import { PANE_RESIZE_HELD_OUT, TOGGLE_HELD_OUT } from './agentP1GapsHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const VOL = { volumeSeparatePane: true, blankVolume: false }
const widget = (board, id = 'c') => board.state.widgets.find(w => w.id === id)
const stored = (board, id = 'c') => JSON.stringify(widget(board, id).opts.settings ?? null)
const load = (s) => { const m = mergeChartSettings(s || null); return adoptOverlayAverages(m) || m }
const live = (s, defId) => (load(s).indicatorInstances || []).filter(i => i && !i.deleted && !i.removed && i.defId === defId)
/** absent | shown | hidden — the chart's own instances of that definition */
const stateOf = (s, defId) => { const l = live(s, defId); return !l.length ? 'absent' : l.some(i => i.hidden !== true) ? 'shown' : 'hidden' }
const shareOf = (s, id) => paneKeysOf(load(s), R, VOL).find(x => x.paneKey === id)?.share ?? null
// the product's own writers, as the Library add / legend eye / divider leave a chart
const withInd = (s, defId, hidden = false) => {
  const a = addInstance(s, defId, R)
  const id = a.indicatorInstances.filter(i => i.defId === defId).at(-1).instanceId
  return hidden ? setInstanceHidden(a, id, true, R) : a
}
const idOf = (s, defId) => live(s, defId)[0]?.instanceId
function mountOne(seed = (s) => s, sym = 'NVDA') {
  const [ws, groups] = ONE(sym)
  ws[0].opts = { ...ws[0].opts, settings: seed(ws[0].opts.settings) }
  return p.mount(ws, groups)
}

// ── C1-094 ──
describe('C1-094: resize one indicator pane', () => {
  it.each(PANE_RESIZE_HELD_OUT.map(c => [c.text, c]))('held-out "%s"', async (t, c) => {
    // RSI and MACD each in their own pane; the default averages on price (so "#50" names a price-pane study); RSI at 30% so
    // "size itself again" has a share to drop
    const { say, board } = mountOne((s) => {
      const a = withInd(withInd(mergeChartSettings(null), 'rsi'), 'macd')
      return setPaneSize(a, idOf(a, 'rsi'), 0.3)
    })
    const s0 = widget(board).opts.settings
    const key = c.pane.startsWith('#') ? null : idOf(s0, c.pane)
    const was = key ? shareOf(s0, key) : null
    const before = stored(board)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'pane.resize', target: body.context.indicatorEdits[0].ref, args: { pane: c.pane, size: c.size } }]))
    const out = await say(t)
    if (c.refuse) {
      expect(stored(board), out).toBe(before)
      expect(out).toMatch(/didn't change anything/)
      // ⭐ (Lead 11-09) said in the percent the member speaks in, never the stored fraction
      if (typeof c.size === 'number') expect(out).toMatch(/between 4% and 90% of the chart's height, so 95% isn't possible/)
      expect(out).not.toMatch(/0\.04|0\.9\b/)
      return
    }
    const now = shareOf(widget(board).opts.settings, key)
    if (c.size === 'auto') expect(now, out).toBeNull()
    else if (c.size === 'bigger') expect(now, out).toBeGreaterThan(was ?? 0)
    else expect(now, out).toBe(c.size / 100)
    await say('undo')
    expect(stored(board)).toBe(before)
  }, 40000)
})

// ── C1-104 ──
const seedState = (defId, start) => (s) => (start === 'absent' ? s : withInd(s, defId, start === 'hidden'))
describe('C1-104: toggle an indicator, the chords\' rule, any indicator', () => {
  it('the held-out indicators are real catalog entries (the words resolve to them)', () => {
    for (const c of TOGGLE_HELD_OUT) expect(defIdOfWords(c.text.replace(/^(?:toggle|flip)(?: the)? /i, '').replace(/ (?:on|off)$/i, '').toLowerCase()), c.text).toBe(c.defId)
  })
  it.each(TOGGLE_HELD_OUT.map(c => [c.text, c]))('held-out "%s": no model call; the chart ends as the chord would leave it; Undo exact', async (t, c) => {
    const { say, board } = mountOne(seedState(c.defId, c.start))
    expect(stateOf(widget(board).opts.settings, c.defId)).toBe(c.start)
    const before = stored(board)
    const out = await say(t)
    expect(p.turns(), out).toBe(0)
    expect(out).not.toContain(MODEL_SENTINEL)
    expect(stateOf(widget(board).opts.settings, c.defId), out).toBe(c.end)
    // ⭐ a hide KEEPS the indicator (its inputs and id), never a delete
    if (c.start === 'shown') expect(live(widget(board).opts.settings, c.defId).map(i => i.instanceId)).toEqual(live(JSON.parse(before), c.defId).map(i => i.instanceId))
    if (c.start === c.end) { expect(stored(board)).toBe(before); expect(out).toMatch(/already hidden/i); return }
    await say('undo')
    expect(stored(board)).toBe(before)
  }, 40000)
  it('two charts and none clicked: not decided here — the model is asked, no chart changes', async () => {
    const [ws, groups] = TWO()
    const { say, board } = p.mount(ws, groups)
    const before = [stored(board, 'cl'), stored(board, 'cr')]
    const out = await say('toggle RSI')
    expect(p.turns()).toBe(1)
    expect(out).toContain(MODEL_SENTINEL)
    expect([stored(board, 'cl'), stored(board, 'cr')]).toEqual(before)
  }, 40000)
  it('not claimed: two of that indicator on the chart, "off" on one that is not there, a word that names no single indicator', () => {
    const host = (s) => ({ charts: { list: () => [{ ref: 'c', cs: load(s) }] } })
    const two = withInd(withInd(mergeChartSettings(null), 'rsi'), 'rsi')
    expect(toggleOp('toggle rsi', host(two))).toBeNull()
    expect(toggleOp('toggle rsi off', host(mergeChartSettings(null)))).toBeNull()
    expect(toggleOp('toggle the grid', host(mergeChartSettings(null)))).toBeNull()
    expect(toggleOp('toggle rsi', host(mergeChartSettings(null)))).toMatchObject({ action: 'indicator.add', args: { defId: 'rsi' } })
  })
})
