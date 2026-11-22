import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import ConnectTilesCompact from './ConnectTilesCompact'
import { EVERNOTE_CONNECT_NOTES } from './evernoteCopy'

function mockFetch(routes) {
  global.fetch = vi.fn(async (url, opts) => {
    for (const [match, resp] of routes) {
      if (String(url).includes(match)) {
        return {
          ok: resp.ok !== false,
          status: resp.status || (resp.ok === false ? 500 : 200),
          json: async () => (typeof resp.body === 'function' ? resp.body(opts) : resp.body ?? {}),
        }
      }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

const NOTHING_CONFIGURED_STATUS = {
  providers: {
    roam: { configured: false, connected: false, sources: [] },
    craft: { configured: false, connected: false, sources: [] },
    notion: { configured: false, connected: false, sources: [] },
  },
}

describe('ConnectTilesCompact', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing while loading', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: NOTHING_CONFIGURED_STATUS }]])
    const { container } = render(<ConnectTilesCompact />)
    // While the SWR fetch is in flight, nothing renders.
    expect(container).toBeEmptyDOMElement()
    await waitFor(() => {
      expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/status'))).toBe(true)
    })
  })

  /**
   * ⛔⛔ THIS USED TO BE THE SAME "renders nothing" CASE AS LOADING — a
   * member on a deployment with zero providers configured saw no evidence
   * this capability was even a category of feature, permanently, not just
   * for the instant the fetch was in flight. Competitive audit finding
   * UX #17, 2026-09-22.
   */
  it('shows an honest coming-soon note (not silence) once loaded with ZERO providers configured', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: NOTHING_CONFIGURED_STATUS }]])
    render(<ConnectTilesCompact />)
    expect(await screen.findByText(/coming soon/i)).toBeInTheDocument()
    // No individual per-provider tile here -- that detail stays on the
    // Settings card, this stays one compact line.
    expect(screen.queryByTestId(/connect-tile-/)).toBeNull()
  })

  const NOTION_CONFIGURED_STATUS = {
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      craft: { configured: false, connected: false, sources: [] },
      notion: { configured: true, connected: false, sources: [] },
      // A stale server (or a stored row) naming an archived provider renders no tile.
      dropbox: { configured: true, connected: true, sources: [] },
    },
  }

  it('a not-yet-connected notion tile reads "Connect Notion" and opens the consent panel (oauth)', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: NOTION_CONFIGURED_STATUS }],
      ['/api/j2/notes/connectors/notion/connect', { body: { redirectUrl: 'https://api.notion.com/v1/oauth/authorize?x=1' } }],
    ])
    render(<ConnectTilesCompact />)
    const tile = await screen.findByTestId('connect-tile-notion')
    expect(tile).toHaveTextContent('Connect Notion')
    expect(screen.queryByTestId('connect-tile-dropbox')).toBeNull()
    fireEvent.click(tile)

    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/notion/connect'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ consent: true })
    })
  })

  const OBSIDIAN_CONFIGURED_STATUS = {
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      craft: { configured: false, connected: false, sources: [] },
      notion: { configured: false, connected: false, sources: [] },
            obsidian: { configured: true, connected: false, connectKind: 'device', sources: [] },
    },
  }

  // ⛔ Same shape as the other providers' click-driven tests above: reaches
  // the mint endpoint ONLY through the tile's own click + the modal's own
  // "Generate code" button, never by rendering ObsidianConnectModal
  // directly — deleting either door fails this test.
  it('a not-yet-connected obsidian tile reads "Connect Obsidian" and mints a code via its device modal (never the token/oauth flow)', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: OBSIDIAN_CONFIGURED_STATUS }],
      ['/api/j2/notes/connectors/obsidian/connect', { body: { connectCode: 'ABCDE-12345', expiresInSeconds: 900 } }],
    ])
    render(<ConnectTilesCompact />)
    const tile = await screen.findByTestId('connect-tile-obsidian')
    expect(tile).toHaveTextContent('Connect Obsidian')
    fireEvent.click(tile)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /generate code/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/obsidian/connect'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ consent: true })
    })
    expect(await screen.findByTestId('obsidian-connect-code')).toHaveTextContent('ABCDE-12345')
  })

  // Plan E Task 10: the wizard strip reads the SAME roster, so Evernote arrives here with no
  // second list, under the same status-field gate as the Settings card.
  const evernoteStatus = (configured) => ({
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      notion: { configured: true, connected: false, sources: [] },
      evernote: { configured, connected: false, sources: [] },
    },
  })

  it('an evernote tile appears only when /status says configured (flag off or not allowed => none)', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: evernoteStatus(false) }]])
    render(<ConnectTilesCompact />)
    expect(await screen.findByTestId('connect-tile-notion')).toBeInTheDocument()   // control
    expect(screen.queryByTestId('connect-tile-evernote')).toBeNull()
  })

  it('a configured evernote tile opens the consent panel with the paid-plan, beta and adoption notes', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: evernoteStatus(true) }]])
    render(<ConnectTilesCompact />)
    const tile = await screen.findByTestId('connect-tile-evernote')
    expect(tile).toHaveTextContent('Connect Evernote')
    fireEvent.click(tile)
    const panel = await screen.findByRole('group', { name: 'Consent to connect Evernote' })
    const items = within(within(panel).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(EVERNOTE_CONNECT_NOTES)
  })
})
