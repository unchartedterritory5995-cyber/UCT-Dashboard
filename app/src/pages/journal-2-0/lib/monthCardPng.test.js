import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderMonthCardPng } from './monthCardPng'

const FAKE_BLOB = new Blob(['png'], { type: 'image/png' })
let ctx
function makeCtx() {
  return {
    fillRect: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 120 })),
    fillStyle: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
  }
}

const DAYS = [
  { date: '2026-08-03', pnlDollar: 300, tradeCount: 2 },
  { date: '2026-08-04', pnlDollar: -100, tradeCount: 1 },
  { date: '2026-08-05', pnlDollar: 0, tradeCount: 0 },   // untraded — excluded
  { date: '2026-08-06', pnlDollar: 650, tradeCount: 3 },
]
const TOTALS = { netPnlDollar: 850, tradeCount: 6, winners: 4, losers: 2 }

beforeEach(() => {
  ctx = makeCtx()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) { cb(FAKE_BLOB) })
})
afterEach(() => vi.restoreAllMocks())

describe('renderMonthCardPng', () => {
  it('draws month label, win rate, green-day count and best day', async () => {
    const blob = await renderMonthCardPng('August 2026', DAYS, TOTALS)
    expect(blob).toBe(FAKE_BLOB)
    const drawn = ctx.fillText.mock.calls.map((c) => c[0]).join(' | ')
    expect(drawn).toContain('August 2026')
    expect(drawn).toContain('MONTH RECAP')
    expect(drawn).toContain('67% win rate')          // 4 / 6 decisive
    expect(drawn).toContain('2 green days of 3')     // untraded day excluded
    expect(drawn).toContain('2026-08-06')            // best day
  })

  it('empty month never throws or draws undefined', async () => {
    await renderMonthCardPng('August 2026', [], null)
    const drawn = ctx.fillText.mock.calls.map((c) => c[0]).join(' | ')
    expect(drawn).not.toContain('undefined')
    expect(drawn).not.toContain('NaN')
  })
})
