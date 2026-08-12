import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DropboxFolderPicker from './DropboxFolderPicker'

describe('DropboxFolderPicker (Task 12b)', () => {
  it('renders the folder list from the mocked GET, requesting the root path first', async () => {
    const listFolders = vi.fn(async () => [
      { pathLower: '/team notes', name: 'Team Notes' },
      { pathLower: '/journal', name: 'Journal' },
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
    const listFolders = vi.fn(async () => [{ pathLower: '/team notes', name: 'Team Notes' }])
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

  it('picking the current (root) level via the footer button sends remoteId ""', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /sync my whole dropbox/i }))

    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith('dropbox', {
        remoteId: '',
        displayName: 'Dropbox (root)',
      })
    })
  })

  it('renders an inline error with a "Try again" retry when the folder list fails to load', async () => {
    const listFolders = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Reconnect Dropbox — stored credentials are unreadable.'), {}))
      .mockResolvedValueOnce([{ pathLower: '/team notes', name: 'Team Notes' }])
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

  it('navigating into a folder updates the breadcrumb and re-fetches with the new path', async () => {
    const listFolders = vi
      .fn()
      .mockResolvedValueOnce([{ pathLower: '/team notes', name: 'Team Notes' }])
      .mockResolvedValueOnce([{ pathLower: '/team notes/2026', name: '2026' }])
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
    const listFolders = vi.fn(async () => [{ pathLower: '/team notes', name: 'Team Notes' }])
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
      .mockResolvedValueOnce([{ pathLower: '/team notes', name: 'Team Notes' }])
      .mockResolvedValueOnce([{ pathLower: '/team notes/2026', name: '2026' }])
      .mockResolvedValueOnce([{ pathLower: '/team notes', name: 'Team Notes' }])
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
