// C2 (browser acceptance, 11-05): "add AMD to my Momentum list and save this layout as Swing 2" was refused whole. A save takes
// the board as it is and has no Undo, so it can't commit inside another change, but as a plan's LAST step it needs to run on the
// board the rest left. Through the REAL panel on the fixture board, the model scripted (no paid call).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { itemsFromTurns } from './present'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const ONE = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: bareSettings() } }], { 'N:c': 'SPY' }]
const weekly = { action: 'chart.setTimeframe', target: 'c', args: { timeframe: 'W' } }
const saveAs = (name) => ({ action: 'layout.saveAs', target: 'layouts', args: { name } })
const saveCurrent = { action: 'layout.saveCurrent', target: 'layouts', args: {} }
const tfOf = (board) => board.state.widgets.find(w => w.id === 'c').opts?.tf || 'D'
const transcript = () => screen.getByTestId('agent-transcript').textContent
const pendingCards = () => screen.queryAllByTestId('agent-proposal').filter(e => e.getAttribute('data-status') === 'pending')
const open = (over = {}) => {
  const [widgets, syms] = ONE()
  return p.mount(widgets, syms, { layouts: { entries: [{ id: 1, name: 'Main', kind: 'yours', scope: 'user' }], active: 1, boards: { 1: widgets }, ...over } })
}
const names = (board) => board.state.layouts.entries.map(e => e.name)

