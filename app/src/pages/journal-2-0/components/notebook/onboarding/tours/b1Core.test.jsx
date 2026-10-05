// Wave 14, lane W14-B1: the seven core-capability tours (plan 4.2 rows 2 to 8).
//
// Per tour: it is registered, it loads, it has 3 to 6 steps each with a title and a
// body, the copy follows the house rules (no em dash), and it is GATED BY ITS OWN
// FLAG through the real generic gate. The anchors themselves are railed generically
// by ../tourAnchors.test.js, which reads every registered tour.
//
// W14-C1 (item g): the three flags that were server-only now ride the auth payload, each
// with its capability's own polarity (task reminders is a kill switch: unset reads ON).
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

  it('W14-C1: the four editor tours start in a note; the rest on a Notebook screen', () => {
    const starts = Object.fromEntries(TOURS.map((t) => [t.id, t.start ?? null]))
    expect(starts).toEqual({
      'writing-help': { note: 'recent' },
      'image-docx-import': { note: 'recent' },
      'publish-share': { note: 'recent' },
      'task-reminders': '/journal/notebook?view=tasks',
      'template-gallery': null,
      'meaning-search': null,
      'formulas-rollups': { note: 'recent' },
    })
  })
})

describe.each(TOURS.map((t) => [t.id, t]))('tour %s', (id, entry) => {
  it('loads lazily into 3 to 6 steps, each with a title and a body', async () => {
    const { steps, copy } = await entry.load()
    expect(steps.length, `${id} step count`).toBeGreaterThanOrEqual(3)
    expect(steps.length, `${id} step count`).toBeLessThanOrEqual(6)
    expect(Object.keys(copy).sort()).toEqual([...new Set(steps.map((s) => s.id))].sort())
    for (const s of steps) {
      // W14-C1: a step may also declare `waitFor` (a later step's anchor, railed in tourRegistry.test.js)
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
  it('its flag is a notebookFlag() key (W14-C1 put the last three on the payload)', () => {
    expect(Object.keys(FLAG_FALLBACKS)).toContain(flag)
  })

  it('flag OFF: opening it shows nothing', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [flag]: false })
    expect(await openAndRead(id)).toBeNull()
  })

  it('flag ON: opening it shows the tour (CONTROL: the gate can open)', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [flag]: true })
    expect(notebookFlag(flag)).toBe(true)
    const dialog = await openAndRead(id)
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain(`${TOURS.find((t) => t.id === id).title} is open`)
  })
})

// ── (g) W14-C1: the three flags that were server-only, each with its OWN polarity ──────────
describe('(g) a payload that does not carry the key reads the capability own default', () => {
  it.each([
    ['notebook_task_reminders_enabled', true, 'task-reminders'],       // a kill switch: ON in prod when unset
    ['notebook_image_docx_documents_enabled', false, 'image-docx-import'], // enablement gates
    ['notebook_semantic_search_enabled', false, 'meaning-search'],
  ])('%s absent -> %s', async (flag, expected, tourId) => {
    expect(FLAG_FALLBACKS[flag]).toBe(expected)
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })       // a payload without the key
    expect(notebookFlag(flag)).toBe(expected)
    const dialog = await openAndRead(tourId)
    if (expected) expect(dialog).not.toBeNull()
    else expect(dialog).toBeNull()
  })

  it('no payload latched yet: every flag answers null, so no tour opens before the server answers', () => {
    // notebookFlags.js contract (unchanged): the fallbacks apply once ANY payload latches.
    for (const f of ['notebook_task_reminders_enabled', 'notebook_image_docx_documents_enabled', 'notebook_semantic_search_enabled']) {
      expect(notebookFlag(f), f).toBeNull()
    }
  })
})
