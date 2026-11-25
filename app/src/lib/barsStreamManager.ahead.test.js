// ⭐ THE ROWS AHEAD RIDE THE SAME CONNECTION, AS `ahead=` PAIRS (2026-11-25, the next rows on the live stream).
// The watchlist puts the next 1-2 rows (the way the member is moving) on the bars stream, so the first press after a minute
// roll finds that row's copy as current as the chart on screen. Rules:
//   M1  an ahead pair rides the EXISTING connection, on the wire as `ahead=`, NEVER a second EventSource; ahead pairs alone
//       open no connection at all (no chart on screen, nothing to keep current for)
//   M2  a pair with an ordinary subscriber (the chart) is wired as ordinary, even while a row-ahead subscription also holds it
//   M3  at most AHEAD_MAX_PAIRS ahead pairs per page (the oldest subscriptions first)
//   M4  ahead pairs only fill room left in the connections the charts already open (the 50-pair cap counts both)
//   M5  getStatus().liveSince: the time since which the pair has been delivering WITHOUT A BREAK. Set by the first
//       developing frame; kept across a rebuild only when the new connection's first frame is the SAME bucket as the last
//       one before it; reset by an error, the server's vendor-down word, and the last subscriber leaving; null while not
//       delivering; a final-only frame does not set it
//   R1  (review of #2721, 1-A) a roll inside a rebuild gap breaks it (a browser connection re-sends only the current
//       bucket: the closed bucket's final never arrives), and it reads null until the first frame decides
//   R2  a pair that drops off every connection and rejoins starts fresh, even inside the same bucket
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as bars from './barsStreamManager'

