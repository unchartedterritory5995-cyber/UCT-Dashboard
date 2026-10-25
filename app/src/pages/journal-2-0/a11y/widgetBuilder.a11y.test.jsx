// app/src/pages/journal-2-0/a11y/widgetBuilder.a11y.test.jsx
//
// Wave 9 Task 9.17 fix 1 (ruling W9-R50, R-46): the widget builder through 8A's axe harness. Until this rail no axe
// run had covered any builder level; components/notebook/widgetBuilder/ and its sections/ are now in the derived
// population, so a new builder file fails surfaceCoverage by name. The levels a member meets: the main level with a
// preview; the examples screen with cards in view; a filter being edited; "Which routine" with a routine already
// taken (the others aria-disabled with the engine's sentence); the date ranges on a routine source (last N trades
// aria-disabled); and the Update-all question. Wave 10 (Task 10.16): "Your own fields" with a valid field, its offers
// and the autocomplete list open; and a field in its error state (the dialect's sentence, and a name the server
// refuses). Each recipe asserts what painted before axe runs. `fetch` is the
// builder's fake server (widgetBuilder/__fixtures__).
import { describe, beforeEach, afterEach, vi, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { axeSurface } from './surface'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS } from '../components/notebook/widgetBuilder/WidgetBuilderSheet'
import { __resetBuiltCaches } from '../lib/builtWidgets'
import { installFetch, answer, payload, SUMMARY } from '../components/notebook/widgetBuilder/__fixtures__/builderFixtures'
import { blankPlan } from '../components/notebook/widgetBuilder/builderState'
import { FORMULA_CATALOG } from '../components/notebook/widgetBuilder/__fixtures__/formulaCatalog'
import {
  TOOL_CATALOG, ROUTINES, TRACKERS, S_ONE_REF, S_UNKNOWN_RANGE,
} from '../components/notebook/widgetBuilder/__fixtures__/toolCatalog'

const DEFS = '/api/j2/widget-definitions'
const SHELF = JSON.parse(readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'widget_engine',
  'shelf.json'), 'utf8')).examples

class AllInView {
  constructor(cb) { this.cb = cb; this.els = new Set() }
  observe(el) { this.els.add(el); this.cb([{ target: el, isIntersecting: true }], this) }
  unobserve(el) { this.els.delete(el) }
  disconnect() { this.els.clear() }
  takeRecords() { return [] }
}

const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
let routes
const route = (method, test, reply) => routes.unshift([method, test, reply])
const withTools = () => {
  route('GET', (u) => u.endsWith('/vocabulary'), () => answer(TOOL_CATALOG))
  route('GET', (u) => u.includes('/vocabulary?field=routine'), () => answer({ field: 'routine', values: ROUTINES }))
  route('GET', (u) => u.includes('/vocabulary?field=tracker'), () => answer({ field: 'tracker', values: TRACKERS }))
}
async function openBuilder(props = {}) {
  render(<WidgetBuilderSheet uid="u1" onClose={() => {}} {...props} />)
  await screen.findByRole('heading', { name: 'What to look at' })
  await wait(PREVIEW_DEBOUNCE_MS + 100)
}

