// Notebook P5, Task 7: the B4 track, two tours for Journal styles and the community style library.
//
// Per tour (the b1Core.test.jsx shape): it is registered, it loads, it has 3 to 6 steps each with
// a title and a body, the copy is plain (no em dash, no en dash, no `!`), and it is GATED BY ITS
// OWN FLAG through the real generic gate. The anchors themselves are railed generically by
// ../tourAnchors.test.js, and the open-from-Help path by ../tourReachability.test.jsx.
//
// Rulings pinned here (ledger 2026-10-17-notebook-p5-launch/progress.md):
//   P5-R-C10  the Journal styles tour starts on the notes LIST (`?view=all`): the Styles button
//             is in the list header, and `/journal/notebook` alone is Research Home, where it
//             does not exist.
//   P5-R-C11  the Community library tour requires the template-gallery switch (its door lives in
//             the template picker), waits on step 2 for the gallery to open, and anchors Adopt in
//             StyleLibraryCard.jsx.
//   V8        the Styles button is on screen at 390 px (a 44 px icon), so no phone-only step.
//   T3-5      anchors are `data-tour`, never an accessible name (two firm cards share one).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { TOURS } from './b4Styles'
import { TRACK_TOURS } from './index'
import { TOUR_REGISTRY } from '../tourRegistry'
import { learnTourGroup } from '../learnTours'
import { makeRegistryToursGate } from '../RegistryToursGate'
import { openRegistryTour, __resetRegistryTourControl } from '../tourRegistryControl'
import {
  FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags, notebookFlag,
} from '../../../../lib/offline/notebookFlags'

const EXPECTED = {
  'journal-styles': 'notebook_journal_styles_enabled',
  'style-library': 'notebook_style_library_enabled',
}

const TAB = 'tabs/NotebookTab.jsx'
const MANAGER = 'components/notebook/styles/StylesManager.jsx'
const PICKER = 'components/notebook/TemplatePicker.jsx'
const GALLERY = 'components/notebook/TemplateGallery.jsx'
const CARD = 'components/notebook/StyleLibraryCard.jsx'

describe('the B4 track is registered', () => {
  it('declares exactly the two P5 tours, each on its own flag', () => {
    expect(Object.fromEntries(TOURS.map((t) => [t.id, t.flag]))).toEqual(EXPECTED)
  })

  it('every B4 tour is in the real registry, through tours/index.js', () => {
    const ids = TOUR_REGISTRY.map((t) => t.id)
    for (const t of TOURS) {
      expect(TRACK_TOURS, `${t.id} not spread into TRACK_TOURS`).toContain(t)
      expect(ids, `${t.id} not in TOUR_REGISTRY`).toContain(t.id)
    }
  })

  it('P5-R-C10 and C11: both start on the notes list, where Styles and Templates are', () => {
    const starts = Object.fromEntries(TOURS.map((t) => [t.id, t.start ?? null]))
    expect(starts).toEqual({
      'journal-styles': '/journal/notebook?view=all',
      'style-library': '/journal/notebook?view=all',
    })
  })

  it('P5-R-C11(a): the library tour also requires the template gallery (its door is in the picker); the styles tour requires nothing more', () => {
    const requires = Object.fromEntries(TOURS.map((t) => [t.id, t.requires ?? null]))
    expect(requires).toEqual({
      'journal-styles': null,
      'style-library': ['notebook_template_gallery_enabled'],
    })
  })

  it('R-P5-6: both sit under Writing and capture in the Learn menu', () => {
    for (const t of TOURS) expect(learnTourGroup(t.id), t.id).toBe('Writing and capture')
  })

  it('both are replayable (Help and Learn list them)', () => {
    for (const t of TOURS) expect(t.replayable, t.id).toBe(true)
  })
})

describe('the steps point where R-P5-7 and the rulings say', () => {
  it('Journal styles: the Styles button (wait for the manager), its heading, the kinds, New style', async () => {
    const { steps } = await TOURS.find((t) => t.id === 'journal-styles').load()
    expect(steps.map(({ anchor, file, waitFor }) => ({ anchor, file, waitFor: waitFor ?? null }))).toEqual([
      { anchor: 'styles-button', file: TAB, waitFor: 'styles-manager' },
      { anchor: 'styles-manager', file: MANAGER, waitFor: null },
      { anchor: 'styles-kinds', file: MANAGER, waitFor: null },
      { anchor: 'styles-new', file: MANAGER, waitFor: null },
    ])
  })

  it('Community library: Templates (wait for the door), the door (wait for the gallery), the type chips, Adopt', async () => {
    const { steps } = await TOURS.find((t) => t.id === 'style-library').load()
    expect(steps.map(({ anchor, file, waitFor }) => ({ anchor, file, waitFor: waitFor ?? null }))).toEqual([
      { anchor: 'templates', file: TAB, waitFor: 'template-gallery-door' },
      { anchor: 'template-gallery-door', file: PICKER, waitFor: 'library-types' },
      { anchor: 'library-types', file: GALLERY, waitFor: null },
      { anchor: 'library-adopt', file: CARD, waitFor: null },
    ])
  })

  // Plan edge case 6 ("the Journal styles tour started on a phone"), decided by V8: the button is
  // on screen at 390 px, so step 1 anchors on the button itself at every width and the tour has no
  // phone-only step. What this pins is that the anchor sits ON the Styles button (the element
  // whose click opens the manager), not on a wrapper or a label a phone hides.
  it('V8: the styles-button anchor is the Styles button itself, and no step is phone-only', async () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url))
    const src = fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', TAB), 'utf8')
    // the opening tag holds `() =>`, so match its LINE rather than a `[^>]*` tag pattern
    const lines = src.split(/\r?\n/).filter((l) => l.includes('data-tour="styles-button"'))
    expect(lines, 'exactly one line carries data-tour="styles-button"').toHaveLength(1)
    expect(lines[0]).toMatch(/^\s*<button\b/)
    expect(lines[0]).toContain('onClick={() => setStylesOpen(true)}')
    const { steps } = await TOURS.find((t) => t.id === 'journal-styles').load()
    expect(steps.filter((s) => s.file === TAB).map((s) => s.anchor)).toEqual(['styles-button'])
  })
})

