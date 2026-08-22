import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import NoteConnectorsTrustStrip from './NoteConnectorsTrustStrip'

function mockFetch(body) {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))
}

describe('NoteConnectorsTrustStrip', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders nothing when no source exists on any provider', async () => {
    mockFetch({ providers: { roam: { configured: true, sources: [] } } })
    const { container } = render(<NoteConnectorsTrustStrip />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('shows "Provider · synced Xm ago · N conflicts" and links to Settings', async () => {
    mockFetch({
      providers: {
        roam: {
          configured: true,
          sources: [{
            id: 's1', provider: 'roam', displayName: 'Roam',
            lastSyncAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            counts: { conflicts: 2 },
          }],
        },
      },
    })
    render(<NoteConnectorsTrustStrip />)
    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', '/settings?section=connections')
    expect(link).toHaveTextContent('Roam Research')
    expect(link).toHaveTextContent('synced 5m ago')
    expect(link).toHaveTextContent('2 conflicts')
  })
})
