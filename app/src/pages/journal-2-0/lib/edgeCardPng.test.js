import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderEdgeCardPng } from './edgeCardPng'

// jsdom ships no real canvas backend (getContext returns null, toBlob throws
// "not implemented"), so we stub both prototype methods: a 2d context whose
// drawing methods are spies, and a toBlob that hands its callback a fake Blob.
// (Same harness as tradeCardPng.test.js — Task B1.)

const FAKE_BLOB = new Blob(['png-bytes'], { type: 'image/png' })

let ctx
function makeCtx() {
  return {
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

const SAMPLE_EDGE = {
  score: 1.234,
  components: { winRate: 0.55, profitFactor: 1.8, rConsistency: 0.62, tradeCount: 42 },
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

describe('renderEdgeCardPng', () => {
  it('resolves to the PNG Blob produced by canvas.toBlob', async () => {
    const blob = await renderEdgeCardPng(SAMPLE_EDGE)
    expect(blob).toBe(FAKE_BLOB)
    expect(blob.type).toBe('image/png')
  })

  it('draws the card (rect fills + text) onto the 2d context', async () => {
    await renderEdgeCardPng(SAMPLE_EDGE)
    expect(ctx.fillRect).toHaveBeenCalled()   // background + header band + rule + hairline
    expect(ctx.fillText).toHaveBeenCalled()   // title / score / formula / stats / brand
    const drawn = ctx.fillText.mock.calls.map((c) => c[0])
    // Title + hero score + brand + tagline.
    expect(drawn).toContain('Weekly Edge Score')
    expect(drawn).toContain('1.234')
    expect(drawn).toContain('UCT INTELLIGENCE')
    expect(drawn).toContain('Navigate the market, effectively.')
    // The 4 component labels + at least one value.
    expect(drawn).toContain('WIN RATE')
    expect(drawn).toContain('PROFIT FACTOR')
    expect(drawn).toContain('R-CONSISTENCY')
    expect(drawn).toContain('TRADES')
    expect(drawn).toContain('55.0%')
    expect(drawn).toContain('42')
  })

  it('requests a PNG (image/png) from toBlob', async () => {
    await renderEdgeCardPng(SAMPLE_EDGE)
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png',
    )
  })

  it('null score → draws the honest "not enough data" card, no fabricated number', async () => {
    const nullEdge = {
      score: null,
      components: { winRate: 0.5, profitFactor: null, rConsistency: null, tradeCount: 6 },
    }
    const blob = await renderEdgeCardPng(nullEdge)
    expect(blob).toBe(FAKE_BLOB)
    const drawn = ctx.fillText.mock.calls.map((c) => String(c[0]))
    // Honest requirement copy, and a dim em-dash where the score would be.
    expect(drawn.some((s) => /Not enough data/i.test(s))).toBe(true)
    expect(drawn.some((s) => /Need 10\+ trades with R-multiples/i.test(s))).toBe(true)
    expect(drawn).toContain('—')
    // No "undefined"/"null" leaked into any drawn string.
    expect(drawn.some((s) => s.includes('undefined'))).toBe(false)
    expect(drawn.some((s) => s.includes('null'))).toBe(false)
    // Progress still visible: the trade count component drew "6".
    expect(drawn).toContain('6')
  })

  it('does not throw on a null / empty edgeScore', async () => {
    await expect(renderEdgeCardPng(null)).resolves.toBe(FAKE_BLOB)
    await expect(renderEdgeCardPng({})).resolves.toBe(FAKE_BLOB)
    const drawn = ctx.fillText.mock.calls.map((c) => String(c[0]))
    expect(drawn.some((s) => s.includes('undefined'))).toBe(false)
    expect(drawn.some((s) => s.includes('null'))).toBe(false)
  })

  it('rejects when no 2d context is available', async () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null)
    await expect(renderEdgeCardPng(SAMPLE_EDGE)).rejects.toThrow(/context/i)
  })
})
