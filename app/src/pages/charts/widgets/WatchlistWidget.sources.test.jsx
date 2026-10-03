/**
 * COV-10 follow-up — two more list SOURCES a Watchlist widget can TRACK or FREEZE:
 *   * a THEME's holdings, published by the real ThemesWidget when a taxonomy theme is open;
 *   * one of the member's SAVED SCREENS (its nightly results), offered by the widget itself.
 *
 * Real: the channel store, ThemesWidget (publisher), WatchlistWidget, SubscribeOffer,
 * SubscribedList, ScreenSourceOffer. Stubbed: ThemeTrackerPage (a two-button stand-in that
 * reports an open / closed theme exactly as the real page's `onOpenThemeChange` does — the
 * real page's report is railed in ThemeTrackerPage.openThemeReport.test.jsx), the Watchlists
 * table (renders its members as text), the picker, and the network. The server half answers
 * like api/routers/charts_list_sources.py, railed on real stores in
 * tests/test_charts_list_sources.py.
 *
 * Every assertion reads RENDERED text or the real store.
 */
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

let track = {}
let trackKeys = []
// COV-10's gate is read from auth by each widget (useListSubscribeEnabled), not
// carried on the workspace; the board helper below sets it per render.
const listSubFlag = vi.hoisted(() => ({ on: true }))
vi.mock('../useListSubscribeEnabled', () => ({ default: () => listSubFlag.on }))
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: (key) => {
    if (Array.isArray(key)) {
      trackKeys.push(key[0])
      return { ...(track[key[0]] || {}), mutate: () => {}, isValidating: false }
    }
    return { data: null, mutate: () => {}, isValidating: false }
  },
}))
vi.mock('../../Watchlists', () => ({
  default: ({ pickName, scanSymbols, pickList }) => (
    <div data-testid={pickList === '__scan__' ? 'table' : 'saved-list'}>
      <span>table:{pickName}</span>
      {Array.isArray(scanSymbols) && <span>members:{scanSymbols.join(',') || '(none)'}</span>}
    </div>
  ),
}))
vi.mock('./WatchlistPicker', () => ({ default: () => <div>list-picker</div> }))
vi.mock('../../ThemeTrackerPage', () => ({
  default: ({ onOpenThemeChange }) => (
    <div>
      <button type="button" onClick={() => onOpenThemeChange?.({ id: 'quantum', name: 'Quantum Computing' })}>open-quantum</button>
      <button type="button" onClick={() => onOpenThemeChange?.(null)}>close-theme</button>
    </div>
  ),
}))

import WatchlistWidget from './WatchlistWidget'
import ThemesWidget from './ThemesWidget'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'
import { ContextChannelsProvider, createChannelStore, channelFor, KIND } from '../../../lib/context/contextChannels'

const THEME_URL = '/api/charts/list-sources/theme/quantum'
const SCREEN_URL = '/api/charts/list-sources/screen/7'
const SCREENS_URL = '/api/screener/saved-screens'
const answer = (syms, extra = {}) => ({ results: syms.map((sym) => ({ sym })), as_of: '2026-09-30', ...extra })
const res = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

let routes = {}
let fetchCalls = []
beforeEach(() => {
  track = {}
  trackKeys = []
  fetchCalls = []
  routes = {
    [SCREENS_URL]: () => res(200, { saved: [{ id: 7, name: 'RSI under 60' }, { id: 9, name: 'Leaders' }], starters: [] }),
    [SCREEN_URL]: () => res(200, answer(['AAA', 'BRK-B'])),
  }
  global.fetch = vi.fn((url) => {
    fetchCalls.push(url)
    return routes[url] ? routes[url]() : res(500, {})
  })
})
afterEach(() => cleanup())

function Board({ store, on = true, wlColor = 'A', showThemes = true }) {
  const [wlOpts, setWlOpts] = useState({})
  Board.wlOpts = wlOpts
  listSubFlag.on = on
  const ws = { ...WORKSPACE_FALLBACK }
  return (
    <ContextChannelsProvider store={store}>
      <WorkspaceContext.Provider value={ws}>
        {showThemes && <ThemesWidget color="A" opts={{}} />}
        <WatchlistWidget color={wlColor} opts={wlOpts} onOptsChange={setWlOpts} />
      </WorkspaceContext.Provider>
    </ContextChannelsProvider>
  )
}
const subTree = () => within(document.querySelector('[data-sub-mode]'))

describe('dark: neither source exists on the board', () => {
  it('an open theme publishes nothing and the empty watchlist offers no saved screen', () => {
    const store = createChannelStore()
    render(<Board store={store} on={false} />)
    fireEvent.click(screen.getByText('open-quantum'))
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toBeNull()
    expect(screen.queryByText(/is showing the theme/)).not.toBeInTheDocument()
    expect(screen.queryByText(/my saved screens/)).not.toBeInTheDocument()
    expect(screen.getByText('list-picker')).toBeInTheDocument()
    expect(fetchCalls).toEqual([])
  })
})

