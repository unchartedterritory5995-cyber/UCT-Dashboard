import { describe, it, expect } from 'vitest'
import { computeHeaderFit, trimTimeframes, HEADER_FIT_THRESHOLDS as T } from './headerFit'

describe('computeHeaderFit — the degradation ladder', () => {
  it('a wide (or unmeasured) pane keeps the full header', () => {
    for (const w of [null, undefined, 0, -5, Infinity, 1200, T.titleTicker + 1]) {
      const fit = computeHeaderFit(w, 8)
      expect(fit).toEqual({ titleMode: null, sessionAbbrev: false, infoAbbrev: false, maxTfs: 8 })
    }
  })

  it('collapses the title first (below titleTicker, above sessionAbbrev)', () => {
    const fit = computeHeaderFit(T.titleTicker - 1, 8)
    expect(fit.titleMode).toBe('ticker')
    expect(fit.sessionAbbrev).toBe(false)
    expect(fit.infoAbbrev).toBe(false)
    expect(fit.maxTfs).toBe(8)
  })

  it('then abbreviates the session buttons (below sessionAbbrev)', () => {
    const fit = computeHeaderFit(T.sessionAbbrev - 1, 8)
    expect(fit.titleMode).toBe('ticker')
    expect(fit.sessionAbbrev).toBe(true)
    expect(fit.infoAbbrev).toBe(false)
  })

  it('then abbreviates the info row (below infoAbbrev)', () => {
    const fit = computeHeaderFit(T.infoAbbrev - 1, 8)
    expect(fit.sessionAbbrev).toBe(true)
    expect(fit.infoAbbrev).toBe(true)
    expect(fit.maxTfs).toBe(8) // still above tfDrop
  })

  it('then drops timeframes one chunk at a time, floored at 1 (the active TF)', () => {
    expect(computeHeaderFit(T.tfDrop - 1, 8).maxTfs).toBe(7)
    const veryNarrow = computeHeaderFit(120, 8)
    expect(veryNarrow.maxTfs).toBe(1)
    // monotonic: never increases as the pane shrinks
    let prev = 8
    for (let w = T.tfDrop; w >= 100; w -= 10) {
      const m = computeHeaderFit(w, 8).maxTfs
      expect(m).toBeLessThanOrEqual(prev)
      prev = m
    }
  })

  it('never returns maxTfs above the available count', () => {
    expect(computeHeaderFit(100, 3).maxTfs).toBe(1)
    expect(computeHeaderFit(1000, 3).maxTfs).toBe(3)
    expect(computeHeaderFit(1000, 0).maxTfs).toBe(1)
  })
})

describe('trimTimeframes — keep active, drop furthest first', () => {
  const tfs = [['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'], ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M']]

  it('returns the list unchanged when it already fits', () => {
    expect(trimTimeframes(tfs, 'D', 8)).toBe(tfs)
    expect(trimTimeframes(tfs, 'D', 20)).toBe(tfs)
  })

  it('always keeps the active code, dropping the ones furthest from it', () => {
    const out = trimTimeframes(tfs, 'D', 3).map(([c]) => c)
    expect(out).toContain('D')
    expect(out).toHaveLength(3)
    // 1D is index 5; its nearest neighbours are 1h(4) and 1W(6)
    expect(out).toEqual(['60', 'D', 'W'])
  })

  it('collapses to just the active TF at cap 1', () => {
    expect(trimTimeframes(tfs, '1D'.replace('1', ''), 1)) // 'D'
    expect(trimTimeframes(tfs, 'D', 1).map(([c]) => c)).toEqual(['D'])
    expect(trimTimeframes(tfs, '5', 1).map(([c]) => c)).toEqual(['5'])
  })

  it('preserves duration display order among the kept codes', () => {
    const out = trimTimeframes(tfs, '15', 4).map(([c]) => c)
    // indices sorted, never reshuffled
    expect(out).toEqual([...out].sort((a, b) => tfs.findIndex(([c]) => c === a) - tfs.findIndex(([c]) => c === b)))
  })

  it('falls back to the middle when the active code is not present', () => {
    const out = trimTimeframes(tfs, 'ZZ', 1)
    expect(out).toHaveLength(1)
  })
})
