// app/src/lib/symbolPace.test.jsx
//
// ─── A SYMBOL THE MEMBER IS RACING PAST ASKS THE SERVER FOR NOTHING ──────────
//
// Measured on production 2026-11-13 (bench member, the arrow key held through 40 charts of a
// list, then released): the browser sent 246 requests in 11.5 s, 121 of them in flight at
// once and 117 still open when the key was released. Six small reads per chart passed
// (delisted, split basis, snapshot, listing date, leveraged family, name and sector), each
// started the moment the chart showed a symbol the member left 0.25 s later. The pod then
// took 4 to 6 s to answer anything, and the chart the member stopped on drew its RS lines
// 5.4 to 6.0 s after its candles, even when the server had them cached.
//
// These rails pin the gate: what is asked while racing (nothing new), what is still shown
// (everything the browser already holds), and what the chart a member stops on gets.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import {
  createPace, useRestedSWR, restGateDisabled,
  RACE_MS, REST_FACTOR, REST_MIN_MS, REST_MAX_MS, REST_GATE_OFF_KEY, __resetRestGate,
} from './symbolPace'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.removeItem(REST_GATE_OFF_KEY)
  __resetRestGate()
})
afterEach(() => {
  localStorage.removeItem(REST_GATE_OFF_KEY)
  vi.useRealTimers()
})

describe('the cadence of one stream of steps', () => {
  it('a first step, and steps a reader takes, are not racing', () => {
    const p = createPace()
    expect(p.step(1000)).toBe(false)
    expect(p.step(1000 + RACE_MS)).toBe(false)
    expect(p.step(1000 + RACE_MS + 700)).toBe(false)
    expect(p.restMs()).toBe(0)
  })

  it('⭐ two steps closer than RACE_MS are racing, and "stopped" is 1.3 x that step with no further one', () => {
    const p = createPace()
    p.step(0)
    expect(p.step(200)).toBe(true)
    expect(p.restMs()).toBe(Math.round(200 * REST_FACTOR))
  })

  it('RACE_MS itself is a reader: the limit excludes its own edge', () => {
    const p = createPace()
    p.step(0)
    expect(p.step(RACE_MS)).toBe(false)
    const q = createPace()
    q.step(0)
    expect(q.step(RACE_MS - 1)).toBe(true)
  })

  it('one slow step in a run of fast ones is still a run, and the wait follows the slower FAST step', () => {
    const p = createPace()
    p.step(0); p.step(180); p.step(180 + 290)
    expect(p.racing()).toBe(true)
    expect(p.restMs(), '1.3 x the slower of the two').toBe(Math.round(290 * REST_FACTOR))
    p.step(180 + 290 + 900)                              // a pause that the gate was not told about
    expect(p.racing(), 'the step before it was fast').toBe(true)
    expect(p.restMs(), 'a pause is not a step to wait by').toBe(Math.round(290 * REST_FACTOR))
  })

  it('the wait is bounded both ways', () => {
    const p = createPace()
    p.step(0); p.step(20)
    expect(Math.round(20 * REST_FACTOR)).toBeLessThan(REST_MIN_MS)
    expect(p.restMs()).toBe(REST_MIN_MS)
    const q = createPace()
    q.step(0); q.step(RACE_MS - 1); q.step(2 * (RACE_MS - 1))
    expect(Math.round((RACE_MS - 1) * REST_FACTOR)).toBeGreaterThan(REST_MAX_MS)
    expect(q.restMs()).toBe(REST_MAX_MS)
  })

  it('⭐ once it has rested, the next step starts from nothing: one step after a run is a reader', () => {
    const p = createPace()
    p.step(0); p.step(150); p.step(300)
    expect(p.racing()).toBe(true)
    p.rested()
    expect(p.racing()).toBe(false)
    expect(p.step(5000), 'not judged against the run before the rest').toBe(false)
    expect(p.step(5150), 'and a new run is a new run').toBe(true)
  })

  it('two calls in the same instant are one step', () => {
    const p = createPace()
    p.step(1000)
    expect(p.step(1000)).toBe(false)
    expect(p.step(1004)).toBe(false)
    expect(p.step(1200), 'measured from the first of them').toBe(true)
  })
})

// ─── the hook ────────────────────────────────────────────────────────────────

let asked
const fetcher = (key) => { asked.push(key); return new Promise(() => {}) }
const keyOf = (sym) => (sym ? `/api/thing/${sym}` : null)

function Probe({ sym, seen, opts }) {
  const { data } = useRestedSWR(keyOf(sym), fetcher, opts)
  seen.push(`${sym}:${data === undefined ? '-' : data}`)
  return null
}

