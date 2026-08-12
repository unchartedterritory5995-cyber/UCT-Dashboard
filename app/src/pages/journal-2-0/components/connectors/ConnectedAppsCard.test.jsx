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
    craft: { configured: true, sources: [] },
    notion: { configured: false, sources: [] },
    dropbox: { configured: false, sources: [] },
  },
}

const EMPTY_STATUS = {
  providers: {
    roam: { configured: true, sources: [] },
    craft: { configured: true, sources: [] },
    notion: { configured: false, sources: [] },
    dropbox: { configured: false, sources: [] },
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

  it('POSTs graphName/token to the connect endpoint', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }],
      ['/api/j2/notes/connectors/roam/connect', { body: { ok: true } }],
    ])
    render(<ConnectedAppsCard />)
    const roamTile = await screen.findByTestId('connector-tile-roam')
    fireEvent.click(within(roamTile).getByRole('button', { name: /connect/i }))

    fireEvent.change(await screen.findByLabelText(/graph name/i), { target: { value: 'my-graph' } })
    fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: 'roam-graph-token-xyz' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^connect$/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/roam/connect'))
      expect(call).toBeTruthy()
      const body = JSON.parse(call[1].body)
      expect(body).toEqual({ graphName: 'my-graph', token: 'roam-graph-token-xyz' })
    })
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

  it('POSTs apiUrl/apiKey to the connect endpoint', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }],
      ['/api/j2/notes/connectors/craft/connect', { body: { ok: true } }],
    ])
    render(<ConnectedAppsCard />)
    const craftTile = await screen.findByTestId('connector-tile-craft')
    fireEvent.click(within(craftTile).getByRole('button', { name: /connect/i }))
    fireEvent.change(await screen.findByLabelText(/api url/i), { target: { value: 'https://connect.craft.do/x' } })
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'craft-key-123' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^connect$/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/craft/connect'))
      expect(call).toBeTruthy()
      const body = JSON.parse(call[1].body)
      expect(body).toEqual({ apiUrl: 'https://connect.craft.do/x', apiKey: 'craft-key-123' })
    })
  })
})

describe('ConnectedAppsCard — OAuth (notion/dropbox)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  const OAUTH_STATUS = {
    providers: {
      roam: { configured: false, sources: [] },
      craft: { configured: false, sources: [] },
      notion: { configured: true, sources: [] },
      dropbox: { configured: false, sources: [] },
    },
  }

  it('clicking Connect on notion POSTs {} to the connect endpoint (starts the OAuth redirect)', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: OAUTH_STATUS }],
      ['/api/j2/notes/connectors/notion/connect', { body: { redirectUrl: 'https://api.notion.com/v1/oauth/authorize?x=1' } }],
    ])
    render(<ConnectedAppsCard />)
    const notionTile = await screen.findByTestId('connector-tile-notion')
    fireEvent.click(within(notionTile).getByRole('button', { name: /connect/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/notion/connect'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({})
    })
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
      { body: { providers: { notion: { configured: true, sources: [{ id: 's1', provider: 'notion', displayName: 'Work', syncEnabled: true, counts: {} }] } } } },
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
