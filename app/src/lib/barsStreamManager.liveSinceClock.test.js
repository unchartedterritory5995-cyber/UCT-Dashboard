// ⭐ (2026-11-25, the merge of #2721 into #2733) THE STREAM'S `liveSince` IS ON THE SERVER'S CLOCK. prefetch compares it with
// the roll (`_rollMs`), which reads lib/serverClock's `serverNow`: stamped with the member's own clock 6 s slow, a stream
// that started 3 s AFTER the roll read as live since BEFORE it, and rule a / the stream's proof of bar M would lend a copy
// the frontier it does not hold.
//   LC1 with a 6.2 s slow member clock learned, the first developing frame stamps liveSince on the server's clock
//   LC2 control: with nothing learned it is the member's clock, exactly as before
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as bars from './barsStreamManager'
import { noteServerDate, serverNow, __resetServerClockForTests } from './serverClock'

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
}

const NOW = Date.UTC(2026, 10, 25, 15, 3, 0, 400)   // 10:03:00.4 ET by the member's clock
beforeEach(() => {
  MockES.instances = []
  global.EventSource = MockES
  try { localStorage.removeItem('uct.barsPool.disabled') } catch { /* ignore */ }
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  // one clock the test moves (fake timers): the member's wall and the monotonic clock together
  __resetServerClockForTests({ wall: () => Date.now(), mono: () => Date.now() })
  bars._resetForTests()
})
afterEach(() => { bars._resetForTests(); __resetServerClockForTests(); vi.useRealTimers() })

const open = () => MockES.instances.filter((e) => !e.closed)
const dev = (sym, tf, t) => ({ sym, tf, bar: { t, o: 1, h: 1, l: 1, c: 1, v: 1 } })

function liveStream() {
  bars.subscribe('AAPL', '1', {})
  bars.subscribe('MSFT', '1', { ahead: true })
  bars._flushRebuild()
  const es = open()[0]
  es._open()
  return es
}

describe('the stream\'s liveSince is on the server\'s clock', () => {
  it('LC1 a member clock 6.2 s slow: the first developing frame stamps liveSince with the server\'s time', () => {
    for (let i = 0; i < 3; i++) {
      expect(noteServerDate(new Date(Date.now() + 6200).toUTCString(), { sentAt: Date.now() - 40, receivedAt: Date.now() })).toBe(true)
    }
    const es = liveStream()
    es._emit('bar', dev('MSFT', '1', Math.floor((NOW + 6200) / 60000) * 60000))
    const since = bars.getStatus('MSFT', '1').liveSince
    expect(Math.abs(since - (Date.now() + 6200)), 'liveSince was stamped with the member\'s clock').toBeLessThanOrEqual(600)
    expect(Math.abs(since - serverNow())).toBeLessThanOrEqual(1)
  })

  it('LC2 control: with nothing learned it is the member\'s clock, exactly', () => {
    const es = liveStream()
    es._emit('bar', dev('MSFT', '1', Math.floor(NOW / 60000) * 60000))
    expect(bars.getStatus('MSFT', '1').liveSince).toBe(NOW)
  })
})