function mount(first, { cache = new Map(), opts } = {}) {
  asked = []
  const seen = []
  const ui = (sym) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <Probe sym={sym} seen={seen} opts={opts} />
    </SWRConfig>
  )
  const r = render(ui(first))
  return { seen, cache, show: (sym) => act(() => { r.rerender(ui(sym)) }), unmount: () => r.unmount() }
}
const wait = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('⭐ a read keyed by the symbol waits while the member races, and asks for the one they stop on', () => {
  it('a symbol the member arrives on and reads is asked for at once', async () => {
    const m = mount('AAA')
    await wait(0)
    expect(asked).toEqual(['/api/thing/AAA'])
    await wait(900)
    m.show('BBB')
    await wait(0)
    expect(asked, 'a reader\'s step: no wait').toEqual(['/api/thing/AAA', '/api/thing/BBB'])
  })

  it('the symbols passed in a run are never asked for; the one the member stops on is, once', async () => {
    const m = mount('AAA')
    await wait(900)
    for (const s of ['BBB', 'CCC', 'DDD', 'EEE']) { m.show(s); await wait(200) }
    expect(asked, 'BBB arrived as a reader would; the rest were raced past').toEqual(['/api/thing/AAA', '/api/thing/BBB'])
    await wait(Math.round(200 * REST_FACTOR) - 200 - 2)
    expect(asked.length, 'not before 1.3 x the step has passed with no further one').toBe(2)
    await wait(4)
    expect(asked).toEqual(['/api/thing/AAA', '/api/thing/BBB', '/api/thing/EEE'])
    await wait(5000)
    expect(asked.length, 'and only once').toBe(3)
  })

  it('what the browser already holds is shown at once, racing or not', async () => {
    const cache = new Map()
    const m = mount('AAA', { cache })
    await wait(900)
    // (the pre-load, or an earlier visit, put DDD's answer in the cache)
    cache.set('/api/thing/DDD', { data: 'held' })
    for (const s of ['BBB', 'CCC', 'DDD']) { m.show(s); await wait(150) }
    expect(m.seen[m.seen.length - 1]).toBe('DDD:held')
    await wait(2000)
    expect(asked.filter((k) => k.endsWith('DDD')), 'and nothing is asked for it: it is there').toEqual([])
  })

  it('CONTROL: a scan at a reading pace asks for every symbol at once, as before', async () => {
    const m = mount('AAA')
    await wait(RACE_MS)
    for (const s of ['BBB', 'CCC', 'DDD']) { m.show(s); await wait(RACE_MS) }
    expect(asked).toEqual(['AAA', 'BBB', 'CCC', 'DDD'].map((s) => `/api/thing/${s}`))
  })

  it('after the member has stopped, the next step is a reader\'s again', async () => {
    const m = mount('AAA')
    await wait(900)
    for (const s of ['BBB', 'CCC', 'DDD']) { m.show(s); await wait(150) }
    await wait(3000)
    const n = asked.length
    m.show('EEE')
    await wait(0)
    expect(asked.slice(n), 'asked at once').toEqual(['/api/thing/EEE'])
  })

  it('a pane that is closed mid-run asks for nothing afterwards', async () => {
    const m = mount('AAA')
    await wait(900)
    for (const s of ['BBB', 'CCC', 'DDD']) { m.show(s); await wait(150) }
    const n = asked.length
    m.unmount()
    await wait(5000)
    expect(asked.length).toBe(n)
  })

  it('two readers of one key that stop together send one request', async () => {
    asked = []
    const cache = new Map()
    const seen = []
    const ui = (sym) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <Probe sym={sym} seen={seen} />
        <Probe sym={sym} seen={seen} />
      </SWRConfig>
    )
    const r = render(ui('AAA'))
    await wait(900)
    for (const s of ['BBB', 'CCC', 'DDD']) { act(() => { r.rerender(ui(s)) }); await wait(150) }
    await wait(3000)
    expect(asked.filter((k) => k.endsWith('DDD'))).toEqual(['/api/thing/DDD'])
  })

  it('the caller\'s own SWR options are kept', async () => {
    const onSuccess = vi.fn()
    asked = []
    const done = (key) => { asked.push(key); return Promise.resolve('ok') }
    function P() { const { data } = useRestedSWR('/api/thing/AAA', done, { onSuccess }); return <i>{data}</i> }
    render(<SWRConfig value={{ provider: () => new Map() }}><P /></SWRConfig>)
    await wait(10)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('⛔ the per-browser switch turns the gate off: every symbol is asked for at once', async () => {
    localStorage.setItem(REST_GATE_OFF_KEY, '1')
    __resetRestGate()
    expect(restGateDisabled()).toBe(true)
    const m = mount('AAA')
    await wait(900)
    for (const s of ['BBB', 'CCC', 'DDD']) { m.show(s); await wait(150) }
    expect(asked).toEqual(['AAA', 'BBB', 'CCC', 'DDD'].map((s) => `/api/thing/${s}`))
  })
})
