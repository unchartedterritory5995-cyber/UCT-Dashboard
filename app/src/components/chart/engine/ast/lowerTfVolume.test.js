// app/src/components/chart/engine/ast/lowerTfVolume.test.js
//
// ─── ⭐⭐ e98 (owner ruling 2026-11-26, the store witness) — A LOWER-TIMEFRAME READ OF VOLUME STAYS WITHHELD BY NAME ─
//
// Our store's volume is consolidated and includes odd lots; TradingView's excludes them (store / TradingView about
// 1.2-1.6x on every 15m bar, measured: `storeIntradayAgreement.test.js`, local evidence). A child read below the chart
// that reads `volume` (or a closed-table function whose row reads it) would compute a different number than
// TradingView's, so once `VITE_PINE_LOWER_TF_ENABLED` is on it is refused BY NAME (`lower-tf:volume-definition`) with
// the definition sentence. A price read is served. While the gate is off the gate's own refusal answers first.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { translatePine } from './pine.js'
import { LOWER_TF_REFUSAL as R, LOWER_TF_VOLUME_DEFINITION } from '../lowerTf.js'

const pine = (line) => ['//@version=6', 'indicator("e98 lower-tf volume")', line].join('\n')
const HOST = { strict: true }
const read = (line) => translatePine(pine(line), HOST)

afterEach(() => vi.unstubAllEnvs())

describe('e98 — with the lower-timeframe gate ON', () => {
  const on = () => vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')

  it('`volume` read at "15" on a daily chart: withheld by name, with the definition sentence', () => {
    on()
    const t = read('plot(request.security(syminfo.tickerid, "15", volume))')
    expect(t.ok).toBe(false)
    expect(t.refusal.message).toContain(R.VOLUME_DEFINITION)
    expect(t.refusal.message).toContain(LOWER_TF_VOLUME_DEFINITION)
  })

  it('a windowed function OF volume, and a closed-table function that reads volume itself, are withheld too', () => {
    on()
    expect(read('plot(request.security(syminfo.tickerid, "60", ta.sma(volume, 5)))').refusal.message).toContain(R.VOLUME_DEFINITION)
    expect(read('plot(request.security(syminfo.tickerid, "60", ta.vwap))').refusal.message).toContain(R.VOLUME_DEFINITION)
  })

  it('CONTROL: a price read at the same timeframe is served', () => {
    on()
    expect(read('plot(request.security(syminfo.tickerid, "15", close))').ok).toBe(true)
    expect(read('plot(request.security(syminfo.tickerid, "60", ta.sma(close, 20)))').ok).toBe(true)
  })

  it('CONTROL: a child with another reason keeps that reason (an earlier rule answers first)', () => {
    on()
    expect(read('plot(request.security(syminfo.tickerid, "60", ta.cum(volume)))').refusal.message).toContain(R.EXPRESSION)
  })
})

describe('e98 — with the gate OFF (as every build ships)', () => {
  it('the gate\'s own refusal answers a volume read, not the definition', () => {
    vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '')
    const m = read('plot(request.security(syminfo.tickerid, "15", volume))').refusal.message
    expect(m).toContain(R.STORE_UNMEASURED)
    expect(m).not.toContain(R.VOLUME_DEFINITION)
  })
})