describe('a save as the last step of a plan', () => {
  it('a local change runs at once with its own receipt; the save is then one card, on the board that change left', async () => {
    const { say, click, board } = open()
    p.st.envelopes.push(p.env('propose', [weekly, saveAs('Swing 2')]))
    await say('make this chart weekly and save this layout as Swing 2')
    expect(tfOf(board)).toBe('W')
    expect(screen.queryAllByTestId('agent-receipt')).toHaveLength(1)
    expect(pendingCards()).toHaveLength(1)
    expect(pendingCards()[0].textContent).toMatch(/Swing 2/)
    expect(names(board)).toEqual(['Main'])
    await click('Apply')
    expect(tfOf(board)).toBe('W')
    expect(names(board)).toEqual(['Main', 'Swing 2'])
    const saved = board.state.layouts.entries.find(e => e.name === 'Swing 2')
    expect(board.state.layouts.boards[saved.id].find(w => w.id === 'c').opts.tf).toBe('W')
    expect(pendingCards()).toHaveLength(0)
  }, 30000)
  it('Dismiss saves nothing; the change keeps its Undo', async () => {
    const { say, click, board } = open()
    p.st.envelopes.push(p.env('propose', [weekly, saveAs('Swing 2')]))
    await say('make this chart weekly and save this layout as Swing 2')
    await click('Dismiss')
    expect(names(board)).toEqual(['Main'])
    await say('undo')
    expect(tfOf(board)).toBe('D')
  }, 30000)
  describe('a model plan proposed whole', () => {
    const SAID = 'weekly would be better here, and keep what I have as a new layout called Swing 2 for me'
    it('one card names both; one Apply runs the change, then saves the board it left', async () => {
      const { say, click, board } = open()
      p.st.envelopes.push(p.env('propose', [weekly, saveAs('Swing 2')]))
      await say(SAID)
      expect(pendingCards()).toHaveLength(1)
      expect(pendingCards()[0].textContent).toMatch(/Swing 2/)
      expect(pendingCards()[0].textContent).toMatch(/Weekly/i)
      expect(tfOf(board)).toBe('D')
      expect(names(board)).toEqual(['Main'])
      await click('Apply')
      expect(tfOf(board)).toBe('W')
      expect(names(board)).toEqual(['Main', 'Swing 2'])
      const saved = board.state.layouts.entries.find(e => e.name === 'Swing 2')
      expect(board.state.layouts.boards[saved.id].find(w => w.id === 'c').opts.tf).toBe('W')
      expect(pendingCards()).toHaveLength(0)
    }, 30000)
    it('Dismiss runs neither', async () => {
      const { say, click, board } = open()
      p.st.envelopes.push(p.env('propose', [weekly, saveAs('Swing 2')]))
      await say(SAID)
      await click('Dismiss')
      expect(tfOf(board)).toBe('D')
      expect(names(board)).toEqual(['Main'])
    }, 30000)
    it('saving into the open layout: approved on the card, it still asks again on the board the change left', async () => {
      const { say, click, board } = open()
      p.st.envelopes.push(p.env('propose', [weekly, saveCurrent]))
      await say('weekly would be better here, and then put that over what my layout has saved for me')
      await click('Apply')
      expect(tfOf(board)).toBe('W')
      expect(board.state.layouts.calls.some(c => c[0] === 'saveCurrent')).toBe(false)
      expect(pendingCards()).toHaveLength(1)
      await click('Apply')
      expect(board.state.layouts.calls.some(c => c[0] === 'saveCurrent')).toBe(true)
    }, 30000)
  })
  it('saved FIRST and then changed stays refused whole: the save would not hold what was asked', async () => {
    const { say, board } = open()
    p.st.envelopes.push(p.env('propose', [saveAs('Swing 2'), weekly]))
    await say('save this layout as Swing 2 and then make this chart weekly')
    expect(transcript()).toMatch(/Save the layout on its own/)
    expect(tfOf(board)).toBe('D')
    expect(names(board)).toEqual(['Main'])
  }, 30000)
  it('a name already taken: the change still runs, and the member is told the save did not', async () => {
    const { say, click, board } = open()
    p.st.envelopes.push(p.env('propose', [weekly, saveAs('Main')]))
    await say('make this chart weekly and save this layout as Main')
    if (pendingCards().length) await click('Apply')
    expect(tfOf(board)).toBe('W')
    expect(transcript()).toMatch(/not this part: You already have a layout named/)
    expect(names(board)).toEqual(['Main'])
  }, 30000)
  // a dropped step is an outcome of its own: it reaches the conversation, ahead of the rest, and comes back on a reload
  const rows = () => p.st.calls.filter(c => c[1] === '/api/agent/record').map(c => c[2])
  it('the dropped step is recorded as its own row, first; the rest still records as applied', async () => {
    const { say, click } = open()
    p.st.envelopes.push(p.env('propose', [weekly, saveAs('Main')]))
    await say('make this chart weekly and save this layout as Main')
    if (pendingCards().length) await click('Apply')
    const kinds = rows().map(r => r.outcomeData?.kind)
    expect(kinds[0]).toBe('partial')
    expect(kinds).toContain('applied')
    expect(rows()[0]).toMatchObject({ outcomeData: { kind: 'partial', actions: ['layout.saveAs'] }, telemetry: { refused: true, actions: ['layout.saveAs'] } })
    expect(rows()[0].outcome).toMatch(/not this part: You already have a layout named/)
    expect(itemsFromTurns([{ id: 1, role: 'outcome', text: rows()[0].outcome, data: rows()[0].outcomeData }])[0]).toMatchObject({ role: 'agent', text: rows()[0].outcome })
  }, 30000)
  it('a fast-path request keeps one member row: the dropped step carries it, the rest does not repeat it', async () => {
    const { say } = open()
    p.st.envelopes.push(p.env('apply', [weekly, saveAs('Main')]))
    await say('make this chart weekly and save this layout as Main')
    expect(rows().filter(r => r.member).length).toBeLessThanOrEqual(1)
  }, 30000)
  it('a check that THROWS drops that step, in words and on the record; the rest of the request runs', async () => {
    const real = getCapability('layout.saveAs').check
    const spy = vi.spyOn(getCapability('layout.saveAs'), 'check').mockImplementation(() => { throw new Error('boom') })
    const { say, board } = open()
    p.st.envelopes.push(p.env('propose', [weekly, saveAs('Swing 2')]))
    await say('make this chart weekly and save this layout as Swing 2')
    spy.mockRestore()
    expect(getCapability('layout.saveAs').check).toBe(real)
    expect(tfOf(board)).toBe('W')
    expect(transcript()).toMatch(/not this part: I could not check that step/)
    expect(rows().map(r => r.outcomeData?.kind)).toContain('partial')
    expect(names(board)).toEqual(['Main'])
  }, 30000)
  it('NEGATIVE: a step that can run records no partial row', async () => {
    const { say, click } = open()
    p.st.envelopes.push(p.env('propose', [weekly, saveAs('Swing 2')]))
    await say('make this chart weekly and save this layout as Swing 2')
    await click('Apply')
    expect(rows().map(r => r.outcomeData?.kind)).not.toContain('partial')
  }, 30000)
  it('opening a layout and saving stays refused: the rest is itself exclusive', async () => {
    const { say, board } = open({ entries: [{ id: 1, name: 'Main', kind: 'yours', scope: 'user' }, { id: 2, name: 'Other', kind: 'yours', scope: 'user' }] })
    p.st.envelopes.push(p.env('propose', [{ action: 'layout.open', target: 'layouts', args: { layout: '2' } }, saveAs('Swing 2')]))
    await say('open Other and save it as Swing 2')
    expect(transcript()).toMatch(/didn't change anything/)
    expect(names(board)).toEqual(['Main', 'Other'])
  }, 30000)
  it('saving into the open layout: its card comes after the change, so it is bound to the board it would save', async () => {
    const { say, click, board } = open()
    p.st.envelopes.push(p.env('propose', [weekly, saveCurrent]))
    await say('make this chart weekly and save it to my layout')
    expect(tfOf(board)).toBe('W')
    expect(board.state.layouts.calls.some(c => c[0] === 'saveCurrent')).toBe(false)
    expect(pendingCards()).toHaveLength(1)
    await click('Apply')
    expect(board.state.layouts.calls.some(c => c[0] === 'saveCurrent')).toBe(true)
  }, 30000)
  describe('protected layouts', () => {
    const MT = { entries: [{ id: 1, name: 'Main Trading', kind: 'yours', scope: 'user' }] }
    it('a chart change on an open protected layout refuses the whole plan: nothing changes, nothing is saved', async () => {
      const { say, board } = open(MT)
      p.st.envelopes.push(p.env('propose', [weekly, saveAs('Swing 2')]))
      await say('make this chart weekly and save this layout as Swing 2')
      expect(transcript()).toMatch(/protected layout/)
      expect(tfOf(board)).toBe('D')
      expect(names(board)).toEqual(['Main Trading'])
    }, 30000)
    it('a save into a protected layout never runs, as a last step either', async () => {
      const { say, click, board } = open(MT)
      const list = { action: 'chart.setType', target: 'c', args: { type: 'line' } }
      p.st.envelopes.push(p.env('propose', [list, saveCurrent]))
      await say('make it a line chart and save it to my layout')
      if (pendingCards().length) await click('Apply')
      expect(transcript()).toMatch(/protected layout/)
      expect(board.state.layouts.calls.some(c => c[0] === 'saveCurrent')).toBe(false)
    }, 30000)
  })
})
