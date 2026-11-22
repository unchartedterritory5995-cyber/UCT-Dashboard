// W14-C1: every registered tour, opened the way a member opens it, MEASURED.
//
// For each of the 23 registered tours: start from Help (`/support`), follow the tour's own
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
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import acornJsx from 'acorn-jsx'
import RegistryToursGate from './RegistryToursGate'
import { OTHER_TOURS, TOUR_REGISTRY, startKind, startPath, startState } from './tourRegistry'
import { openRegistryTour, __resetRegistryTourControl } from './tourRegistryControl'
import { SAMPLE_IMPORT_PREFIX } from './tourStart'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'
// The app mounts the gate inside this boundary, keyed by pathname, so every change of page
// remounts the gate (W14-Q2: a stand-in without it could not see trade tours being dropped).
import RouteErrorBoundary from '../../../../../components/RouteErrorBoundary'

// Where each anchor file renders in the app (journal-2-0 relative). A function of the
// location: true when that component is on screen there.
const params = (l) => new URLSearchParams(l.search)
const onNote = (l) => l.pathname === '/journal/notebook' && Boolean(params(l).get('note'))
const onNotebook = (l) => l.pathname === '/journal/notebook'
// Go-live wave 1: Research Home is gone (Notebook simplify Task 5 un-routed it; `?view=home` is the list). The two
// pages on the Notebook route are the Daily brief (`?view=today`, TodayHome.jsx) and, at every other address, the notes
// list -- whose own file (NotebookTab.jsx) also holds the phone note's back button, so it is "the Notebook, not the
// Daily brief". The folders panel is beside both.
const onBrief = (l) => onNotebook(l) && params(l).get('view') === 'today' && !params(l).has('note')
const onNotebookNotBrief = (l) => onNotebook(l) && params(l).get('view') !== 'today'
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
  'components/notebook/styles/StylesManager.jsx': () => false,      // P5: the Styles manager open: behind a click
  'components/notebook/TemplateGallery.jsx': () => false,           // P5: the community gallery open: behind two clicks
  'components/notebook/StyleLibraryCard.jsx': () => false,          // P5 (C11): a library card, inside the open gallery
  'tabs/NotebookTab.jsx': onNotebookNotBrief,                      // the list's toolbar and menus (and the phone back)
  'components/notebook/FolderSidebar.jsx': onNotebook,
  'components/notebook/ReportingSoon.jsx': onBrief,                 // the Daily brief's folded boxes (they unfold for a tour)
  'components/notebook/PassedSetups.jsx': onBrief,
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
  it('there are 23 registered tours beyond the base tour (22 replayable, 1 passive explainer)', () => {
    expect(OTHER_TOURS).toHaveLength(23)
    expect(OTHER_TOURS.filter((t) => !t.replayable).map((t) => t.id)).toEqual(['note-resurfaces'])
  })

  it.each(OTHER_TOURS.map((t) => [t.id, t]))('%s opens at its first step', async (id, tour) => {
    const { steps, copy } = loaded[id]
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={['/support']}>
          <Where />
          <Help tour={tour} />
          <RouteErrorBoundary>
            <World tour={tour} />
            <RegistryToursGate tours={OTHER_TOURS} />
          </RouteErrorBoundary>
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

// ── Go-live wave 1 (C7): every step's anchor file is ROUTED ──────────────────────────────────
// The stand-in above is only as true as ROUTE_OF_FILE. Research Home showed how it goes wrong: Task 5 un-routed it, and
// its entry here kept saying "on screen at ?view=home", so four tours read as reachable while no member could reach
// them. Two checks make the model answer for itself:
//   1. EVERY step of EVERY registered tour (the base tour too, and steps behind a click) names a file the model knows;
//   2. every file the model knows is REACHED from the app's entry (App.jsx), by walking the real import graph with an
//      AST -- static imports, re-exports and `import('...')`, relative specifiers resolved the way Vite does
//      (.jsx/.js/index). A file nothing routed imports (Research Home after Task 5) fails here by name.
// (components/screener/reachable.test.js sweeps all of app/src the same way, with every import form; this is the
// narrow, tour-shaped version, so a tour pointing into an unrouted file fails in the tour's own rail.)
const SRC = path.resolve(__dirname, '..', '..', '..', '..', '..')   // app/src
const J2 = path.join(SRC, 'pages', 'journal-2-0')
const JsxParser = Parser.extend(acornJsx())

function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8')
  let ast
  try { ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) } catch { return [] }
  const out = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration')
      && n.source && typeof n.source.value === 'string') out.push(n.source.value)
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal' && typeof n.source.value === 'string') out.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return out
}

function resolveFrom(file, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(file), spec.split('?')[0])
  for (const c of [base, `${base}.jsx`, `${base}.js`, path.join(base, 'index.jsx'), path.join(base, 'index.js')]) {
    if (/\.(jsx?|mjs)$/.test(c) && fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

function reachedFromApp() {
  const seen = new Set()
  const stack = [path.join(SRC, 'App.jsx')]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    for (const spec of importsOf(f)) {
      const r = resolveFrom(f, spec)
      if (r && !seen.has(r)) stack.push(r)
    }
  }
  return seen
}

describe('every tour step\'s anchor file is routed (C7)', () => {
  it('every step of every registered tour names a file the stand-in models', async () => {
    const unmodelled = []
    for (const t of TOUR_REGISTRY) {
      const { steps } = await t.load()
      for (const st of steps) if (!ROUTE_OF_FILE[st.file]) unmodelled.push(`${t.id}.${st.id}: ${st.file}`)
    }
    expect(unmodelled).toEqual([])
  })

  it('every file the stand-in models is reached from App.jsx (no tour can point into an unrouted file)', () => {
    const reached = reachedFromApp()
    expect(reached.size, 'non-vacuity: the walk reached the app').toBeGreaterThan(200)
    const unrouted = Object.keys(ROUTE_OF_FILE).filter((rel) => !reached.has(path.join(J2, rel)))
    expect(unrouted).toEqual([])
  }, 60000)

  it('CONTROL: a file nothing imports is not reached (the walk can say no)', () => {
    const reached = reachedFromApp()
    expect(reached.has(path.join(J2, 'components', 'notebook', 'onboarding', 'tourAnchors.test.js'))).toBe(false)
    expect(reached.has(path.join(J2, 'components', 'notebook', 'onboarding', 'tourRegistry.js'))).toBe(true)
  }, 60000)
})
