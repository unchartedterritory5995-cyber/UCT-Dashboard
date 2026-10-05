// Track W14-B2 (wave 14): one block per tour proving it is registered, loads 3 to 6
// steps with copy for every step, starts where its record says, and is gated by its
// capability's OWN flag through the real registry gate. The anchors themselves are
// tourAnchors.test.js's job (it walks every registered tour generically).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOURS } from './b2Trading'
import { TOUR_REGISTRY, getTourEntry, startPath, NOTEBOOK_ROOT } from '../tourRegistry'
import { makeRegistryToursGate } from '../RegistryToursGate'
import { openRegistryTour, __resetRegistryTourControl } from '../tourRegistryControl'
import { FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags } from '../../../../lib/offline/notebookFlags'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// The slice's own record (plan 4.2 rows 9-14, D6): id -> [capability flag, start, Replay link].
// W14-C1 gave the five tours that had no reachable start one each (wave14-w14-c1.md).
const CHART = { note: 'sample:plan', embed: 'chart' }
const EXPECTED = {
  'plan-grading': ['notebook_plan_grading_enabled', { trade: 'recent' }, '/journal/trades'],
  'entry-context': ['notebook_entry_context_enabled', { trade: 'recent' }, '/journal/trades'],
  'review-drafts': ['notebook_review_drafts_enabled', '/journal/notebook', '/journal/notebook'],
  'my-playbook': ['notebook_playbook_enabled', '/journal-2-0/playbook', '/journal-2-0/playbook'],
  'chart-plan-basics': ['notebook_chart_plan_enabled', CHART, NOTEBOOK_ROOT],
  'chart-plan-replay': ['notebook_chart_plan_enabled', CHART, NOTEBOOK_ROOT],
}
const IDS = Object.keys(EXPECTED)

describe('track B2: exactly the six planned tours', () => {
  it('declares rows 9 to 14 and nothing else, in plan order', () => {
    expect(TOURS.map((t) => t.id)).toEqual(IDS)
  })

  it('D6: the chart plan is two tours on the same flag', () => {
    expect(getTourEntry('chart-plan-basics').flag).toBe(getTourEntry('chart-plan-replay').flag)
  })

  it('no step data is imported statically (risk R3): every load is a dynamic import', () => {
    const src = fs.readFileSync(path.join(HERE, 'b2Trading.js'), 'utf8')
    expect(src).not.toMatch(/^\s*import\s[^(]*\.steps/m)
    expect(src.match(/import\('\.\/\w+\.steps'\)/g)).toHaveLength(IDS.length)
  })
})

describe.each(IDS)('tour %s', (id) => {
  const [flag, start] = EXPECTED[id]

  it('is in the real registry, with its own capability flag', () => {
    const entry = getTourEntry(id)
    expect(entry, `${id} missing from TOUR_REGISTRY`).not.toBeNull()
    expect(TOUR_REGISTRY.filter((t) => t.id === id)).toHaveLength(1)
    expect(entry.flag).toBe(flag)
    expect(Object.keys(FLAG_FALLBACKS), `${flag} is not a notebookFlag() key`).toContain(flag)
    expect(entry.replayable).toBe(true)
  })

  it('starts where the slice record says (the Notebook root when it names none)', () => {
    const entry = getTourEntry(id)
    expect(entry.start).toEqual(start)
    expect(startPath(entry)).toBe(EXPECTED[id][2])
  })

  it('loads 3 to 6 steps, each with a title and a body, and no copy without a step', async () => {
    const { steps, copy } = await getTourEntry(id).load()
    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect(steps.length).toBeLessThanOrEqual(6)
    for (const s of steps) {
      // W14-C1: a step may also declare `waitFor` (a later step's anchor, railed in tourRegistry.test.js)
      expect(Object.keys(s).filter((k) => k !== 'waitFor').sort()).toEqual(['anchor', 'file', 'id'])
      const c = copy[s.id]
      expect(c, `${id} step ${s.id} has no copy`).toBeTruthy()
      expect(c.title.trim().length, `${id} ${s.id} title`).toBeGreaterThan(0)
      expect(c.body.trim().length, `${id} ${s.id} body`).toBeGreaterThan(0)
      expect(`${c.title} ${c.body}`, `${id} ${s.id}: no em or en dashes in member copy`).not.toMatch(/[–—]/)
    }
    expect(Object.keys(copy).sort()).toEqual(steps.map((s) => s.id).sort())
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
  })
})

// ── gated by its own flag, through the REAL registry gate ───────────────────────
const engineLoader = () => vi.fn(async () => ({
  default: ({ entry }) => <div role="dialog">{entry.title} is open</div>,
}))

function Page({ Gate }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <Gate tours={TOUR_REGISTRY} />
      </MemoryRouter>
    </SWRConfig>
  )
}

describe('each tour is gated by its capability flag', () => {
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

  it.each(IDS)('%s: flag off, asking for it by id loads nothing', async (id) => {
    latchNotebookFlags({ [EXPECTED[id][0]]: false })
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} />)
    act(() => { openRegistryTour(id) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(load).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(IDS)('%s: flag on, asking for it by id opens it', async (id) => {
    latchNotebookFlags({ [EXPECTED[id][0]]: true })
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} />)
    act(() => { openRegistryTour(id) })
    expect(await screen.findByText(`${getTourEntry(id).title} is open`)).toBeInTheDocument()
  })
})
