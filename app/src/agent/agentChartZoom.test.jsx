// C1-028 ZOOM (owner 2026-11-10): "zoom in / out" on ONE chart, reported as done ONLY when that chart's visible window (its logical
// range, read back from the time scale as getDateMeta's `frame`) actually narrowed (in) or widened (out). A no-op ("already fully
// zoomed out", "already as close as it goes") says nothing changed. Undo puts the previous window back (restoreView). The stand-in
// chart keeps a view the way getDateMeta reports it, so a zoom that does not land is never claimed. StockChart's own zoom is the
// real-browser half. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const op = (action, args) => p.env('apply', [{ action, target: 'c', args }])

/** a chart view as getDateMeta reports it: a window counted from the newest bar, over `bars` bars */
function withView(h, start = {}) {
  const v = { fromRight: 120, toRight: -5, bars: 500, land: true, calls: [], locked: false, lock: null, activeRange: null, ...start }
  const frame = () => ({ fromRight: v.fromRight, toRight: v.toRight, bars: v.bars, activeRange: v.activeRange, locked: v.locked, lock: v.lock })
  const meta = () => ({ firstMs: 0, lastMs: 1, rightMs: 1, activeRange: v.activeRange, atDefaultView: false, indicatorsHidden: false, frame: frame() })
  const base = h.charts
  const read = base.read, list = base.list
  h.charts = {
    ...base,
    read: (ref) => { const s = read(ref); return s && { ...s, view: meta() } },
    list: () => list().map(s => ({ ...s, view: meta() })),
    viewDo: (ref, o, arg) => {
      v.calls.push([ref, o, arg])
      if (!v.land) return true
      const width = v.fromRight - v.toRight
      if (o === 'zoom') {
        const next = arg.dir === 'in' ? Math.max(10, width / 2) : Math.min(v.bars - 1 - v.toRight, width * 2)
        v.fromRight = v.toRight + next
      }
      if (o === 'restoreView') { v.fromRight = arg.fromRight; v.toRight = arg.toRight }
      return true
    },
  }
  return v
}
const width = (v) => v.fromRight - v.toRight
const WORDS = { in: ['zoom in on this chart', 'zoom in a bit', 'get closer on the chart'], out: ['zoom out on this chart', 'zoom out a little', 'pull back on this chart'] }
const CASES = [...WORDS.in.map(t => [t, 'in']), ...WORDS.out.map(t => [t, 'out'])]

describe('C1-028: zoom one chart, read back from its window', () => {
  it.each(CASES)('"%s": the window zooms %s; the receipt says so; Undo puts it back exactly', async (t, dir) => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h)
    const before = width(v)
    p.st.envelopes.push(op('chartSetup.zoom', { direction: dir }))
    const out = await say(t)
    if (dir === 'in') expect(width(v), out).toBeLessThan(before)
    else expect(width(v), out).toBeGreaterThan(before)
    expect(out).toMatch(new RegExp(`Zoomed ${dir}`))
    await say('undo')
    expect([v.fromRight, v.toRight]).toEqual([120, -5])
  }, 40000)
  it('NO-OP already fully zoomed out: nothing changed is said; no success receipt; the chart is not asked to zoom', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h, { fromRight: 499, toRight: -5, bars: 500 })
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'out' }))
    const out = await say('zoom out on this chart')
    expect(out).toMatch(/already (?:fully )?zoomed out|nothing (?:changed|to change)/i)
    expect(out).not.toMatch(/Zoomed out/)
    expect(v.calls.filter(c => c[1] === 'zoom')).toEqual([])
  }, 40000)
  it('NO-OP already as close as it goes: nothing changed is said', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h, { fromRight: 5, toRight: -5 })
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'in' }))
    const out = await say('zoom in on this chart')
    expect(out).toMatch(/already .*(?:close|zoomed in)|nothing (?:changed|to change)/i)
    expect(out).not.toMatch(/Zoomed in/)
    expect(v.calls.filter(c => c[1] === 'zoom')).toEqual([])
  }, 40000)
  it('NEGATIVE a zoom the chart does not carry out is never claimed', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h, { land: false })
    const realNow = Date.now
    let t = realNow()
    vi.spyOn(Date, 'now').mockImplementation(() => { t += 2000; return t })       // the 10s read-back wait passes at once
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'in' }))
    const out = await say('zoom in on this chart')
    expect(width(v)).toBe(125)
    expect(out).not.toMatch(/Zoomed in/)
  }, 60000)
})
