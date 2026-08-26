import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'

// The Activity page mounts the REAL ChartPane with the channel's handoff. Pinned:
// a handoff sets symbol + timeframe; none → the remembered/default symbol; the
// page renders outside Discord (no frame_id) without touching the SDK.

vi.mock('../components/chart/pane/ChartPane', () => ({
  default: (props) => <div data-testid="pane" data-sym={props.sym} data-tf={props.tf}
    data-search={typeof props.onSymbolChange === 'function' ? '1' : '0'} data-live={String(props.stockChartProps?.liveUpdates)} />,
}))
vi.mock('@discord/embedded-app-sdk', () => ({ DiscordSDK: class { ready() { return Promise.resolve() } } }))

const { default: DiscordActivity, launchContext } = await import('./DiscordActivity')

beforeEach(() => { try { localStorage.clear() } catch {} })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

describe('DiscordActivity', () => {
  it('reads the launch context Discord appends to the URL', () => {
    expect(launchContext('?instance_id=i1&channel_id=c1&guild_id=g1&frame_id=f1')).toEqual(
      { inDiscord: true, channelId: 'c1', guildId: 'g1', instanceId: 'i1' })
    expect(launchContext('')).toEqual({ inDiscord: false, channelId: '', guildId: '', instanceId: '' })
  })

  it('opens the channel handoff (symbol + timeframe) with symbol search and live updates off', async () => {
    window.history.replaceState({}, '', '/r/activity?instance_id=i1&channel_id=555&guild_id=g1&frame_id=f1')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ticker: 'NVDA', tf: '15', prefs: null }) })))
    render(<DiscordActivity />)
    await waitFor(() => expect(screen.getByTestId('pane').getAttribute('data-sym')).toBe('NVDA'))
    const pane = screen.getByTestId('pane')
    expect(pane.getAttribute('data-tf')).toBe('15')
    expect(pane.getAttribute('data-search')).toBe('1')
    expect(pane.getAttribute('data-live')).toBe('false')
    expect(screen.getByTestId('discord-activity').getAttribute('data-handoff')).toBe('applied')
    expect(fetch).toHaveBeenCalledWith('/api/discord/activity/handoff?channel_id=555')
  })

  it('falls back to the remembered symbol outside Discord and never calls the handoff', async () => {
    localStorage.setItem('uct.activity.sym', 'amd')
    vi.stubGlobal('fetch', vi.fn())
    render(<DiscordActivity />)
    await waitFor(() => expect(screen.getByTestId('discord-activity').getAttribute('data-handoff')).toBe('none'))
    expect(screen.getByTestId('pane').getAttribute('data-sym')).toBe('AMD')
    expect(screen.getByTestId('discord-activity').getAttribute('data-in-discord')).toBe('0')
    expect(fetch).not.toHaveBeenCalled()
  })
})
