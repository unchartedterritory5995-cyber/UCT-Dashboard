// D20 · Tools → Replay Mode stepped by bars, through the REAL Agent panel (scripted model; the fast path needs none):
// the step, its receipt and exact Undo, the chart it counts (the clicked / sole one; several and none clicked → asks), the
// refusals (no Replay Mode, a Multi Chart cell, a custom timeframe), Replay Mode's missing playback, the status answers in
// every state, routing by STATE, the model's context field, and the guards on the bar replay and the window step.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO } from './testing/panelHarness'
import { selectGroups } from './routing'
import { getCapability } from './capabilities'
import { describeChart } from './capabilities/chart'
import { STEP_ACTION, parseStep } from './capabilities/replayMode'
import { cutoffFetchDay } from '../components/chart/replayCutoff'
import * as O from '../components/chart/__tests__/replayOracle'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const WIN = O.sessions('2026-02-02', '2026-05-29')
const BARS = { D: O.dwmBars(WIN, 'D'), '5': O.intradayBars(WIN, '5'), W: O.dwmBars(WIN, 'W') }
const dayOfBar = (b) => (typeof b.t === 'number' ? O.unixToEt(b.t).day : b.t)

/** The board's charts with Replay Mode (one shared cutoff), each chart's bars, and (optionally) a bar replay on a chart. */
function withReplayMode(h, { cutoff = null, tfs = {}, door = true, bar = null, instances = null } = {}) {
  const ws = { cut: cutoff, writes: [], viewDo: [] }
  const base = h.charts, read = base.read, list = base.list
  const deco = (s) => s && ({
    ...s, tf: tfs[s.ref] || s.tf, replay: ws.cut, ...(door ? { canStepReplay: true } : {}),
    ...(instances ? { cs: { ...s.cs, indicatorInstances: instances } } : {}),
    view: { frame: { fromRight: 50, toRight: 0 }, replay: { can: true, mode: bar === s.ref, playing: false, speed: 1, index: bar === s.ref ? 70 : null, total: 100 } },
  })
  h.charts = {
    ...base,
    read: (ref) => deco(read(ref)),
    list: () => list().map(deco),
    setReplay: (v) => { ws.writes.push(v ?? null); ws.cut = v ?? null; return true },
    viewDo: (ref, op, arg) => { ws.viewDo.push([ref, op, arg]); return true },
    ...(door ? {
      replayBarTimes: async (ref, { throughDay } = {}) => {
        const tf = tfs[ref] || read(ref)?.tf || 'D'
        const all = BARS[tf]
        if (!all) return null
        const to = throughDay || cutoffFetchDay(ws.cut, tf)
        return { tf, extended: false, times: all.filter(b => dayOfBar(b) <= to).map(b => b.t) }
      },
    } : {}),
  }
  return ws
}
const NO_MODEL = (p) => expect(p.turns()).toBe(0)

describe('step Replay Mode by bars (fast path, from state)', () => {
  it('daily: "step forward one bar" moves the cutoff one SESSION (Fri → Mon), says exactly where, and Undo puts it back exactly', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const ws = withReplayMode(h, { cutoff: '2026-03-06', tfs: { c: 'D' } })
    expect(await say('step forward one bar')).toMatch(/Moved Replay Mode forward 1 bar of this chart \(1D\): every chart now shows only what was known by Mon, Mar 9/)
    NO_MODEL(p)
    expect(ws.writes).toEqual(['2026-03-09'])
    expect(ws.viewDo).toEqual([])                                     // the bar replay is never pressed
    await say('undo')
    expect(ws.cut).toBe('2026-03-06')
  }, 40000)
  it('intraday 5m: two bars forward from a precise cutoff → the precise end of the target bar; Undo restores the PRECISE value', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = O.preciseOf(O.etToUnix('2026-03-10', 600))
    const ws = withReplayMode(h, { cutoff: v, tfs: { c: '5' } })
    expect(await say('step forward 2 bars')).toMatch(/Moved Replay Mode forward 2 bars of this chart \(5m\): every chart now shows only what was known by Tue, Mar 10, 10:10 ET/)
    expect(ws.cut).toBe(O.preciseOf(O.etToUnix('2026-03-10', 610)))
    await say('undo')
    expect(ws.cut).toBe(v)
  }, 40000)
  it('back, "previous bar", "next bar" and "step replay mode back 3 bars" are steps too', () => {
    expect(parseStep('previous bar')).toMatchObject({ direction: 'back', bars: 1 })
    expect(parseStep('next bar')).toMatchObject({ direction: 'forward', bars: 1 })
    expect(parseStep('step replay mode back 3 bars')).toMatchObject({ direction: 'back', bars: 3, named: true })
    expect(parseStep('go back ten bars')).toMatchObject({ direction: 'back', bars: 10 })
    expect(parseStep('step forward one bar 2x')).toBe(null)
  })
  it('Undo is stale once the cutoff moved since (the dialog, Exit): it refuses and writes nothing', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const ws = withReplayMode(h, { cutoff: '2026-03-06', tfs: { c: 'D' } })
    await say('next bar')
    ws.cut = '2026-04-01'
    const n = ws.writes.length
    await say('undo')
    expect(document.body.textContent).toMatch(/has changed since/)
    expect(ws.writes.length).toBe(n)
  }, 40000)
})

