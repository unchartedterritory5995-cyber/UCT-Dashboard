import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DropboxFolderPicker from './DropboxFolderPicker'

describe('DropboxFolderPicker (Task 12b)', () => {
  it('renders the folder list from the mocked GET, requesting the root path first', async () => {
    const listFolders = vi.fn(async () => [
      { name: 'Team Notes', remoteId: '/team notes', drillPath: '/team notes' },
      { name: 'Journal', remoteId: '/journal', drillPath: '/journal' },
    ])
    render(
      <DropboxFolderPicker
        open
        listFolders={listFolders}
        addSource={vi.fn()}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    expect(await screen.findByText('Team Notes')).toBeInTheDocument()
    expect(screen.getByText('Journal')).toBeInTheDocument()
    expect(listFolders).toHaveBeenCalledWith('dropbox', '')
  })

  it('picking a folder row POSTs {remoteId, displayName} via addSource, then closes', async () => {
    const listFolders = vi.fn(async () => [
      { name: 'Team Notes', remoteId: '/team notes', drillPath: '/team notes' },
    ])
    const addSource = vi.fn(async () => ({ source: { id: 's1' } }))
    const onPicked = vi.fn()
    const onClose = vi.fn()
    render(
      <DropboxFolderPicker
        open
        listFolders={listFolders}
        addSource={addSource}
        onClose={onClose}
        onPicked={onPicked}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: /sync this folder/i }))

    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith('dropbox', {
        remoteId: '/team notes',
        displayName: 'Team Notes',
      })
    })
    expect(onPicked).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  // Fix-round item #2: Dropbox's OWN API treats "" and "/" as equivalent
  // references to the account root, but "" is indistinguishable from
  // "missing" everywhere downstream (the backend's `if not remote_id: 400`)
  // -- so the root pick must send the "/" sentinel, not "".
  it('picking the current (root) level via the footer button sends remoteId "/" (Dropbox\'s own root sentinel)', async () => {
    const listFolders = vi.fn(async () => [])
    const addSource = vi.fn(async () => ({ source: { id: 's1' } }))
    render(
      <DropboxFolderPicker
        open
        listFolders={listFolders}
        addSource={addSource}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    await screen.findByText(/no subfolders/i)
    const rootBtn = screen.getByRole('button', { name: /sync my whole dropbox/i })
    expect(rootBtn).not.toBeDisabled()
    fireEvent.click(rootBtn)

    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith('dropbox', {
        remoteId: '/',
        displayName: 'Dropbox (root)',
      })
    })
  })

  it('renders an inline error with a "Try again" retry when the folder list fails to load', async () => {
    const listFolders = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Reconnect Dropbox — stored credentials are unreadable.'), {}))
      .mockResolvedValueOnce([{ name: 'Team Notes', remoteId: '/team notes', drillPath: '/team notes' }])
    render(
      <DropboxFolderPicker
        open
        listFolders={listFolders}
        addSource={vi.fn()}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    expect(await screen.findByText(/reconnect dropbox/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText('Team Notes')).toBeInTheDocument()
    expect(listFolders).toHaveBeenCalledTimes(2)
  })

  it('navigating into a folder updates the breadcrumb and re-fetches with the new drillPath', async () => {
    const listFolders = vi
      .fn()
      .mockResolvedValueOnce([{ name: 'Team Notes', remoteId: '/team notes', drillPath: '/team notes' }])
      .mockResolvedValueOnce([{ name: '2026', remoteId: '/team notes/2026', drillPath: '/team notes/2026' }])
    render(
      <DropboxFolderPicker
        open
        listFolders={listFolders}
        addSource={vi.fn()}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Team Notes' }))

    await waitFor(() => expect(listFolders).toHaveBeenLastCalledWith('dropbox', '/team notes'))
    expect(await screen.findByText('2026')).toBeInTheDocument()
  })

  it('a picking failure (e.g. a 5xx) renders inline without closing the sheet', async () => {
    const listFolders = vi.fn(async () => [
      { name: 'Team Notes', remoteId: '/team notes', drillPath: '/team notes' },
    ])
    const addSource = vi.fn(async () => {
      const err = new Error('Dropbox is having trouble — try again shortly.')
      throw err
    })
    const onClose = vi.fn()
    render(
      <DropboxFolderPicker
        open
        listFolders={listFolders}
        addSource={addSource}
        onClose={onClose}
        onPicked={() => {}}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: /sync this folder/i }))

    expect(await screen.findByText(/trouble — try again shortly/i)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('re-opening resets to the root path (fresh fields every open, mirrors ConnectTokenModal)', async () => {
    const listFolders = vi
      .fn()
      .mockResolvedValueOnce([{ name: 'Team Notes', remoteId: '/team notes', drillPath: '/team notes' }])
      .mockResolvedValueOnce([{ name: '2026', remoteId: '/team notes/2026', drillPath: '/team notes/2026' }])
      .mockResolvedValueOnce([{ name: 'Team Notes', remoteId: '/team notes', drillPath: '/team notes' }])
    const { rerender } = render(
      <DropboxFolderPicker
        open
        listFolders={listFolders}
        addSource={vi.fn()}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Team Notes' }))
    await waitFor(() => expect(listFolders).toHaveBeenLastCalledWith('dropbox', '/team notes'))

    rerender(
      <DropboxFolderPicker
        open={false}
        listFolders={listFolders}
        addSource={vi.fn()}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    rerender(
      <DropboxFolderPicker
        open
        listFolders={listFolders}
        addSource={vi.fn()}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    await waitFor(() => expect(listFolders).toHaveBeenLastCalledWith('dropbox', ''))
  })
})

describe('DropboxFolderPicker — OneDrive (fix-round CRITICAL: the folder picker could not create a source)', () => {
  it('OneDrive rows carry a real, non-empty remoteId (id-based, not path_lower) and drill/pick correctly', async () => {
    const listFolders = vi.fn(async (provider, path) => {
      if (!path) return [{ name: 'Trading Notes', remoteId: 'item-1', drillPath: 'item-1' }]
      if (path === 'item-1') return [{ name: '2026', remoteId: 'item-2', drillPath: 'item-2' }]
      return []
    })
    const addSource = vi.fn(async () => ({ source: { id: 's1' } }))
    render(
      <DropboxFolderPicker
        open
        provider="onedrive"
        providerLabel="OneDrive"
        listFolders={listFolders}
        addSource={addSource}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    expect(await screen.findByText('Trading Notes')).toBeInTheDocument()
    expect(listFolders).toHaveBeenCalledWith('onedrive', '')

    // Drilling passes the folder's OWN id as the next drill path — the exact
    // step that regressed to '' (re-listing the root forever) before the fix.
    fireEvent.click(screen.getByRole('button', { name: 'Trading Notes' }))
    await waitFor(() => expect(listFolders).toHaveBeenLastCalledWith('onedrive', 'item-1'))
    expect(await screen.findByText('2026')).toBeInTheDocument()

    // Picking the drilled-into folder POSTs its real item id, never ''.
    fireEvent.click(screen.getByRole('button', { name: /sync this folder/i }))
    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith('onedrive', {
        remoteId: 'item-2',
        displayName: '2026',
      })
    })
  })

  it('two OneDrive rows never collide on the same React key (the old pathLower-based key put every OneDrive row at the same empty key)', async () => {
    const listFolders = vi.fn(async () => [
      { name: 'Alpha', remoteId: 'item-a', drillPath: 'item-a' },
      { name: 'Beta', remoteId: 'item-b', drillPath: 'item-b' },
    ])
    render(
      <DropboxFolderPicker
        open
        provider="onedrive"
        providerLabel="OneDrive"
        listFolders={listFolders}
        addSource={vi.fn()}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(await screen.findByText('Beta')).toBeInTheDocument()
  })

  it('OneDrive has NO "sync whole account" root affordance — the footer button is disabled at root with an explanatory label', async () => {
    const listFolders = vi.fn(async () => [])
    const addSource = vi.fn()
    render(
      <DropboxFolderPicker
        open
        provider="onedrive"
        providerLabel="OneDrive"
        listFolders={listFolders}
        addSource={addSource}
        onClose={() => {}}
        onPicked={() => {}}
      />
    )
    await screen.findByText(/no subfolders/i)
    const rootBtn = await screen.findByText(/doesn't support syncing the whole account yet/i)
    expect(rootBtn.closest('button')).toBeDisabled()
    fireEvent.click(rootBtn)
    expect(addSource).not.toHaveBeenCalled()
  })
})
