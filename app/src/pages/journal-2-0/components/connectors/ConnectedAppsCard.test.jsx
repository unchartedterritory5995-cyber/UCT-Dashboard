import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import ConnectedAppsCard from './ConnectedAppsCard'

let mockIsPaid = true
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ isPaid: mockIsPaid, startCheckout: vi.fn() }),
}))

const STATUS_MIXED = {
  providers: {
    roam: {
      configured: true,
      // `connected` is connector-level (per the shipped router: `connector
      // is not None`) — it does NOT come from sources.length, so fixtures
      // must set it explicitly (Task 12b correction).
      connected: true,
      sources: [
        {
          id: 'src-roam-1',
          provider: 'roam',
          displayName: 'My Trading Graph',
          remoteId: 'my-trading-graph',
          syncEnabled: true,
          status: 'active',
          lastSyncAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          lastSyncStatus: 'ok',
          counts: { notesCreated: 12, notesUpdated: 3, conflicts: 2 },
        },
      ],
    },
    craft: { configured: true, connected: false, sources: [] },
    notion: { configured: false, connected: false, sources: [] },
    dropbox: { configured: false, connected: false, sources: [] },
  },
}

const EMPTY_STATUS = {
  providers: {
    roam: { configured: true, connected: false, sources: [] },
    craft: { configured: true, connected: false, sources: [] },
    notion: { configured: false, connected: false, sources: [] },
    dropbox: { configured: false, connected: false, sources: [] },
  },
}

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

describe('ConnectedAppsCard — upsell', () => {
  afterEach(() => {
    mockIsPaid = true
    vi.restoreAllMocks()
  })

  it('shows an upsell instead of the provider matrix when !isPaid', async () => {
    mockIsPaid = false
    global.fetch = vi.fn()
    render(<ConnectedAppsCard />)
    expect(screen.getByText(/premium feature/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upgrade to connect/i })).toBeInTheDocument()
    expect(screen.queryByTestId('connector-tile-roam')).not.toBeInTheDocument()
  })
})

describe('ConnectedAppsCard — provider matrix', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  it('renders the provider matrix from mocked status: connected / connect / coming soon', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: STATUS_MIXED }]])
    render(<ConnectedAppsCard />)

    // roam: configured + 1 connected source
    expect(await screen.findByText(/Connected · 1 source/)).toBeInTheDocument()
    expect(screen.getByText('My Trading Graph')).toBeInTheDocument()

    // craft: configured, no sources -> Connect button
    const craftTile = screen.getByTestId('connector-tile-craft')
    expect(craftTile).toHaveTextContent('Connect')

    // notion + dropbox: not configured -> Coming soon
    expect(screen.getByTestId('connector-tile-notion')).toHaveTextContent('Coming soon')
    expect(screen.getByTestId('connector-tile-dropbox')).toHaveTextContent('Coming soon')
  })

  it('renders the conflict count on a source with conflicts', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: STATUS_MIXED }]])
    render(<ConnectedAppsCard />)
    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(screen.getByText('Conflicts')).toBeInTheDocument()
  })

  it('Sync now fires POST /sources/{id}/sync', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: STATUS_MIXED }],
      ['/sources/src-roam-1/sync', { body: { status: 'ok' } }],
    ])
    render(<ConnectedAppsCard />)
    const syncBtn = await screen.findByRole('button', { name: /sync now/i })
    fireEvent.click(syncBtn)
    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/sources/src-roam-1/sync'))
      expect(call).toBeTruthy()
      expect(call[1].method).toBe('POST')
    })
  })

  it('disconnect requires a second click (2-step confirm) before DELETE fires', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: STATUS_MIXED }],
      ['/api/j2/notes/connectors/roam', { body: {} }],
    ])
    render(<ConnectedAppsCard />)
    const btn = await screen.findByRole('button', { name: /^disconnect$/i })
    fireEvent.click(btn)
    expect(await screen.findByRole('button', { name: /click again to disconnect/i })).toBeInTheDocument()
    // no DELETE yet on the first click
    expect(global.fetch.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /click again to disconnect/i }))
    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => c[1]?.method === 'DELETE')
      expect(call).toBeTruthy()
      expect(String(call[0])).toContain('/api/j2/notes/connectors/roam')
    })
  })

  it('pause toggle fires PUT /sources/{id} with syncEnabled flipped', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: STATUS_MIXED }],
      ['/sources/src-roam-1', { body: {} }],
    ])
    render(<ConnectedAppsCard />)
    const toggle = await screen.findByRole('checkbox')
    fireEvent.click(toggle)
    await waitFor(() => {
      const call = global.fetch.mock.calls.find(
        (c) => String(c[0]) === '/api/j2/notes/connectors/sources/src-roam-1' && c[1]?.method === 'PUT'
      )
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ syncEnabled: false })
    })
  })
})

