import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ConnectedAppsCard from './ConnectedAppsCard'
import ConnectConsentPanel from './ConnectConsentPanel'
import { ENEX_IMPORT_HREF, EVERNOTE_CONNECT_NOTES, EVERNOTE_ENEX_OFFER, EVERNOTE_PLAN_RETURN } from './evernoteCopy'

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
  },
}

const EMPTY_STATUS = {
  providers: {
    roam: { configured: true, connected: false, sources: [] },
    craft: { configured: true, connected: false, sources: [] },
    notion: { configured: false, connected: false, sources: [] },
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

  // Spec 8.2: "Nobody moves a decade of writing into a product they cannot
  // leave." The member on THIS path has not paid and is deciding whether to
  // commit their library at all, so the reassurance has to be here, not only
  // behind the paywall it is meant to get them through.
  it('tells an unconverted member their notes can leave, before asking them to commit', async () => {
    mockIsPaid = false
    global.fetch = vi.fn()
    render(<ConnectedAppsCard />)
    expect(screen.getByTestId('export-reassurance')).toBeInTheDocument()
    expect(screen.getByText(/never locked in/i)).toBeInTheDocument()
    expect(screen.getByText(/markdown/i)).toBeInTheDocument()
  })
})

// G-106 (Wave B lower-frequency sweep, competitive-gap-ledger.md): the
// isLoading branch used to be bare "Loading…" text.
describe('ConnectedAppsCard — loading (G-106)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows a Skeleton loading state, not bare text, while connector status is in flight', async () => {
    let resolveFetch
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    render(<ConnectedAppsCard />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading…')
    resolveFetch({ ok: true, status: 200, json: async () => EMPTY_STATUS })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
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

    // notion: not configured -> Coming soon
    expect(screen.getByTestId('connector-tile-notion')).toHaveTextContent('Coming soon')
    // Dropbox, OneNote and OneDrive were archived on 2026-11-04: no tile at all
    for (const gone of ['dropbox', 'onenote', 'onedrive']) {
      expect(screen.queryByTestId(`connector-tile-${gone}`)).toBeNull()
    }
  })

  it('renders the conflict count on a source with conflicts', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: STATUS_MIXED }]])
    render(<ConnectedAppsCard />)
    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(screen.getByText('Conflicts')).toBeInTheDocument()
  })

  it('names the source-deleted tag when a sync severed notes', async () => {
    // A severed note is NOT removed from the Notebook -- the engine appends
    // `source-deleted` and keeps the body. A bare count would tell the member
    // something vanished without saying where it went or that it survived, so
    // the hint (not just the number) is the contract under test.
    const withRemoved = JSON.parse(JSON.stringify(STATUS_MIXED))
    withRemoved.providers.roam.sources[0].counts = {
      notesCreated: 0, notesUpdated: 1, conflicts: 0, sourceDeleted: 3,
    }
    mockFetch([['/api/j2/notes/connectors/status', { body: withRemoved }]])
    render(<ConnectedAppsCard />)
    expect(await screen.findByText('Removed')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/source-deleted/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing was erased/i)).toBeInTheDocument()
  })

  it('shows no removal count or hint when nothing was severed', async () => {
    // The other half of the rail: without this, a component that rendered the
    // hint unconditionally would still pass the test above.
    mockFetch([['/api/j2/notes/connectors/status', { body: STATUS_MIXED }]])
    render(<ConnectedAppsCard />)
    await screen.findByText('Conflicts')
    expect(screen.queryByText('Removed')).not.toBeInTheDocument()
    expect(screen.queryByText(/source-deleted/)).not.toBeInTheDocument()
  })

  it('passes the provider label so the pending line names the app', async () => {
    const pending = JSON.parse(JSON.stringify(STATUS_MIXED))
    pending.providers.roam.sources[0].pendingRemoval = 2
    mockFetch([['/api/j2/notes/connectors/status', { body: pending }]])
    render(<ConnectedAppsCard />)
    expect(await screen.findByText('2 notes look removed in Roam Research; confirming on the next check.')).toBeInTheDocument()
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

  // Honesty audit, 2026-09-04: the OAuth consent panel and the Obsidian
  // device modal both disclose "one-way, nothing written back" before the
  // member connects. The token modal (roam/craft) had no such line — this
  // pins that it now matches.
  it('discloses the sync is one-way before the member connects', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }]])
    render(<ConnectedAppsCard />)
    const roamTile = await screen.findByTestId('connector-tile-roam')
    fireEvent.click(within(roamTile).getByRole('button', { name: /connect/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/one-way/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/nothing is ever written back/i)).toBeInTheDocument()
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

describe('ConnectedAppsCard — OAuth (notion) consent gate', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  const OAUTH_STATUS = {
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      craft: { configured: false, connected: false, sources: [] },
      notion: { configured: true, connected: false, sources: [] },
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

  const failedReturn = async (query) => {
    window.history.replaceState({}, '', `/settings?section=connections&${query}`)
    mockFetch([['/api/j2/notes/connectors/status', { body: { providers: {} } }]])
    render(<ConnectedAppsCard />)
  }

  it('an OAuth return that failed in this browser says how to finish, then strips the params', async () => {
    await failedReturn('connector=notion&connected=0&reason=oauth_state')
    const note = await screen.findByText("Connecting Notion didn't finish in this browser. Press Connect below to start again here.")
    expect(note.getAttribute('role')).toBe('status')
    expect(window.location.search).toBe('?section=connections')
  })

  it('names any other reason the provider gave', async () => {
    await failedReturn('connector=craft&connected=0&reason=access_denied')
    expect(await screen.findByText("Couldn't connect Craft: access_denied")).toBeTruthy()
    expect(window.location.search).toBe('?section=connections')
  })

  it('says to try again when there is no reason', async () => {
    await failedReturn('connector=notion&connected=0')
    expect(await screen.findByText("Couldn't connect Notion. Try again.")).toBeTruthy()
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
      // notion intentionally OMITTED — normalizeStatus must still
      // produce a "not configured" tile for it rather than crashing.
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
    // notion missing from the raw payload entirely -> still renders as not-configured
    expect(screen.getByTestId('connector-tile-notion')).toHaveTextContent('Coming soon')
  })
})

describe('ConnectedAppsCard — device modal (obsidian, Task 5)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  const OBSIDIAN_CONFIGURED_STATUS = {
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      craft: { configured: false, connected: false, sources: [] },
      notion: { configured: false, connected: false, sources: [] },
      obsidian: { configured: true, connected: false, connectKind: 'device', sources: [] },
    },
  }

  // ⛔ This is the rail that would FAIL if the "Connect" button on the
  // Obsidian tile were deleted — it drives the whole flow through the real
  // tile click, never rendering ObsidianConnectModal directly. That is the
  // exact shape this repo's export door was missing (every test rendered
  // the dialog directly, so deleting the door left them all green).
  it('the consent promises images and files only when /status says attachments are on', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: { ...OBSIDIAN_CONFIGURED_STATUS, obsidianAttachments: true } }],
    ])
    render(<ConnectedAppsCard />)
    const obsidianTile = await screen.findByTestId('connector-tile-obsidian')
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    fireEvent.click(within(obsidianTile).getByRole('button', { name: /connect/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/and the images and files your notes use/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/does not upload attachments/)).toBeNull()
  })

  it('minting a connect code is reachable from the Obsidian tile\'s own Connect button', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: OBSIDIAN_CONFIGURED_STATUS }],
      ['/api/j2/notes/connectors/obsidian/connect', { body: { connectCode: 'OBS-CODE-123', expiresInSeconds: 900 } }],
    ])
    render(<ConnectedAppsCard />)

    const obsidianTile = await screen.findByTestId('connector-tile-obsidian')
    fireEvent.click(within(obsidianTile).getByRole('button', { name: /connect/i }))

    // Phase 1: explanation + required consent checkbox — no POST yet.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/markdown text of your notes/i)).toBeInTheDocument()
    // Final review I3: no `obsidianAttachments` in /status -> the text-only consent.
    expect(within(dialog).getByText(/does not upload attachments/)).toBeInTheDocument()
    const generateBtn = within(dialog).getByRole('button', { name: /generate code/i })
    expect(generateBtn).toBeDisabled()
    await new Promise((r) => setTimeout(r, 20))
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/obsidian/connect'))).toBe(false)

    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /generate code/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/obsidian/connect'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ consent: true })
    })

    // Phase 2: the code is shown, once, with a copy control.
    expect(await screen.findByTestId('obsidian-connect-code')).toHaveTextContent('OBS-CODE-123')
    expect(within(dialog).getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })

  it('the minted code is not re-fetched on a re-render', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: OBSIDIAN_CONFIGURED_STATUS }],
      ['/api/j2/notes/connectors/obsidian/connect', { body: { connectCode: 'OBS-CODE-456', expiresInSeconds: 900 } }],
    ])
    const { rerender } = render(<ConnectedAppsCard />)

    const obsidianTile = await screen.findByTestId('connector-tile-obsidian')
    fireEvent.click(within(obsidianTile).getByRole('button', { name: /connect/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /generate code/i }))
    expect(await screen.findByTestId('obsidian-connect-code')).toHaveTextContent('OBS-CODE-456')

    const mintCallsAfterFirstGenerate = global.fetch.mock.calls.filter(
      (c) => String(c[0]).includes('/obsidian/connect')
    ).length
    expect(mintCallsAfterFirstGenerate).toBe(1)

    rerender(<ConnectedAppsCard />)

    // Still the same code, and mint was never called again.
    expect(screen.getByTestId('obsidian-connect-code')).toHaveTextContent('OBS-CODE-456')
    const mintCallsAfterRerender = global.fetch.mock.calls.filter(
      (c) => String(c[0]).includes('/obsidian/connect')
    ).length
    expect(mintCallsAfterRerender).toBe(1)
  })

  it('a dark (unconfigured) Obsidian tile shows Coming soon, never a Connect button', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: EMPTY_STATUS }]])
    render(<ConnectedAppsCard />)
    expect(await screen.findByTestId('connector-tile-obsidian')).toHaveTextContent('Coming soon')
  })
})

