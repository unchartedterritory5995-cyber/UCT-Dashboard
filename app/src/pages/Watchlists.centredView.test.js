// `centredViewStaysDrawn` (Watchlists.jsx): would centring a row keep the whole viewport inside the rows the list
// drew? It decides whether an arrow key's snap may wait for the frame callback (near) or must centre in the commit as
// on the parent (far). Tested on a fake virtualizer whose rows (30 px) differ from the viewport (600 px), so the
// centring term `(row - viewport) / 2` is not zero (review of e1fdb99975, G1).
//   C1 near, mid-list -> true
//   C2 the target above the drawn rows -> false;  C3 below them -> false
//   C4 the first rows: the lower clamp (0) is mirrored -> true
//   C5 the centring term decides it -> true
//   C6 no viewport yet (size 0) -> false;  C7 the virtualizer throws -> false
//   C8 the last rows: the upper clamp is NOT mirrored, so they read "far" (conservative, pinned)
//   C9 a row measured between the render and the check: the drawn edges come from the SAME measurements as the target
import { describe, it, expect, vi } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))

const { centredViewStaysDrawn } = await import('./Watchlists')

const ROW = 30
const VIEW = 600
/** Measurements of `n` rows of `size` (the first row may be taller: `first`). */
function rows(n, size = ROW, first = size) {
  const out = []
  let start = 0
  for (let i = 0; i < n; i++) {
    const s = i === 0 ? first : size
    out.push({ index: i, start, size: s, end: start + s })
    start += s
  }
  return out
}
const fake = (ms, size = VIEW) => ({ getMeasurements: () => ms, getSize: () => size })
const drawn = (ms, a, b) => ms.slice(a, b + 1).map((m) => ({ ...m }))   // the render's own copies

describe('centredViewStaysDrawn', () => {
  const ms = rows(400)

  it('C1 near, mid-list', () => {
    expect(centredViewStaysDrawn(fake(ms), 130, drawn(ms, 100, 160))).toBe(true)
  })

  it('C2 / C3 a target above, or below, the drawn rows is far', () => {
    expect(centredViewStaysDrawn(fake(ms), 20, drawn(ms, 100, 160))).toBe(false)
    expect(centredViewStaysDrawn(fake(ms), 300, drawn(ms, 100, 160))).toBe(false)
  })

  it('C4 the first rows: centring is clamped at 0, so they are near', () => {
    expect(centredViewStaysDrawn(fake(ms), 1, drawn(ms, 0, 40))).toBe(true)
  })

  it('C5 the centring term decides it (row 110 centred: 3015..3615, drawn 3000..3780)', () => {
    expect(centredViewStaysDrawn(fake(ms), 110, drawn(ms, 100, 125))).toBe(true)
  })

  it('C6 / C7 no viewport yet, or a virtualizer that throws, is far', () => {
    expect(centredViewStaysDrawn(fake(ms, 0), 130, drawn(ms, 100, 160))).toBe(false)
    const broken = { getMeasurements: () => { throw new Error('boom') }, getSize: () => VIEW }
    expect(centredViewStaysDrawn(broken, 130, drawn(ms, 100, 160))).toBe(false)
  })

  it('C8 the last rows read far (the upper clamp is not mirrored): conservative, pinned', () => {
    expect(centredViewStaysDrawn(fake(ms), 399, drawn(ms, 370, 399))).toBe(false)
  })

  it('C9 a row measured since the render: the drawn edges are read from the same measurements as the target', () => {
    const atRender = rows(400)                   // what the render drew from
    const now = rows(400, ROW, ROW + 200)        // row 0 measured 200 px taller since: every start moved by 200
    // row 110 now starts at 3500, centred 3215..3815; drawn rows 100..125 now span 3200..3980: inside.
    // (The render's copies say 3000..3780, which would call it far.)
    expect(centredViewStaysDrawn(fake(now), 110, drawn(atRender, 100, 125))).toBe(true)
  })
})
