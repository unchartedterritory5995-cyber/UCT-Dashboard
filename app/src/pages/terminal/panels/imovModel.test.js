// IMOV's pure model: equal-weight contributions that reconcile to the basket's return, the owner
// basket rule (engine-overlay members never count), and the refusal of an index or ETF.
import { describe, it, expect } from 'vitest'
import {
  INDEX_FUNDS, biggestMover, contributionRead, normSym, ownerSyms, refusalFor, splitRead, themesHolding, themesOf,
  trackerDiffers,
} from './imovModel'
import { AI, PAYLOAD, SEMIS } from './__fixtures__/imovThemes'

const THEMES = themesOf(PAYLOAD)
const sum = (xs) => xs.reduce((s, x) => s + x, 0)

describe('contributionRead', () => {
  it('each counted name contributes its return ÷ N, and the contributions sum to the equal-weight mean', () => {
    const r = contributionRead(SEMIS, '1D')
    expect(r.n).toBe(4)
    expect(Object.fromEntries(r.rows.map((x) => [x.sym, x.contrib]))).toEqual({ NVDA: 1, AMD: 0.5, AVGO: -0.25, MU: -0.75 })
    expect(r.total).toBeCloseTo(0.5, 10)
    expect(r.total).toBeCloseTo(sum(r.rows.map((x) => x.ret)) / r.n, 10)
  })

  it('an engine-overlay member never counts, even with the biggest move in the basket', () => {
    const r = contributionRead(SEMIS, '1D')
    expect(r.rows.map((x) => x.sym)).not.toContain('ENGX')
    expect(r.engine).toEqual(['ENGX'])
    // control: the same holding as an owner member WOULD move the total, so the rule is load-bearing
    const promoted = { ...SEMIS, holdings: SEMIS.holdings.map((h) => (h.sym === 'ENGX' ? { ...h, source: 'owner' } : h)) }
    expect(contributionRead(promoted, '1D').total).not.toBeCloseTo(0.5, 5)
  })

  it('the owner basket mirrors theme_performance: absent source is an owner, _owner_syms counts too', () => {
    expect([...ownerSyms(SEMIS)].sort()).toEqual(['AMD', 'AVGO', 'INTC', 'MU', 'NVDA'])
    const stashed = { holdings: [{ sym: 'BRK.B', source: 'engine', returns: { '1d': 2 } }], _owner_syms: ['BRK-B'] }
    expect(contributionRead(stashed, '1D')).toMatchObject({ n: 1, total: 2, engine: [] })
  })

  it('a member with no return for the window is named, not counted, and does not dilute N', () => {
    const r = contributionRead(SEMIS, '1D')
    expect(r.unpriced).toEqual(['INTC'])
    expect(contributionRead(SEMIS, '1M')).toMatchObject({ n: 0, total: null })
  })

  it('reads the window it was asked for, and the tracker figure for that window', () => {
    const w = contributionRead(SEMIS, '1W')
    expect(w.key).toBe('1w')
    expect(w.total).toBeCloseTo((10 - 2 + 3 + 1) / 4, 10)
    expect(w.published).toBe(3.0)
    expect(trackerDiffers(w)).toBe(false)
    expect(trackerDiffers(contributionRead(SEMIS, '1D'))).toBe(true)
    expect(trackerDiffers(contributionRead(AI, '1D'))).toBe(false)
  })
})

describe('splitRead', () => {
  it('the listed contributors, the listed detractors and the rest always add up to the total', () => {
    for (const topN of [1, 2, 8]) {
      for (const win of ['1D', '1W']) {
        const r = contributionRead(SEMIS, win)
        const s = splitRead(r, topN)
        const parts = sum(s.contributors.map((x) => x.contrib)) + sum(s.detractors.map((x) => x.contrib)) + s.restSum
        expect(parts).toBeCloseTo(r.total, 10)
        expect(s.contributors.length + s.detractors.length + s.restCount).toBe(r.n)
      }
    }
  })

  it('orders contributors biggest first and detractors most negative first', () => {
    const s = splitRead(contributionRead(SEMIS, '1D'))
    expect(s.contributors.map((x) => x.sym)).toEqual(['NVDA', 'AMD'])
    expect(s.detractors.map((x) => x.sym)).toEqual(['MU', 'AVGO'])
  })
})