describe('ConnectedAppsCard — reconnecting a broken source (member-reachability fix)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  const STATUS_BROKEN_ROAM = {
    providers: {
      roam: {
        configured: true,
        connected: true,
        sources: [
          {
            id: 'src-roam-broken',
            provider: 'roam',
            displayName: 'My Trading Graph',
            remoteId: 'my-trading-graph',
            syncEnabled: true,
            status: 'broken',
            lastSyncAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            lastSyncStatus: 'error',
            lastSyncError: 'token expired',
            counts: { notesCreated: 12, notesUpdated: 3, conflicts: 0 },
          },
        ],
      },
      craft: { configured: true, connected: false, sources: [] },
      notion: { configured: false, connected: false, sources: [] },
    },
  }

  // ⛔ Before this fix, `freshnessLabel` promised "reconnect needed" with no
  // button anywhere in the tile that could act on it — Sync now just
  // re-submits the same broken credentials, and the top-level CTA stays the
  // green "Connected" badge forever once `connected: true`. This test would
  // fail on the pre-fix component (no "Reconnect" role in the DOM at all).
  it('a broken source shows a Reconnect control, not just an inert red dot', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: STATUS_BROKEN_ROAM }]])
    render(<ConnectedAppsCard />)

    const roamTile = await screen.findByTestId('connector-tile-roam')
    expect(within(roamTile).getByText(/reconnect needed/i)).toBeInTheDocument()
    expect(within(roamTile).getByRole('button', { name: /^reconnect$/i })).toBeInTheDocument()
  })

  // The button must actually reach the real recovery path: the SAME
  // token-modal + `/roam/connect` POST the initial "Connect" button uses,
  // which the backend upserts over the broken credentials (no Disconnect
  // required first) — see connections.py's own 'broken' -> 'active' note.
  it('clicking Reconnect opens the real connect flow and can heal the connector', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: STATUS_BROKEN_ROAM }],
      ['/api/j2/notes/connectors/roam/connect', { body: {} }],
    ])
    render(<ConnectedAppsCard />)

    const roamTile = await screen.findByTestId('connector-tile-roam')
    fireEvent.click(within(roamTile).getByRole('button', { name: /^reconnect$/i }))

    fireEvent.change(await screen.findByLabelText(/graph name/i), { target: { value: 'my-trading-graph' } })
    fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: 'fresh-token' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^connect$/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/roam/connect'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ graphName: 'my-trading-graph', token: 'fresh-token', consent: true })
    })
  })

  it('a healthy source never shows a Reconnect control', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: STATUS_MIXED }]])
    render(<ConnectedAppsCard />)
    const roamTile = await screen.findByTestId('connector-tile-roam')
    await screen.findByText(/Connected · 1 source/)
    expect(within(roamTile).queryByRole('button', { name: /^reconnect$/i })).not.toBeInTheDocument()
  })
})