describe('ConnectedAppsCard — token modal (roam)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  it('POSTs graphName/token/consent:true to the connect endpoint once consent is checked', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }],
      ['/api/j2/notes/connectors/roam/connect', { body: { ok: true } }],
    ])
    render(<ConnectedAppsCard />)
    const roamTile = await screen.findByTestId('connector-tile-roam')
    fireEvent.click(within(roamTile).getByRole('button', { name: /connect/i }))

    fireEvent.change(await screen.findByLabelText(/graph name/i), { target: { value: 'my-graph' } })
    fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: 'roam-graph-token-xyz' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^connect$/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/roam/connect'))
      expect(call).toBeTruthy()
      const body = JSON.parse(call[1].body)
      expect(body).toEqual({ graphName: 'my-graph', token: 'roam-graph-token-xyz', consent: true })
    })
  })

  it('spec §8 consent gate: fields filled but consent UNCHECKED — Connect stays disabled, no POST fires', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }]])
    render(<ConnectedAppsCard />)
    const roamTile = await screen.findByTestId('connector-tile-roam')
    fireEvent.click(within(roamTile).getByRole('button', { name: /connect/i }))

    fireEvent.change(await screen.findByLabelText(/graph name/i), { target: { value: 'my-graph' } })
    fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: 'roam-graph-token-xyz' } })
    // Consent checkbox deliberately left unchecked.
    const submitBtn = within(screen.getByRole('dialog')).getByRole('button', { name: /^connect$/i })
    expect(submitBtn).toBeDisabled()
    fireEvent.click(submitBtn)

    await new Promise((r) => setTimeout(r, 20))
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/roam/connect'))).toBe(false)
  })

  it('shows the exact Roam helper text pointing at Settings → Graph → API tokens', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }]])
    render(<ConnectedAppsCard />)
    const roamTile = await screen.findByTestId('connector-tile-roam')
    fireEvent.click(within(roamTile).getByRole('button', { name: /connect/i }))
    expect(await screen.findByText(/Settings → Graph → API tokens/)).toBeInTheDocument()
  })

  it('renders a 400 detail inline instead of failing silently', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }],
      ['/api/j2/notes/connectors/roam/connect', { ok: false, status: 400, body: { detail: 'That graph token looks invalid.' } }],
    ])
    render(<ConnectedAppsCard />)
    const roamTile = await screen.findByTestId('connector-tile-roam')
    fireEvent.click(within(roamTile).getByRole('button', { name: /connect/i }))
    fireEvent.change(await screen.findByLabelText(/graph name/i), { target: { value: 'my-graph' } })
    fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: 'bad-token' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^connect$/i }))

    expect(await screen.findByText('That graph token looks invalid.')).toBeInTheDocument()
  })
})

