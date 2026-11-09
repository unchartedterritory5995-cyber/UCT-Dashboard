// P1 GAPS, C1-144 (pl-exec, agent/pl/exec-p1-gaps; Lead-approved view-level design 2026-11-09): the Position Calculator's
// entry / stop / target on ONE chart, through the REAL panel. The chart side is a stand-in for StockChart's own hook (its
// getDateMeta `position` read-back and viewDo 'setPosition'), so this proves the call and the read-back contract, not that the
// real panel redrew (†). Held-out: agentP1GapsHeldOut POSITION_HELD_OUT (committed first, ee478284d7).
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): native Windows Node v24, jsdom, scripted plans.
//   - done only when the chart reads the calculator back OPEN with exactly those prices; a chart that never lands is not claimed
//   - Undo puts the previous prices back, and closes the calculator again if it was closed; stale once the member edits it
//   - refused (nothing asked of the chart): a price not above zero, entry = stop, an entry not between stop and target
//   - every held-out phrasing brings the group that offers the action (routing), and the old Position DRAWING is never made
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { viewDone } from './capabilities/chart'
import { selectGroups, groupOfAction } from './routing'
import { setupPanel, ONE } from './testing/panelHarness'
import { POSITION_HELD_OUT } from './agentP1GapsHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const op = (args) => p.env('apply', [{ action: 'chartSetup.setPosition', target: 'c', args }])

// StockChart's calculator as getDateMeta reports it, and its viewDo('setPosition') — the same writer for the change and its Undo
const CLOSED = { open: false, entry: null, stop: null, target: null }
function withCalculator(h, start = {}) {
  const v = { position: { ...CLOSED }, land: true, calls: [], ...start }
  const meta = () => ({ firstMs: 0, lastMs: 1, rightMs: 1, activeRange: null, atDefaultView: false, indicatorsHidden: false,
    position: { ...v.position }, frame: { fromRight: 120, toRight: -5, bars: 500, activeRange: null, locked: false, lock: null } })
  const base = h.charts, read = base.read, list = base.list
  h.charts = {
    ...base,
    read: (ref) => { const s = read(ref); return s && { ...s, view: meta() } },
    list: () => list().map(s => ({ ...s, view: meta() })),
    viewDo: (ref, o, arg) => {
      v.calls.push([ref, o, JSON.parse(JSON.stringify(arg ?? null))])
      if (v.land && o === 'setPosition') v.position = { open: arg.open !== false, entry: arg.entry ?? null, stop: arg.stop ?? null, target: arg.target ?? null }
      return true
    },
  }
  return v
}
const drawingsOf = (board) => JSON.stringify(board.state.drawings ?? null)