// Plan E Task 10: the honest Evernote tile. ⛔ /status lists evernote to EVERY member, with
// `configured` false while the flag is off or the member is not allowed (the server makes those
// two indistinguishable from "not set up" on purpose). So the gate is the status field, applied
// here: no tile at all until the server says configured. The `.enex` offer and the plan notice
// link out of Settings, so these cases render inside a router.
describe('ConnectedAppsCard — Evernote (Plan E Task 10)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/settings')
    vi.restoreAllMocks()
  })

  const ALL = ['roam', 'craft', 'notion', 'obsidian', 'evernote']
  const statusWith = (evernote, others = { configured: true, connected: false, sources: [] }) => ({
    providers: Object.fromEntries(ALL.map((k) => [k, k === 'evernote' ? evernote : others])),
  })
  const renderCard = () => render(<MemoryRouter><ConnectedAppsCard /></MemoryRouter>)

  it('the copy module carries the exact sentences, verbatim', () => {
    expect(EVERNOTE_CONNECT_NOTES).toEqual([
      'Live sync needs a paid Evernote plan (Personal or above). Evernote does not allow it on the Free plan.',
      "Beta: Evernote's connection for apps is in beta, so things may change.",
      'Notes you imported earlier from an .enex file are matched by title and created time and kept up to date, never duplicated. Notes you have edited here are never overwritten.',
    ])
    expect(EVERNOTE_ENEX_OFFER).toBe('On Evernote Free? Import an .enex export instead.')
    expect(EVERNOTE_PLAN_RETURN).toBe('Evernote did not let us read this account. Live sync needs a paid Evernote plan. You can import an .enex export instead.')
    expect(ENEX_IMPORT_HREF).toBe('/journal/notebook?import=evernote')
  })

  // Replaces the brief's "offers the .enex import instead of Coming soon when not configured":
  // the controller ruled the tile never shows while the flag is off or the member is not allowed,
  // and /status cannot tell those apart from "not set up". So Evernote never says Coming soon
  // because it is not there at all; the `.enex` offer lives under the consent panel and on the
  // plan return, where a member who CAN see the tile meets it.
  it('evernote tile never shows to a member while /status says not configured (flag off or not allowed)', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: statusWith({ configured: false, connected: false, sources: [] }) }]])
    renderCard()
    expect(await screen.findByTestId('connector-tile-notion')).toBeInTheDocument()   // control: tiles rendered
    expect(screen.queryByTestId('connector-tile-evernote')).toBeNull()
    expect(screen.queryByText('Evernote')).toBeNull()
  })

  it('evernote tile never shows when the server predates the provider (absent from /status)', async () => {
    const body = statusWith({ configured: true, connected: false, sources: [] })
    delete body.providers.evernote
    mockFetch([['/api/j2/notes/connectors/status', { body }]])
    renderCard()
    expect(await screen.findByTestId('connector-tile-notion')).toBeInTheDocument()
    expect(screen.queryByTestId('connector-tile-evernote')).toBeNull()
  })

  it('evernote consent panel lists the paid-plan, beta and adoption notes', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: statusWith({ configured: true, connected: false, sources: [] }) }]])
    renderCard()
    const tile = await screen.findByTestId('connector-tile-evernote')
    expect(within(tile).queryByText(EVERNOTE_ENEX_OFFER)).toBeNull()   // not before Connect
    fireEvent.click(within(tile).getByRole('button', { name: /connect/i }))

    const panel = await within(tile).findByRole('group', { name: 'Consent to connect Evernote' })
    const items = within(within(panel).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(EVERNOTE_CONNECT_NOTES)
    // The list sits above the checkbox.
    const list = within(panel).getByRole('list')
    const box = within(panel).getByRole('checkbox')
    expect(list.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The `.enex` offer sits under the panel, and links to the import.
    const offer = within(tile).getByRole('link', { name: EVERNOTE_ENEX_OFFER })
    expect(offer.getAttribute('href')).toBe(ENEX_IMPORT_HREF)
    expect(panel.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('another provider\'s consent panel carries no notes list', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: statusWith({ configured: true, connected: false, sources: [] }) }]])
    renderCard()
    const tile = await screen.findByTestId('connector-tile-notion')
    fireEvent.click(within(tile).getByRole('button', { name: /connect/i }))
    const panel = await within(tile).findByRole('group', { name: 'Consent to connect Notion' })
    expect(within(panel).queryByRole('list')).toBeNull()
    expect(within(tile).queryByText(EVERNOTE_ENEX_OFFER)).toBeNull()
  })

  it('evernote_plan return reason shows the plan sentence and the .enex link', async () => {
    window.history.replaceState({}, '', '/settings?section=connections&connector=evernote&connected=0&reason=evernote_plan')
    mockFetch([['/api/j2/notes/connectors/status', { body: statusWith({ configured: true, connected: false, sources: [] }) }]])
    renderCard()
    const note = await screen.findByTestId('oauth-return-notice')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.textContent).toContain(EVERNOTE_PLAN_RETURN)
    expect(note.textContent).not.toContain('evernote_plan')
    const link = within(note).getByRole('link')
    expect(link.getAttribute('href')).toBe(ENEX_IMPORT_HREF)
    expect(window.location.search).toBe('?section=connections')
  })

  // Review M3: the Evernote sentence keys on BOTH connector=evernote and reason=evernote_plan.
  it('reason=evernote_plan on another connector never shows the Evernote plan sentence', async () => {
    window.history.replaceState({}, '', '/settings?section=connections&connector=notion&connected=0&reason=evernote_plan')
    mockFetch([['/api/j2/notes/connectors/status', { body: statusWith({ configured: true, connected: false, sources: [] }) }]])
    renderCard()
    const note = await screen.findByTestId('oauth-return-notice')
    expect(note.textContent).toBe("Couldn't connect Notion: evernote_plan")   // the generic line, as any other reason
    expect(screen.queryByText(EVERNOTE_PLAN_RETURN, { exact: false })).toBeNull()
    expect(within(note).queryByRole('link')).toBeNull()
  })

  it('evernote tile carries a Beta pill and no other tile does', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: statusWith({ configured: true, connected: false, sources: [] }) }]])
    renderCard()
    const tile = await screen.findByTestId('connector-tile-evernote')
    expect(within(tile).getByText('Beta')).toBeInTheDocument()
    expect(screen.getAllByText('Beta')).toHaveLength(1)
    // Review M2: a real separator, so a screen reader says "Evernote, Beta", never "EvernoteBeta".
    const name = within(tile).getByText('Beta').parentElement
    expect(name.textContent).toBe('Evernote, Beta')
    expect(name.querySelector('.sr-only')?.textContent).toBe(', ')
    for (const k of ALL.filter((x) => x !== 'evernote')) {
      expect(within(screen.getByTestId(`connector-tile-${k}`)).queryByText('Beta')).toBeNull()
    }
  })

  // Coordinator ruling (concern 2): a member who ALREADY has Evernote connected keeps the tile while
  // it is connected, even with the flag off or admin mode excluding them, so a connection is never
  // invisible or unremovable. The server leaves Disconnect and the log ungated, but refuses Sync now
  // and pause (503), so the tile says sync is off and offers only what works.
  it('a connected member keeps the evernote tile while gated off: sync-off notice and a working Disconnect, no dead buttons', async () => {
    const source = {
      id: 'src-en-1', provider: 'evernote', displayName: 'Evernote', remoteId: 'acct-1', syncEnabled: true,
      status: 'broken', lastSyncStatus: 'error', lastSyncError: 'Evernote sync is paused.', counts: {},
    }
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: statusWith({ configured: false, connected: true, sources: [source] }) }],
      ['/api/j2/notes/connectors/evernote', { body: { disconnected: true } }],
    ])
    renderCard()
    const tile = await screen.findByTestId('connector-tile-evernote')
    expect(within(tile).getByText('Evernote sync is off for this account. Your imported notes stay here, and you can disconnect.')).toBeInTheDocument()
    expect(within(tile).queryByText('Coming soon')).toBeNull()
    expect(within(tile).queryByRole('button', { name: /^connect$/i })).toBeNull()
    expect(within(tile).queryByRole('button', { name: /sync now/i })).toBeNull()
    expect(within(tile).queryByRole('button', { name: /reconnect/i })).toBeNull()
    expect(within(tile).queryByRole('checkbox')).toBeNull()
    fireEvent.click(within(tile).getByRole('button', { name: /disconnect/i }))
    fireEvent.click(within(tile).getByRole('button', { name: /click again to disconnect/i }))
    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).endsWith('/connectors/evernote') && c[1]?.method === 'DELETE')
      expect(call).toBeTruthy()
    })
  })
})

// Review M6: the notes list keys by position, so two identical notes both render with no duplicate-key warning.
describe('ConnectConsentPanel — notes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders a repeated note twice, with no duplicate-key warning', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ConnectConsentPanel providerLabel="X" checked={false} onCheck={() => {}} onConfirm={() => {}} onCancel={() => {}} notes={['Same.', 'Same.']} />)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Same.', 'Same.'])
    expect(err.mock.calls.some((c) => /same key/i.test(String(c[0])) || c.some((a) => /same key/i.test(String(a))))).toBe(false)
  })

  it('renders no list when notes is empty or absent', () => {
    const { rerender } = render(<ConnectConsentPanel providerLabel="X" checked={false} onCheck={() => {}} onConfirm={() => {}} onCancel={() => {}} notes={[]} />)
    expect(screen.queryByRole('list')).toBeNull()
    rerender(<ConnectConsentPanel providerLabel="X" checked={false} onCheck={() => {}} onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('list')).toBeNull()
  })
})

