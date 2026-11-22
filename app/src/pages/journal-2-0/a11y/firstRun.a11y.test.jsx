// S16 (audit 2026-11-05, M2): the 60-second first run's step 1, open, read by axe -- its two questions (a group of
// pressed buttons, a combobox with its listbox), the promise and the two actions. The gate's closed state renders
// nothing, so it is read through the open sheet.
import { describe, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axeSurface } from './surface'
import FirstRunGate from '../components/notebook/FirstRunGate'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

vi.mock('../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: {}, loading: false, readFailed: false, setPrefMerged: vi.fn(() => Promise.resolve({ ok: true })) }),
}))

beforeEach(() => {
  latchNotebookFlags({ notebook_starter_packs_enabled: true })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals(); __resetNotebookFlags() })

describe('the first run -- axe', () => {
  axeSurface('first-run-sheet', async () => {
    render(<MemoryRouter><main><FirstRunGate hasAnyNotes={false} notesKnown /></main></MemoryRouter>)
    expect(await screen.findByRole('dialog', { name: 'Make the Notebook yours' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Add a ticker' })).toBeInTheDocument()
  })
})
