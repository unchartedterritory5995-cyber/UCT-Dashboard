// Theme rotation: which themes are rotating in and out. Rails:
//   * loading; a failed read (error with Retry); a paywall and a switched-off route (locked, no Retry);
//   * nothing ranked yet is "the server is preparing this", never "nothing is rotating";
//   * themes ranked with nothing past the threshold is the one empty state, and says how many were ranked;
//   * a populated board: the count line, both lists biggest move first, a sign on every change, the
//     server's own time in the header, and a theme opening the stocks that drive it;
//   * the chips cut the lists and hand their word to the command; the typed word seeds the chip;
//   * a refresh that fails keeps the last read and says so;
//   * no hard-coded colour, and axe.
// The fixtures are the route's real shape (api/services/theme_performance.compute_rotation_signals).
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wire = vi.hoisted(() => ({ writeBack: null }))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('./commandWriteBack', () => ({ usePanelWriteBack: () => wire.writeBack }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import ThemeRotationPanel, { THEME_ROTATION_CODE, THEME_ROTATION_URL, rotationRead } from './ThemeRotationPanel'
import * as model from './themeRotationModel'
import { stampedKey } from './marketRead'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const entry = (ticker, name, r1w, k1w, r1m, k1m, delta) => ({
  name, ticker, '1w_return': r1w, '1w_rank': k1w, '1m_return': r1m, '1m_rank': k1m, '3m_return': 1, '3m_rank': 50, momentum_delta: delta,
})
const SEMI = entry('SEMI', 'Semiconductors', 6.21, 91.2, 1.1, 48.6, 42.6)
const GOLD = entry('GOLDM', 'Gold miners', -0.4, 55, -9.8, 12.5, 42.5)
const SOLAR = entry('SOLAR', 'Solar', -7.5, 4.4, 5.6, 77.7, -73.3)
const BANKS = entry('BANKS', 'Regional banks', -1.2, 30, null, 60, -30)
const FLAT = entry('FLAT', 'Utilities', 0.3, 51, 0.6, 50, 1)
const GENERATED = '2026-11-17T15:04:05.123456+00:00'
const BODY = {
  rotating_in: [SEMI, GOLD], rotating_out: [SOLAR, BANKS],
  rankings: { SEMI, GOLDM: GOLD, SOLAR, BANKS, FLAT }, generated_at: GENERATED,
}
const ONLY_IN = { ...BODY, rotating_out: [] }
const QUIET = { rotating_in: [], rotating_out: [], rankings: { FLAT, SEMI }, generated_at: GENERATED }
const COLD = { rotating_in: [], rotating_out: [], rankings: {}, generated_at: GENERATED }

const fail = (status, extra = {}) => Object.assign(new Error('x'), { status, ...extra })
const HERE = path.dirname(fileURLToPath(import.meta.url))

const swr = { mutate: null }
function Grab() {
  const { mutate } = useSWRConfig()
  useEffect(() => { swr.mutate = mutate }, [mutate])
  return null
}

function renderPanel(props = {}, { open = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <Grab />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          <ThemeRotationPanel {...props} />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  render(code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body)
  return { open, setFreshness }
}
const rowsOf = (side) => within(screen.getByTestId(`terminal-trot-${side}`)).getAllByRole('row').slice(1)
const keysOf = (side) => rowsOf(side).map((r) => r.getAttribute('data-testid').replace('terminal-trot-row-', ''))
const cells = (row) => within(row).getAllByRole('cell').map((c) => c.textContent)

beforeEach(() => { jsonFetcher.mockReset(); wire.writeBack = vi.fn(() => false) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('theme rotation panel states', () => {
  it('re-exports the model, and reads the one route', async () => {
    expect(rotationRead).toBe(model.rotationRead)
    expect(THEME_ROTATION_CODE).toBe(model.THEME_ROTATION_CODE)
    jsonFetcher.mockResolvedValue(BODY)
    renderPanel()
    await screen.findByTestId('terminal-trot')
    expect(jsonFetcher.mock.calls.map((c) => c[0])).toEqual([THEME_ROTATION_URL])
  })

  it('shows a loading skeleton first', () => {
    jsonFetcher.mockImplementation(() => new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-trot-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-trot')).toBeNull()
  })

  it('a failed read is an error with Retry, and says it is not "no theme rotating"', async () => {
    jsonFetcher.mockRejectedValueOnce(fail(503)).mockResolvedValue(BODY)
    renderPanel({}, { code: 'TROT' })
    const box = await screen.findByTestId('terminal-trot-error')
    expect(box.getAttribute('data-kind')).toBe('error')
    expect(box.textContent).toContain('Theme rotation could not be read just now.')
    expect(box.textContent).toContain('That is not the same as no theme rotating.')
    expect(screen.queryByTestId('terminal-trot-empty')).toBeNull()
    fireEvent.click(within(box).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-trot-in')
  })

  it('a 402 says paid plan and a 404 says not switched on, both locked with no Retry', async () => {
    jsonFetcher.mockRejectedValue(fail(402))
    renderPanel()
    const paid = await screen.findByTestId('terminal-trot-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('Theme rotation needs a paid plan.')
    expect(within(paid).queryByRole('button')).toBeNull()
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(fail(404))
    renderPanel()
    const off = await screen.findByTestId('terminal-trot-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('not switched on')
    expect(within(off).queryByRole('button')).toBeNull()
  })

  it('a signed-out read says sign in again', async () => {
    jsonFetcher.mockRejectedValue(fail(401))
    renderPanel()
    expect((await screen.findByTestId('terminal-trot-error')).textContent).toContain('You are signed out')
  })

  it('nothing ranked yet is "the server is preparing this", never "nothing is rotating"', async () => {
    jsonFetcher.mockResolvedValue(COLD)
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-trot-warming')
    expect(box.textContent).toContain('Loading, the server is preparing this.')
    expect(screen.queryByTestId('terminal-trot-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-trot')).toBeNull()
    // a warming answer reports no as-of: its generated_at dates nothing
    expect(setFreshness.mock.calls.every((c) => c[0] === null)).toBe(true)
  })

  it('an answer in the wrong shape is an error with Retry, never an empty board', async () => {
    jsonFetcher.mockResolvedValue({ status: 'ok' })
    renderPanel()
    const box = await screen.findByTestId('terminal-trot-error')
    expect(box.textContent).toContain('cannot read')
    expect(within(box).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('themes ranked with nothing past the threshold is the one empty state, with the count ranked', async () => {
    jsonFetcher.mockResolvedValue(QUIET)
    renderPanel()
    const box = await screen.findByTestId('terminal-trot-empty')
    expect(box.textContent).toContain('No theme is rotating in or out right now.')
    expect(box.textContent).toContain('All 2 themes were ranked')
    expect(box.textContent).toContain('not a failed read')
    expect(screen.queryByTestId('terminal-trot-in')).toBeNull()
    expect(screen.getByTestId('terminal-trot-side-both').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('theme rotation panel, populated', () => {
  it('shows the count line, both lists biggest move first, and the server\'s time in the header', async () => {
    jsonFetcher.mockResolvedValue(BODY)
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-trot-in')
    expect(screen.getByTestId('terminal-trot-summary').textContent).toBe('2 themes are rotating in and 2 themes are rotating out, of 5 ranked.')
    expect(keysOf('in')).toEqual(['SEMI', 'GOLDM'])
    expect(keysOf('out')).toEqual(['SOLAR', 'BANKS'])
    expect(screen.getByRole('table', { name: 'Rotating in (2)' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Rotating out (2)' })).toBeTruthy()
    // theme, rank change (signed), rank over 1 month then 1 week, 1 week return, 1 month return
    // (the theme cell ends with its second door, "stocks": the theme's stocks ranked, in GRP)
    expect(cells(rowsOf('in')[0])).toEqual(['1Semiconductors stocks', '+42', '49 to 91', '+6.2%', '+1.1%'])
    expect(cells(rowsOf('in')[1])).toEqual(['2Gold miners stocks', '+42', '13 to 55', '-0.4%', '-9.8%'])
    // a missing return is n/a, never 0
    expect(cells(rowsOf('out')[1])).toEqual(['2Regional banks stocks', '-30', '60 to 30', '-1.2%', 'n/a'])
    const method = screen.getByTestId('terminal-trot-method').textContent
    expect(method).toContain('1 week rank less the 1 month rank')
    expect(method).toContain('20 points or more')
    expect(method).toContain('color is never the only signal')
    expect(method).toMatch(/Ranks worked out at \d{1,2}:04 [AP]M ET/)
    const report = setFreshness.mock.calls.map((c) => c[0]).filter(Boolean).pop()
    expect(report.source).toContain('UCT theme tracker')
    expect(report.observedAt).toBe('2026-11-17T15:04:05.123Z')
  })

  it('a theme opens the stocks that drive it, beside the panel', async () => {
    jsonFetcher.mockResolvedValue(BODY)
    const { open } = renderPanel()
    await screen.findByTestId('terminal-trot-in')
    fireEvent.click(within(rowsOf('in')[0]).getByRole('button', { name: /Open the stocks driving Semiconductors/ }))
    expect(open).toHaveBeenCalledWith('IMOV THEME SEMI 1W')
  })

  it('"stocks" beside a theme opens every stock of it, ranked over the month (GRP)', async () => {
    jsonFetcher.mockResolvedValue(BODY)
    const { open } = renderPanel()
    await screen.findByTestId('terminal-trot-in')
    const door = within(rowsOf('out')[1]).getByRole('button', { name: 'Open the stocks of Regional banks, ranked (GRP THEME REGIONAL BANKS 1M)' })
    expect(door.textContent).toBe('stocks')
    fireEvent.click(door)
    expect(open).toHaveBeenLastCalledWith('GRP THEME REGIONAL BANKS 1M')
    expect(screen.getByTestId('terminal-trot-method').textContent).toContain('"stocks" opens every stock of the theme, ranked.')
  })

  it('one list empty says so beside the other, and is not drawn as a table', async () => {
    jsonFetcher.mockResolvedValue(ONLY_IN)
    renderPanel()
    await screen.findByTestId('terminal-trot-in')
    expect(screen.queryByTestId('terminal-trot-out')).toBeNull()
    expect(screen.getByTestId('terminal-trot-no-out').textContent).toBe('No theme is rotating out right now.')
  })

  it('a refresh that fails keeps the last read and says so', async () => {
    let calls = 0
    jsonFetcher.mockImplementation(async () => { calls += 1; if (calls === 1) return BODY; throw fail(500) })
    renderPanel({}, { code: 'TROT' })
    await screen.findByTestId('terminal-trot-in')
    expect(screen.queryByTestId('terminal-trot-stale')).toBeNull()
    await act(async () => { await swr.mutate(stampedKey(THEME_ROTATION_URL)).catch(() => {}) })
    const note = await screen.findByTestId('terminal-trot-stale')
    expect(note.textContent).toBe('Theme rotation could not be read just now. Showing the last read.')
    expect(keysOf('in')).toEqual(['SEMI', 'GOLDM'])
    expect(screen.queryByTestId('terminal-trot-error')).toBeNull()
  })
})

describe('theme rotation chips', () => {
  it('Rotating in and Rotating out cut the lists and hand their word to the command', async () => {
    jsonFetcher.mockResolvedValue(BODY)
    renderPanel()
    await screen.findByTestId('terminal-trot-in')
    fireEvent.click(screen.getByTestId('terminal-trot-side-out'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['OUT'])
    expect(screen.queryByTestId('terminal-trot-in')).toBeNull()
    expect(keysOf('out')).toEqual(['SOLAR', 'BANKS'])
    expect(screen.getByTestId('terminal-trot-side-out').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-trot-side-in'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['IN'])
    expect(screen.queryByTestId('terminal-trot-out')).toBeNull()
    expect(keysOf('in')).toEqual(['SEMI', 'GOLDM'])
    fireEvent.click(screen.getByTestId('terminal-trot-side-both'))
    expect(wire.writeBack).toHaveBeenLastCalledWith([])
    expect(screen.getByTestId('terminal-trot').getAttribute('data-side')).toBe('both')
  })

  it('the typed word seeds the chip', async () => {
    jsonFetcher.mockResolvedValue(BODY)
    renderPanel({ side: 'out' })
    await screen.findByTestId('terminal-trot-out')
    expect(screen.queryByTestId('terminal-trot-in')).toBeNull()
    expect(screen.getByTestId('terminal-trot-side-out').getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(wire.writeBack).not.toHaveBeenCalled())
  })
})

describe('theme rotation follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['ThemeRotationPanel.jsx', 'themeRotationModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('theme rotation accessibility', () => {
  it('the board and the empty state pass axe (WCAG A and AA)', async () => {
    jsonFetcher.mockResolvedValue(BODY)
    renderPanel({}, { code: 'TROT' })
    await screen.findByTestId('terminal-trot-in')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue(QUIET)
    renderPanel()
    await screen.findByTestId('terminal-trot-empty')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})
