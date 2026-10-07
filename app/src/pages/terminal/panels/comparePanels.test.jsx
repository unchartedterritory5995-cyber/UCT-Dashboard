// RRG / REL / CORR — rendered text and real behaviour, against a fake `/api/bars` that serves
// series whose answer is known by construction. Nothing on the path under test is mocked except
// the network (`fetch`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import RrgPanel, { SECTOR_ETFS, rrgUniverse } from './RrgPanel'
import RelPanel, { relSymbols, ratioVerdict, axisDecimals } from './RelPanel'
import CorrPanel, { corrSymbols, corrTint } from './CorrPanel'
import { clearClosesCache, settleLimited, MAX_IN_FLIGHT } from './useCloses'
import { fakeBarsFetch, series, weekdays, wiggle } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
let fetchSpy
function serve(bySym) {
  fetchSpy = vi.fn(fakeBarsFetch(bySym))
  globalThis.fetch = fetchSpy
}
beforeEach(() => { clearClosesCache() })
afterEach(() => { globalThis.fetch = realFetch })

const requested = () => fetchSpy.mock.calls.map(([u]) => decodeURIComponent(String(u).match(/\/api\/bars\/([^?]+)/)[1]))

describe('RRG', () => {
  const dates = weekdays(60)
  const bench = series(dates, () => 0.001)
  const shaped = (rel) => series(dates, (i) => (1.001 * (1 + rel(i))) - 1)

  it('places a leader in Leading and a laggard in Lagging, says so in words, and publishes row commands', async () => {
    serve({ SPY: bench, XLK: shaped((i) => 0.0004 * i), XLU: shaped((i) => -0.0004 * i) })
    const onRows = vi.fn()
    const onRun = vi.fn()
    render(<RrgPanel with0="XLK" with1="XLU" onRows={onRows} onRun={onRun} />)
    expect(await screen.findByTestId('terminal-rrg')).toBeTruthy()
    expect(screen.getByTestId('terminal-rrg-lede').textContent).toBe('Rotation vs SPY, weekly. Leading: XLK. ')
    expect(screen.getByTestId('terminal-rrg-row-XLK').textContent).toContain('Leading')
    expect(screen.getByTestId('terminal-rrg-row-XLU').textContent).toContain('Lagging')
    expect(screen.getByTestId('rrg-point-XLK').getAttribute('data-quadrant')).toBe('Leading')
    expect(screen.getByTestId('terminal-rrg-row-XLK').textContent).toContain('Technology')
    expect(onRows).toHaveBeenLastCalledWith(['XLK GP', 'XLU GP'])
    fireEvent.click(screen.getByTitle('Open XLU GP'))
    expect(onRun).toHaveBeenCalledWith('XLU GP')
    expect(screen.getByTestId('terminal-rrg-method').textContent).toContain("not JdK's proprietary formula")
    // a11y (audit 2026-10-06): the graph's name states what it SHOWS, and the table is named
    expect(screen.getByRole('img', { name: /vs SPY.*Leading: XLK\..*Lagging: XLU\./ })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Rotation quadrants vs SPY' })).toBeTruthy()
    // weekly closes, one request per name, at the shared depth
    expect(fetchSpy.mock.calls.every(([u]) => /tf=W&bars=120/.test(u))).toBe(true)
  })

  it('names a symbol it could not read instead of dropping it silently', async () => {
    serve({ SPY: bench, XLK: shaped((i) => 0.0004 * i) })
    render(<RrgPanel with0="XLK" with1="NOPE" />)
    expect((await screen.findByTestId('terminal-rrg-failed')).textContent).toBe('Could not read NOPE just now; it is not on the graph.')
    expect(screen.queryByTestId('terminal-rrg-row-NOPE')).toBeNull()
  })

  it('control: with the benchmark unreadable nothing is plotted, and the panel says why', async () => {
    serve({ XLK: shaped((i) => 0.0004 * i), XLU: shaped(() => 0) })
    render(<RrgPanel with0="XLK" with1="XLU" />)
    expect((await screen.findByTestId('terminal-rrg-error')).textContent).toContain('Could not read SPY, the benchmark, just now.')
    expect(screen.queryByTestId('terminal-rrg-table')).toBeNull()
  })

  it('bare RRG plots the 11 sector ETFs against SPY; one security is placed AMONG them; D switches to daily', async () => {
    expect(rrgUniverse(null, {})).toMatchObject({ mode: 'sectors', syms: Object.keys(SECTOR_ETFS) })
    const among = rrgUniverse('nvda', {})
    expect(among.mode).toBe('among-sectors')
    expect(among.syms).toEqual(['NVDA', ...Object.keys(SECTOR_ETFS)])
    expect(rrgUniverse('NVDA', { with0: 'SPY', with1: 'AMD' })).toMatchObject({ mode: 'custom', syms: ['NVDA', 'AMD'] })
    serve({ SPY: bench })
    render(<RrgPanel tf="D" />)
    await screen.findByTestId('terminal-rrg-empty')
    expect(requested().sort()).toEqual(['SPY', ...Object.keys(SECTOR_ETFS)].sort())
    expect(fetchSpy.mock.calls.every(([u]) => /tf=D&bars=600/.test(u))).toBe(true)
  })

  it('the sector set is the one api/services/sector_strength.py ranks (one list, two readers)', () => {
    const py = fs.readFileSync(path.resolve(process.cwd(), '..', 'api/services/sector_strength.py'), 'utf8')
    const block = py.match(/SECTOR_ETFS[^=]*=\s*\{([\s\S]*?)\n\}/)[1]
    const pyPairs = Object.fromEntries([...block.matchAll(/"([^"]+)":\s*"([A-Z]+)"/g)].map((m) => [m[2], m[1]]))
    expect(Object.keys(pyPairs).length).toBe(11)   // non-vacuity: the parse found the table
    expect(SECTOR_ETFS).toEqual(pyPairs)
  })
})

describe('REL', () => {
  const dates = weekdays(300)
  it('renders the comparison, the table and the ratio verdict in words', async () => {
    serve({ NVDA: series(dates, () => 0.002), AMD: series(dates, () => 0) })
    render(<RelPanel sym="NVDA" with0="AMD" />)
    const lede = await screen.findByTestId('terminal-rel-lede')
    expect(lede.textContent).toMatch(/^NVDA vs AMD, rebased to 0 % on \d{4}-\d{2}-\d{2}, through \d{4}-\d{2}-\d{2} \(126 sessions\)\.$/)
    expect(screen.getByTestId('terminal-rel-row-NVDA').textContent).toContain('+28.6%')
    expect(screen.getByTestId('terminal-rel-row-NVDA').textContent).toContain('base')
    expect(screen.getByTestId('terminal-rel-row-AMD').textContent).toContain('-28.6%')
    // a11y (audit 2026-10-06): the chart's name carries the result, not only the axis
    expect(screen.getByTestId('terminal-rel-chart').getAttribute('aria-label')).toMatch(/: NVDA \+28\.6%, AMD [^,]+$/)
    expect(screen.getByTestId('terminal-rel-verdict').textContent).toBe(
      'NVDA has outperformed AMD by 28.6% on the ratio over 6M. The ratio is above its 50-session average: NVDA is gaining on AMD now.')
  })

  it('the window chips change the read (1Y is a bigger gap than 1M)', async () => {
    serve({ NVDA: series(dates, () => 0.002), AMD: series(dates, () => 0) })
    render(<RelPanel sym="NVDA" with0="AMD" lookback="1M" />)
    const v1 = (await screen.findByTestId('terminal-rel-verdict')).textContent
    expect(v1).toContain('by 4.3% on the ratio over 1M')
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    expect(screen.getByTestId('terminal-rel-verdict').textContent).toContain('over 1Y')
    expect(screen.getByTestId('terminal-rel-verdict').textContent).not.toBe(v1)
  })

  it('one security alone is compared with SPY (QQQ when it IS SPY)', () => {
    expect(relSymbols('nvda', {})).toEqual(['NVDA', 'SPY'])
    expect(relSymbols('SPY', {})).toEqual(['SPY', 'QQQ'])
    expect(relSymbols(null, { with0: 'XLK', with1: 'XLU' })).toEqual(['XLK', 'XLU'])
  })

  it('a laggard first reads as the laggard, losing ground (non-vacuity for the verdict)', () => {
    expect(ratioVerdict({ a: 'B', b: 'A', change: -12.34, aboveAvg: false }, '3M'))
      .toBe('A has outperformed B by 12.3% on the ratio over 3M. The ratio is below its 50-session average: B is losing ground to A now.')
  })

  it('axis labels carry enough decimals that top and bottom never read the same', () => {
    // Live 2026-10-06: NVDA/SPY ran 0.27 to 0.30 and both labels printed 0.3.
    expect(axisDecimals(0.2985, 0.2702)).toBe(3)
    expect((0.2985).toFixed(axisDecimals(0.2985, 0.2702))).not.toBe((0.2702).toFixed(axisDecimals(0.2985, 0.2702)))
    expect(axisDecimals(34.3, 0)).toBe(1)
    expect(axisDecimals(1, 1)).toBe(1)
  })

  it('an unreadable comparator is an error that names it, never an empty chart', async () => {
    serve({ NVDA: series(dates, () => 0.002) })
    render(<RelPanel sym="NVDA" with0="ZZZZ" />)
    expect((await screen.findByTestId('terminal-rel-error')).textContent).toContain('Could not read ZZZZ just now.')
  })
})

describe('CORR', () => {
  const dates = weekdays(200)
  it('fills the matrix, names the most and least related pairs, and marks a thin pair n/a', async () => {
    serve({
      AAA: series(dates, (i) => wiggle(i, 1)),
      BBB: series(dates, (i) => wiggle(i, 1), 40),
      CCC: series(dates, (i) => -wiggle(i, 1)),
      NEWB: series(dates.slice(-8), (i) => wiggle(i, 3)),
    })
    render(<CorrPanel sym="AAA" with0="BBB" with1="CCC" with2="NEWB" />)
    expect((await screen.findByTestId('terminal-corr-verdict')).textContent).toBe('AAA and BBB move almost as one (r = 1.00).')
    expect(screen.getByTestId('terminal-corr-least').textContent).toMatch(/^Least related: (AAA|BBB) and CCC \(r = -1\.00\)\.$/)
    expect(screen.getByTestId('corr-AAA-BBB').textContent).toBe('1.00')
    expect(screen.getByTestId('corr-AAA-AAA').textContent).toBe('1')
    expect(screen.getByTestId('corr-AAA-NEWB').textContent).toBe('n/a')
    expect(screen.getByTestId('corr-AAA-NEWB').getAttribute('title')).toBe('7 common sessions: too few')
    // 3M default window: every daily-closes request, one per name
    expect(requested().sort()).toEqual(['AAA', 'BBB', 'CCC', 'NEWB'])
  })

  it('one security alone is correlated with SPY and QQQ', () => {
    expect(corrSymbols('nvda', {})).toEqual(['NVDA', 'SPY', 'QQQ'])
    expect(corrSymbols('QQQ', {})).toEqual(['QQQ', 'SPY'])
  })

  it('tints are accent for positive and info for negative — never gain/loss', () => {
    expect(corrTint(0.9)).toContain('--accent')
    expect(corrTint(-0.9)).toContain('--info')
    expect(corrTint(null)).toBeUndefined()
    expect(`${corrTint(0.9)} ${corrTint(-0.9)}`).not.toMatch(/--gain|--loss/)
  })

  it('control: with nothing readable it is an error, not an empty matrix', async () => {
    serve({})
    render(<CorrPanel sym="AAA" with0="BBB" />)
    expect((await screen.findByTestId('terminal-corr-error')).textContent).toContain('Could not read AAA, BBB just now.')
  })
})

describe('the fetch layer', () => {
  it(`never has more than ${MAX_IN_FLIGHT} reads in flight, and settles every task`, async () => {
    let live = 0
    let peak = 0
    const tasks = Array.from({ length: 12 }, (_, i) => async () => {
      live += 1
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 5))
      live -= 1
      if (i === 3) throw new Error('boom')
      return i
    })
    const out = await settleLimited(tasks)
    expect(peak).toBe(MAX_IN_FLIGHT)
    expect(out.filter((r) => r.ok)).toHaveLength(11)
    expect(out[3].ok).toBe(false)
  })

  it('a second panel asking for the same name reuses the first read', async () => {
    const dates = weekdays(200)
    serve({ AAA: series(dates, (i) => wiggle(i, 1)), BBB: series(dates, (i) => wiggle(i, 2)) })
    const { unmount } = render(<CorrPanel sym="AAA" with0="BBB" />)
    await screen.findByTestId('terminal-corr-verdict')
    unmount()
    render(<RelPanel sym="AAA" with0="BBB" />)
    await waitFor(() => expect(screen.getByTestId('terminal-rel-lede')).toBeTruthy())
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
