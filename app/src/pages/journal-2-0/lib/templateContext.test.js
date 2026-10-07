import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  assembleTemplateContext,
  emptyTemplateContext,
  extractSectionBullets,
} from './templateContext'

afterEach(() => vi.unstubAllGlobals())

const okJson = (payload) => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })

describe('extractSectionBullets', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Levels' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SPY 560' }] }] }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'My plan' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'prose between' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'If X, do Y' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'If Z, stand down' }] }] },
      ] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'After' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'not mine' }] }] }] },
    ],
  }

  it('collects bullets only under the matching heading', () => {
    expect(extractSectionBullets(doc, 'My plan')).toEqual(['If X, do Y', 'If Z, stand down'])
  })

  it('returns [] for a missing section or garbage input', () => {
    expect(extractSectionBullets(doc, 'Nope')).toEqual([])
    expect(extractSectionBullets(null, 'My plan')).toEqual([])
    expect(extractSectionBullets({ content: 'bad' }, 'My plan')).toEqual([])
  })
})

describe('assembleTemplateContext', () => {
  it('fetches only what the template declares it needs', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url) => { calls.push(String(url)); return okJson({}) }))
    await assembleTemplateContext({ needs: { regime: true } })
    expect(calls).toEqual(['/api/breadth'])
  })

  it('builds regime + position lines from the API shapes', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url) === '/api/breadth') {
        return okJson({ market_phase: 'UPTREND', exposure: { score: 95.4 } })
      }
      return okJson({ positions: [{ symbol: 'NVDA', side: 'long', entryPrice: 120, stopPrice: 112, shares: 10 }] })
    }))
    const ctx = await assembleTemplateContext({ needs: { regime: true, positions: true }, ticker: 'nvda' })
    expect(ctx.regimeLine).toBe('UPTREND — UCT exposure 95/150')
    expect(ctx.positionLines).toEqual(['NVDA LONG · in $120.00 · stop $112.00'])
    expect(ctx.ticker).toBe('NVDA')
    expect(ctx.dateShort.length).toBeGreaterThan(0)
  })

  it('every source failing still yields a usable blank context', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))))
    const ctx = await assembleTemplateContext({ needs: { regime: true, positions: true, gamePlan: true } })
    expect(ctx.regimeLine).toBeNull()
    expect(ctx.positionLines).toEqual([])
    expect(ctx.gamePlanNote).toBeNull()
    expect(ctx.dateText.length).toBeGreaterThan(0)
  })

  it("finds today's game-plan note and extracts its plan bullets", async () => {
    const today = new Date().toISOString()
    vi.stubGlobal('fetch', vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/j2/notes?')) {
        return okJson({ notes: [
          { id: 'old', title: 'Game Plan — old', createdAt: '2020-01-01T12:00:00Z' },
          { id: 'gp1', title: 'Game Plan — today', createdAt: today },
        ] })
      }
      if (u === '/api/j2/notes/gp1') {
        return okJson({ note: { id: 'gp1', bodyJson: { type: 'doc', content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'My plan' }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'If SPY holds 560, add' }] }] }] },
        ] } } })
      }
      return okJson({})
    }))
    const ctx = await assembleTemplateContext({ needs: { gamePlan: true } })
    expect(ctx.gamePlanNote).toEqual({ id: 'gp1', title: 'Game Plan — today', planBullets: ['If SPY holds 560, add'] })
  })
})

describe('emptyTemplateContext', () => {
  it('is fully blank but dated', () => {
    const ctx = emptyTemplateContext()
    expect(ctx.regimeLine).toBeNull()
    expect(ctx.positionLines).toEqual([])
    expect(ctx.gamePlanNote).toBeNull()
    expect(ctx.dateText.length).toBeGreaterThan(0)
    expect(ctx.weekOfText.length).toBeGreaterThan(0)
  })
})