describe.each(TOURS.map((t) => [t.id, t]))('tour %s', (id, entry) => {
  it('loads lazily into 3 to 6 steps, each with a title and a body', async () => {
    const { steps, copy } = await entry.load()
    expect(steps.length, `${id} step count`).toBeGreaterThanOrEqual(3)
    expect(steps.length, `${id} step count`).toBeLessThanOrEqual(6)
    expect(Object.keys(copy).sort()).toEqual([...new Set(steps.map((s) => s.id))].sort())
    for (const s of steps) {
      expect(Object.keys(s).filter((k) => k !== 'waitFor').sort()).toEqual(['anchor', 'file', 'id'])
      const c = copy[s.id]
      expect(c?.title?.trim(), `${id}.${s.id} title`).toBeTruthy()
      expect(c?.body?.trim(), `${id}.${s.id} body`).toBeTruthy()
    }
  })

  it('copy is plain: no em dash, no en dash, no exclamation mark', async () => {
    const { copy } = await entry.load()
    for (const [k, c] of Object.entries(copy)) {
      for (const text of [c.title, c.body]) {
        expect(text, `${id}.${k}`).not.toMatch(/[—–!]/)
      }
    }
  })

  it('each body is one or two sentences', async () => {
    const { copy } = await entry.load()
    for (const [k, c] of Object.entries(copy)) {
      const sentences = c.body.trim().split(/(?<=[.?])\s+/).filter(Boolean)
      expect(sentences.length, `${id}.${k}: ${c.body}`).toBeGreaterThanOrEqual(1)
      expect(sentences.length, `${id}.${k}: ${c.body}`).toBeLessThanOrEqual(2)
      expect(c.body.trim(), `${id}.${k} ends a sentence`).toMatch(/[.?]$/)
    }
  })

  it('step ids are unique within the tour', async () => {
    const { steps } = await entry.load()
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
  })
})

// ── gated by its own flag (and its `requires`), through the real gate ─────────────────────────
const engineLoader = () => vi.fn(async () => ({
  default: ({ entry }) => <div role="dialog">{entry.title} is open</div>,
}))

function Page({ Gate }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook?view=all']}>
        <Gate tours={TOURS} />
      </MemoryRouter>
    </SWRConfig>
  )
}

async function openAndRead(id) {
  const Gate = makeRegistryToursGate(engineLoader(), 0)
  render(<Page Gate={Gate} />)
  act(() => { openRegistryTour(id) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  return screen.queryByRole('dialog')
}

const SW_ON = { notebook_onboarding_enabled: true, notebook_getting_started_enabled: true }

beforeEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  vi.restoreAllMocks()
})

describe.each(TOURS.map((t) => [t.id, t]))('tour %s is gated by its own flag', (id, entry) => {
  const required = Object.fromEntries((entry.requires || []).map((f) => [f, true]))

  it('its flag (and every `requires`) is a notebookFlag() key that falls back OFF', () => {
    for (const f of [entry.flag, ...(entry.requires || [])]) {
      expect(Object.keys(FLAG_FALLBACKS), f).toContain(f)
      expect(FLAG_FALLBACKS[f], f).toBe(false)
    }
  })

  it('flag OFF: opening it shows nothing', async () => {
    latchNotebookFlags({ ...SW_ON, ...required, [entry.flag]: false })
    expect(await openAndRead(id)).toBeNull()
  })

  it('flag ON: opening it shows the tour (CONTROL: the gate can open)', async () => {
    latchNotebookFlags({ ...SW_ON, ...required, [entry.flag]: true })
    expect(notebookFlag(entry.flag)).toBe(true)
    const dialog = await openAndRead(id)
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain(`${entry.title} is open`)
  })
})

describe('P5-R-C11(a): the library tour needs the template gallery too', () => {
  it('library ON, template gallery OFF: nothing opens (its first anchor is a door that does not render)', async () => {
    latchNotebookFlags({ ...SW_ON, notebook_style_library_enabled: true, notebook_template_gallery_enabled: false })
    expect(await openAndRead('style-library')).toBeNull()
  })
})
