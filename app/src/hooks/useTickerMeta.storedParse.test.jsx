// The name/sector seed read from localStorage is PARSED once per stored text, not once per reader (2026-11-23,
// next-row key profile). One symbol switch on a two-chart board has four readers of the new symbol's name and
// sector (each chart's pane and its metadata feed), and each seeded itself from localStorage in its render with a
// JSON.parse of the same stored text. The text is still read from storage every time (so a changed entry is never
// missed); only the parse of an unchanged text is reused.
//   TM1 four readers of one symbol parse its stored entry once, and all get its data
//   TM2 a changed stored entry is parsed again, and the new data is what a new reader gets
//   TM3 an expired entry still seeds nothing
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useTickerMeta from './useTickerMeta'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
const store = (sym, d, t = Date.now()) => {
  const raw = JSON.stringify({ t, d })
  localStorage.setItem(`tmeta:${sym}`, raw)
  return raw
}

describe('the localStorage seed', () => {
  let origFetch
  let parsesOf
  beforeEach(() => {
    origFetch = global.fetch
    localStorage.clear()
    global.fetch = vi.fn(() => new Promise(() => {}))   // never answers: the seed is all a reader has
    const realParse = JSON.parse
    const seen = []
    vi.spyOn(JSON, 'parse').mockImplementation((text, ...rest) => { seen.push(text); return realParse(text, ...rest) })
    parsesOf = (raw) => seen.filter((x) => x === raw).length
  })
  afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks(); localStorage.clear() })

  it('TM1 four readers of one symbol parse its stored entry once, and all get its data', () => {
    const raw = store('TMA', { name: 'Alpha Corp', sector: 'Tech' })
    const readers = [1, 2, 3, 4].map(() => renderHook(() => useTickerMeta('TMA'), { wrapper }))
    for (const r of readers) expect(r.result.current.name).toBe('Alpha Corp')
    expect(parsesOf(raw)).toBe(1)
  })

  it('TM2 a changed stored entry is parsed again, and a new reader gets the new data', () => {
    store('TMB', { name: 'Beta Old', sector: 'Energy' })
    const first = renderHook(() => useTickerMeta('TMB'), { wrapper })
    expect(first.result.current.name).toBe('Beta Old')
    const raw2 = store('TMB', { name: 'Beta New', sector: 'Energy' })
    const second = renderHook(() => useTickerMeta('TMB'), { wrapper })
    expect(second.result.current.name).toBe('Beta New')
    expect(parsesOf(raw2)).toBe(1)
  })

  it('TM3 an expired entry seeds nothing', () => {
    store('TMC', { name: 'Gamma' }, Date.now() - 8 * 24 * 60 * 60 * 1000)
    const r = renderHook(() => useTickerMeta('TMC'), { wrapper })
    expect(r.result.current.name).toBe(null)
  })
})
