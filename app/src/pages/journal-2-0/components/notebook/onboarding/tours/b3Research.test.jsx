// Wave 14 lane W14-B3: the seven research-and-setups tours (plan 4.2 rows 15 to 21).
//
// Per tour: it is registered, it loads, it has the plan's step count with a title and
// a body for every step, its flag is the capability's OWN flag (the key the
// capability's file reads), and the generic gate opens it only while that flag is on.
// The anchor rail itself is tourAnchors.test.js, which covers these tours by
// iterating TOUR_REGISTRY; nothing here restates it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOURS } from './b3Research'
import { TRACK_TOURS } from '.'
import { TOUR_REGISTRY, replayableTours } from '../tourRegistry'
import { makeRegistryToursGate } from '../RegistryToursGate'
import { openRegistryTour, __resetRegistryTourControl } from '../tourRegistryControl'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../../lib/offline/notebookFlags'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..', '..', '..', '..') // .../pages/journal-2-0

// id -> [flag, plan 4.2 step count, the capability file whose own code reads the flag]
const EXPECTED = {
  'ta-fingerprint': ['notebook_ta_fingerprint_enabled', 4, 'components/notebook/FingerprintPanel.jsx'],
  'visual-playbook': ['notebook_visual_playbook_enabled', 5, 'components/notebook/VisualPlaybook.jsx'],
  'setups-board': ['notebook_setups_board_enabled', 5, 'components/notebook/SetupsBoard.jsx'],
  'earnings-prep': ['notebook_earnings_prep_enabled', 4, 'lib/earningsPrepShared.js'],
  'transcript-capture': ['notebook_transcript_capture_enabled', 5, 'lib/researchCapture.js'],
  'passed-setups': ['notebook_passed_setups_enabled', 3, 'lib/researchCapture.js'],
  'note-resurfaces': ['awareness_note_resurface_enabled', 2, 'components/notebook/NoteEditorPage.jsx'],
}
const IDS = Object.keys(EXPECTED)

describe('the B3 track is registered', () => {
  it('exports exactly the seven tours, in plan order, and every one reaches the registry', () => {
    expect(TOURS.map((t) => t.id)).toEqual(IDS)
    for (const t of TOURS) {
      expect(TRACK_TOURS).toContain(t)
      expect(TOUR_REGISTRY.some((r) => r.id === t.id)).toBe(true)
    }
  })

  it('step data stays lazy: the track file imports no steps module statically', () => {
    const src = fs.readFileSync(path.join(HERE, 'b3Research.js'), 'utf8')
    expect(src).not.toMatch(/^\s*import\s[^(]*\.steps/m)
    expect((src.match(/import\('\.\/\w+\.steps'\)/g) || []).length).toBe(IDS.length)
  })

  it('only the passive explainer is hidden from Help; every other B3 tour is replayable', () => {
    const replayable = replayableTours().map((t) => t.id)
    for (const id of IDS) expect(replayable.includes(id), id).toBe(id !== 'note-resurfaces')
  })
})

describe.each(IDS)('tour %s', (id) => {
  const [flag, count, flagFile] = EXPECTED[id]
  const entry = TOURS.find((t) => t.id === id)

  it(`loads ${count} steps, each with a title and a body in plain copy`, async () => {
    const { steps, copy } = await entry.load()
    expect(steps).toHaveLength(count)
    expect(new Set(steps.map((s) => s.id)).size).toBe(count)
    expect(Object.keys(copy).sort()).toEqual(steps.map((s) => s.id).sort())
    for (const s of steps) {
      expect(Object.keys(s).sort()).toEqual(['anchor', 'file', 'id'])
      const c = copy[s.id]
      expect(c.title.trim().length, `${id}/${s.id} title`).toBeGreaterThan(0)
      expect(c.body.trim().length, `${id}/${s.id} body`).toBeGreaterThan(0)
      // house style for member copy: no em or en dashes
      expect(`${c.title} ${c.body}`, `${id}/${s.id}`).not.toMatch(/[—–]/)
    }
  })

  it(`is gated by ${flag}, the key the capability's own code reads`, () => {
    expect(entry.flag).toBe(flag)
    expect(fs.readFileSync(path.join(WAVE, flagFile), 'utf8')).toContain(`'${flag}'`)
  })
})

// The generic gate opens a registered tour only while its flag is on. A fake engine
// stands in for GenericTourEngine so this is about the gate's reading of `flag`.
const engineLoader = () => vi.fn(async () => ({
  default: ({ entry }) => <div role="dialog">{entry.title} is open</div>,
}))

function Page({ Gate, tours }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <Gate tours={tours} />
      </MemoryRouter>
    </SWRConfig>
  )
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

describe.each(IDS)('the gate for %s', (id) => {
  const entry = TOURS.find((t) => t.id === id)

  it('flag off: asked for by id, nothing is fetched or shown', async () => {
    latchNotebookFlags({ [entry.flag]: false })
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[entry]} />)
    act(() => { openRegistryTour(id) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(load).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('flag on: the same request opens it', async () => {
    latchNotebookFlags({ [entry.flag]: true })
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[entry]} />)
    act(() => { openRegistryTour(id) })
    expect(await screen.findByText(`${entry.title} is open`)).toBeInTheDocument()
  })
})
