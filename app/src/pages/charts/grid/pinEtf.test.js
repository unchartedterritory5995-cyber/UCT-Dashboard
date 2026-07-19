import { describe, it, expect } from 'vitest'
import { pinEtf } from './groupsApi'

describe('pinEtf', () => {
  it('pins the etf as cell 0, dedups it from syms, slices to n', () => {
    expect(pinEtf(['RKLB', 'ASTS', 'LUNR', 'BKSY'], 'UFO', 4)).toEqual(['UFO', 'RKLB', 'ASTS', 'LUNR'])
    expect(pinEtf(['RKLB', 'UFO', 'ASTS'], 'UFO', 3)).toEqual(['UFO', 'RKLB', 'ASTS'])   // etf already in syms -> deduped, once
  })
  it('passes syms through unchanged when there is no etf', () => {
    expect(pinEtf(['RKLB', 'ASTS'], null, 4)).toEqual(['RKLB', 'ASTS'])
    expect(pinEtf(['RKLB', 'ASTS'], undefined, 4)).toEqual(['RKLB', 'ASTS'])
  })
  it('etf-only (empty syms) yields just the etf', () => {
    expect(pinEtf([], 'UFO', 4)).toEqual(['UFO'])
    expect(pinEtf(undefined, 'UFO', 4)).toEqual(['UFO'])
  })
})
