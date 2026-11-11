// Family C (chart right-click parity): chartMenu.askAi (C1-178) and chartMenu.resetWatermark (C1-061) through the REAL panel on
// the fixture board, the model scripted (no paid call). One chart only: the chart the targeting rules name (the clicked one, a
// relation to it — #988: the clicked chart is the anchor, never the target), every other chart untouched. Read back, exact Undo
// for the watermark; Ask AI has no Undo (it opens another page, after the receipt). The widget half (the adapter reaching
// ChartWidget's own openAskAi / resetWatermark) is pages/charts/widgets/ChartWidget.rclickParity.test.jsx.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability, manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { wordsSelect, groupOfAction, GROUPS } from './routing'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const PLACED = { x: 0.2, y: 0.8, anchor: null }
// 2×2: c0 TL, c1 TR, c2 BL, c3 BR — every chart's watermark dragged
const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings(), watermarkPos: { ...PLACED } } })
const WIDGETS = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
// the right-click Ask AI door on every chart, recorded (what ChartWidget's openAskAi would open)
function mountOn(clicked) {
  const m = p.mount(WIDGETS, SYMS, { decorate: (s) => ({ ...label(s), canAskAi: true }) })
  const opened = []
  m.h.charts.askAi = (ref) => { opened.push(`/research/${m.h.charts.read(ref).symbol}?section=ai`); return true }
  if (clicked) p.select(clicked)
  return { ...m, opened }
}
const wmOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.watermarkPos ?? null
const others = (b, id) => JSON.stringify(b.state.widgets.filter(w => w.id !== id).map(w => w.opts))
const planOn = (id, action) => (body) => p.env('apply', [{ action, target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: {} }])
const asked = () => /Which chart do you mean|Did you mean/.test(screen.getByTestId('agent-transcript').textContent)

describe('chartMenu.resetWatermark: one chart, read back, exact Undo (C1-061)', () => {
  it('the clicked chart: reset, read back from its opts; the other three untouched; Undo puts it back exactly', async () => {
    const { say, board: b } = mountOn('c2')
    const before = others(b, 'c2')
    p.st.envelopes.push(planOn('c2', 'chartMenu.resetWatermark'))
    const out = await say('reset the watermark on this chart')
    expect(out).toMatch(/Reset the watermark to the centre/)
    expect(wmOf(b, 'c2')).toBeNull()
    expect(others(b, 'c2')).toBe(before)                  // wrong-target control
    await say('undo that')
    expect(wmOf(b, 'c2')).toEqual(PLACED)
  }, 40000)
  it('#988: "the one above this" (clicked c2) resets c0; the clicked chart is the anchor and keeps its watermark', async () => {
    const { say, board: b } = mountOn('c2')
    p.st.envelopes.push(planOn('c0', 'chartMenu.resetWatermark'))
    await say('reset the watermark on the one above this')
    expect(wmOf(b, 'c0')).toBeNull()
    expect(wmOf(b, 'c2')).toEqual(PLACED)
    expect(asked()).toBe(false)
  }, 40000)
  it('NEGATIVE #988: a plan on the CLICKED chart for "the one above this" is not run', async () => {
    const { say, board: b } = mountOn('c2')
    p.st.envelopes.push(planOn('c2', 'chartMenu.resetWatermark'))
    await say('reset the watermark on the one above this')
    for (const w of WIDGETS) expect(wmOf(b, w.id)).toEqual(PLACED)
  }, 40000)
})

describe('chartMenu.askAi: the clicked chart\'s symbol, after the receipt, no Undo (C1-178)', () => {
  it('opens Ask AI for the clicked chart\'s symbol only; the board is unchanged', async () => {
    const { say, board: b, opened } = mountOn('c1')
    const before = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(planOn('c1', 'chartMenu.askAi'))
    const out = await say('ask ai about this chart')
    expect(out).toMatch(/Opening Ask AI about QQQ/)
    expect(opened).toEqual([])                            // the receipt first; the page changes after it
    await waitFor(() => expect(opened).toEqual(['/research/QQQ?section=ai']), { timeout: 3000 })
    expect(JSON.stringify(b.state.widgets)).toBe(before)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  }, 40000)
  it('#988: "the one next to this" (clicked c2) opens TSLA\'s, never the clicked chart\'s', async () => {
    const { say, opened } = mountOn('c2')
    p.st.envelopes.push(planOn('c3', 'chartMenu.askAi'))
    await say('ask ai about the one next to this')
    await waitFor(() => expect(opened).toEqual(['/research/TSLA?section=ai']), { timeout: 3000 })
  }, 40000)
  it('no door on that chart (a Multi Chart cell): refused, nothing opens', async () => {
    const m = p.mount(WIDGETS, SYMS, { decorate: label })
    p.select('c0')
    let calls = 0
    m.h.charts.askAi = () => { calls += 1; return true }
    p.st.envelopes.push(planOn('c0', 'chartMenu.askAi'))
    const out = await m.say('ask ai about this chart')
    expect(out).toMatch(/can't open Ask AI from that chart/)
    await new Promise(r => setTimeout(r, 1200))
    expect(calls).toBe(0)
  }, 40000)
})

describe('chartMenu: contract and routing', () => {
  it('the two capabilities: undo as the product has it, inside the manifest limits', () => {
    expect(getCapability('chartMenu.askAi').undo).toBe('none')
    expect(getCapability('chartMenu.askAi').undoNote).toMatch(/Back/)
    expect(getCapability('chartMenu.resetWatermark').undo).not.toBe('none')
    const L = MANIFEST_CONTRACT.limits
    for (const c of manifestFor({ surface: 'charts' }).filter(x => x.name.startsWith('chartMenu.'))) {
      expect(c.summary.length, c.name).toBeLessThanOrEqual(L.maxSummary)
      expect((c.hints || '').length, c.name).toBeLessThanOrEqual(L.maxHints)
    }
  })
  it('its own words-only, fill-last group', () => {
    const g = GROUPS.find(x => x.id === 'chartMenu')
    expect(g).toMatchObject({ wordsOnly: true, fillLast: true })
    expect(groupOfAction('chartMenu.askAi')).toBe('chartMenu')
    expect(groupOfAction('chartMenu.resetWatermark')).toBe('chartMenu')
  })
  it.each(['ask ai about this chart', 'open the ai on nvda', 'ask the ai about the stock on this chart', 'reset the watermark',
    'put the watermark back where it was', 'recenter the watermark on the left chart', 'move the watermark back to the default spot'])
  ('selected by its own words: "%s"', (t) => expect(wordsSelect('chartMenu', t)).toBe(true))
  it.each(['make the watermark bigger', 'hide the watermark', 'send this chart to my journal', 'ask about nvda earnings',
    'what does the ai search widget say', 'reset the view', 'show the header', 'is this a good setup', 'add the rsi'])
  ('NEGATIVE: not its words: "%s"', (t) => expect(wordsSelect('chartMenu', t)).toBe(false))
})
