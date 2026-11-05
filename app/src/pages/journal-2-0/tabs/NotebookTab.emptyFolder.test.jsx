// VIS-5 (audit 2026-11-05, issue 15): an EMPTY FOLDER says so, by name, with the two things a member does
// next -- "No notes in {Folder} yet", New note here, Move notes…. ⚰️ It said "Your notebook is empty." and
// rendered the whole template gallery (536 text nodes) inside a folder of a notebook that was not empty.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH, installFetch, NOTES, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

// f3 ("Archive 2025") holds no notes; every other read is the shared fixture.
async function renderAt(route) {
  const fetchSpy = installFetch([
    [/^\/api\/j2\/notes$/, (url) => (url.includes('folder_id=f3') ? { notes: [], total: 0 } : { notes: NOTES, total: NOTES.length })],
  ])
  render(<Providers auth={AUTH} route={route}><NotebookTab /></Providers>)
  await screen.findAllByText('Theses')
  await settle()
  return fetchSpy
}

describe('an empty folder (VIS-5)', () => {
  it('names the folder and offers New note here and Move notes…, never the template gallery', async () => {
    await renderAt('/journal/notebook?folder=f3')
    expect(await screen.findByText('No notes in Archive 2025 yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New note here' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move notes…' })).toBeInTheDocument()
    expect(screen.queryByText('Your notebook is empty.')).toBeNull()
    expect(document.querySelector('[data-tour="template-gallery-door"]')).toBeNull()
  })

  it('"New note here" makes the note IN that folder', async () => {
    const spy = await renderAt('/journal/notebook?folder=f3')
    fireEvent.click(await screen.findByRole('button', { name: 'New note here' }))
    await waitFor(() => {
      const post = spy.mock.calls.find(([u, init]) => String(u) === '/api/j2/notes' && init?.method === 'POST')
      expect(post, 'no create was sent').toBeTruthy()
      expect(JSON.parse(post[1].body).folderId).toBe('f3')
    })
  })

  it('"Move notes…" goes back to All notes and says how to move notes into the folder', async () => {
    await renderAt('/journal/notebook?folder=f3')
    fireEvent.click(await screen.findByRole('button', { name: 'Move notes…' }))
    expect(await screen.findByText('Select the notes you want, then choose Move to put them in Archive 2025.')).toBeInTheDocument()
    expect(screen.queryByText('No notes in Archive 2025 yet')).toBeNull()
  })

  it('CONTROL: a folder with notes lists them, and no empty sentence', async () => {
    await renderAt('/journal/notebook?folder=f1')
    expect(screen.queryByText(/^No notes in /)).toBeNull()
  })
})
