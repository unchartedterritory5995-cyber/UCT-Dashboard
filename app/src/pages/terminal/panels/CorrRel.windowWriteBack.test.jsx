// Customization pass 1 (C2): the CORR and REL window chips write the window into the panel's own
// command (the registered `lookback` argument), keeping the other names, so a reload, a saved
// board and a share link reopen on the chosen window. Outside the shell the chip is local state.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import CorrPanel from './CorrPanel'
import RelPanel from './RelPanel'
import { clearClosesCache } from './useCloses'
import { windowTokens } from './relativeMath'
import { fakeBarsFetch, series, weekdays } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
const dates = weekdays(320, '2025-06-02')
const A = series(dates, (i) => 0.01 * Math.sin(i))
const B = series(dates, (i) => 0.01 * Math.cos(i))
const C = series(dates, (i) => 0.005 * Math.sin(i / 3))
beforeEach(() => { clearClosesCache(); globalThis.fetch = vi.fn(fakeBarsFetch({ AAA: A, BBB: B, CCC: C })) })
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

function inShell(code, el) {
  const rerun = vi.fn()
  render(
    <PanelListContext.Provider value={{ rerun, run: vi.fn(), open: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
      <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider>
    </PanelListContext.Provider>,
  )
  return rerun
}

describe('window chips write back', () => {
  it('windowTokens: the window, then the other names in order', () => {
    expect(windowTokens({ with0: 'BBB', with1: 'CCC' }, '6M')).toEqual(['6M', 'BBB', 'CCC'])
    expect(windowTokens({}, '1Y')).toEqual(['1Y'])
  })
  it('CORR: a ticker panel re-runs SYM CORR WINDOW names', async () => {
    const rerun = inShell('CORR', <CorrPanel sym="AAA" with0="BBB" with1="CCC" />)
    await screen.findByTestId('terminal-corr-matrix')
    fireEvent.click(screen.getByRole('button', { name: '6M' }))
    expect(rerun).toHaveBeenCalledWith('AAA CORR 6M BBB CCC')
    // the chip already chosen re-runs nothing
    rerun.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    expect(rerun).not.toHaveBeenCalled()
  })
  it('CORR: a market list re-runs CORR WINDOW names', async () => {
    const rerun = inShell('CORR', <CorrPanel with0="AAA" with1="BBB" lookback="6M" />)
    await screen.findByTestId('terminal-corr-matrix')
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    expect(rerun).toHaveBeenCalledWith('CORR 1Y AAA BBB')
  })
  it('REL: re-runs SYM REL WINDOW names', async () => {
    const rerun = inShell('REL', <RelPanel sym="AAA" with0="BBB" />)
    await screen.findByTestId('terminal-rel')
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    expect(rerun).toHaveBeenCalledWith('AAA REL 1Y BBB')
  })
  it('outside the shell the chip is local state', async () => {
    render(<CorrPanel sym="AAA" with0="BBB" />)
    await screen.findByTestId('terminal-corr-matrix')
    fireEvent.click(screen.getByRole('button', { name: '6M' }))
    expect(screen.getByRole('button', { name: '6M' }).getAttribute('aria-pressed')).toBe('true')
  })
})
