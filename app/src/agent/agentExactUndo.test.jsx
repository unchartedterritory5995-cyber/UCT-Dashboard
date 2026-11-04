// UCT Agent — exact stored-state Undo (the Agent side of Indicators #517). The Agent hands the chart's STORED pref to
// applyIndicatorMutation as ctx.storedSettings, so an Undo with nothing changed since writes back exactly what was
// stored — byte for byte, or nothing at all on a chart that stored nothing. Through the REAL panel (panelHarness) and
// the REAL Indicators mutation interface; asserted on the board's stored settings, not only on what the chart draws.
// Spec: docs/indicators/AGENT-HANDOFF-EXACT-UNDO-2026-10-30.md (tests 1–3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const stored = (board, id = 'c') => JSON.stringify(board.state.widgets.find(w => w.id === id).opts.settings ?? null)
const ids = (board, id = 'c') => p.instancesOn(board, id).map(i => i.id)
// the bare chart's settings as a member's saved blob can be: equal to the merged form, NOT in its key order
const reordered = () => Object.fromEntries(Object.entries(bareSettings()).reverse())
const undoAll = async (say, done) => { for (let i = 0; i < 8 && !done(); i++) await say('undo') }

describe('exact stored-state Undo — the Agent hands Indicators the stored settings', () => {
  it('1 · a chart with stored settings: the 9 and 20 coloured, then every Undo — the stored blob byte-identical', async () => {
    const [widgets, syms] = ONE('CYPH')
    const { say, board } = p.mount([{ ...widgets[0], opts: { settings: reordered() } }], syms)
    const before = stored(board)
    await say('throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow')
    expect(p.instancesOn(board, 'c')).toHaveLength(2)
    expect(stored(board)).not.toBe(before)
    await undoAll(say, () => !p.instancesOn(board, 'c').length)
    expect(p.instancesOn(board, 'c')).toEqual([])
    expect(stored(board)).toBe(before)                                         // not only drawn: STORED, key order included
    expect(p.turns()).toBe(0)
  }, 40000)

  it('2 · a chart that stores NO settings: "add rsi", then "undo" — it stores nothing again, and the Undo is confirmed', async () => {
    const [widgets, syms] = ONE('BRCB')
    const { say, board } = p.mount([{ ...widgets[0], opts: {} }], syms)
    expect(stored(board)).toBe('null')
    await say('add rsi')
    expect(p.instancesOn(board, 'c').filter(i => i.defId === 'rsi')).toHaveLength(1)
    expect(stored(board)).not.toBe('null')
    const drawn = p.instancesOn(board, 'c').filter(i => i.defId !== 'rsi').map(i => i.id)
    const out = await say('undo')
    expect(out).not.toMatch(/not confirmed|did not land|not done/i)
    expect(board.state.widgets[0].opts.settings ?? null).toBeNull()            // absent or null — never the effective blob
    expect(p.instancesOn(board, 'c').map(i => i.id)).toEqual(drawn)            // the defaults it reads, no RSI
    expect(p.turns()).toBe(0)
  }, 40000)

  it('3 · add → undo → add → undo: the stored settings unchanged and the same instance id reused', async () => {
    const { say, board } = p.mount(...ONE('BRCB'))
    const before = stored(board)
    await say('add rsi')
    const first = ids(board)
    expect(first).toHaveLength(1)
    await say('undo')
    expect(stored(board)).toBe(before)
    await say('add rsi')
    expect(ids(board)).toEqual(first)                                          // no tombstone holds the id
    await say('undo')
    expect(stored(board)).toBe(before)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('4 · changed since (the member switched the chart to log scale): Undo takes off ONLY the RSI — never the old blob back', async () => {
    const [widgets, syms] = ONE('BRCB')
    const { say, board } = p.mount([{ ...widgets[0], opts: { settings: reordered() } }], syms)
    const before = stored(board)
    await say('add rsi')
    expect(p.instancesOn(board, 'c').filter(i => i.defId === 'rsi')).toHaveLength(1)
    // the member's own edit, outside the Agent, between the change and its Undo
    board.host.charts.commit('c', { settings: { ...board.state.widgets[0].opts.settings, logScale: true } })
    const out = await say('undo')
    expect(out).not.toMatch(/not confirmed|did not land|not done/i)
    expect(p.instancesOn(board, 'c').filter(i => i.defId === 'rsi')).toEqual([])   // the Agent's change is gone
    expect(board.state.widgets[0].opts.settings.logScale).toBe(true)               // the member's is kept
    expect(stored(board)).not.toBe(before)                                         // the restore point did not write over it
    // otherwise as it was — but for the preset stamp: with the chart changed since, Indicators (settlePreset) leaves it
    // 'custom' rather than claim the old preset back
    const { preset, ...rest } = board.state.widgets[0].opts.settings
    const { preset: was, ...restBefore } = JSON.parse(before)
    expect(rest).toEqual({ ...restBefore, logScale: true })
    expect([was, preset]).toEqual(['classic', 'custom'])
    expect(p.turns()).toBe(0)
  }, 40000)
})
