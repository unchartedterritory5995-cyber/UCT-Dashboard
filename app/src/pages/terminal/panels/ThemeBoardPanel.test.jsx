// THMS: the theme leaderboard. Rails:
//   * leaders best first, laggards worst first, per period, from the tracker's own figure;
//   * a theme with no return is listed as unranked, never as +0.00%;
//   * engine-suggested members never move a theme's figure;
//   * a theme opens IMOV beside the board; a period chip writes 1D-3M back into the command;
//   * a failed read is an error with Retry; a 402 says paid plan;
//   * the registry: `THMS` / `THMS 1W` resolve to this panel.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

const clock = vi.hoisted(() => ({ state: { isOpen: true, isPremarket: false, isExtended: false } }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => clock.state }))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import ThemeBoardPanel, { themeBoard, themeReturn } from './ThemeBoardPanel'
import { THEMES_URL } from './imovModel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'
import { applyArgs } from '../args'

const PAYLOAD = {
  live_as_of: '2026-10-09T14:30:00+00:00',
  themes: [
    { name: 'Semiconductors', ticker: 'SMH', theme_id: 'semis', group_return: { '1d': 2.5, '1w': -1.0 },
      holdings: [{ sym: 'NVDA', returns: { '1d': 3 } }, { sym: 'AMD', returns: { '1d': 2 } }] },
    { name: 'Gold Miners', ticker: 'GDX', theme_id: 'gold', group_return: {},
      holdings: [{ sym: 'NEM', returns: { '1d': -1, '1w': 4 } }, { sym: 'AEM', returns: { '1d': -3, '1w': 2 } },
        { sym: 'ZZZ', source: 'engine', returns: { '1d': 50, '1w': 50 } }] },
    { name: 'Quiet Theme', ticker: 'QQQ', theme_id: 'quiet', group_return: {}, holdings: [{ sym: 'ABC', returns: {} }] },
  ],
}

function renderPanel(props = {}, { open = vi.fn(), rerun = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={{ open, rerun, run: vi.fn() }}>
        <ThemeBoardPanel {...props} />
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { open, rerun }
}
const keys = (testId) => within(screen.getByTestId(testId)).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-thms-row-', ''))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('THMS panel', () => {
  it('ranks leaders and laggards for the period and lists the unranked theme', async () => {
    jsonFetcher.mockResolvedValue(PAYLOAD)
    renderPanel()
    await screen.findByTestId('terminal-thms-leaders')
    expect(keys('terminal-thms-leaders')).toEqual(['semis'])
    expect(keys('terminal-thms-laggards')).toEqual(['gold'])
    expect(screen.getByTestId('terminal-thms-row-semis').textContent).toContain('+2.50%')
    // the engine member (+50%) does not count: (-1 + -3) / 2
    expect(screen.getByTestId('terminal-thms-row-gold').textContent).toContain('-2.00%')
    expect(screen.getByTestId('terminal-thms-unpriced').textContent).toContain('1 theme has no 1D return')
    expect(document.body.textContent).not.toContain('+0.00%')
    expect(jsonFetcher).toHaveBeenCalledWith(THEMES_URL)
  })

  it('a period chip re-ranks and writes 1D-3M back into the command; 1Y stays local', async () => {
    jsonFetcher.mockResolvedValue(PAYLOAD)
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-thms-leaders')
    fireEvent.click(screen.getByTestId('terminal-thms-period-1W'))
    expect(rerun).toHaveBeenLastCalledWith('THMS 1W')
    expect(keys('terminal-thms-leaders')).toEqual(['gold'])
    expect(keys('terminal-thms-laggards')).toEqual(['semis'])
    fireEvent.click(screen.getByTestId('terminal-thms-period-1Y'))
    expect(rerun).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('terminal-thms-empty').textContent).toContain('No theme has a 1Y return')
  })

  it('THMS 1W opens on the week, and a theme opens IMOV beside it', async () => {
    jsonFetcher.mockResolvedValue(PAYLOAD)
    const { open } = renderPanel({ win: '1W' })
    await screen.findByTestId('terminal-thms-leaders')
    expect(screen.getByTestId('terminal-thms-period-1W').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(screen.getByTestId('terminal-thms-row-gold')).getByRole('button'))
    expect(open).toHaveBeenCalledWith('IMOV THEME GOLD 1W')
  })

  it('a failed read is an error with Retry; a 402 says paid plan', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-thms-error')).textContent).toContain('could not be read just now')
    jsonFetcher.mockResolvedValueOnce(PAYLOAD)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-thms-leaders')).toBeTruthy()
    cleanup()
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('p'), { status: 402 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-thms-error')).textContent).toContain('paid plan')
  })

  it('a payload with no themes yet says it is computing', async () => {
    jsonFetcher.mockResolvedValue({ status: 'computing' })
    renderPanel()
    expect(await screen.findByTestId('terminal-thms-computing')).toBeTruthy()
  })

  it('a computing payload says the server is preparing it and re-asks on its own (wave 9)', async () => {
    jsonFetcher.mockResolvedValueOnce({ themes: [], status: 'computing' })
    jsonFetcher.mockResolvedValue(PAYLOAD)
    renderPanel()
    expect((await screen.findByTestId('terminal-thms-computing')).textContent).toContain('Loading, the server is preparing this.')
    expect(await screen.findByTestId('terminal-thms-leaders', {}, { timeout: 8000 })).toBeTruthy()
  }, 12_000)

  it('an empty list that is NOT computing is not called "being computed" (wave 9)', async () => {
    jsonFetcher.mockResolvedValue({ themes: [] })
    renderPanel()
    const none = await screen.findByTestId('terminal-thms-none')
    expect(none.textContent).toContain('no themes to show')
    expect(screen.queryByTestId('terminal-thms-computing')).toBeNull()
  })

  it('a switched-off route reads "not switched on" with no Retry (wave 9)', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('off'), { status: 404 }))
    renderPanel()
    const off = await screen.findByTestId('terminal-thms-error')
    expect(off.textContent).toContain('not switched on')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('pure helpers: published figure first, owner mean second, null when nothing is priced', () => {
    const [semis, gold, quiet] = PAYLOAD.themes
    expect(themeReturn(semis, '1d')).toBe(2.5)
    expect(themeReturn(gold, '1w')).toBe(3)
    expect(themeReturn(quiet, '1d')).toBeNull()
    expect(themeBoard(PAYLOAD.themes, '1d').unpriced).toEqual(['Quiet Theme'])
  })
})

describe('THMS in the registry', () => {
  it('THMS opens the theme board and takes a window', async () => {
    expect(BY_CODE.THMS.group).toBe('Market')
    const { variant } = variantFor('THMS', false)
    expect(variant.panel).toBe('ThemeBoard')
    expect(applyArgs(variant, ['1W']).props).toEqual({ win: '1W' })
    expect(parseCommand('THMS 1W').code).toBe('THMS')
    expect((await PANEL_IMPORTERS.ThemeBoard()).default).toBe(ThemeBoardPanel)
  })
})
