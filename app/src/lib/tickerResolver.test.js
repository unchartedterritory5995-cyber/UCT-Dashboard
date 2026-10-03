import { describe, it, expect } from 'vitest'
import { resolveCashtags, canonical, CASHTAG_TIER } from './tickerResolver'
import PARITY from './tickerResolver.parity.json'

describe('TERM-064 — the frontend cashtag tier answers what the Python resolver answers', () => {
  it.each(PARITY.cases)('parity: %j', ({ text, want }) => {
    expect(resolveCashtags(text)).toEqual(want)
  })

  it('is total on non-strings', () => {
    expect(resolveCashtags(null)).toEqual([])
    expect(resolveCashtags(undefined)).toEqual([])
    expect(resolveCashtags(42)).toEqual([])
  })

  it('never emits the dot form', () => {
    expect(canonical('brk.b')).toBe('BRK-B')
    expect(resolveCashtags('$BRK.B').join()).not.toContain('.')
  })

  it('the grammar is the cashtag tier only — a bare word never matches', () => {
    expect(new RegExp(CASHTAG_TIER).test('NVDA')).toBe(false)
  })
})

describe('the two free-text extractors delegate to it', () => {
  // ⚠️ Scope, stated: AiSearchWidget's `renderRich` still TOKENISES an answer with its
  // own pattern to decide which spans render as buttons. That is a renderer's split,
  // not ticker extraction, and is not migrated here.
  it('Composer and AiSearchWidget extract through resolveCashtags, with no regex in the extractor', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '..')
    for (const rel of ['floor2/Composer.jsx', 'pages/charts/widgets/AiSearchWidget.jsx']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
      expect(src, rel).toMatch(/import\s*\{[^}]*resolveCashtags[^}]*\}\s*from\s*'[^']*lib\/tickerResolver'/)
      const at = src.search(/(function extractTickers|const extractTickers)/)
      expect(at, `${rel} lost its extractTickers`).toBeGreaterThan(-1)
      const body = src.slice(at, src.indexOf('\n}', at) > -1 && src.indexOf('\n}', at) - at < 400
        ? src.indexOf('\n}', at) : src.indexOf('\n', at))
      expect(body, rel).toMatch(/resolveCashtags\(text\)/)
      expect(body, `${rel}: the extractor carries its own regex`).not.toMatch(/\/[^/\n]*\\\$/)
    }
  })
})