describe('THEME — the open theme is a source on its colour group', () => {
  it('opening a theme publishes it; closing it gives the channel up', () => {
    const store = createChannelStore()
    render(<Board store={store} />)
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toBeNull()
    fireEvent.click(screen.getByText('open-quantum'))
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toMatchObject({ source: 'theme', value: 'quantum', label: 'Quantum Computing' })
    fireEvent.click(screen.getByText('close-theme'))
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toBeNull()
  })

  it('the offer names the theme, has both buttons, and subscribes to neither', () => {
    render(<Board store={createChannelStore()} />)
    fireEvent.click(screen.getByText('open-quantum'))
    expect(screen.getByText(/Group A is showing the theme/)).toBeInTheDocument()
    expect(screen.getByText('Quantum Computing', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Track it follows the theme's holdings/ })).toBeInTheDocument()
    expect(Board.wlOpts.listSub).toBeUndefined()
  })

  it('Track follows the theme endpoint and says what "current" means for a theme', () => {
    track[THEME_URL] = { data: answer(['IONQ', 'RGTI']) }
    render(<Board store={createChannelStore()} />)
    fireEvent.click(screen.getByText('open-quantum'))
    fireEvent.click(screen.getByRole('button', { name: /Track it/ }))
    expect(Board.wlOpts.listSub).toMatchObject({ mode: 'track', source: 'theme', value: 'quantum' })
    expect(trackKeys).toContain(THEME_URL)
    expect(screen.getByText(/^Tracking Quantum Computing · current holdings · 2 stocks · read /)).toBeInTheDocument()
    expect(subTree().getByText('members:IONQ,RGTI')).toBeInTheDocument()
  })

  it('⛔ a theme that is gone says so, by the server\'s reason, and shows no table', async () => {
    routes[THEME_URL] = () => res(404, { detail: 'That theme no longer exists.' })
    render(<Board store={createChannelStore()} />)
    fireEvent.click(screen.getByText('open-quantum'))
    fireEvent.click(screen.getByRole('button', { name: /Freeze a copy/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not freeze Quantum Computing: the source could not be read (HTTP 404 · That theme no longer exists). Nothing was saved.'))
    expect(Board.wlOpts.listSub).toBeUndefined()
  })
})

describe('SAVED SCREEN — offered by the empty watchlist itself', () => {
  it('nothing is read until the member asks; then the screens, then the same two buttons', async () => {
    render(<Board store={createChannelStore()} showThemes={false} />)
    expect(fetchCalls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Track or freeze one of my saved screens…' }))
    const pick = await screen.findByRole('combobox', { name: 'Saved screen' })
    expect(within(pick).getAllByRole('option').map(o => o.textContent)).toEqual(['Choose…', 'RSI under 60', 'Leaders'])
    expect(screen.queryByRole('button', { name: /Track it/ })).not.toBeInTheDocument()
    fireEvent.change(pick, { target: { value: '7' } })
    expect(screen.getByText(/Your saved screen/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Track it follows its nightly results/ })).toBeInTheDocument()
    expect(Board.wlOpts.listSub).toBeUndefined()                     // ⛔ no default mode
  })

  it('Freeze stores the nightly members and says when a page cut the list short', async () => {
    routes[SCREEN_URL] = () => res(200, answer(['AAA', 'BRK-B'], { total: 812 }))
    render(<Board store={createChannelStore()} showThemes={false} />)
    fireEvent.click(screen.getByRole('button', { name: /my saved screens/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Saved screen' }), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Freeze a copy/ }))
    await waitFor(() => expect(screen.getByText('FROZEN')).toBeInTheDocument())
    expect(Board.wlOpts.listSub).toMatchObject({ mode: 'freeze', source: 'screen', value: '7', label: 'RSI under 60', symbols: ['AAA', 'BRK-B'], total: 812 })
    expect(screen.getByText(/Frozen copy of RSI under 60 · taken .* · 2 stocks \(the first 2 of 812\) · does not update/)).toBeInTheDocument()
    expect(subTree().getByText('members:AAA,BRK-B')).toBeInTheDocument()
  })

  it('Track reads the screen endpoint and calls it nightly results, not live', () => {
    track[SCREEN_URL] = { data: answer(['AAA']) }
    render(<Board store={createChannelStore()} showThemes={false} />)
    fireEvent.click(screen.getByRole('button', { name: /my saved screens/ }))
    return screen.findByRole('combobox', { name: 'Saved screen' }).then((pick) => {
      fireEvent.change(pick, { target: { value: '7' } })
      fireEvent.click(screen.getByRole('button', { name: /Track it/ }))
      expect(trackKeys).toContain(SCREEN_URL)
      expect(screen.getByText(/^Tracking RSI under 60 · nightly results · 1 stock · read /)).toBeInTheDocument()
    })
  })

  it('⛔ a tracked screen that was deleted says so with the reason, never as an empty list', () => {
    track[SCREEN_URL] = { error: new Error('HTTP 404 · That saved screen no longer exists') }
    render(<Board store={createChannelStore()} showThemes={false} />)
    fireEvent.click(screen.getByRole('button', { name: /my saved screens/ }))
    return screen.findByRole('combobox', { name: 'Saved screen' }).then((pick) => {
      fireEvent.change(pick, { target: { value: '7' } })
      fireEvent.click(screen.getByRole('button', { name: /Track it/ }))
      expect(screen.getByRole('alert')).toHaveTextContent(
        'SOURCE UNAVAILABLE: it could not be read (HTTP 404 · That saved screen no longer exists). Nothing is shown because nothing could be read; this is not an empty list.')
      expect(screen.queryByTestId('table')).not.toBeInTheDocument()
    })
  })

  it('⛔ an unreadable screens list says why; a free member is told it needs a plan', async () => {
    routes[SCREENS_URL] = () => res(402, { detail: 'paid' })
    render(<Board store={createChannelStore()} showThemes={false} />)
    fireEvent.click(screen.getByRole('button', { name: /my saved screens/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Saved screens need a paid plan.'))
    cleanup()
    routes[SCREENS_URL] = () => res(500, {})
    render(<Board store={createChannelStore()} showThemes={false} />)
    fireEvent.click(screen.getByRole('button', { name: /my saved screens/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your saved screens could not be read (HTTP 500).'))
  })
})
