// The Breadth Pack import decision (2026-10-11): a corrected history inside the window —
// same length, same last bar — differs only in the pack's per-series content hash, and must
// replace the cached copy; an unchanged one is kept.
import { describe, it, expect } from 'vitest'
import { _keepLocalOverPack, _CACHE_LOGIC_VERSION as V } from './barsIDB'

const bars = (c = 5) => [{ t: '2026-10-07', c: 4 }, { t: '2026-10-08', c }]
const cur = (extra = {}) => ({ v: V, bars: bars(), lastT: '2026-10-08', sha: 'aaa', ...extra })

describe('_keepLocalOverPack', () => {
  it('keeps an unchanged cached series', () => {
    expect(_keepLocalOverPack(cur(), { bars: bars(), sha: 'aaa' }, true)).toBe(true)
  })
  it('replaces when the pack content hash differs (a corrected interior bar)', () => {
    expect(_keepLocalOverPack(cur(), { bars: bars(), sha: 'bbb' }, true)).toBe(false)
  })
  it('replaces a cached series that predates the hash', () => {
    expect(_keepLocalOverPack(cur({ sha: undefined }), { bars: bars(), sha: 'bbb' }, true)).toBe(false)
  })
  it('ignores the hash outside the Breadth Pack (replaceIfNewer off)', () => {
    expect(_keepLocalOverPack(cur(), { bars: bars(), sha: 'bbb' }, false)).toBe(true)
  })
  it('still replaces a newer tail', () => {
    const e = { bars: [...bars(), { t: '2026-10-09', c: 6 }], sha: 'aaa' }
    expect(_keepLocalOverPack(cur(), e, true)).toBe(false)
  })
  it('writes when nothing is cached', () => {
    expect(_keepLocalOverPack(undefined, { bars: bars(), sha: 'aaa' }, true)).toBe(false)
  })
})
