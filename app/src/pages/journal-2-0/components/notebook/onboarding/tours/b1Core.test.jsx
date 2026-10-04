// Wave 14, lane W14-B1: the seven core-capability tours (plan 4.2 rows 2 to 8).
//
// Per tour: it is registered, it loads, it has 3 to 6 steps each with a title and a
// body, the copy follows the house rules (no em dash), and it is GATED BY ITS OWN
// FLAG through the real generic gate. The anchors themselves are railed generically
// by ../tourAnchors.test.js, which reads every registered tour.
//
// Three flags are not yet on the auth payload (FLAG_FALLBACKS has no key for them),
// so `notebookFlag()` answers null for them whatever the server says. For those the
// gate rail proves the tour stays CLOSED even when a payload claims the flag is on:
// fail closed, never a tour for a capability the tab cannot see.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { TOURS } from './b1Core'
import { TRACK_TOURS } from './index'
import { TOUR_REGISTRY } from '../tourRegistry'
import { makeRegistryToursGate } from '../RegistryToursGate'
import { openRegistryTour, __resetRegistryTourControl } from '../tourRegistryControl'
import {
  FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags, notebookFlag,
} from '../../../../lib/offline/notebookFlags'

// The plan's rows 2 to 8, by id, each with the flag its capability is gated on.
const EXPECTED = {
  'writing-help': 'notebook_writing_help_enabled',
  'image-docx-import': 'notebook_image_docx_documents_enabled',
  'publish-share': 'notebook_publish_enabled',
  'task-reminders': 'notebook_task_reminders_enabled',
  'template-gallery': 'notebook_template_gallery_enabled',
  'meaning-search': 'notebook_semantic_search_enabled',
  'formulas-rollups': 'notebook_formulas_enabled',
}

describe('the B1 track is registered', () => {
  it('declares exactly the seven tours of plan 4.2 rows 2 to 8, each on its own flag', () => {
    expect(Object.fromEntries(TOURS.map((t) => [t.id, t.flag]))).toEqual(EXPECTED)
  })

  it('every B1 tour is in the real registry, through tours/index.js', () => {
    const ids = TOUR_REGISTRY.map((t) => t.id)
    for (const t of TOURS) {
      expect(TRACK_TOURS, `${t.id} not spread into TRACK_TOURS`).toContain(t)
      expect(ids, `${t.id} not in TOUR_REGISTRY`).toContain(t.id)
    }
  })

  it('`start`, where set, is a path under the Notebook (no engine change for B1)', () => {
    for (const t of TOURS) {
      if ('start' in t) expect(t.start.startsWith('/journal/notebook'), t.id).toBe(true)
    }
  })
})

describe.each(TOURS.map((t) => [t.id, t]))('tour %s', (id, entry) => {
  it('loads lazily into 3 to 6 steps, each with a title and a body', async () => {
    const { steps, copy } = await entry.load()
    expect(steps.length, `${id} step count`).toBeGreaterThanOrEqual(3)
    expect(steps.length, `${id} step count`).toBeLessThanOrEqual(6)
    expect(Object.keys(copy).sort()).toEqual([...new Set(steps.map((s) => s.id))].sort())
    for (const s of steps) {
      expect(Object.keys(s).sort()).toEqual(['anchor', 'file', 'id'])
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

  it('step ids are unique within the tour', async () => {
    const { steps } = await entry.load()
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
  })
})

// ── gated by its own flag, through the real gate ─────────────────────────────────
const engineLoader = () => vi.fn(async () => ({
  default: ({ entry }) => <div role="dialog">{entry.title} is open</div>,
}))

function Page({ Gate }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <Gate tours={TOURS} />
      </MemoryRouter>
    </SWRConfig>
  )
}

async function openAndRead(id) {
  const Gate = makeRegistryToursGate(engineLoader(), 0)
  render(<Page Gate={Gate} />)
  act(() => { openRegistryTour(id) })
  // Let the lazy leaf settle either way before reading.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  return screen.queryByRole('dialog')
}

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

describe.each(TOURS.map((t) => [t.id, t.flag]))('tour %s is gated by %s', (id, flag) => {
  const plumbed = Object.prototype.hasOwnProperty.call(FLAG_FALLBACKS, flag)

  it('flag OFF: opening it shows nothing', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, ...(plumbed ? { [flag]: false } : {}) })
    expect(await openAndRead(id)).toBeNull()
  })

  if (plumbed) {
    it('flag ON: opening it shows the tour (CONTROL: the gate can open)', async () => {
      latchNotebookFlags({ [flag]: true })
      expect(notebookFlag(flag)).toBe(true)
      const dialog = await openAndRead(id)
      expect(dialog).not.toBeNull()
      expect(dialog.textContent).toContain(`${TOURS.find((t) => t.id === id).title} is open`)
    })
  } else {
    it('flag not on the auth payload yet: stays closed even when a payload claims it is on', async () => {
      latchNotebookFlags({ notebook_onboarding_enabled: true, [flag]: true })
      expect(notebookFlag(flag)).toBeNull()
      expect(await openAndRead(id)).toBeNull()
    })
  }
})