class MockES {
  static instances = []
  constructor(url) {
    this.url = url; this.listeners = {}; this.onopen = null; this.onerror = null
    this.closed = false; MockES.instances.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  _open() { if (this.onopen) this.onopen() }
  _emit(type, data) { (this.listeners[type] || []).forEach((fn) => fn({ data: JSON.stringify(data) })) }
  _error() { if (this.onerror) this.onerror() }
}

beforeEach(() => {
  MockES.instances = []
  global.EventSource = MockES
  try { localStorage.removeItem('uct.barsPool.disabled') } catch { /* ignore */ }
  bars._resetForTests()
})
afterEach(() => { bars._resetForTests(); vi.useRealTimers() })

const flush = () => bars._flushRebuild()
const open = () => MockES.instances.filter((e) => !e.closed)
const q = (url) => Object.fromEntries(new URL(url, 'http://x').searchParams)
const dev = (sym, tf, t) => ({ sym, tf, bar: { t, o: 1, h: 1, l: 1, c: 1, v: 1 } })

describe('M: the rows ahead on the bars stream', () => {
  it('M1 an ahead pair rides the chart\'s connection as `ahead=`, never a second EventSource', () => {
    bars.subscribe('AAPL', '1', {})
    bars.subscribe('MSFT', '1', { ahead: true })
    bars.subscribe('NVDA', '1', { ahead: true })
    flush()
    expect(open().length).toBe(1)
    const p = q(open()[0].url)
    expect(p.bars).toBe('AAPL:1')
    expect(p.ahead.split(',').sort()).toEqual(['MSFT:1', 'NVDA:1'])
  })

  it('M1 ahead pairs alone open no connection', () => {
    bars.subscribe('MSFT', '1', { ahead: true })
    flush()
    expect(MockES.instances.length).toBe(0)
    expect(bars.getStatus('MSFT', '1')).toMatchObject({ connected: false, delivering: false, liveSince: null })
  })

  it('M2 a pair the chart subscribes is ordinary even while a row-ahead subscription also holds it', () => {
    bars.subscribe('AAPL', '1', {})
    bars.subscribe('MSFT', '1', { ahead: true })
    bars.subscribe('MSFT', '1', {})                     // the member reached MSFT: the chart now shows it
    flush()
    const p = q(open()[0].url)
    expect(p.bars.split(',').sort()).toEqual(['AAPL:1', 'MSFT:1'])
    expect(p.ahead).toBeUndefined()
  })

  it('M3 at most AHEAD_MAX_PAIRS ahead pairs per page, the oldest subscriptions first', () => {
    expect(bars.AHEAD_MAX_PAIRS).toBe(4)
    bars.subscribe('AAPL', '1', {})
    for (const s of ['A1', 'A2', 'A3', 'A4', 'A5']) bars.subscribe(s, '1', { ahead: true })
    flush()
    expect(q(open()[0].url).ahead.split(',').sort()).toEqual(['A1:1', 'A2:1', 'A3:1', 'A4:1'])
  })

  it('M4 ahead pairs only fill the room the charts\' connections leave (the 50-pair cap counts both)', () => {
    for (let i = 0; i < 49; i++) bars.subscribe(`S${String(i).padStart(2, '0')}`, '1', {})
    for (const s of ['A1', 'A2', 'A3']) bars.subscribe(s, '1', { ahead: true })
    flush()
    expect(open().length).toBe(1)
    const p = q(open()[0].url)
    expect(p.bars.split(',').length).toBe(49)
    expect(p.ahead.split(',')).toEqual(['A1:1'])
  })

  it('M5 liveSince: set by the first developing frame, kept across a rebuild that keeps the pair', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    bars.subscribe('AAPL', '1', {})
    bars.subscribe('MSFT', '1', { ahead: true })
    flush()
    const es = open()[0]
    es._open()
    vi.setSystemTime(1_001_000)
    es._emit('bar', { sym: 'MSFT', tf: '1', bar: { t: 60_000, c: 1, final: true } })   // a past bucket's final
    expect(bars.getStatus('MSFT', '1').liveSince).toBeNull()
    vi.setSystemTime(1_002_000)
    es._emit('bar', dev('MSFT', '1', 120_000))
    expect(bars.getStatus('MSFT', '1')).toMatchObject({ delivering: true, liveSince: 1_002_000 })
    vi.setSystemTime(1_005_000)
    bars.subscribe('TSLA', '1', {})                       // the next press: the union changes, the connection is rebuilt
    flush()
    const es2 = open()[0]
    expect(es2).not.toBe(es)
    expect(bars.getStatus('MSFT', '1').liveSince, 'reported live while its connection is down').toBeNull()
    es2._open()
    es2._emit('bar', dev('MSFT', '1', 120_000))
    expect(bars.getStatus('MSFT', '1').liveSince, 'a rebuild that kept the pair broke its continuity').toBe(1_002_000)
  })

  it('R1 a roll inside a rebuild gap breaks it; it reads null until the new connection\'s first frame decides', () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_000_000)
    bars.subscribe('AAPL', '1', {})
    bars.subscribe('MSFT', '1', { ahead: true })
    flush()
    const es = open()[0]
    es._open()
    es._emit('bar', dev('MSFT', '1', 120_000))                 // bucket 120 000 (M) delivering since 3 000 000
    expect(bars.getStatus('MSFT', '1').liveSince).toBe(3_000_000)
    vi.setSystemTime(3_005_000)
    bars.subscribe('TSLA', '1', {})                       // a press: the connection is rebuilt...
    flush()
    const es2 = open()[0]
    es2._open()
    expect(bars.getStatus('MSFT', '1').liveSince, 'reported live before the first frame decided').toBeNull()
    vi.setSystemTime(3_006_000)
    es2._emit('bar', dev('MSFT', '1', 180_000))                // ...and a roll fell inside the gap: the first frame is M+1
    expect(bars.getStatus('MSFT', '1').liveSince, 'a roll inside the rebuild gap kept the pair live through it').toBe(3_006_000)
  })

  it('R2 a pair that drops off every connection and rejoins starts fresh, even inside the same bucket', () => {
    vi.useFakeTimers()
    vi.setSystemTime(4_000_000)
    const offA = bars.subscribe('AAPL', '1', {})
    bars.subscribe('MSFT', '1', { ahead: true })
    flush()
    let es = open()[0]
    es._open()
    es._emit('bar', dev('MSFT', '1', 120_000))
    expect(bars.getStatus('MSFT', '1').liveSince).toBe(4_000_000)
    offA()                                                // the chart leaves: the row ahead rides no connection
    flush()
    expect(open().length).toBe(0)
    vi.setSystemTime(4_010_000)
    bars.subscribe('AAPL', '1', {})                       // ...and comes back within the staleness window
    flush()
    es = open()[0]
    es._open()
    es._emit('bar', dev('MSFT', '1', 120_000))
    expect(bars.getStatus('MSFT', '1').liveSince, 'a pair that dropped off reused its old liveSince').toBe(4_010_000)
  })

  it('M5 an error, the vendor-down word and the last subscriber leaving each reset it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    bars.subscribe('AAPL', '1', {})
    const offMsft = bars.subscribe('MSFT', '1', { ahead: true })
    flush()
    let es = open()[0]
    es._open()
    es._emit('bar', dev('MSFT', '1', 120_000))
    expect(bars.getStatus('MSFT', '1').liveSince).toBe(2_000_000)
    // an error
    es._error()
    vi.advanceTimersByTime(6_000)                         // the backoff reconnect
    es = open()[0]
    es._open()
    vi.setSystemTime(2_010_000)
    es._emit('bar', dev('MSFT', '1', 120_000))
    expect(bars.getStatus('MSFT', '1').liveSince).toBe(2_010_000)
    // the vendor socket is down
    es._emit('status', { live: false })
    es._emit('status', { live: true })
    vi.setSystemTime(2_020_000)
    es._emit('bar', dev('MSFT', '1', 180_000))
    expect(bars.getStatus('MSFT', '1').liveSince).toBe(2_020_000)
    // the last subscriber leaves, and the row comes back
    offMsft()
    bars.subscribe('MSFT', '1', { ahead: true })
    flush()
    es = open()[0]
    es._open()
    vi.setSystemTime(2_030_000)
    es._emit('bar', dev('MSFT', '1', 180_000))
    expect(bars.getStatus('MSFT', '1').liveSince).toBe(2_030_000)
  })
})