describe('which chart, and where it can not step', () => {
  it('two charts, none clicked: it ASKS which chart; nothing is written', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const ws = withReplayMode(h, { cutoff: '2026-03-06', tfs: { cl: 'D', cr: '5' } })
    const out = await say('step forward one bar')
    expect(out).toMatch(/[Ww]hich chart/)
    expect(ws.writes).toEqual([])
  }, 40000)
  it('two charts with the 5m one clicked: it steps by THAT chart\'s bars', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    p.st.selected = 'cr'
    const ws = withReplayMode(h, { cutoff: '2026-03-06', tfs: { cl: 'D', cr: '5' } })
    expect(await say('step forward one bar')).toMatch(/of this chart \(5m\).*Mon, Mar 9, 09:35 ET \(charts on other timeframes show only their bars that were complete by then\)/)
    expect(ws.cut).toBe(O.preciseOf(O.etToUnix('2026-03-09', 575)))
  }, 40000)
  it('a chart with no bar door (a Multi Chart cell), a custom timeframe, and Replay Mode off are refused; nothing written', async () => {
    for (const [opts, re] of [[{ cutoff: '2026-03-06', door: false }, /isn’t reachable on that chart/], [{ cutoff: '2026-03-06', tfs: { c: '45' } }, /custom timeframe/],
      [{ cutoff: null, tfs: { c: 'D' } }, /Replay Mode isn’t on/]]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const ws = withReplayMode(h, opts)
      p.st.envelopes.push(p.env('apply', [{ action: STEP_ACTION, target: 'c', args: { direction: 'forward', bars: 1 } }]))
      await say('step replay mode forward a bar please')
      expect(document.body.textContent).toMatch(re)
      expect(ws.writes).toEqual([])
      cleanup()
    }
  }, 60000)
  it('past the last bar: refused with the reason, nothing written', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const ws = withReplayMode(h, { cutoff: '2026-05-29', tfs: { c: 'D' } })
    expect(await say('next bar')).toMatch(/no later bar on this chart/)
    expect(ws.writes).toEqual([])
  }, 40000)
})

describe('Replay Mode has no playback (owner req 7) — and the bar replay is never reached (req 4)', () => {
  it.each(['play', 'pause', 'resume', 'play at 2x', '2x', 'speed it up', 'slower'])('"%s" with only Replay Mode on: explained, nothing pressed', async (msg) => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const ws = withReplayMode(h, { cutoff: '2026-03-06', tfs: { c: 'D' } })
    await say(msg)
    // (a quoted request the panel can run renders as its own element: read the whole panel)
    expect(document.body.textContent).toMatch(/Replay Mode \(as of Fri, Mar 6\) shows the charts as they were at that point; it has no play, pause or speed/)
    NO_MODEL(p)
    expect(ws.viewDo).toEqual([])
    expect(ws.writes).toEqual([])
  }, 40000)
  it('a MODEL plan for the bar replay while only Replay Mode is on is refused (play, and a step); nothing pressed', async () => {
    for (const args of [{ op: 'play' }, { op: 'forward', bars: 1 }]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const ws = withReplayMode(h, { cutoff: '2026-03-06', tfs: { c: 'D' } })
      p.st.envelopes.push(p.env('apply', [{ action: 'chartReplay.playback', target: 'c', args: { bars: null, date: null, speed: null, ...args } }]))
      await say('could you get the replay moving for me')
      expect(document.body.textContent).toMatch(/Replay Mode \(as of Fri, Mar 6\)/)
      expect(ws.viewDo).toEqual([])
      cleanup()
    }
  }, 60000)
  it('a model "step the window" (chartSetup.stepBars) under Replay Mode asks instead of scrolling', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const ws = withReplayMode(h, { cutoff: '2026-03-06', tfs: { c: 'D' } })
    p.st.envelopes.push(p.env('apply', [{ action: 'chartSetup.stepBars', target: 'c', args: { direction: 'forward', bars: 1 } }]))
    await say('could you scoot it along a bit')
    expect(document.body.textContent).toMatch(/Replay Mode is on: say “step Replay Mode forward \/ back”/)
    expect(ws.viewDo).toEqual([])
  }, 40000)
  it('BOTH replays on and the words name neither: it asks which to step', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const ws = withReplayMode(h, { cutoff: '2026-03-06', tfs: { c: 'D' }, bar: 'c' })
    expect(await say('step forward one bar')).toMatch(/Two replays are on: .*Which should I step/)
    expect(ws.writes).toEqual([])
    expect(ws.viewDo).toEqual([])
  }, 40000)
})

