// IMOV — rendered text and real behaviour against a fake `/api/theme-performance`. Only the market
// clock is stood in for (a 60 s interval no test should wait on).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

const clock = vi.hoisted(() => ({ state: { isOpen: true, isPremarket: false, isExtended: false, isHalfDay: false } }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => clock.state }))

import ImovPanel, { formatPts, resetImovMemory } from './ImovPanel'
import { THEMES_URL } from './imovModel'
import { PAYLOAD } from './__fixtures__/imovThemes'

const realFetch = globalThis.fetch
function serve(body, status = 200) {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url) !== THEMES_URL) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
}

function renderPanel(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ImovPanel {...props} />
    </SWRConfig>,
  )
}
const symsIn = (id) => within(screen.getByTestId(id)).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid')?.replace('terminal-imov-row-', '')).filter(Boolean)
const text = (id) => screen.getByTestId(id).textContent.replace(/\s+/g, ' ')

beforeEach(() => { resetImovMemory(); clock.state = { isOpen: true, isPremarket: false, isExtended: false, isHalfDay: false } })
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('IMOV', () => {
  it('opens on the theme moving most, labelled equal-weighted, and switches theme from the picker', async () => {
    serve(PAYLOAD)
    renderPanel()
    await screen.findByTestId('terminal-imov-total')
    expect(text('terminal-imov-total')).toContain('Equal-weighted')
    expect(text('terminal-imov-total')).toContain('AI Software 1D: -1.00% across 2 names')
    fireEvent.change(screen.getByTestId('terminal-imov-theme'), { target: { value: 'semiconductors' } })
    expect(text('terminal-imov-total')).toContain('Semiconductors 1D: +0.50% across 4 names')
    expect(symsIn('terminal-imov-up')).toEqual(['NVDA', 'AMD'])
    expect(symsIn('terminal-imov-down')).toEqual(['MU', 'AVGO'])
    expect(text('terminal-imov-row-NVDA')).toContain('+4.00%')
    expect(text('terminal-imov-row-NVDA')).toContain('+1.00 pts')
    expect(text('terminal-imov-row-AVGO')).toContain('-0.25 pts')
  })

  it('the reconciliation line adds the parts up to the theme’s equal-weight return', async () => {
    serve(PAYLOAD)
    renderPanel()
    await screen.findByTestId('terminal-imov-total')
    fireEvent.change(screen.getByTestId('terminal-imov-theme'), { target: { value: 'semiconductors' } })
    expect(text('terminal-imov-reconcile')).toBe(
      '+1.50 pts from the top contributors, -1.00 pts from the top detractors = +0.50%, the theme\'s equal-weight return.')
  })

  it('names what it did not count, and says when the tracker’s own figure differs', async () => {
    serve(PAYLOAD)
    renderPanel()
    await screen.findByTestId('terminal-imov-total')
    expect(screen.queryByTestId('terminal-imov-tracker')).toBeNull()   // AI Software: the two agree
    fireEvent.change(screen.getByTestId('terminal-imov-theme'), { target: { value: 'semiconductors' } })
    expect(text('terminal-imov-unpriced')).toContain('INTC')
    expect(text('terminal-imov-engine')).toContain('1 suggested member is not counted')
    expect(text('terminal-imov-tracker')).toContain('The Theme Tracker shows +1.00%')
    expect(text('terminal-imov-method')).toContain('not index or ETF weights')
  })

  it('a window chip (and a typed window) re-reads the same theme over that period', async () => {
    serve(PAYLOAD)
    renderPanel({ win: '1W' })
    await screen.findByTestId('terminal-imov-total')
    expect(text('terminal-imov-total')).toContain('Semiconductors 1W: +3.00%')
    expect(screen.getByTestId('terminal-imov-win-1W').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-imov-win-1D'))
    expect(text('terminal-imov-total')).toContain('Semiconductors 1D: +0.50%')
  })

  it('a row click loads that name into the linked group and keeps every function; rows are numbered for <GO>', async () => {
    serve(PAYLOAD)
    const onRun = vi.fn()
    const onRows = vi.fn()
    renderPanel({ win: '1W', onRun, onRows })
    await screen.findByTestId('terminal-imov-total')
    expect(onRows).toHaveBeenLastCalledWith(['$NVDA', '$AVGO', '$MU', '$AMD'])
    fireEvent.click(within(screen.getByTestId('terminal-imov-row-AVGO')).getByRole('button'))
    expect(onRun).toHaveBeenCalledWith('$AVGO', { keepFunction: true })
  })

  it('NVDA IMOV: the theme(s) holding NVDA, and NVDA’s own share of the move', async () => {
    serve(PAYLOAD)
    renderPanel({ sym: 'NVDA' })
    await screen.findByTestId('terminal-imov-total')
    expect(text('terminal-imov-memberships')).toContain('NVDA is in 2 themes')
    expect(text('terminal-imov-mine')).toContain('NVDA: +4.00% → +2.00 pts of the move, #1 of 2')
    fireEvent.click(within(screen.getByTestId('terminal-imov-memberships')).getByText('Semiconductors'))
    expect(text('terminal-imov-mine')).toContain('+1.00 pts of the move, #1 of 4')
  })

  it('remembers the theme across a reload on a new name it holds (a row click re-keys the panel)', async () => {
    serve(PAYLOAD)
    const first = renderPanel({ sym: 'NVDA' })
    await screen.findByTestId('terminal-imov-total')
    fireEvent.click(within(screen.getByTestId('terminal-imov-memberships')).getByText('Semiconductors'))
    first.unmount()
    renderPanel({ sym: 'NVDA' })
    await screen.findByTestId('terminal-imov-total')
    expect(text('terminal-imov-total')).toContain('Semiconductors')
  })

  it('SPY IMOV is refused at once, with the reason, and nothing is read', async () => {
    serve(PAYLOAD)
    renderPanel({ sym: 'SPY' })
    expect(text('terminal-imov-refused')).toContain('SPY is an index fund')
    expect(text('terminal-imov-refused')).toContain('does not hold index weights')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('an ETF a theme uses as its proxy is refused too, and offers that UCT theme by name instead', async () => {
    serve(PAYLOAD)
    renderPanel({ sym: 'SMH' })
    await screen.findByTestId('terminal-imov-refused')
    expect(text('terminal-imov-refused')).toContain('SMH is an ETF')
    fireEvent.click(screen.getByTestId('terminal-imov-proxy-semiconductors'))
    expect(text('terminal-imov-total')).toContain('Semiconductors 1D: +0.50%')
  })

  it('a name no theme holds says so and offers the picker', async () => {
    serve(PAYLOAD)
    renderPanel({ sym: 'ZZZZ' })
    await screen.findByTestId('terminal-imov-unheld')
    expect(text('terminal-imov-unheld')).toContain('No UCT theme holds ZZZZ.')
    expect(screen.getByTestId('terminal-imov-theme')).toBeTruthy()
  })

  it('a still-computing payload, a paywall and an outage are three different sentences', async () => {
    serve({ themes: [], status: 'computing' })
    const a = renderPanel()
    await screen.findByTestId('terminal-imov-computing')
    a.unmount()
    serve({ detail: 'x' }, 402)
    const b = renderPanel()
    expect((await screen.findByTestId('terminal-imov-error')).getAttribute('data-kind')).toBe('locked')
    b.unmount()
    serve({ detail: 'x' }, 500)
    renderPanel()
    const err = await screen.findByTestId('terminal-imov-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Retry')
  })

  it('formatPts: signed points, and a rounding zero is never "-0.00"', () => {
    expect(formatPts(1)).toBe('+1.00 pts')
    expect(formatPts(-0.25)).toBe('-0.25 pts')
    expect(formatPts(-0.001)).toBe('0.00 pts')
    expect(formatPts(null)).toBe('—')
  })
})

describe('IMOV with a theme NAMED on the command line', () => {
  const GPU = { name: 'AI / GPU Chips', ticker: 'GPUX', theme_id: 'ai_gpu_chips', group_return: {},
    holdings: [{ sym: 'NVDA', source: 'owner', returns: { '1d': 3 } }, { sym: 'AMD', source: 'owner', returns: { '1d': 1 } }] }
  const WITH_GPU = { ...PAYLOAD, themes: [...PAYLOAD.themes, GPU] }

  it('opens the named theme, not the biggest mover, and says nothing about a default', async () => {
    serve(PAYLOAD)
    renderPanel({ theme: 'SEMICONDUCTORS' })
    await screen.findByTestId('terminal-imov-total')
    expect(text('terminal-imov-total')).toContain('Semiconductors 1D: +0.50% across 4 names')
    expect(screen.queryByText(/Opened on the theme moving most/)).toBeNull()
  })

  it('a multi-word name is case and spacing insensitive', async () => {
    serve(WITH_GPU)
    renderPanel({ theme: 'ai gpu   CHIPS' })
    await screen.findByTestId('terminal-imov-total')
    expect(text('terminal-imov-total')).toContain('AI / GPU Chips 1D: +2.00% across 2 names')
  })

  it('an ambiguous name asks which, and picking one writes it into the panel command', async () => {
    serve(WITH_GPU)
    const onRun = vi.fn()
    renderPanel({ theme: 'AI', onRun })
    await screen.findByTestId('terminal-imov-theme-ambiguous')
    expect(text('terminal-imov-theme-ambiguous')).toContain('"AI" fits 2 UCT themes. Which one did you mean?')
    fireEvent.click(screen.getByTestId('terminal-imov-didyoumean-ai_software'))
    expect(onRun).toHaveBeenCalledWith('IMOV THEME AI_SOFTWARE', { here: true })
    expect(text('terminal-imov-total')).toContain('AI Software')
  })

  it('an unknown name says so out loud, offers the nearest theme, and never guesses', async () => {
    serve(PAYLOAD)
    renderPanel({ theme: 'SEMICONDUTORS' })
    await screen.findByTestId('terminal-imov-theme-unknown')
    expect(text('terminal-imov-theme-unknown')).toContain('No UCT theme is called "SEMICONDUTORS".')
    expect(text('terminal-imov-theme-unknown')).toContain('Did you mean one of these?')
    expect(screen.getByTestId('terminal-imov-didyoumean-semiconductors')).toHaveTextContent('Open the Semiconductors theme')
    expect(screen.queryByTestId('terminal-imov-total')).toBeNull()
  })

  it('picking from the picker writes the theme (and a non-default window, and the security) into the command', async () => {
    serve(PAYLOAD)
    const onRun = vi.fn()
    renderPanel({ sym: 'NVDA', onRun })
    await screen.findByTestId('terminal-imov-total')
    fireEvent.click(screen.getByTestId('terminal-imov-win-1W'))
    fireEvent.change(screen.getByTestId('terminal-imov-theme'), { target: { value: 'semiconductors' } })
    expect(onRun).toHaveBeenLastCalledWith('NVDA IMOV THEME SEMICONDUCTORS 1W', { here: true })
  })

  it('one ticker-shaped word no theme holds, but a theme is called, offers that theme', async () => {
    serve(PAYLOAD)
    const onRun = vi.fn()
    renderPanel({ sym: 'SEMI', onRun })
    await screen.findByTestId('terminal-imov-unheld')
    expect(text('terminal-imov-unheld')).toContain('No UCT theme holds SEMI.')
    expect(text('terminal-imov-unheld')).toContain('Did you mean the Semiconductors theme?')
    fireEvent.click(screen.getByTestId('terminal-imov-didyoumean-semiconductors'))
    expect(onRun).toHaveBeenCalledWith('SEMI IMOV THEME SEMICONDUCTORS', { here: true })
  })
})