describe('which theme, and which symbols are refused', () => {
  it('finds every theme holding a name, in either share-class spelling', () => {
    expect(themesHolding(THEMES, 'nvda').map((t) => t.name)).toEqual(['AI Software', 'Semiconductors'])
    const brk = [{ name: 'X', holdings: [{ sym: 'BRK-B' }] }]
    expect(themesHolding(brk, 'BRK.B')).toHaveLength(1)
    expect(normSym('brk.b')).toBe('BRK-B')
    // an engine-only member does not put a name "in" a theme
    expect(themesHolding(THEMES, 'ENGX')).toEqual([])
  })

  it('refuses an index fund, and an ETF a theme uses as its proxy, naming that theme', () => {
    for (const s of ['SPY', 'QQQ', 'IWM', 'XLK', 'XLE']) expect(refusalFor(THEMES, s)?.kind, s).toBe('index')
    expect(refusalFor(THEMES, 'SMH')).toMatchObject({ kind: 'etf', sym: 'SMH' })
    expect(refusalFor(THEMES, 'SMH').proxies.map((t) => t.name)).toEqual(['Semiconductors'])
    expect(refusalFor(THEMES, 'NVDA')).toBeNull()
    expect(INDEX_FUNDS).toContain('SPY')
  })

  it('with nothing asked, the default is the theme moving most either way over the window', () => {
    expect(biggestMover(THEMES, '1D').name).toBe('AI Software')
    expect(biggestMover(THEMES, '1W').name).toBe('Semiconductors')
  })

  it('a payload that is still computing has no themes, rather than throwing', () => {
    expect(themesOf({ themes: [], status: 'computing' })).toEqual([])
    expect(themesOf(null)).toEqual([])
  })
})

describe('naming a theme: matchTheme and the command the panel writes back', () => {
  const GPU = { name: 'AI / GPU Chips', ticker: 'GPUX', theme_id: 'ai_gpu_chips', holdings: [{ sym: 'NVDA', returns: { '1d': 1 } }] }
  const all = [SEMIS, AI, GPU]

  it('case, spacing and punctuation do not matter; an id or ticker works too', async () => {
    const { matchTheme } = await import('./imovModel')
    for (const q of ['semiconductors', 'SEMICONDUCTORS', ' Semi conductors ', 'SMH']) {
      expect(matchTheme(all, q), q).toMatchObject({ status: 'ok', theme: SEMIS })
    }
    for (const q of ['AI / GPU Chips', 'ai gpu chips', 'AI_GPU_CHIPS', 'ai-gpu-chips']) {
      expect(matchTheme(all, q), q).toMatchObject({ status: 'ok', theme: GPU })
    }
  })

  it('a UNIQUE prefix opens the theme; a shared one asks which', async () => {
    const { matchTheme } = await import('./imovModel')
    expect(matchTheme(all, 'semi')).toMatchObject({ status: 'ok', theme: SEMIS })
    expect(matchTheme(all, 'ai g')).toMatchObject({ status: 'ok', theme: GPU })
    const amb = matchTheme(all, 'AI')
    expect(amb.status).toBe('ambiguous')
    expect(amb.options.map((t) => t.name)).toEqual(['AI / GPU Chips', 'AI Software'])
  })

  it('nothing fitting is "unknown", with the nearest names and never a guess', async () => {
    const { matchTheme } = await import('./imovModel')
    expect(matchTheme(all, 'chips')).toMatchObject({ status: 'unknown', suggestions: [GPU] })      // inside a name
    expect(matchTheme(all, 'semicondutors')).toMatchObject({ status: 'unknown', suggestions: [SEMIS] }) // a typo
    expect(matchTheme(all, 'xyzzy')).toMatchObject({ status: 'unknown', suggestions: [] })
    expect(matchTheme(all, '  ')).toEqual({ status: 'empty' })
  })

  it('imovCommand writes the stable key behind THEME, the window only when not the default, and the security first', async () => {
    const { imovCommand, matchTheme } = await import('./imovModel')
    expect(imovCommand({ theme: SEMIS })).toBe('IMOV THEME SEMICONDUCTORS')
    expect(imovCommand({ theme: AI, win: '1W', sym: 'NVDA' })).toBe('NVDA IMOV THEME AI_SOFTWARE 1W')
    // ...and the key it writes reopens the same theme.
    expect(matchTheme(all, 'AI_SOFTWARE')).toMatchObject({ status: 'ok', theme: AI })
  })
})
