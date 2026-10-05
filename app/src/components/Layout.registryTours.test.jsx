// W14-C1 item (a): the registered-tour gate is mounted ONCE, in the app shell, so a tour can
// start on a Journal page (a trade, My Playbook, the setups board) and survive the
// navigation to its own start. This renders the REAL Layout and the REAL gate and engine
// on a page OUTSIDE the Notebook, and opens a real registered tour there, the way Help's
// Replay link does (navigation state).
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, test, expect, beforeEach, afterEach, describe } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { useEffect, useState } from 'react'
import Layout from './Layout'
import { getTourEntry, startPath, startState } from '../pages/journal-2-0/components/notebook/onboarding/tourRegistry'
import { __resetRegistryTourControl } from '../pages/journal-2-0/components/notebook/onboarding/tourRegistryControl'
import { __resetNotebookFlags, latchNotebookFlags } from '../pages/journal-2-0/lib/offline/notebookFlags'
import { installTourLayout } from '../pages/journal-2-0/components/notebook/onboarding/__fixtures__/tourLayout'

vi.mock('./NavBar', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => <div data-testid="nav-marker">nav</div>,
}))
vi.mock('./MobileNav', () => ({ default: () => null }))
vi.mock('./FeedbackWidget', () => ({ default: () => null }))
vi.mock('./mobile/MoreSheet', () => ({ default: () => null }))
vi.mock('./mobile/TickerHubSheet', () => ({ default: () => null }))
const setPrefMerged = vi.fn(async () => {})
vi.mock('../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: {}, loading: false, setPrefMerged }),
}))
vi.mock('../lib/barsPackClient', () => ({ initBarsPack: () => {} }))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => fs.readFileSync(path.resolve(HERE, rel), 'utf8')

beforeEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  installTourLayout()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => ({}) }))
})
afterEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  vi.restoreAllMocks()
})

/** A stand-in for My Playbook: renders every anchor the real tour names, once loaded. */
function PlaybookPage() {
  const [anchors, setAnchors] = useState([])
  useEffect(() => {
    getTourEntry('my-playbook').load().then(({ steps }) => setAnchors(steps.map((s) => s.anchor)))
  }, [])
  return <div>{anchors.map((a) => <div key={a} data-tour={a}>{a}</div>)}</div>
}

describe('(a) one mount, in the app shell', () => {
  test('Layout mounts RegistryToursGate exactly once; NotebookTab no longer mounts it', () => {
    const layout = read('./Layout.jsx')
    expect(layout.match(/<RegistryToursGate\b/g)).toHaveLength(1)
    const tab = read('../pages/journal-2-0/tabs/NotebookTab.jsx')
    expect(tab).not.toMatch(/<RegistryToursGate\b/)
    expect(tab).not.toMatch(/import RegistryToursGate/)
    // the offer stays with the Notebook (it never shows while a note is open, R4)
    expect(tab.match(/<TourOfferGate\b/g)).toHaveLength(1)
  })

  test('a real tour opens on a Journal page outside the Notebook (My Playbook), from a Replay link', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_playbook_enabled: true })
    const entry = getTourEntry('my-playbook')
    expect(startPath(entry)).toBe('/journal-2-0/playbook')
    const { steps, copy } = await entry.load()
    render(
      <MemoryRouter initialEntries={[{ pathname: startPath(entry), state: startState(entry) }]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/journal-2-0/playbook" element={<PlaybookPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    const d = await screen.findByRole('dialog', { name: copy[steps[0].id].title }, { timeout: 5000 })
    expect(d).toBeInTheDocument()
  })

  test('CONTROL: with the capability off, the same Replay opens nothing', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_playbook_enabled: false })
    const entry = getTourEntry('my-playbook')
    render(
      <MemoryRouter initialEntries={[{ pathname: startPath(entry), state: startState(entry) }]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/journal-2-0/playbook" element={<PlaybookPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
