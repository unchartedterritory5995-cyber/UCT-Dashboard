// app/src/components/chart/__tests__/rsTeaching.test.js
//
// ─── UCT RS Phase 4, unit 4-04 · the teaching copy on `rsLine` ──────────────
//
// The five tour cards (D12) and the RSI signpost (D13) live on the shipped
// definition. Unit 4-03 railed the engine against a probe; this file rails the
// shipped copy:
//   - the definition registers with both, and `meta.tags` gained no "rsi" (F45);
//   - `meta.tour` IS the authored `TOUR` and equals the committed export
//     (`api/data/rs_teaching.json`), so the Python lane reads the same words;
//   - the tagline appears once across the tour, at the end of card 5;
//   - the library prints the hint for "rsi" and "relative strength index" only,
//     its button adds UCT RS once, and that add is a first add (`onFirstAdd`).
//
// Everything here is Relative Strength. RSI is a different indicator; the hint is
// a signpost for a member who typed "rsi", not a comparison.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, act, waitFor, screen, fireEvent, within } from '@testing-library/react'
import { SWRConfig, mutate as globalMutate } from 'swr'
import { __resetRevisionStateForTests } from '../../../hooks/usePreferences'
import { __resetPrefsSessionForTests } from '../../../lib/prefsSession'
import IndicatorLibraryDialog from '../IndicatorLibraryDialog'
import { INDICATOR_TOURS_PREF } from '../useIndicatorTours'
import { mergeChartSettings } from '../chartDefaults'
import { definitionVisibility } from '../engine/instanceControls'
import { ENGINE_OWNED } from '../engine/flipState'
import { validateDefinition } from '../engine/defSchema'
import * as engineRegistry from '../engine/nativeRegistry'
import { TOUR, TAGLINE } from '../../../content/rs/teachingData.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXPORT_PATH = path.resolve(HERE, '..', '..', '..', '..', '..', 'api', 'data', 'rs_teaching.json')
const RS_ID = 'rsLine'
const RS_NAME = 'UCT Relative Strength'
const HINT_LINE = 'Looking for strength versus the market? That is UCT Relative Strength.'

const rsDef = () => engineRegistry.getDefinition(RS_ID)

describe('rsLine carries the teaching copy', () => {
  it('registers, in the library catalogue and the server lane, with a tour and a hint', () => {
    const def = rsDef()
    expect(def, 'rsLine is not registered').toBeTruthy()
    expect(engineRegistry.SERVER_DEFS.map((d) => d.id)).toContain(RS_ID)
    expect(engineRegistry.listDefinitions().map((d) => d.id)).toContain(RS_ID)
    expect(def.meta.name).toBe(RS_NAME)
    // the registered document still passes the schema as it stands
    expect(validateDefinition(def).ok).toBe(true)
  })

  it('meta.tour IS the authored TOUR, and equals the committed export\'s tour', () => {
    const exported = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'))
    expect(rsDef().meta.tour).toEqual(TOUR)
    expect(rsDef().meta.tour).toEqual(exported.tour)
    expect(rsDef().meta.tour).toHaveLength(5)
  })

  it('the tagline appears exactly once across the tour, at the end of card 5', () => {
    expect(TAGLINE).toBe('Navigate the market, effectively.')
    const tour = rsDef().meta.tour
    const count = (s) => s.split(TAGLINE).length - 1
    const total = tour.reduce((n, c) => n + count(c.title) + count(c.body), 0)
    expect(total).toBe(1)
    expect(count(tour[4].body)).toBe(1)
    expect(tour[4].body.endsWith(TAGLINE)).toBe(true)
  })

  it('meta.searchHint is D13 verbatim; meta.tags has no "rsi" (F45)', () => {
    const { searchHint, tags } = rsDef().meta
    expect(searchHint).toEqual({ queries: ['rsi', 'relative strength index'], line: HINT_LINE })
    expect(tags.some((t) => /\brsi\b/i.test(t))).toBe(false)
  })
})

