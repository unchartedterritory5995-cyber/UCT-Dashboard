// W14-C1: every registered tour, opened the way a member opens it, MEASURED.
//
// For each of the 20 registered tours: start from Help (`/support`), follow the tour's own
// Replay link (`startPath` + `startState`, exactly what Support.jsx renders), through the REAL
// gate and the REAL engine, in a stand-in app whose pages render a capability's anchors only
// on the screen where that capability's component really renders (ROUTE_OF_FILE below, one
// line per anchor file). The tour "can open" when its card shows its first step there. The
// passive explainer is opened the way the product opens it: the resurfacing sheet's trigger.
//
// The stand-in is honest about what sits behind a click: a step whose anchor appears only
// after the member acts (a `waitFor` target, and every step after it) is NOT rendered up
// front. So a tour that could only open on a click it cannot ask for fails here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { SWRConfig } from 'swr'
import RegistryToursGate from './RegistryToursGate'
import { OTHER_TOURS, startKind, startPath, startState } from './tourRegistry'
import { openRegistryTour, __resetRegistryTourControl } from './tourRegistryControl'
import { SAMPLE_IMPORT_PREFIX } from './tourStart'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'

// Where each anchor file renders in the app (journal-2-0 relative). A function of the
// location: true when that component is on screen there.
const params = (l) => new URLSearchParams(l.search)
const onNote = (l) => l.pathname === '/journal/notebook' && Boolean(params(l).get('note'))
const onNotebook = (l) => l.pathname === '/journal/notebook'
const onHome = (l) => onNotebook(l) && !['note', 'view', 'side', 'resurfaceVersion', 'new'].some((k) => params(l).has(k))
const ROUTE_OF_FILE = {
  'components/notebook/NoteEditorPage.jsx': onNote,
  'components/notebook/NoteShareControls.jsx': onNote,
  'components/notebook/PropertiesSection.jsx': onNote,
  'components/notebook/WidgetEmbedView.jsx': onNote,
  'components/notebook/ChartPlanPanel.jsx': onNote,
  'components/notebook/BarReplay.jsx': onNote,
  'components/notebook/FingerprintPanel.jsx': onNote,
  'components/notebook/VisualPlaybook.jsx': onNote,
  'components/notebook/SaveTranscriptPassage.jsx': onNote,
  'components/notebook/ResurfaceVersionSheet.jsx': (l) => onNote(l) && params(l).has('resurfaceVersion'),
  'components/notebook/NoteTasksView.jsx': (l) => onNotebook(l) && params(l).get('view') === 'tasks',
  'components/notebook/TemplatePicker.jsx': () => false,            // a picker open: behind a click
  'tabs/NotebookTab.jsx': onNotebook,
  'components/notebook/FolderSidebar.jsx': onNotebook,
  'components/notebook/ResearchHome.jsx': onHome,
  'components/notebook/ReportingSoon.jsx': onHome,
  'components/notebook/PassedSetups.jsx': onHome,
  'components/trade/PlanGradeCard.jsx': (l) => /^\/journal-2-0\/trade\/[^/]+$/.test(l.pathname),
  'components/EntryContextCard.jsx': (l) => /^\/journal-2-0\/(trade|position)\/[^/]+$/.test(l.pathname),
  'components/WhyPrompt.jsx': (l) => /^\/journal-2-0\/(trade|position)\/[^/]+$/.test(l.pathname),
  'components/insights/MyPlaybook.jsx': (l) => l.pathname === '/journal-2-0/playbook',
  'components/notebook/BoardCard.jsx': (l) => l.pathname === '/journal/notebook/setups',
  'components/notebook/SetupsBoard.jsx': (l) => l.pathname === '/journal/notebook/setups',
}

