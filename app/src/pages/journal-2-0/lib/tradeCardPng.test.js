import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderTradeCardPng } from './tradeCardPng'

// jsdom ships no real canvas backend (getContext returns null, toBlob throws
// "not implemented"), so we stub both prototype methods: a 2d context whose
// drawing methods are spies, and a toBlob that hands its callback a fake Blob.

const FAKE_BLOB = new Blob(['png-bytes'], { type: 'image/png' })

let ctx
function makeCtx() {
  return {
    // drawing methods used by drawCard
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 120 })),
    // assignable state props (plain object accepts writes)
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  }
}

const SAMPLE_TRADE = {
  id: 't1', symbol: 'NVDA', side: 'Long', shares: 100,
  entryPrice: 50, exitPrice: 56, originalStop: 48, rMultiple: 2.4,
  pnlDollar: 600, pnlDollarNet: 588, pnlPercent: 0.12, holdDays: 3,
  result: 'Win', setup: 'VCP', entryDate: '2026-05-01', exitDate: '2026-05-04',
}

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

describe('renderTradeCardPng', () => {
  it('resolves to the PNG Blob produced by canvas.toBlob', async () => {
    const blob = await renderTradeCardPng(SAMPLE_TRADE)
    expect(blob).toBe(FAKE_BLOB)
    expect(blob.type).toBe('image/png')
  })

  it('draws the card (rect fills + text) onto the 2d context', async () => {
    await renderTradeCardPng(SAMPLE_TRADE)
    expect(ctx.fillRect).toHaveBeenCalled()   // background + accent bar + hairline
    expect(ctx.fillText).toHaveBeenCalled()   // symbol / pnl / stats / brand
    // the branded wordmark + tagline are drawn
    const drawn = ctx.fillText.mock.calls.map((c) => c[0])
    expect(drawn).toContain('UCT INTELLIGENCE')
    expect(drawn).toContain('Navigate the market, effectively.')
    expect(drawn).toContain('NVDA')
  })

  it('requests a PNG (image/png) from toBlob', async () => {
    await renderTradeCardPng(SAMPLE_TRADE)
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png',
    )
  })

  it('does not throw on a trade with null pnl / setup / dates', async () => {
    const sparse = {
      symbol: 'AMD', side: null, entryPrice: null, exitPrice: null,
      pnlDollar: null, pnlDollarNet: null, pnlPercent: null, rMultiple: null,
      setup: null, holdDays: null, exitDate: null, result: null,
    }
    const blob = await renderTradeCardPng(sparse)
    expect(blob).toBe(FAKE_BLOB)
    // dash-guarded values still drew (no "undefined"/"null" text)
    const drawn = ctx.fillText.mock.calls.map((c) => String(c[0]))
    expect(drawn.some((s) => s.includes('undefined'))).toBe(false)
    expect(drawn.some((s) => s.includes('null'))).toBe(false)
  })

  it('rejects when no 2d context is available', async () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null)
    await expect(renderTradeCardPng(SAMPLE_TRADE)).rejects.toThrow(/context/i)
  })
})
