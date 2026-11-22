// Plan E Task 10: `?import=evernote` (the Evernote tile's `.enex` offer, and the plan-refusal notice)
// opens the Notebook's import wizard ONCE and leaves the URL clean, on the REAL Notebook tab with only
// the network faked. The href is read from the copy module the Settings card links with, never retyped.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router-dom'
import { installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { ENEX_IMPORT_HREF } from '../components/connectors/evernoteCopy'
import NotebookTab from './NotebookTab'
import { toolbarOffers } from './__tests__/toolbarDoors'

// The wizard has its own rails. A stub that shows whenever it is open proves the TAB opened it.
vi.mock('../components/notebook/import/ImportWizard', () => ({
  default: ({ open, onClose }) => (open ? (
    <div>
      <h2>Import wizard</h2>
      <button type="button" onClick={onClose}>Close wizard</button>
    </div>
  ) : null),
}))

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.search}</output>
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

beforeEach(() => { installFetch([[/mapping-offer$/, { offer: null }]]) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function show(route) {
  render(<Providers route={route}><NotebookTab /><Where /></Providers>)
  await settle()
}

describe('?import=evernote on the Notebook tab', () => {
  it('notebook opens the import wizard once for ?import=evernote and strips the param', async () => {
    expect(ENEX_IMPORT_HREF).toBe('/journal/notebook?import=evernote')
    await show(ENEX_IMPORT_HREF)
    expect(await screen.findByRole('heading', { name: 'Import wizard' })).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).not.toMatch(/import=/)
    // Once: closing it does not bring it back (the param is gone, nothing re-reads it).
    fireEvent.click(screen.getByRole('button', { name: 'Close wizard' }))
    await settle()
    expect(screen.queryByRole('heading', { name: 'Import wizard' })).toBeNull()
  })

  it('keeps the other params when it strips import', async () => {
    await show('/journal/notebook?view=all&import=evernote')
    expect(await screen.findByRole('heading', { name: 'Import wizard' })).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('?view=all')
  })

  it('opens nothing for any other import value, and leaves the URL alone', async () => {
    await show('/journal/notebook?view=all&import=notion')
    expect(toolbarOffers('Import')).toBe(true)   // control: the list rendered
    expect(screen.queryByRole('heading', { name: 'Import wizard' })).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe('?view=all&import=notion')
  })
})
