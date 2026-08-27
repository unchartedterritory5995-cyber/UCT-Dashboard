// app/src/components/chart/engine/ast/trees.test.js
import { describe, it, expect } from 'vitest'
import { parseFormula, astHash, sha256Hex } from './parse'
import { REPAINT_MODES } from './lint'
import { FRESHNESS_MODES } from './freshness'
import { treesHash, assertTrees, worstRepaint, stalestFreshness } from './trees'

const T = (src) => parseFormula(src).ast
const MACD = () => ({
  macd: T('ema(close, 12) - ema(close, 26)'),
  signal: T('ema(ema(close, 12) - ema(close, 26), 9)'),
  hist: T('(ema(close, 12) - ema(close, 26)) - ema(ema(close, 12) - ema(close, 26), 9)'),
})

describe('treesHash — one string over the canonical ["key":astHash] pairs', () => {
  it('is DEFINED as sha256 over `"<key>":<astHash>` pairs, keys sorted, comma-joined', () => {
    const trees = MACD()
    const pairs = ['hist', 'macd', 'signal'].map((k) => `${JSON.stringify(k)}:${astHash(trees[k])}`)
    expect(treesHash(trees)).toBe(`sha256:${sha256Hex(pairs.join(','))}`)
  })
  it('is INDEPENDENT of insertion order — the sort is what makes it canonical', () => {
    const a = MACD()
    expect(treesHash({ signal: a.signal, hist: a.hist, macd: a.macd })).toBe(treesHash(a))
  })
  it('MOVES when one tree moves, and only then', () => {
    const a = MACD()
    expect(treesHash({ ...a, hist: T('ema(close, 5)') })).not.toBe(treesHash(a))
    expect(treesHash({ ...a })).toBe(treesHash(a))
  })
  it('refuses an empty map, an illegal key and a non-canonical tree BY NAME', () => {
    expect(() => treesHash({})).toThrow(/names no plot/)
    expect(() => treesHash({ 'a.b': T('close') })).toThrow(/not a legal plot key/)
    expect(() => treesHash({ macd: { type: 'Literal', value: 1 } })).toThrow(/compute\.trees\.macd/)
    expect(() => assertTrees([])).toThrow(/plotKey/)
  })
  it('assertTrees returns the keys SORTED — the order every consumer must use', () => {
    expect(assertTrees({ z: 1, a: 1, m: 1 })).toEqual(['a', 'm', 'z'])
  })
})

describe('the badge aggregators — a definition is as bad as its worst tree', () => {
  it('worstRepaint: one preview-repaints tree brands the whole definition', () => {
    expect(worstRepaint(['non-repainting', 'preview-repaints', 'non-repainting'])).toBe('preview-repaints')
    expect(worstRepaint(['non-repainting'])).toBe('non-repainting')
    expect(worstRepaint(['preview-repaints', 'repaints'])).toBe('repaints')
  })
  it('stalestFreshness: one as-of-snapshot tree makes the definition as-of-snapshot; unknown wins over everything', () => {
    expect(stalestFreshness(['live', 'as-of-snapshot'])).toBe('as-of-snapshot')
    expect(stalestFreshness(['as-of-snapshot', 'unknown', 'live'])).toBe('unknown')
    expect(stalestFreshness(['live'])).toBe('live')
  })
  it('an unrecognised mode fails CLOSED to the worst value, never to the best', () => {
    expect(worstRepaint(['non-repainting', 'hologram'])).toBe('repaints')
    expect(stalestFreshness(['live', 'hologram'])).toBe('unknown')
  })
  it('an EMPTY or missing list makes no promise — it fails CLOSED too, never to the best', () => {
    expect(worstRepaint([])).toBe('repaints')
    expect(stalestFreshness([])).toBe('unknown')
    expect(worstRepaint(undefined)).toBe('repaints')
    expect(stalestFreshness(undefined)).toBe('unknown')
  })
  // ⛔ THE VOCABULARY IS IMPORTED, NEVER RETYPED. `lint.js` owns `REPAINT_MODES`
  // and `freshness.js` owns `FRESHNESS_MODES`; a mode either lane can emit that
  // the aggregator did not recognise would fail CLOSED to the worst value —
  // silently branding a clean multi-plot definition. So every emittable mode
  // must round-trip as itself. A local copy that drifted fails here BY NAME.
  it('recognises EVERY mode the linter and the freshness reader can emit', () => {
    for (const m of REPAINT_MODES) expect(worstRepaint([m])).toBe(m)
    for (const m of FRESHNESS_MODES) expect(stalestFreshness([m])).toBe(m)
  })
})