describe('a11y: the widget builder (wave 9, Task 9.17 fix 1)', () => {
  beforeEach(() => {
    __resetBuiltCaches()
    window.localStorage.clear()
    ;({ routes } = installFetch())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  axeSurface('widget-builder-main', async () => {
    await openBuilder()
    expect(screen.getByRole('dialog', { name: 'Build a widget' })).toBeTruthy()
    expect(screen.getAllByText(SUMMARY).length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: 'Closed trades' })).toBeTruthy()
  })

  axeSurface('widget-builder-examples', async () => {
    vi.stubGlobal('IntersectionObserver', AllInView)
    route('GET', (u) => u === `${DEFS}/shelf`, () => answer({ examples: SHELF }))
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => answer({
      sample: false, cards: Object.fromEntries(JSON.parse(init.body).ids.map((id) => [id, payload({ title: id })])),
    }))
    render(<WidgetBuilderSheet uid="u1" onClose={() => {}} start="examples" />)
    await screen.findByRole('list', { name: 'Examples' })
    await wait(600)
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(3)
  })

  axeSurface('widget-builder-filter-editor', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    await wait(50)
    expect(screen.getByRole('button', { name: 'Flag' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Flag' }))
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeTruthy()
  })

  axeSurface('widget-builder-ref-taken', async () => {
    withTools()
    await openBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'Trading days' }))
    await wait(PREVIEW_DEBOUNCE_MS + 50)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Routine done' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Morning prep' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await wait(PREVIEW_DEBOUNCE_MS + 50)
    fireEvent.click(screen.getByRole('button', { name: 'No split. Pick one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Routine done' }))
    const other = await screen.findByRole('button', { name: 'Post-market review' })
    expect(other).toHaveAttribute('aria-disabled', 'true')
    expect(other).toHaveAccessibleDescription(S_ONE_REF)
  })

  axeSurface('widget-builder-range-tool', async () => {
    withTools()
    await openBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'Routine history' }))
    await wait(PREVIEW_DEBOUNCE_MS + 50)
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    const lastN = screen.getByRole('button', { name: 'Last 20 trades' })
    expect(lastN).toHaveAttribute('aria-disabled', 'true')
    expect(lastN).toHaveAccessibleDescription(S_UNKNOWN_RANGE)
  })

  axeSurface('widget-builder-save-question', async () => {
    const saved = { id: 'd-1', name: 'Mine', rev: 3, placedRev: 3, etag: 7, archived: false, usedIn: 14,
      lastAnswer: null, summary: SUMMARY, plan: blankPlan() }
    route('GET', (u) => u === `${DEFS}/d-1`, () => answer(saved))
    const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n-1', uid: 'u1' } }, chain: () => ({}) }
    render(<WidgetBuilderSheet uid="u1" onClose={() => {}} editor={editor} from={{ defId: 'd-1', getPos: () => null }} />)
    await screen.findByRole('dialog', { name: 'Edit widget' })
    await wait(PREVIEW_DEBOUNCE_MS + 100)
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
    fireEvent.click(screen.getByRole('button', { name: /Win rate/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByTestId('builder-save'))
    expect(await screen.findByText('This widget is in 14 notes.')).toBeTruthy()
  })

  axeSurface('widget-builder-formulas', async () => {
    route('GET', (u) => u.endsWith('/vocabulary'), () => answer(FORMULA_CATALOG))
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Add your own field' }))
    const g = screen.getByTestId('formula-field')
    fireEvent.change(within(g).getByLabelText('Name'), { target: { value: 'Green' } })
    fireEvent.change(within(g).getByLabelText('Formula'), { target: { value: '[Net P&L] > 0' } })
    await wait(PREVIEW_DEBOUNCE_MS * 2 + 100)
    expect(within(g).getByRole('group', { name: 'Add as a measure' })).toBeTruthy()
    expect(within(g).getByRole('button', { name: 'Split by this' })).toBeTruthy()
    // The autocomplete list open, its first option active.
    fireEvent.change(within(g).getByLabelText('Formula'), { target: { value: '[Net P&L] > 0 And [' } })
    const list = screen.getByRole('listbox', { name: 'Suggestions' })
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(3)
    expect(within(g).getByLabelText('Formula')).toHaveAttribute('aria-activedescendant')
    await wait(PREVIEW_DEBOUNCE_MS + 50)       // the box settles inside the recipe, not under axe
    expect(screen.getByRole('listbox', { name: 'Suggestions' })).toBeTruthy()
  })

  axeSurface('widget-builder-formula-error', async () => {
    route('GET', (u) => u.endsWith('/vocabulary'), () => answer(FORMULA_CATALOG))
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Add your own field' }))
    const g = screen.getByTestId('formula-field')
    fireEvent.change(within(g).getByLabelText('Name'), { target: { value: 'Net P&L' } })
    fireEvent.change(within(g).getByLabelText('Formula'), { target: { value: '[nope] / 2' } })
    expect(within(g).getByText("[nope] isn't a field here.")).toBeTruthy()
    expect(within(g).getByText('That name is already used.')).toBeTruthy()
    expect(within(g).getByLabelText('Formula')).toHaveAttribute('aria-invalid', 'true')
    await wait(PREVIEW_DEBOUNCE_MS + 50)       // settled: still refused, and no preview was asked for
    expect(within(g).getByText("[nope] isn't a field here.")).toBeTruthy()
  })
})
