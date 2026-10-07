// W14-Q2, measured in a real browser: the app mounts this gate inside RouteErrorBoundary,
// which is KEYED BY PATHNAME, so every change of page remounts the gate. A request made with
// `openRegistryTour` stays pending after the gate has taken it, and before this fix it
// outlived the tour: close the tour, change page, and the new gate opened it again.
// This rail mounts the gate the way the app does and changes page after the tour ends.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { SWRConfig } from 'swr'
import RouteErrorBoundary from '../../../../../components/RouteErrorBoundary'
import { makeRegistryToursGate } from './RegistryToursGate'
import {
  openRegistryTour, hasPendingRegistryTourOpen, __resetRegistryTourControl,
} from './tourRegistryControl'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'

// a key FLAG_FALLBACKS already knows (see RegistryToursGate.test.jsx for why it is borrowed)
const BORROWED_FLAG = 'notebook_template_gallery_enabled'
const TOUR = { id: 'w14-q2-tour', flag: BORROWED_FLAG, title: 'Tour Q', replayable: true }

const engineLoader = () => vi.fn(async () => ({
  default: ({ entry, onClose }) => (
    <div role="dialog">
      {entry.title} is open
      <button type="button" onClick={() => onClose({ opened: true })}>Close</button>
    </div>
  ),
}))

let go = null
function Nav() { go = useNavigate(); return null }

function App({ Gate }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <Nav />
        <RouteErrorBoundary>
          <main><h1>Page</h1></main>
          <Gate tours={[TOUR]} />
        </RouteErrorBoundary>
      </MemoryRouter>
    </SWRConfig>
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [BORROWED_FLAG]: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  vi.restoreAllMocks()
})

describe('a tour that ended is not opened again by the next change of page', () => {
  it('close, then navigate to another page: no dialog, and nothing left pending', async () => {
    const Gate = makeRegistryToursGate(engineLoader(), 0)
    render(<App Gate={Gate} />)
    act(() => { openRegistryTour(TOUR.id) })
    expect(await screen.findByText('Tour Q is open')).toBeInTheDocument()
    act(() => { screen.getByRole('button', { name: 'Close' }).click() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(hasPendingRegistryTourOpen()).toBeNull()
    act(() => { go('/support') })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('control: a tour still running when the page changes is picked up by the remounted gate', async () => {
    const Gate = makeRegistryToursGate(engineLoader(), 0)
    render(<App Gate={Gate} />)
    act(() => { openRegistryTour(TOUR.id) })
    expect(await screen.findByText('Tour Q is open')).toBeInTheDocument()
    act(() => { go('/support') })
    expect(await screen.findByText('Tour Q is open')).toBeInTheDocument()
  })
})
