/* RowSpark — the herd-guard rail.
 *
 * The component's whole contract is "phone-only, LOCAL-only": hundreds of
 * watchlist rows (thousands in scan mode) may mount one of these, so it must
 * never open a network request and must read nothing at all off-phone. The
 * tests pin both directions plus the pure geometry.
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { vi } from 'vitest'

let phone = true
vi.mock('../../hooks/useBreakpoint', () => ({
  useIsPhone: () => phone,
}))

const idbGet = vi.fn()
vi.mock('../../utils/barsIDB', () => ({
  idbGet: (...a) => idbGet(...a),
}))

const { default: RowSpark, sparkPath } = await import('./RowSpark')

const bars = (closes) => closes.map((c, i) => ({ t: i, c }))

beforeEach(() => {
  phone = true
  idbGet.mockReset()
})
afterEach(cleanup)

describe('sparkPath — the pure geometry', () => {
  test('needs at least 5 closes to draw honestly', () => {
    expect(sparkPath(bars([1, 2, 3, 4]))).toBeNull()
    expect(sparkPath([])).toBeNull()
    expect(sparkPath(undefined)).toBeNull()
  })

  test('direction comes from last close vs first', () => {
    expect(sparkPath(bars([10, 11, 12, 13, 14])).up).toBe(true)
    expect(sparkPath(bars([14, 13, 12, 11, 10])).up).toBe(false)
  })

  test('accepts both bar close keys and skips junk rows', () => {
    const mixed = [{ c: 10 }, { close: 11 }, { c: 12 }, { close: 13 }, { c: 14 }, { c: NaN }, null]
    const d = sparkPath(mixed)
    expect(d).not.toBeNull()
    expect(d.points.split(' ')).toHaveLength(5)
  })

  test('a flat series does not divide by zero', () => {
    const d = sparkPath(bars([5, 5, 5, 5, 5]))
    expect(d).not.toBeNull()
    expect(d.points).not.toMatch(/NaN|Infinity/)
  })
})

describe('the component — phone-only, local-only', () => {
  test('phone + local bars → a polyline, colored by direction', async () => {
    idbGet.mockResolvedValue({ bars: bars([10, 11, 12, 13, 15]) })
    render(<RowSpark sym="UPPP" />)
    const svg = await screen.findByTestId('row-spark')
    expect(svg.querySelector('polyline')).not.toBeNull()
    expect(idbGet).toHaveBeenCalledWith('UPPP', 'D')
  })

  test('a symbol the local store does not hold renders NOTHING — never a fetch fallback', async () => {
    idbGet.mockResolvedValue(null)
    render(<RowSpark sym="MISS" />)
    await waitFor(() => expect(idbGet).toHaveBeenCalled())
    expect(screen.queryByTestId('row-spark')).toBeNull()
  })

  test('desktop mounts read NOTHING at all', () => {
    phone = false
    render(<RowSpark sym="DESK" />)
    expect(idbGet).not.toHaveBeenCalled()
    expect(screen.queryByTestId('row-spark')).toBeNull()
  })

  test('a re-mount of the same symbol serves from the memo — one IDB read total', async () => {
    idbGet.mockResolvedValue({ bars: bars([1, 2, 3, 4, 5, 6]) })
    const { unmount } = render(<RowSpark sym="MEMO" />)
    await screen.findByTestId('row-spark')
    unmount()
    render(<RowSpark sym="MEMO" />)
    expect(screen.getByTestId('row-spark')).toBeInTheDocument()
    expect(idbGet).toHaveBeenCalledTimes(1)
  })
})