describe('C1-144: the Position Calculator\'s entry / stop / target', () => {
  it('the action is in its own positionCalc group (neither the NL-1 core nor chartSetup grows) and takes the closed all-required grammar', () => {
    expect(groupOfAction('chartSetup.setPosition')).toBe('positionCalc')
    const a = getCapability('chartSetup.setPosition').args
    expect(a.required).toEqual(['entry', 'stop', 'target'])
    expect(a.additionalProperties).toBe(false)
  })
  it.each(POSITION_HELD_OUT.map(c => [c.text]))('held-out "%s" routes to the group that offers it', (t) => {
    const r = selectGroups(t)
    expect(r.matched, t).toBe(true)
    expect(r.selected, t).toContain('positionCalc')
  })

  it.each(POSITION_HELD_OUT.filter(c => !c.refuse).map(c => [c.text, c]))('held-out "%s": the calculator reads back open with those prices; Undo closes it again', async (t, c) => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const v = withCalculator(h)
    const drawings = drawingsOf(board)
    p.st.envelopes.push(op(c.args))
    const out = await say(t)
    expect(v.position, out).toEqual({ open: true, entry: c.args.entry, stop: c.args.stop, target: c.args.target })
    expect(out).toMatch(/Opened the Position Calculator/)
    expect(out).toContain(`entry ${c.args.entry}`)
    if (c.args.target != null) expect(out).toMatch(c.args.target > c.args.entry ? /a long/ : /a short/)
    expect(drawingsOf(board)).toBe(drawings)                        // ⛔ never the retired Position drawing
    await say('undo')
    expect(v.position).toEqual(CLOSED)
    expect(v.calls.map(x => x[1])).toEqual(['setPosition', 'setPosition'])
  }, 40000)

  it.each(POSITION_HELD_OUT.filter(c => c.refuse).map(c => [c.text, c]))('held-out "%s": REFUSED — nothing is asked of the chart; the reason is said', async (t, c) => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withCalculator(h)
    p.st.envelopes.push(op(c.args))
    const out = await say(t)
    expect(v.calls).toEqual([])
    expect(v.position).toEqual(CLOSED)
    expect(out).toMatch(c.refuse)
    expect(out).not.toMatch(/Opened the Position Calculator/)
  }, 40000)

  it('an OPEN calculator with the member\'s own prices: Undo puts those prices back and leaves it open', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const mine = { open: true, entry: 41.25, stop: 39, target: null }
    const v = withCalculator(h, { position: { ...mine } })
    p.st.envelopes.push(op({ entry: 50, stop: 47.5, target: 58 }))
    await say('size a long: entry 50, stop 47.5, target 58')
    expect(v.position).toEqual({ open: true, entry: 50, stop: 47.5, target: 58 })
    await say('undo')
    expect(v.position).toEqual(mine)
  }, 40000)

  // (the panel's own 10 s idle bound equals the commit's read-back wait, so a never-landing chart is checked on the read-back
  // contract the commit and landed() both use, not through the panel)
  it('NOT LANDED: the read-back is false unless the calculator is open with exactly those prices', () => {
    const arg = { open: true, entry: 50, stop: 47.5, target: 58 }
    expect(viewDone({ position: { ...arg } }, { op: 'setPosition', arg })).toBe(true)
    expect(viewDone({ position: { ...arg, open: false } }, { op: 'setPosition', arg })).toBe(false)
    expect(viewDone({ position: { ...arg, stop: 47.51 } }, { op: 'setPosition', arg })).toBe(false)
    expect(viewDone({ position: { ...arg, target: null } }, { op: 'setPosition', arg })).toBe(false)
    expect(viewDone({}, { op: 'setPosition', arg })).toBe(false)
    expect(viewDone({ position: { ...CLOSED } }, { op: 'setPosition', arg: { ...CLOSED } })).toBe(true)
  })

  it('NO-OP: the calculator already open with exactly those prices — nothing is asked of the chart', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withCalculator(h, { position: { open: true, entry: 50, stop: 47.5, target: 58 } })
    p.st.envelopes.push(op({ entry: 50, stop: 47.5, target: 58 }))
    const out = await say('position calculator: entry 50, stop 47.5, target 58')
    expect(v.calls).toEqual([])
    expect(out).toMatch(/already shows those prices/)
  }, 40000)

  it('STALE: the member types a new stop after the change — Undo refuses and leaves their edit alone', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withCalculator(h)
    p.st.envelopes.push(op({ entry: 50, stop: 47.5, target: 58 }))
    await say('position calculator: entry 50, stop 47.5, target 58')
    v.position = { ...v.position, stop: 48 }
    await say('undo')
    expect(v.position).toEqual({ open: true, entry: 50, stop: 48, target: 58 })
    expect(v.calls.map(x => x[1])).toEqual(['setPosition'])
  }, 40000)

  it('a chart with no calculator hook (no `position` in its view) is refused in words, never claimed', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    withCalculator(h)
    const read = h.charts.read, list = h.charts.list
    h.charts = { ...h.charts, read: (r) => { const s = read(r); return s && { ...s, view: { ...s.view, position: undefined } } }, list: () => list().map(s => ({ ...s, view: { ...s.view, position: undefined } })) }
    p.st.envelopes.push(op({ entry: 50, stop: 47.5, target: 58 }))
    const out = await say('position calculator: entry 50, stop 47.5, target 58')
    expect(out).toMatch(/can't reach the Position Calculator/)
  }, 40000)
})