describe('status, from state, in every state (owner req 6)', () => {
  it.each([
    [{ cutoff: null }, /No replay is running/],
    [{ cutoff: '2026-03-06' }, /Replay Mode \(Tools → Replay\) is on: every chart shows only what was known by Fri, Mar 6\. The bar replay \(Replay \/ Time Machine\) is off\./],
    [{ cutoff: null, bar: 'c' }, /Replay Mode \(Tools → Replay\) is off\. The bar replay \(Replay \/ Time Machine\) is on for .*paused at 1×, bar 71 of 100/],
    [{ cutoff: '2026-03-10T10:05-04:00', bar: 'c' }, /Replay Mode \(Tools → Replay\) is on: every chart shows only what was known by Tue, Mar 10, 10:05 ET\. The bar replay .* is on/],
  ])('%j', async (opts, re) => {
    for (const q of ['is replay mode on', 'which replay is on', 'what date is the replay at', 'replay status']) {
      const { say, h } = p.mount(...ONE('NVDA'))
      withReplayMode(h, { tfs: { c: 'D' }, ...opts })
      expect(await say(q), q).toMatch(re)
      NO_MODEL(p)
      cleanup()
    }
  }, 90000)
  it('the model-path context carries Replay Mode (only while it is on: 0 bytes when off)', async () => {
    const off = describeChart({ label: 'Chart (NVDA)', symbol: 'NVDA', tf: 'D', cs: {}, replay: null }, 'c')
    expect('replayMode' in off).toBe(false)
    const on = describeChart({ label: 'Chart (NVDA)', symbol: 'NVDA', tf: 'D', cs: {}, replay: '2026-03-10T10:05-04:00' }, 'c')
    expect(on.replayMode).toBe('on, as of Tue, Mar 10, 10:05 ET')
    const { say, h } = p.mount(...ONE('NVDA'))
    withReplayMode(h, { cutoff: '2026-03-10T10:05-04:00', tfs: { c: 'D' } })
    await say('hmm, what am I looking at here')
    expect(JSON.stringify(p.lastTurnBody())).toContain('"replayMode":"on, as of Tue, Mar 10, 10:05 ET"')
  }, 40000)
})

describe('routing by STATE (AUDIT e)', () => {
  const sel = (msg, names) => selectGroups(msg, { names }).selected
  it.each(['step forward one bar', 'next bar', 'play', 'pause', '2x', 'speed it up', 'play the replay', 'step the replay forward 10 bars'])(
    '"%s" with only Replay Mode on: never the bar replay group', (msg) => {
      expect(sel(msg, { cutoffOn: true, replayOn: false })).not.toContain('chartReplay')
    })
  it('a step with only Replay Mode on brings Replay Mode\'s group; with only the bar replay on it is the bar replay\'s, unchanged', () => {
    expect(sel('next bar', { cutoffOn: true, replayOn: false })).toContain('replayMode')
    expect(sel('next bar', { cutoffOn: false, replayOn: false })).not.toContain('replayMode')      // a bare step, no Replay Mode: never
    expect(sel('next bar', { cutoffOn: false, replayOn: true })).toContain('chartReplay')
    expect(sel('play the replay', { cutoffOn: false, replayOn: false })).toContain('chartReplay')
    expect(sel('step replay mode forward 2 bars', {})).toContain('replayMode')                       // named: its own words
  })
  it('the capability: one chart, exact Undo, its words', () => {
    const c = getCapability(STEP_ACTION)
    expect(c.target).toBe('chart')
    expect(c.undo).toBe('exact')
    expect(c.args.properties.direction.enum).toEqual(['forward', 'back'])
  })
})

// AUDIT #1292 (owner req 5): a step receipt names, from the charts' ACTUAL instances, every indicator calculated on a higher
// timeframe (its own frame's bars are not cut at the cutoff); absent when there is none
describe('the receipt names higher-timeframe-calculated indicators', () => {
  it('a 1W-calculated RSI on the daily chart: the receipt says it is not cut at the cutoff', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    withReplayMode(h, { cutoff: '2026-03-06', tfs: { c: 'D' }, instances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, calculationTimeframe: 'W' }] })
    await say('step forward one bar')
    expect(document.body.textContent).toMatch(/Note: the 1W-calculated RSI is not cut at the cutoff — it reads its own higher-timeframe bars, and each bar shows the last such period that had closed before it/)
  }, 40000)
  it('the same RSI on the chart’s own timeframe, or none at all: no note', async () => {
    for (const instances of [[{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 } }], [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, calculationTimeframe: 'D' }], []]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      withReplayMode(h, { cutoff: '2026-03-06', tfs: { c: 'D' }, instances })
      await say('step forward one bar')
      expect(document.body.textContent).toMatch(/Moved Replay Mode forward 1 bar/)
      expect(document.body.textContent).not.toMatch(/not cut at the cutoff/)
      cleanup()
    }
  }, 60000)
})
