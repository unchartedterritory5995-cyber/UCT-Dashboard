// Wave 8 (Task 8.15 fix 2): the re-review's findings, each with a test that fails without its fix.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS, STALE_DRAFT, RESUME_OFFER, orientationOf } from './WidgetBuilderSheet'
import { DRAFT_PREFIX } from './builderDraft'
import { openWidgetBuilder } from './openWidgetBuilder'
import { fitView, indexCatalog, viewReason, unboundedTokens } from './builderCatalog'
import { blankPlan } from './builderState'
import { typePrompt } from './sections/WhichOnesSection'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { installFetch, answer, callsTo, bodyOf, SUMMARY, CATALOG } from './__fixtures__/builderFixtures'

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

let fetchSpy
let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  ;({ spy: fetchSpy, routes } = installFetch())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.querySelectorAll('[data-widget-builder-root]').forEach((n) => n.remove())
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
const DEFS = '/api/j2/widget-definitions'
const draft = () => JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}u1`) || 'null')
const SAVED = { id: 'd-1', name: 'Mine', rev: 3, placedRev: 3, etag: 7, archived: false, usedIn: 14, lastAnswer: null,
  summary: SUMMARY, plan: { ...blankPlan(), measures: [{ key: 'net_pnl' }] } }

async function openDoor(editor) {
  let close
  act(() => { close = openWidgetBuilder({ editor, uid: 'u1' }) })
  await flush()
  await flush(PREVIEW_DEBOUNCE_MS)
  return close
}
const fakeEditor = () => {
  const handlers = new Map()
  return { editor: { storage: { uctJournalWidgets: { uid: 'u1' } }, on: (e, fn) => handlers.set(e, fn), off: (e) => handlers.delete(e) }, handlers }
}

describe('Task 8.15 fix 2', () => {
  it('R-38: browser navigation while edited keeps the draft, and the next open offers it', async () => {
    await openDoor(null)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Left mid-way' } })
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    await flush()
    expect(document.querySelectorAll('[data-widget-builder-root]')).toHaveLength(0)
    expect(draft()).toMatchObject({ plan: { display: { title: 'Left mid-way' } } })
    const close = await openDoor(null)
    expect(screen.getByText(RESUME_OFFER)).toBeInTheDocument()
    act(() => close())
    await flush()
  })

  it('R-38: the note’s editor going away while edited keeps the draft; a clean leave keeps nothing', async () => {
    const { editor, handlers } = fakeEditor()
    await openDoor(editor)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Editor gone' } })
    act(() => handlers.get('destroy')())
    await flush()
    expect(draft()).toMatchObject({ plan: { display: { title: 'Editor gone' } } })
    window.localStorage.clear()
    await openDoor(null)                                         // nothing edited
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    await flush()
    expect(draft()).toBeNull()
    const close = await openDoor(null)                           // an ordinary close writes nothing either
    act(() => close())
    await flush()
    expect(draft()).toBeNull()
  })

  it('N-2: a stale draft kept again keeps its ORIGINAL etag, so it reopens stale and save-as-new only', async () => {
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...SAVED, id: 'd-2', rev: 1, usedIn: 0 }))
    window.localStorage.setItem(`${DRAFT_PREFIX}u1`, JSON.stringify({ v: 1, at: Date.now(), nameTouched: true,
      plan: { ...SAVED.plan, display: { ...SAVED.plan.display, title: 'Kept', titleAuto: false } }, target: 'd-1', etag: 5 }))
    const first = render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} from={{ defId: 'd-1', getPos: () => 1 }} start="resume" />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.getByText(STALE_DRAFT)).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(draft().etag).toBe(5)                                 // never the server's newer 7
    first.unmount()
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} from={{ defId: 'd-1', getPos: () => 1 }} start="resume" />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.getByText(STALE_DRAFT)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    expect(callsTo(fetchSpy, 'PUT', () => true).map((c) => bodyOf(c).apply)).toEqual(['save_new'])
  })

  it('R-35: no range-token rule is typed in the builder; the server’s has_earlier tokens are the list', () => {
    const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'widgetBuilder')
    const walk = (d, out = []) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (n !== '__fixtures__') walk(p, out) } else if (/\.(js|jsx)$/.test(n) && !/\.test\./.test(n)) out.push(p)
      }
      return out
    }
    const files = walk(DIR)
    expect(files.length).toBeGreaterThan(8)
    const typed = /['"]_trades['"]|endsWith\(\s*['"]_trades|(token|tok)\s*===\s*['"]all['"]|['"]last_\d+_trades['"]/
    expect(files.filter((f) => typed.test(readFileSync(f, 'utf8')))).toEqual([])
    expect(typed.test("tok === 'all' || tok.endsWith('_trades')")).toBe(true)        // control: the pattern sees one
    expect(unboundedTokens(indexCatalog(CATALOG))).toEqual(
      CATALOG.viewRules.checks.find((c) => c.test === 'has_earlier').tokens)
  })

  it('R-35: moving the server’s tokens moves fitView, "The period before" and the range picker', async () => {
    const moved = { ...CATALOG, viewRules: { ...CATALOG.viewRules, checks: CATALOG.viewRules.checks.map((c) => (
      c.test === 'has_earlier' ? { ...c, tokens: [...c.tokens, 'ytd'] } : c)) } }
    const cat = indexCatalog(moved)
    const plan = { ...blankPlan(), range: { token: 'ytd' }, view: { type: 'compare', auto: false } }
    expect(fitView(indexCatalog(CATALOG), plan).compare).toEqual({ mode: 'previous' })
    expect(fitView(cat, plan).compare).toEqual({ mode: 'all' })                   // 1: fitView
    route('GET', (u) => u.endsWith('/vocabulary'), () => answer(moved))
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.click(screen.getByRole('radio', { name: 'Number with comparison' }))
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    expect(screen.getByRole('button', { name: 'Year to date' })).toBeDisabled()    // 2: the range picker
    fireEvent.click(screen.getByRole('button', { name: /Back to the widget/ }))
    // 3: "The period before" (pick ytd with the comparison off, then turn it on)
    fireEvent.click(screen.getByRole('radio', { name: /^Number(, suggested)?$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Year to date' }))
    fireEvent.click(screen.getByRole('radio', { name: /^Number with comparison/ }))
    expect(screen.getByRole('radio', { name: 'The period before' })).toBeDisabled()
  })

  it('R-35: a second split’s views are the server’s THEN_VIEWS', () => {
    const plan = { ...blankPlan(), split: { by: 'setup', then: 'symbol' } }
    expect(viewReason(indexCatalog(CATALOG), plan, 'bar')).toBe(CATALOG.reasons.then_table_only)
    expect(viewReason(indexCatalog({ ...CATALOG, viewRules: { ...CATALOG.viewRules, thenViews: ['table', 'bar'] } }), plan, 'bar')).toBeNull()
  })

  it('minor: Undo and Redo say they are not available inside a picker, and do nothing there', async () => {
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.click(screen.getByRole('radio', { name: 'Trading days' }))
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(undo)
    fireEvent.click(screen.getByRole('button', { name: /Back to the widget/ }))
    expect(screen.getByRole('radio', { name: 'Trading days' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Undo' })).not.toHaveAttribute('aria-disabled')
  })

  it('minor: orientation comes from the device (screen.orientation, then the media query), never the window', () => {
    const mm = (landscape) => vi.stubGlobal('matchMedia', (q) => ({ matches: landscape && q.includes('landscape'), media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    mm(true)
    expect(orientationOf()).toBe('landscape')                      // no screen.orientation: the media query
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { type: 'portrait-primary' } })
    expect(orientationOf()).toBe('portrait')                       // the device wins over the media query
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { type: 'landscape-secondary' } })
    mm(false)
    expect(orientationOf()).toBe('landscape')
    delete window.screen.orientation
  })

  it('minor: "Type a" / "Type an" keeps acronyms and reads letters by their sound', () => {
    expect(typePrompt('ET hour')).toBe('Type an ET hour')
    expect(typePrompt('R bucket')).toBe('Type an R bucket')
    expect(typePrompt('Setup')).toBe('Type a setup')
    expect(typePrompt('Emotion')).toBe('Type an emotion')
    expect(typePrompt('Hold minutes')).toBe('Type a hold minutes')
  })
})
