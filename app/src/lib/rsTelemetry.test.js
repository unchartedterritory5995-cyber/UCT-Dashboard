// app/src/lib/rsTelemetry.test.js
//
// ─── UCT RS unit VA2 — the plan's §13 counts (`lib/rsTelemetry.js`) ──────────
//
//   · ON by default since the server lists the six events (2026-11-07); a build
//     with `VITE_RS_TELEMETRY_ENABLED=0` (the kill switch) sends nothing at all;
//   · through the app's own door (`lib/indicatorTelemetry` → `/api/indicator-telemetry/event`);
//   · props are short identifiers only (ticker, preset id, benchmark code, row key,
//     lesson key), everything else dropped;
//   · the observed events: a chart's first look is its baseline, then rs_on, a
//     benchmark change, and rs_off_within_60s only inside 60 s;
//   · two charts on one page (one blob) count one member action once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  logRsEvent, noteRsCard, noteRsLearn, createRsInstanceTracker, rsTelemetryEnabled,
  __setRsTelemetrySink, __setRsTelemetryOffForTests, RS_TELEMETRY_EVENTS, RS_QUICK_OFF_MS, SYMBOL_RE,
} from './rsTelemetry'

const rs = (instanceId, inputs = {}, hidden = false) => ({ instanceId, defId: 'rsLine', inputs, hidden })

let sent
beforeEach(() => {
  sent = []
  // the shared test setup turns the default off for the chart suites; this file
  // rails the real gate
  __setRsTelemetryOffForTests(false)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-07T15:00:00Z'))
})
afterEach(() => {
  __setRsTelemetrySink(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const sink = () => __setRsTelemetrySink((event, props) => sent.push([event, props]))

describe('on by default, with a build kill switch', () => {
  it('with no build flag the gate is open and an event posts', () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubEnv('VITE_RS_TELEMETRY_ENABLED', undefined)
    expect(rsTelemetryEnabled()).toBe(true)
    expect(noteRsCard({ id: 'rsLine' }, 'checks')).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
  it('VITE_RS_TELEMETRY_ENABLED=0 sends nothing and makes no request', () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubEnv('VITE_RS_TELEMETRY_ENABLED', '0')
    expect(rsTelemetryEnabled()).toBe(false)
    expect(logRsEvent('rs_on', { symbol: 'NVDA' })).toBe(false)
    expect(noteRsCard({ id: 'rsLine' }, 'checks')).toBe(false)
    const t = createRsInstanceTracker()
    t.observe([])
    t.observe([rs('a')])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('any other value is on: only an explicit 0 turns it off', () => {
    for (const v of ['1', 'true', '']) {
      vi.stubEnv('VITE_RS_TELEMETRY_ENABLED', v)
      expect(rsTelemetryEnabled(), JSON.stringify(v)).toBe(true)
    }
  })
  it('the switch in the shared test setup closes it, and a sink opens it either way', () => {
    __setRsTelemetryOffForTests(true)
    expect(rsTelemetryEnabled()).toBe(false)
    sink()
    expect(rsTelemetryEnabled()).toBe(true)
  })
})

describe('the five events and their props', () => {
  // U9 (RS split): `rs_preset` retired with the presets; the server refuses it too
  it('are exactly the plan\'s six less the retired rs_preset', () => {
    expect(Object.keys(RS_TELEMETRY_EVENTS).sort()).toEqual(
      ['rs_benchmark', 'rs_learn', 'rs_marker_card', 'rs_off_within_60s', 'rs_on'])
    expect('rs_preset' in RS_TELEMETRY_EVENTS).toBe(false)
  })
  it('an unknown event is refused; props outside each event\'s one field, or not an identifier, are dropped', () => {
    sink()
    expect(logRsEvent('rs_whatever', {})).toBe(false)
    expect(logRsEvent('rs_preset', { name: 'classic' }), 'retired event (U9)').toBe(false)
    logRsEvent('rs_marker_card', { kind: 'checks', email: 'a@b.c' })
    logRsEvent('rs_on', { symbol: 'BRK.B', name: 'x' })
    logRsEvent('rs_learn', { target: 'not an identifier!' })
    // a symbol the server's ticker rule refuses is dropped, and the count still lands
    logRsEvent('rs_off_within_60s', { symbol: 'nvda' })
    expect(sent).toEqual([
      ['rs_marker_card', { kind: 'checks' }],
      ['rs_on', { symbol: 'BRK.B' }],
      ['rs_learn', {}],
      ['rs_off_within_60s', {}],
    ])
  })
  it('the symbol rule is the ticker rule of the server (`indicator_telemetry._RS_TICKER`)', () => {
    for (const ok of ['NVDA', 'BRK-B', 'BRK.B', 'X:BTCUSD', 'A']) expect(SYMBOL_RE.test(ok), ok).toBe(true)
    for (const bad of ['nvda', 'NV DA', '', '-NVDA', 'ABCDEFGHIJKLM', 'NVDA!']) expect(SYMBOL_RE.test(bad), bad).toBe(false)
  })
  it('the door helpers fire for UCT RS only', () => {
    sink()
    noteRsCard('rsLine', 'beforePrice')
    noteRsCard('u_fixture', 'benchmark')
    noteRsLearn({ id: 'rsi' }, 'rsLine')
    noteRsLearn({ id: 'rsLine' }, 'redDay')
    expect(sent).toEqual([
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
      logRsEvent('rs_learn', { target: 'fourChecks' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/api/indicator-telemetry/event')
      const body = JSON.parse(init.body)
      expect(body).toMatchObject({ event: 'rs_learn', props: { target: 'fourChecks' } })
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
