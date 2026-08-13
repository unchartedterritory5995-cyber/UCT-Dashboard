import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import ConnectTilesCompact from './ConnectTilesCompact'

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
    dropbox: { configured: false, connected: false, sources: [] },
    onenote: { configured: false, connected: false, sources: [] },
    onedrive: { configured: false, connected: false, sources: [] },
  },
}

describe('ConnectTilesCompact', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing while loading and nothing when no provider is configured', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: NOTHING_CONFIGURED_STATUS }]])
    const { container } = render(<ConnectTilesCompact />)
    // While the SWR fetch is in flight, nothing renders.
    expect(container).toBeEmptyDOMElement()
    await waitFor(() => {
      expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/status'))).toBe(true)
    })
    expect(container).toBeEmptyDOMElement()
  })

  const MSGRAPH_SOURCELESS_STATUS = {
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      craft: { configured: false, connected: false, sources: [] },
      notion: { configured: false, connected: false, sources: [] },
      dropbox: { configured: true, connected: true, sources: [] },
      onenote: { configured: false, connected: false, sources: [] },
      onedrive: { configured: true, connected: true, sources: [] },
    },
  }

  it('a connected-but-sourceless onedrive tile reads "Choose a folder for OneDrive" (the shared FOLDER_PICKER_PROVIDERS gate, widened from dropbox-only)', async () => {
    mockFetch([['/api/j2/notes/connectors/status', { body: MSGRAPH_SOURCELESS_STATUS }]])
    render(<ConnectTilesCompact />)
    const tile = await screen.findByTestId('connect-tile-onedrive')
    expect(tile).toHaveTextContent('Choose a folder for OneDrive')
    expect(tile).toHaveAttribute('data-needs-folder', 'true')
    // Regression control: Dropbox's own identical state is unaffected.
    const dropboxTile = screen.getByTestId('connect-tile-dropbox')
    expect(dropboxTile).toHaveTextContent('Choose a folder for Dropbox')
  })

  it('clicking the onedrive "needs folder" tile opens the picker against /onedrive/folders, not /dropbox/folders', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: MSGRAPH_SOURCELESS_STATUS }],
      ['/onedrive/folders', { body: { folders: [{ id: 'item-1', name: 'Trading Notes' }] } }],
    ])
    render(<ConnectTilesCompact />)
    const tile = await screen.findByTestId('connect-tile-onedrive')
    fireEvent.click(tile)

    expect(await screen.findByText('Choose a OneDrive folder')).toBeInTheDocument()
    expect(await screen.findByText('Trading Notes')).toBeInTheDocument()
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/onedrive/folders'))).toBe(true)
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/dropbox/folders'))).toBe(false)
  })

  it('picking an onedrive folder POSTs {remoteId, displayName} to /onedrive/sources', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: MSGRAPH_SOURCELESS_STATUS }],
      ['/onedrive/folders', { body: { folders: [{ id: 'item-1', name: 'Trading Notes' }] } }],
      ['/onedrive/sources', {
        body: (opts) => {
          expect(JSON.parse(opts.body)).toEqual({ remoteId: 'item-1', displayName: 'Trading Notes' })
          return { source: { id: 'od-1' } }
        },
      }],
    ])
    render(<ConnectTilesCompact />)
    const tile = await screen.findByTestId('connect-tile-onedrive')
    fireEvent.click(tile)
    fireEvent.click(await screen.findByRole('button', { name: /sync this folder/i }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/onedrive/sources') && c[1]?.method === 'POST')
      expect(call).toBeTruthy()
    })
  })

  const ONENOTE_CONFIGURED_STATUS = {
    providers: {
      roam: { configured: false, connected: false, sources: [] },
      craft: { configured: false, connected: false, sources: [] },
      notion: { configured: false, connected: false, sources: [] },
      dropbox: { configured: false, connected: false, sources: [] },
      onenote: { configured: true, connected: false, sources: [] },
      onedrive: { configured: false, connected: false, sources: [] },
    },
  }

  it('a not-yet-connected onenote tile reads "Connect OneNote" and opens the consent panel (oauth, never the folder picker)', async () => {
    mockFetch([
      ['/api/j2/notes/connectors/status', { body: ONENOTE_CONFIGURED_STATUS }],
      ['/api/j2/notes/connectors/onenote/connect', { body: { redirectUrl: 'https://login.microsoftonline.com/x' } }],
    ])
    render(<ConnectTilesCompact />)
    const tile = await screen.findByTestId('connect-tile-onenote')
    expect(tile).toHaveTextContent('Connect OneNote')
    expect(tile).toHaveAttribute('data-needs-folder', 'false')
    fireEvent.click(tile)

    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/onenote/connect'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ consent: true })
    })
  })
})