let loaded = {}
function World({ tour }) {
  const l = useLocation()
  const { steps } = loaded[tour.id]
  // steps from the first `waitFor` target on are behind a click the member has not made
  const firstWait = steps.findIndex((s) => s.waitFor)
  const behind = firstWait >= 0 ? steps.findIndex((s) => s.anchor === steps[firstWait].waitFor) : steps.length
  const shown = steps.slice(0, behind).filter((s) => {
    const on = ROUTE_OF_FILE[s.file]
    if (!on) throw new Error(`ROUTE_OF_FILE has no entry for ${s.file} (${tour.id}.${s.id})`)
    return on(l)
  })
  return <div>{[...new Set(shown.map((s) => s.anchor))].map((a) => <div key={a} data-tour={a}>{a}</div>)}</div>
}

function Help({ tour }) {
  const navigate = useNavigate()
  useEffect(() => {
    // what Support.jsx's Replay <Link> does
    if (tour.replayable) navigate(startPath(tour), { state: startState(tour) })
    // the passive explainer: the resurfacing sheet's trigger, on the note it belongs to
    else { navigate('/journal/notebook?note=n-thesis&resurfaceVersion=v1'); setTimeout(() => openRegistryTour(tour.id), 50) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

const RESULTS = []
beforeAll(async () => {
  for (const t of OTHER_TOURS) loaded[t.id] = await t.load()
})
afterAll(() => {
  // the table for docs/notebook/wave14-w14-c1.md, printed once
  // eslint-disable-next-line no-console
  console.log(`\nREACHABILITY\n${RESULTS.map((r) => `${r.id} | ${r.start} | ${r.opens ? 'opens' : 'NO'} | ${r.where}`).join('\n')}\n`)
})
beforeEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  installTourLayout()
  // every tour's own flag, every `requires`, and the wave-14 switch (W14-C1 ruling)
  latchNotebookFlags({
    ...Object.fromEntries([...new Set(OTHER_TOURS.flatMap((t) => [t.flag, ...(t.requires || [])]))].map((f) => [f, true])),
    notebook_onboarding_enabled: true, notebook_getting_started_enabled: true,
  })
  global.fetch = vi.fn(async (url, init = {}) => {
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (url === '/api/j2/notes/import/check') {
      const keys = JSON.parse(init.body).importKeys
      return ok({ existing: Object.fromEntries(keys.map((k) => [k, { id: `n-${k.slice(SAMPLE_IMPORT_PREFIX.length)}` }])) })
    }
    if (String(url).startsWith('/api/j2/notes?')) return ok({ notes: [{ id: 'n-recent' }] })
    if (String(url).startsWith('/api/j2/trades?')) return ok({ trades: [{ id: 501 }] })
    if (url === '/api/auth/preferences') return ok({})
    return { ok: false, status: 404, json: async () => ({}) }
  })
})
afterEach(() => { cleanup(); __resetNotebookFlags(); __resetRegistryTourControl(); vi.restoreAllMocks() })

let where = ''
function Where() { const l = useLocation(); where = l.pathname + l.search; return null }

describe('every registered tour, opened from Help the way a member opens it', () => {
  it('there are 20 registered tours beyond the base tour (19 replayable, 1 passive explainer)', () => {
    expect(OTHER_TOURS).toHaveLength(20)
    expect(OTHER_TOURS.filter((t) => !t.replayable).map((t) => t.id)).toEqual(['note-resurfaces'])
  })

  it.each(OTHER_TOURS.map((t) => [t.id, t]))('%s opens at its first step', async (id, tour) => {
    const { steps, copy } = loaded[id]
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={['/support']}>
          <Where />
          <Help tour={tour} />
          <World tour={tour} />
          <RegistryToursGate tours={OTHER_TOURS} />
        </MemoryRouter>
      </SWRConfig>,
    )
    const name = copy[steps[0].id].title
    const role = tour.replayable ? 'dialog' : 'complementary'
    let opens = true
    try { await screen.findByRole(role, { name }, { timeout: 4000 }) } catch { opens = false }
    const k = startKind(tour)
    RESULTS.push({ id, start: k ? JSON.stringify(tour.start) : '(none)', opens, where })
    expect(opens, `${id} did not open (ended at ${where})`).toBe(true)
  }, 15000)
})
