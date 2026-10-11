// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/captureDoors.a11y.test.jsx
//
// P0.8's two new surfaces through 8A's axe harness (the new-surface rule: a member-facing file with
// no entry in a11y/notebookSurfaces.js fails surfaceCoverage.test.js by name):
//   * capture-doors    -- the "Capture from anywhere" box with ALL THREE doors live, in both its
//                         shapes (under the import dropzone, and the compact one on the first-run
//                         welcome) on one screen, which also proves two copies share no heading id;
//   * shortcut-how-to  -- the iPhone Shortcut how-to sheet, OPEN (it is a portal, so axe reads the
//                         whole document).
// Each recipe proves the state it is about rendered before axe runs, so an empty screen can never
// pass as a clean one.
import { describe, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import CaptureDoors from '../components/notebook/CaptureDoors'
import ShortcutHowTo, { SHORTCUT_STEPS } from '../components/notebook/ShortcutHowTo'

beforeEach(() => {
  try { localStorage.clear() } catch { /* ignore */ }
  // Both capture gates answer 200: the email address card and the personal API card would render.
  global.fetch = vi.fn(async (url) => {
    const body = String(url).includes('personal') ? { tokens: [] } : { address: 'notes+abc@in.example' }
    return { ok: true, status: 200, json: async () => body }
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('capture doors -- axe', () => {
  axeSurface('capture-doors', async () => {
    const { container } = render(
      <Providers>
        <main>
          <CaptureDoors />
          <CaptureDoors compact />
        </main>
      </Providers>,
    )
    // Non-vacuity: all three doors are on screen, in both copies.
    const regions = await screen.findAllByRole('region', { name: 'Capture from anywhere' })
    if (regions.length !== 2) throw new Error(`expected two capture boxes, saw ${regions.length}`)
    for (const r of regions) {
      await within(r).findByRole('link', { name: /Email to Notebook/ })
      within(r).getByRole('link', { name: /Browser extension/ })
      within(r).getByRole('button', { name: 'iPhone Shortcut' })
    }
    return { root: container }
  })

  axeSurface('shortcut-how-to', async () => {
    render(<Providers><main><ShortcutHowTo onClose={vi.fn()} /></main></Providers>)
    const dlg = screen.getByRole('dialog', { name: 'Send notes from your iPhone' })
    const steps = within(dlg).getByRole('list', { name: 'Steps' })
    if (steps.children.length !== SHORTCUT_STEPS.length) throw new Error('the steps did not render')
    within(dlg).getByRole('link', { name: /Make a key/ })
    // (no root: the sheet is portaled to <body>)
  })

  axeSurface('capture-doors-to-how-to', async () => {
    // The door that opens the sheet, then the sheet over the page that holds it.
    render(<Providers><main><CaptureDoors /></main></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'iPhone Shortcut' }))
    screen.getByRole('dialog', { name: 'Send notes from your iPhone' })
  })
})