describe('ConnectedAppsCard — token modal (craft)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  it('shows the "shown once" warning for Craft', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }]])
    render(<ConnectedAppsCard />)
    const craftTile = await screen.findByTestId('connector-tile-craft')
    fireEvent.click(within(craftTile).getByRole('button', { name: /connect/i }))
    expect(await screen.findByText(/shown once/i)).toBeInTheDocument()
  })

  it('POSTs apiUrl/apiKey/consent:true to the connect endpoint once consent is checked', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }],
      ['/api/j2/notes/connectors/craft/connect', { body: { ok: true } }],
    ])
    render(<ConnectedAppsCard />)
    const craftTile = await screen.findByTestId('connector-tile-craft')
    fireEvent.click(within(craftTile).getByRole('button', { name: /connect/i }))
    fireEvent.change(await screen.findByLabelText(/api url/i), { target: { value: 'https://connect.craft.do/x' } })
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'craft-key-123' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^connect$/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/craft/connect'))
      expect(call).toBeTruthy()
      const body = JSON.parse(call[1].body)
      expect(body).toEqual({ apiUrl: 'https://connect.craft.do/x', apiKey: 'craft-key-123', consent: true })
    })
  })

  it('consent UNCHECKED — Connect stays disabled, no POST fires', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }]])
    render(<ConnectedAppsCard />)
    const craftTile = await screen.findByTestId('connector-tile-craft')
    fireEvent.click(within(craftTile).getByRole('button', { name: /connect/i }))
    fireEvent.change(await screen.findByLabelText(/api url/i), { target: { value: 'https://connect.craft.do/x' } })
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'craft-key-123' } })
    const submitBtn = within(screen.getByRole('dialog')).getByRole('button', { name: /^connect$/i })
    expect(submitBtn).toBeDisabled()
    fireEvent.click(submitBtn)

    await new Promise((r) => setTimeout(r, 20))
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/craft/connect'))).toBe(false)
  })
})

describe('ConnectedAppsCard — OAuth (notion/dropbox) consent gate', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  const OAUTH_STATUS = {
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      craft: { configured: false, connected: false, sources: [] },
      notion: { configured: true, connected: false, sources: [] },
      dropbox: { configured: false, connected: false, sources: [] },
    },
  }

  it('first Connect click reveals a consent panel — no connect POST fires yet', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: OAUTH_STATUS }]])
    render(<ConnectedAppsCard />)
    const notionTile = await screen.findByTestId('connector-tile-notion')
    fireEvent.click(within(notionTile).getByRole('button', { name: /connect/i }))

    const continueBtn = await screen.findByRole('button', { name: /^continue$/i })
    expect(continueBtn).toBeDisabled()
    await new Promise((r) => setTimeout(r, 20))
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/notion/connect'))).toBe(false)
  })

  it('checking consent then Continue POSTs {consent:true} to the connect endpoint (starts the OAuth redirect)', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: OAUTH_STATUS }],
      ['/api/j2/notes/connectors/notion/connect', { body: { redirectUrl: 'https://api.notion.com/v1/oauth/authorize?x=1' } }],
    ])
    render(<ConnectedAppsCard />)
    const notionTile = await screen.findByTestId('connector-tile-notion')
    fireEvent.click(within(notionTile).getByRole('button', { name: /connect/i }))

    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/notion/connect'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ consent: true })
    })
  })

  it('Cancel on the consent panel drops back to the Connect button with no POST', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: OAUTH_STATUS }]])
    render(<ConnectedAppsCard />)
    const notionTile = await screen.findByTestId('connector-tile-notion')
    fireEvent.click(within(notionTile).getByRole('button', { name: /connect/i }))
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument()
    expect(within(notionTile).getByRole('button', { name: /connect/i })).toBeInTheDocument()
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/notion/connect'))).toBe(false)
  })
})

describe('ConnectedAppsCard — OAuth return self-heal', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  it('detects ?connector=notion&connected=1, refreshes status, and strips the params', async () => {
    window.history.replaceState({}, '', '/settings?section=connections&connector=notion&connected=1')
    mockFetch([[
      '/api/j2/notes/connectors/status',
      { body: { providers: { notion: { configured: true, connected: true, sources: [{ id: 's1', provider: 'notion', displayName: 'Work', syncEnabled: true, counts: {} }] } } } },
    ]])
    render(<ConnectedAppsCard />)

    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter((c) => String(c[0]).includes('/api/j2/notes/connectors/status'))
      expect(calls.length).toBeGreaterThanOrEqual(2) // initial SWR fetch + the self-heal refresh
    })
    expect(window.location.search).not.toContain('connector')
    expect(window.location.search).not.toContain('connected')
    expect(window.location.search).toContain('section=connections')
  })
})