// ─── the library, with the shipped registry ─────────────────────────────────
// The real preference endpoint's contract (as `useIndicatorTours.test.js`): GET
// returns the stored map, POST replaces one key.
let server
function installFetch() {
  globalThis.fetch = vi.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      server[body.key] = body.value
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }
    }
    const snapshot = { ...server }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => snapshot }
  })
}
const wrapper = ({ children }) => h(SWRConfig, { value: { dedupingInterval: 0, shouldRetryOnError: false } }, children)

beforeEach(async () => {
  __resetRevisionStateForTests(); __resetPrefsSessionForTests()
  await globalMutate(() => true, undefined, { revalidate: false })
  server = {}
  installFetch()
})
afterEach(() => { vi.restoreAllMocks() })

const base = () => mergeChartSettings(null)

async function openLibrary(settings = base()) {
  const onChange = vi.fn()
  const onFirstAdd = vi.fn()
  const props = (s) => ({ open: true, onClose: () => {}, settings: s, onChange, registry: engineRegistry, onFirstAdd })
  const utils = render(h(IndicatorLibraryDialog, props(settings)), { wrapper })
  // the seen-state read lands before any click
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  const rerender = (s) => utils.rerender(h(IndicatorLibraryDialog, props(s)))
  return { onChange, onFirstAdd, rerender }
}
const type = (v) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: v } })
const hintRow = () => screen.queryByTestId('library-search-hint')

describe('the RSI signpost in the indicator library', () => {
  it('shows for "rsi" and "relative strength index", naming UCT RS', async () => {
    await openLibrary()
    for (const q of ['rsi', 'relative strength index', '  RSI ']) {
      type(q)
      const row = hintRow()
      expect(row, `no hint for ${JSON.stringify(q)}`).toBeTruthy()
      expect(row.dataset.defId).toBe(RS_ID)
      expect(within(row).getByText(HINT_LINE)).toBeTruthy()
      expect(within(row).getByRole('button', { name: `Add ${RS_NAME}` })).toBeTruthy()
    }
  })

  it('does NOT show for "rs" or "rsi divergence"', async () => {
    await openLibrary()
    for (const q of ['rs', 'rsi divergence', 'relative strength']) {
      type(q)
      expect(hintRow(), `a hint showed for ${JSON.stringify(q)}`).toBeNull()
    }
  })

  it('the RSI result stays listed above the hint (a signpost, not a replacement)', async () => {
    await openLibrary()
    type('rsi')
    const rsiRow = document.querySelector('li[data-def-id="rsi"]')
    expect(rsiRow).toBeTruthy()
    expect(rsiRow.compareDocumentPosition(hintRow()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('its button adds UCT RS once, and that first add fires onFirstAdd("rsLine")', async () => {
    const { onChange, onFirstAdd, rerender } = await openLibrary()
    type('rsi')
    fireEvent.click(within(hintRow()).getByRole('button', { name: `Add ${RS_NAME}` }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(definitionVisibility(next, RS_ID, ENGINE_OWNED)).toMatchObject({ state: 'shown', live: 1 })
    expect(onFirstAdd).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).toHaveBeenCalledWith(RS_ID)
    // once on, the hint offers no second Add
    rerender(next)
    expect(within(hintRow()).queryByRole('button')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).toHaveBeenCalledTimes(1)
  })

  it('a member who has seen the RS tour gets the add, not the tour', async () => {
    server[INDICATOR_TOURS_PREF] = JSON.stringify({ [RS_ID]: '2026-11-01T00:00:00.000Z' })
    const { onChange, onFirstAdd } = await openLibrary()
    await act(async () => { await Promise.resolve() })
    type('rsi')
    fireEvent.click(within(hintRow()).getByRole('button', { name: `Add ${RS_NAME}` }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).not.toHaveBeenCalled()
  })
})
