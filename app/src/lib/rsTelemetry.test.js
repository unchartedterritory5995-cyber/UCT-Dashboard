// app/src/lib/rsTelemetry.test.js
//
// ─── UCT RS unit VA2 — the plan's §13 counts (`lib/rsTelemetry.js`) ──────────
//
//   · DARK by default: with no build flag nothing is sent, not even a request the
//     server would refuse (the six events are not on its client list yet);
//   · through the app's own door (`lib/indicatorTelemetry` → `/api/indicator-telemetry/event`);
//   · props are short identifiers only (ticker, preset id, benchmark code, row key,
//     lesson key), everything else dropped;
//   · the observed events: a chart's first look is its baseline, then rs_on, a
//     benchmark change, and rs_off_within_60s only inside 60 s;
//   · two charts on one page (one blob) count one member action once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  logRsEvent, noteRsPreset, noteRsCard, noteRsLearn, createRsInstanceTracker, rsTelemetryEnabled,
  __setRsTelemetrySink, RS_TELEMETRY_EVENTS, RS_QUICK_OFF_MS,
} from './rsTelemetry'

const rs = (instanceId, inputs = {}, hidden = false) => ({ instanceId, defId: 'rsLine', inputs, hidden })

let sent
beforeEach(() => {
  sent = []
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-07T15:00:00Z'))
})
afterEach(() => {
  __setRsTelemetrySink(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const sink = () => __setRsTelemetrySink((event, props) => sent.push([event, props]))

describe('dark by default', () => {
  it('sends nothing and makes no request without the build flag', () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    expect(rsTelemetryEnabled()).toBe(false)
    expect(logRsEvent('rs_on', { symbol: 'NVDA' })).toBe(false)
    expect(noteRsPreset({ id: 'rsLine' }, { id: 'classic' })).toBe(false)
    const t = createRsInstanceTracker()
    t.observe([])
    t.observe([rs('a')])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the six events and their props', () => {
  it('are exactly the plan\'s six', () => {
    expect(Object.keys(RS_TELEMETRY_EVENTS).sort()).toEqual(
      ['rs_benchmark', 'rs_learn', 'rs_marker_card', 'rs_off_within_60s', 'rs_on', 'rs_preset'])
  })
  it('an unknown event is refused; props outside each event\'s one field, or not an identifier, are dropped', () => {
    sink()
    expect(logRsEvent('rs_whatever', {})).toBe(false)
    logRsEvent('rs_preset', { name: 'classic', email: 'a@b.c' })
    logRsEvent('rs_on', { symbol: 'BRK.B', name: 'x' })
    logRsEvent('rs_learn', { target: 'not an identifier!' })
    expect(sent).toEqual([
      ['rs_preset', { name: 'classic' }],
      ['rs_on', { symbol: 'BRK.B' }],
      ['rs_learn', {}],
    ])
  })
  it('the door helpers fire for UCT RS only', () => {
    sink()
    noteRsPreset({ id: 'rsi' }, { id: 'fast' })
    noteRsPreset({ id: 'rsLine' }, { id: 'stress' })
    noteRsCard('rsLine', 'beforePrice')
    noteRsCard('u_fixture', 'benchmark')
    noteRsLearn({ id: 'rsLine' }, 'redDay')
    expect(sent).toEqual([
      ['rs_preset', { name: 'stress' }],
      ['rs_marker_card', { kind: 'beforePrice' }],
      ['rs_learn', { target: 'redDay' }],
    ])
  })
  it('posts through the indicator telemetry door when the flag is on', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubEnv('VITE_RS_TELEMETRY_ENABLED', '1')
    try {
      expect(rsTelemetryEnabled()).toBe(true)
      logRsEvent('rs_preset', { name: 'trend' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/indicator-telemetry/event')
      const body = JSON.parse(init.body)
      expect(body).toMatchObject({ event: 'rs_preset', props: { name: 'trend' } })
      expect(typeof body.import_id).toBe('string')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('the observed events (createRsInstanceTracker)', () => {
  it('the first look is a baseline: a chart that opens with RS on reports nothing', () => {
    sink()
    const t = createRsInstanceTracker()
    t.observe([rs('a')], { symbol: 'NVDA' })
    expect(sent).toEqual([])
  })
  it('rs_on when a copy starts drawing; hidden and other indicators do not count', () => {
    sink()
    const t = createRsInstanceTracker()
    t.observe([], { symbol: 'NVDA' })
    t.observe([{ instanceId: 'r', defId: 'rsi', inputs: {} }, rs('h', {}, true)], { symbol: 'NVDA' })
    expect(sent).toEqual([])
    t.observe([rs('a')], { symbol: 'NVDA' })
    expect(sent).toEqual([['rs_on', { symbol: 'NVDA' }]])
  })
  it('rs_off_within_60s inside the window only; hiding counts as off', () => {
    sink()
    const t = createRsInstanceTracker()
    t.observe([], { symbol: 'NVDA' })
    t.observe([rs('a'), rs('b')], { symbol: 'NVDA' })
    vi.advanceTimersByTime(30_000)
    t.observe([rs('a', {}, true), rs('b')], { symbol: 'NVDA' })          // a hidden at 30 s
    vi.advanceTimersByTime(RS_QUICK_OFF_MS)
    t.observe([rs('a', {}, true)], { symbol: 'NVDA' })                    // b removed at 90 s
    expect(sent.map((e) => e[0])).toEqual(['rs_on', 'rs_on', 'rs_off_within_60s'])
  })
  it('rs_benchmark when a copy\'s benchmark changes, whichever door changed it', () => {
    sink()
    const t = createRsInstanceTracker()
    t.observe([rs('a')])
    t.observe([rs('a', { benchmark: 'RSP' })])
    t.observe([rs('a', { benchmark: 'RSP', maLength: 50 })])
    expect(sent).toEqual([['rs_benchmark', { value: 'RSP' }]])
  })
  it('two charts on one blob count one action once', () => {
    sink()
    const one = createRsInstanceTracker()
    const two = createRsInstanceTracker()
    one.observe([]); two.observe([])
    one.observe([rs('a')]); two.observe([rs('a')])
    one.observe([rs('a', { benchmark: 'QQQ' })]); two.observe([rs('a', { benchmark: 'QQQ' })])
    expect(sent.map((e) => e[0])).toEqual(['rs_on', 'rs_benchmark'])
  })
  it('never throws on junk', () => {
    sink()
    const t = createRsInstanceTracker()
    expect(() => { t.observe(null); t.observe('x'); t.observe([null, 7, {}]) }).not.toThrow()
  })
})
