// Wave 11 lane 11A — "Start from audio" in the Notebook's New note sheet: the real
// NotebookTab with only the network faked (a11y/fixtures.jsx).
//
// ⛔ THE GATE IS RAILED ON THE RENDERED DOM: "flag off ⇒ absent" means no button a
// member could press is in the document. Each absent case carries a control that
// the sheet itself rendered (its template gallery), so absence is never vacuous.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AUTH, installFetch, latchWave8Flags, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

beforeEach(() => {
  installFetch([[/^\/api\/j2\/voice-notes\/status$/, { cap: { usedSeconds: 0, capSeconds: 3600, remainingSeconds: 3600, unlimited: false } }]])
})
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function openNewNoteSheet(auth = AUTH) {
  render(<Providers auth={auth} route="/journal/notebook?view=all"><NotebookTab /></Providers>)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
  const sheet = await screen.findByRole('dialog', { name: 'New note' })
  // control: the sheet's own gallery is there, so an absent row is really absent
  expect(within(sheet).getAllByText('Blank note').length).toBeGreaterThan(0)
  return sheet
}

describe('Start from audio — who sees it', () => {
  it('nobody while no flag has latched', async () => {
    __resetNotebookFlags()
    const sheet = await openNewNoteSheet()
    expect(within(sheet).queryByRole('group', { name: 'Start from audio' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /Voice note/ })).toBeNull()
  })

  it('nobody while the gate is latched OFF (every other flag on)', async () => {
    latchWave8Flags(true, { notebook_voice_notes_enabled: false })
    const sheet = await openNewNoteSheet()
    expect(within(sheet).queryByRole('button', { name: /Upload recording/ })).toBeNull()
  })

  it('not a free member, gate on', async () => {
    latchWave8Flags(true, { notebook_voice_notes_enabled: true })
    const sheet = await openNewNoteSheet({ ...AUTH, isPaid: false, plan: 'free' })
    expect(within(sheet).queryByRole('group', { name: 'Start from audio' })).toBeNull()
  })

  it('a paid member with the gate on: Voice note, Upload recording, From a Desk session', async () => {
    latchWave8Flags(true, { notebook_voice_notes_enabled: true })
    const sheet = await openNewNoteSheet()
    const group = within(sheet).getByRole('group', { name: 'Start from audio' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent.trim())).toEqual([
      'Voice note', 'Upload recording', 'From a Desk session'])
  })

  it('Upload recording opens the voice-note dialog on its upload step', async () => {
    latchWave8Flags(true, { notebook_voice_notes_enabled: true })
    const sheet = await openNewNoteSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: /Upload recording/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Voice note' })
    expect(within(dialog).getByRole('button', { name: /Upload a file/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByLabelText('Choose an audio file')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull()
  })
})
