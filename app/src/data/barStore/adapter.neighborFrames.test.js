// ⭐⭐ NEIGHBOR FRAMES — a NEW snapshot of the SAME bars (a status / meta change, a subscribe's mem hydrate)
// hands the chart the SAME array when the switch is on, so what was prepared for that array is found.
// Off, it is today's: a new snapshot with a developing bar is a new array.
import { describe, it, expect, afterEach } from 'vitest'
import { legacyBars } from './adapter'
import { __setNeighborFramesForTests } from '../../components/chart/neighborFrames'

const T0 = 1_763_000_000
const sealed = Array.from({ length: 50 }, (_, i) => ({ t: T0 + i * 3600, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 100 + i }))
const dev = (c = 99) => ({ t: T0 + 50 * 3600, o: 60, h: 61, l: 59, c, v: 5 })
const snap = (o = {}) => Object.freeze({ key: 'AAA_60', tf: '60', bars: sealed, developing: dev(), baseRev: 7, devRev: 1, status: 'current', ...o })

afterEach(() => __setNeighborFramesForTests(null))

describe('legacyBars across snapshots of the same bars', () => {
  it('off: a new snapshot with a developing bar is a new array (today)', () => {
    __setNeighborFramesForTests(false)
    const a = legacyBars(snap())
    const b = legacyBars(snap({ status: 'updating' }))
    expect(b).not.toBe(a)
    expect(b).toEqual(a)
  })

  it('on: the same sealed rows and an equal developing bar are the same array', () => {
    __setNeighborFramesForTests(true)
    const a = legacyBars(snap())
    const b = legacyBars(snap({ status: 'updating', devRev: 2 }))
    expect(b).toBe(a)
    expect(a.length).toBe(51)
    expect(a[50]).toEqual({ t: T0 + 50 * 3600, o: 60, h: 61, l: 59, c: 99, v: 5 })
  })

  it('on: a developing bar that moved is a new array, with the new bar', () => {
    __setNeighborFramesForTests(true)
    const a = legacyBars(snap())
    const b = legacyBars(snap({ developing: dev(100), devRev: 2 }))
    expect(b).not.toBe(a)
    expect(b[50].c).toBe(100)
    expect(b.slice(0, 50)).toEqual(a.slice(0, 50))
  })

  it('on: other sealed rows are a new array', () => {
    __setNeighborFramesForTests(true)
    const a = legacyBars(snap())
    const other = sealed.map((x) => ({ ...x }))
    const b = legacyBars(snap({ bars: other, baseRev: 8 }))
    expect(b).not.toBe(a)
    expect(b).toEqual(a)
  })
})