describe('ConnectedAppsCard — Dropbox folder picker + sourceless-connected state (Task 12b)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  const DROPBOX_SOURCELESS_STATUS = {
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      craft: { configured: false, connected: false, sources: [] },
      notion: { configured: false, connected: false, sources: [] },
      dropbox: { configured: true, connected: true, sources: [] },
    },
  }

  it('a connected-but-sourceless Dropbox tile shows a "Choose folder" CTA, not the healthy Connected badge', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: DROPBOX_SOURCELESS_STATUS }]])
    render(<ConnectedAppsCard />)

    const tile = await screen.findByTestId('connector-tile-dropbox')
    expect(within(tile).getByRole('button', { name: /choose folder/i })).toBeInTheDocument()
    // The healthy "Connected · N source(s)" pill must NOT render for this state.
    expect(within(tile).queryByText(/Connected · \d+ source/)).not.toBeInTheDocument()
  })

  it('clicking "Choose folder" opens the picker, which lists folders from the mocked GET', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: DROPBOX_SOURCELESS_STATUS }],
      ['/dropbox/folders', { body: { folders: [{ path_lower: '/team notes', name: 'Team Notes' }] } }],
    ])
    render(<ConnectedAppsCard />)
    const tile = await screen.findByTestId('connector-tile-dropbox')
    fireEvent.click(within(tile).getByRole('button', { name: /choose folder/i }))

    expect(await screen.findByText('Team Notes')).toBeInTheDocument()
    const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/dropbox/folders'))
    expect(call).toBeTruthy()
  })

  it('picking a folder POSTs {remoteId, displayName} to /dropbox/sources and refreshes status', async () => {
    let sourcesCreated = false
    mockFetch([
      ['/api/j2/notes/connectors/status', {
        body: () => (sourcesCreated
          ? {
              providers: {
                ...DROPBOX_SOURCELESS_STATUS.providers,
                dropbox: {
                  configured: true, connected: true,
                  sources: [{ id: 'dbx-1', provider: 'dropbox', displayName: 'Team Notes', remoteId: '/team notes', syncEnabled: true, counts: {} }],
                },
              },
            }
          : DROPBOX_SOURCELESS_STATUS),
      }],
      ['/dropbox/folders', { body: { folders: [{ path_lower: '/team notes', name: 'Team Notes' }] } }],
      ['/dropbox/sources', {
        body: (opts) => {
          sourcesCreated = true
          expect(JSON.parse(opts.body)).toEqual({ remoteId: '/team notes', displayName: 'Team Notes' })
          return { source: { id: 'dbx-1' } }
        },
      }],
    ])
    render(<ConnectedAppsCard />)
    const tile = await screen.findByTestId('connector-tile-dropbox')
    fireEvent.click(within(tile).getByRole('button', { name: /choose folder/i }))
    fireEvent.click(await screen.findByRole('button', { name: /sync this folder/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/dropbox/sources') && c[1]?.method === 'POST')
      expect(call).toBeTruthy()
    })
    // Status re-fetched after the pick -> the tile flips to the healthy Connected state.
    expect(await screen.findByText(/Connected · 1 source/)).toBeInTheDocument()
  })

  it('a folder-list failure (e.g. broken connector) renders inline with a retry, mirroring the existing error idiom', async () => {
    let attempt = 0
    // A bespoke fetch mock (not the `mockFetch` helper) — this test needs the
    // FIRST /dropbox/folders call to answer with a real non-ok Response (409,
    // matching the router's "Reconnect Dropbox" contract) and the SECOND to
    // succeed, which the helper's single-route-per-URL table can't express.
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/j2/notes/connectors/status')) {
        return { ok: true, status: 200, json: async () => DROPBOX_SOURCELESS_STATUS }
      }
      if (String(url).includes('/dropbox/folders')) {
        attempt += 1
        if (attempt === 1) {
          return { ok: false, status: 409, json: async () => ({ detail: 'Reconnect Dropbox — stored credentials are unreadable.' }) }
        }
        return { ok: true, status: 200, json: async () => ({ folders: [{ path_lower: '/team notes', name: 'Team Notes' }] }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    render(<ConnectedAppsCard />)
    const tile = await screen.findByTestId('connector-tile-dropbox')
    fireEvent.click(within(tile).getByRole('button', { name: /choose folder/i }))

    expect(await screen.findByText(/reconnect dropbox/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Team Notes')).toBeInTheDocument()
  })

  it('OAuth return for dropbox auto-opens the folder picker when it lands connected-but-sourceless', async () => {
    window.history.replaceState({}, '', '/settings?section=connections&connector=dropbox&connected=1')
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: DROPBOX_SOURCELESS_STATUS }],
      ['/dropbox/folders', { body: { folders: [] } }],
    ])
    render(<ConnectedAppsCard />)

    // The picker opens WITHOUT any click — the self-heal drove it.
    expect(await screen.findByText('Choose a Dropbox folder')).toBeInTheDocument()
  })

  it('OAuth return for notion (which always gets a source atomically) does NOT open the Dropbox picker', async () => {
    window.history.replaceState({}, '', '/settings?section=connections&connector=notion&connected=1')
    mockFetch([[
      '/api/j2/notes/connectors/status',
      { body: { providers: { notion: { configured: true, connected: true, sources: [{ id: 's1', provider: 'notion', displayName: 'Work', syncEnabled: true, counts: {} }] } } } },
    ]])
    render(<ConnectedAppsCard />)

    expect(await screen.findByText(/Connected · 1 source/)).toBeInTheDocument()
    expect(screen.queryByText('Choose a Dropbox folder')).not.toBeInTheDocument()
  })
})

