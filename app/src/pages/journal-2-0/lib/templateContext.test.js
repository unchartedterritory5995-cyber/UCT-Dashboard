import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  assembleTemplateContext,
  emptyTemplateContext,
  extractSectionBullets,
} from './templateContext'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'

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
    expect(ctx.earningsPrepDraft).toBeNull()
    expect(ctx.dateText.length).toBeGreaterThan(0)
    expect(ctx.weekOfText.length).toBeGreaterThan(0)
  })
})

// Wave 13 lane 13C-2: the earnings-prep template declares `needs.earningsPrepDraft` and reads
// `ctx.earningsPrepDraft` -- the SAME POST the one-click "Create prep note" door makes
// (earningsPrepShared.js::requestPrepDraft). These prove the fetch is gated correctly: only
// when both the need and a ticker are present, never raced with the other sources' timeout,
// and a refusal (the daily cap, a gate 404) resolves to null rather than throwing.
describe('assembleTemplateContext -- the earnings-prep draft (13C-2)', () => {
  afterEach(() => __resetNotebookFlags())

  it('fetches nothing when the template does not declare the need, even with a ticker and the gate on', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url) => { calls.push(String(url)); return okJson({}) }))
    const ctx = await assembleTemplateContext({ ticker: 'NVDA', needs: {} })
    expect(calls).toEqual([])
    expect(ctx.earningsPrepDraft).toBeNull()
  })

  it('fetches nothing when a ticker is not given, even with the need declared and the gate on', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url) => { calls.push(String(url)); return okJson({}) }))
    const ctx = await assembleTemplateContext({ needs: { earningsPrepDraft: true } })
    expect(calls).toEqual([])
    expect(ctx.earningsPrepDraft).toBeNull()
  })

  // ⛔ Found by the real-browser walk (tools/notebook_w13c2_walk.py, run 1): a member can
  // still pick the Earnings Prep template while the capability is dark -- the catalog card
  // is not itself flag-gated, same as every other template. Without this, a ticker-scoped
  // pick while OFF reached the real POST, got a 404 from the server's own gate, and silently
  // fell back -- safe, but a network call the member-facing "fetches nothing while off"
  // promise (ReportingSoon.jsx's own words) does not make for every OTHER door.
  it('fetches nothing when the capability is not latched ON client-side, even with a ticker and the need declared', async () => {
    __resetNotebookFlags()
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url) => { calls.push(String(url)); return okJson({}) }))
    const ctx = await assembleTemplateContext({ ticker: 'NVDA', needs: { earningsPrepDraft: true } })
    expect(calls).toEqual([])
    expect(ctx.earningsPrepDraft).toBeNull()
  })

  it('fetches nothing when the capability is explicitly latched OFF, even with a ticker and the need declared', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: false })
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url) => { calls.push(String(url)); return okJson({}) }))
    const ctx = await assembleTemplateContext({ ticker: 'NVDA', needs: { earningsPrepDraft: true } })
    expect(calls).toEqual([])
    expect(ctx.earningsPrepDraft).toBeNull()
  })

  it('POSTs the SAME draft endpoint the one-click door uses, once, for the normalized ticker, once the gate is latched ON', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const draft = { symbol: 'NVDA', frozenAt: '2026-10-02T14:00:00Z', report: {} }
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
      calls.push([String(url), init.method || 'GET'])
      return okJson(draft)
    }))
    const ctx = await assembleTemplateContext({ ticker: ' nvda ', needs: { earningsPrepDraft: true } })
    expect(calls).toEqual([['/api/j2/earnings-prep/NVDA/draft', 'POST']])
    expect(ctx.earningsPrepDraft).toEqual(draft)
    expect(ctx.ticker).toBe('NVDA')
  })

  it('a refused draft (the daily cap) resolves to null, not a thrown error', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ detail: 'cap' }) })))
    const ctx = await assembleTemplateContext({ ticker: 'NVDA', needs: { earningsPrepDraft: true, regime: true } })
    expect(ctx.earningsPrepDraft).toBeNull()
    // the OTHER sources on the same Promise.all are unaffected by this one's refusal
    expect(ctx.regimeLine).toBeNull()
  })

  it('runs alongside the other sources, not blocked by or blocking them', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url) => {
      calls.push(String(url))
      if (String(url) === '/api/breadth') return okJson({ market_phase: 'UPTREND', exposure: { score: 90 } })
      return okJson({ symbol: 'NVDA' })
    }))
    const ctx = await assembleTemplateContext({ ticker: 'NVDA', needs: { regime: true, earningsPrepDraft: true } })
    expect(new Set(calls)).toEqual(new Set(['/api/breadth', '/api/j2/earnings-prep/NVDA/draft']))
    expect(ctx.regimeLine).toBe('UPTREND — UCT exposure 90/150')
    expect(ctx.earningsPrepDraft).toEqual({ symbol: 'NVDA' })
  })
})
