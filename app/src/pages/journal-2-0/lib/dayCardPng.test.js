import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderDayCardPng } from './dayCardPng'

// Same canvas-stub fixture as tradeCardPng.test.js — jsdom has no canvas
// backend, so getContext/toBlob are stubbed.

const FAKE_BLOB = new Blob(['png-bytes'], { type: 'image/png' })

let ctx
function makeCtx() {
  return {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 120 })),
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  }
}

const METRICS = {
  netPnlDollar: 842.5, pnlPercent: 0.021, rSum: 3.1,
  tradeCount: 5, winners: 4, losers: 1, winRate: 0.8,
}
const TRADES = [
  { symbol: 'NVDA', pnlDollar: 600 },
  { symbol: 'AMD', pnlDollar: -120 },
  { symbol: 'TTD', pnlDollar: 362.5 },
]

beforeEach(() => {
  ctx = makeCtx()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    cb(FAKE_BLOB)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderDayCardPng', () => {
  it('resolves to the PNG Blob produced by canvas.toBlob', async () => {
    const blob = await renderDayCardPng('Thursday, August 21, 2026', METRICS, TRADES)
    expect(blob).toBe(FAKE_BLOB)
  })

  it('draws the date, net P&L, win rate and best trade', async () => {
    await renderDayCardPng('Thursday, August 21, 2026', METRICS, TRADES)
    const drawn = ctx.fillText.mock.calls.map((c) => c[0]).join(' | ')
    expect(drawn).toContain('Thursday, August 21, 2026')
    expect(drawn).toContain('DAY RECAP')
    expect(drawn).toContain('80% win rate')
    expect(drawn).toContain('4 / 1')
    expect(drawn).toContain('NVDA')            // best trade by |P&L|
    expect(drawn).toContain('uctintelligence.com')
  })

  it('does not throw on null metrics / empty trades — dashes, never undefined', async () => {
    await renderDayCardPng('2026-08-21', null, [])
    const drawn = ctx.fillText.mock.calls.map((c) => c[0]).join(' | ')
    expect(drawn).not.toContain('undefined')
    expect(drawn).not.toContain('NaN')
  })

  it('rejects when no 2d context is available', async () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null)
    await expect(renderDayCardPng('x', METRICS, TRADES)).rejects.toThrow()
  })
})