describe('ConnectedAppsCard — background sync paused notice (final-review Item B)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  it('renders a dim, honest notice above the tiles when the server reports enabled:false', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: { enabled: false, ...EMPTY_STATUS } }]])
    render(<ConnectedAppsCard />)
    expect(await screen.findByTestId('sync-paused-notice')).toBeInTheDocument()
    expect(screen.getByText(/background sync is paused on this server/i)).toBeInTheDocument()
  })

  it('does not render the notice when the server sends enabled:true', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: { enabled: true, ...EMPTY_STATUS } }]])
    render(<ConnectedAppsCard />)
    await screen.findByTestId('connector-tile-roam')
    expect(screen.queryByTestId('sync-paused-notice')).not.toBeInTheDocument()
  })

  it('does not render the notice when the server omits `enabled` entirely (the safe default)', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }]])
    render(<ConnectedAppsCard />)
    await screen.findByTestId('connector-tile-roam')
    expect(screen.queryByTestId('sync-paused-notice')).not.toBeInTheDocument()
  })
})

describe('ConnectedAppsCard — normalization contract (fix-round 1, finding #2)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  // A raw payload in an entirely different casing/shape than this task's own
  // camelCase contract (the real router — a parallel task — may not match
  // it) — the card must still render correctly, proving every consumer
  // reads useNoteConnectors' normalized output rather than raw keys.
  const SNAKE_CASE_STATUS = {
    providers: {
      roam: {
        is_configured: true,
        connected: true,
        sources: [
          {
            id: 'src-1',
            provider: 'roam',
            display_name: 'Snake Case Graph',
            remote_id: 'snake-graph',
            sync_enabled: true,
            status: 'active',
            last_sync_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            last_sync_status: 'ok',
            counts: { notes_created: 7, notes_updated: 1, conflicts: 3 },
          },
        ],
      },
      craft: { is_configured: false, connected: false, sources: [] },
      // notion/dropbox intentionally OMITTED — normalizeStatus must still
      // produce a "not configured" tile for both rather than crashing.
    },
  }

  it('renders correctly off a raw snake_case + partial payload', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: SNAKE_CASE_STATUS }]])
    render(<ConnectedAppsCard />)

    expect(await screen.findByText(/Connected · 1 source/)).toBeInTheDocument()
    expect(screen.getByText('Snake Case Graph')).toBeInTheDocument()
    expect(screen.getByText(/synced 10m ago/)).toBeInTheDocument()
    // counts.conflicts normalized from snake_case
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Conflicts')).toBeInTheDocument()
    // craft: is_configured:false -> Coming soon
    expect(screen.getByTestId('connector-tile-craft')).toHaveTextContent('Coming soon')
    // notion/dropbox missing from the raw payload entirely -> still render as not-configured
    expect(screen.getByTestId('connector-tile-notion')).toHaveTextContent('Coming soon')
    expect(screen.getByTestId('connector-tile-dropbox')).toHaveTextContent('Coming soon')
  })
})
