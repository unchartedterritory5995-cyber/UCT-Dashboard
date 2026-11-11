// app/src/components/chart/useIndicatorTours.test.js
//
// ─── UCT RS Phase 4, unit 4-03 · tour seen-state and the first-add seam ─────
//
// Two contracts:
//   1. `useIndicatorTours` keeps `indicator_tours_seen` (defId -> ISO date) and
//      never loses a row: `markSeen` unions over the freshest cache, after
//      folding in the server's copy (a tab that loaded before another tab marked
//      a tour must not erase that tour's row).
//   2. `IndicatorLibraryDialog` calls `onFirstAdd(defId)` only when a click adds
//      the FIRST live instance of a definition with an unseen tour: never on
//      showing a hidden instance, never on a second instance.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from 'react'
import { render, renderHook, act, waitFor, screen, fireEvent, within } from '@testing-library/react'
import { SWRConfig, mutate as globalMutate } from 'swr'
import { __resetRevisionStateForTests } from '../../hooks/usePreferences'
import { __resetPrefsSessionForTests } from '../../lib/prefsSession'
import useIndicatorTours, { INDICATOR_TOURS_PREF, readToursSeen, mergeToursSeen } from './useIndicatorTours'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import { addInstance, setIndicatorEnabled } from './engine/instanceControls'
import * as engineRegistry from './engine/nativeRegistry'
import { withTourProbe, tourProbeDefinition, TOUR_PROBE_ID } from './__tests__/tourProbe.fixture'

// ─── a fake server with the real endpoint's contract: POST REPLACES the key ───
let server, posts, getMode
function installFetch() {
  globalThis.fetch = vi.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push(body)
      server[body.key] = body.value
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }
    }
    if (getMode.length && getMode.shift() === 'fail') {
      return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) }
    }
    const snapshot = { ...server }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => snapshot }
  })
}
// The app's arrangement: the GLOBAL SWR cache (App.jsx's SWRConfig sets no provider).
const wrapper = ({ children }) => h(SWRConfig, { value: { dedupingInterval: 0, shouldRetryOnError: false } }, children)

beforeEach(async () => {
  __resetRevisionStateForTests(); __resetPrefsSessionForTests()
  await globalMutate(() => true, undefined, { revalidate: false })
  server = {}; posts = []; getMode = []
  installFetch()
})
afterEach(() => { vi.restoreAllMocks() })

const stored = () => readToursSeen(server[INDICATOR_TOURS_PREF])

async function mountHook() {
  const hook = renderHook(() => useIndicatorTours(), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

describe('the seen map', () => {
  it('reads defensively: never an array, drops rows without a date', () => {
    expect(readToursSeen(undefined)).toEqual({})
    expect(readToursSeen('[1,2]')).toEqual({})
    expect(readToursSeen('not json')).toEqual({})
    expect(readToursSeen(JSON.stringify({ a: '2026-11-07T00:00:00.000Z', b: 3, c: '' })))
      .toEqual({ a: '2026-11-07T00:00:00.000Z' })
  })

  it('merges as a union, keeping the EARLIER date for a row both hold', () => {
    expect(mergeToursSeen({ a: '2026-11-02', b: '2026-11-05' }, { b: '2026-11-03', c: '2026-11-04' }))
      .toEqual({ a: '2026-11-02', b: '2026-11-03', c: '2026-11-04' })
  })
})

describe('useIndicatorTours', () => {
  it('seen() reads the stored map; markSeen() writes an ISO date and keeps every other row', async () => {
    server[INDICATOR_TOURS_PREF] = JSON.stringify({ older: '2026-10-01T00:00:00.000Z' })
    const { result } = await mountHook()
    expect(result.current.seen('older')).toBe(true)
    expect(result.current.seen(TOUR_PROBE_ID)).toBe(false)
    await act(async () => { await result.current.markSeen(TOUR_PROBE_ID, new Date('2026-11-07T15:00:00Z')) })
    expect(result.current.seen(TOUR_PROBE_ID)).toBe(true)
    expect(stored()).toEqual({ older: '2026-10-01T00:00:00.000Z', [TOUR_PROBE_ID]: '2026-11-07T15:00:00.000Z' })
  })

  it('⛔ two writers in one tab, at once: both rows survive', async () => {
    const { result } = await mountHook()
    await act(async () => {
      await Promise.all([result.current.markSeen('defA'), result.current.markSeen('defB')])
    })
    expect(Object.keys(stored()).sort()).toEqual(['defA', 'defB'])
  })

  it('⛔⛔ a second tab\'s row, written after THIS tab loaded, is not erased by this tab\'s mark', async () => {
    const { result } = await mountHook()            // this tab loads: the map is empty
    // …then another tab marks its tour (a whole-value POST, as the real endpoint stores it)
    server[INDICATOR_TOURS_PREF] = JSON.stringify({ otherTab: '2026-11-07T14:00:00.000Z' })
    await act(async () => { await result.current.markSeen('thisTab', new Date('2026-11-07T15:00:00Z')) })
    expect(stored()).toEqual({ otherTab: '2026-11-07T14:00:00.000Z', thisTab: '2026-11-07T15:00:00.000Z' })
    expect(result.current.seen('otherTab'), 'the other tab\'s row reached this tab\'s cache too').toBe(true)
  })

  it('CONTROL: when the re-read fails, the same race loses the other tab\'s row (so the rail above can fail)', async () => {
    const { result } = await mountHook()
    server[INDICATOR_TOURS_PREF] = JSON.stringify({ otherTab: '2026-11-07T14:00:00.000Z' })
    getMode = ['fail']
    await act(async () => { await result.current.markSeen('thisTab') })
    expect(Object.keys(stored())).toEqual(['thisTab'])
  })

  it('marking a tour already seen, with the server holding every row, sends nothing', async () => {
    server[INDICATOR_TOURS_PREF] = JSON.stringify({ [TOUR_PROBE_ID]: '2026-11-01T00:00:00.000Z' })
    const { result } = await mountHook()
    await act(async () => { await result.current.markSeen(TOUR_PROBE_ID) })
    expect(posts).toEqual([])
    expect(stored()[TOUR_PROBE_ID]).toBe('2026-11-01T00:00:00.000Z')   // the first date is kept
  })

  it('disabled: reads nothing and writes nothing', async () => {
    const { result } = renderHook(() => useIndicatorTours(false), { wrapper })
    expect(result.current.seen(TOUR_PROBE_ID)).toBe(false)
    let out
    await act(async () => { out = await result.current.markSeen(TOUR_PROBE_ID) })
    expect(out).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

// ─── the library's first-add seam ────────────────────────────────────────────
const REG = withTourProbe(engineRegistry)
const base = () => mergeChartSettings(null)

async function openLibrary(settings, { registry = REG } = {}) {
  const onChange = vi.fn()
  const onFirstAdd = vi.fn()
  const props = (s) => ({ open: true, onClose: () => {}, settings: s, onChange, registry, onFirstAdd })
  const utils = render(h(IndicatorLibraryDialog, props(settings)), { wrapper })
  // the seen-state read has landed before any click (a member cannot click faster than the read)
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  const rerender = (s) => utils.rerender(h(IndicatorLibraryDialog, props(s)))
  return { onChange, onFirstAdd, rerender }
}
const probeRow = () => document.querySelector(`li[data-def-id="${TOUR_PROBE_ID}"]`)

describe('IndicatorLibraryDialog — onFirstAdd', () => {
  it('fires once, with the definition id, on the FIRST add of a definition with an unseen tour', async () => {
    const { onChange, onFirstAdd } = await openLibrary(base())
    fireEvent.click(probeRow())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).toHaveBeenCalledWith(TOUR_PROBE_ID)
  })

  it('the hint row\'s Add button is the same door: it fires too', async () => {
    const { onFirstAdd } = await openLibrary(base())
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'rsi' } })
    fireEvent.click(within(screen.getByTestId('library-search-hint')).getByRole('button'))
    expect(onFirstAdd).toHaveBeenCalledWith(TOUR_PROBE_ID)
  })

  it('never on a SECOND instance ("+ Add another")', async () => {
    const on = setIndicatorEnabled(base(), TOUR_PROBE_ID, true, REG)
    const { onChange, onFirstAdd } = await openLibrary(on)
    fireEvent.click(within(probeRow()).getByRole('button', { name: /Add another/ }))
    expect(onChange).toHaveBeenCalledTimes(1)          // the add happened…
    expect(onFirstAdd).not.toHaveBeenCalled()          // …and it was not a first add
  })

  it('never on re-enabling a HIDDEN instance', async () => {
    const hidden = setIndicatorEnabled(setIndicatorEnabled(base(), TOUR_PROBE_ID, true, REG), TOUR_PROBE_ID, false, REG)
    const { onChange, onFirstAdd } = await openLibrary(hidden)
    fireEvent.click(probeRow())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).not.toHaveBeenCalled()
  })

  it('never on hiding a shown one', async () => {
    const on = addInstance(base(), TOUR_PROBE_ID, REG)
    const { onChange, onFirstAdd } = await openLibrary(on)
    fireEvent.click(probeRow())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).not.toHaveBeenCalled()
  })

  it('never when the member has already seen this definition\'s tour', async () => {
    server[INDICATOR_TOURS_PREF] = JSON.stringify({ [TOUR_PROBE_ID]: '2026-11-01T00:00:00.000Z' })
    const { onChange, onFirstAdd } = await openLibrary(base())
    await waitFor(() => expect(posts).toEqual([]))
    fireEvent.click(probeRow())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).not.toHaveBeenCalled()
  })

  it('never for a definition with no tour (the shipped RSI)', async () => {
    const { onChange, onFirstAdd } = await openLibrary(base())
    fireEvent.click(document.querySelector('li[data-def-id="rsi"]'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).not.toHaveBeenCalled()
  })

  it('CONTROL: the same probe without a tour never fires, so the first case is the tour\'s doing', async () => {
    const noTour = tourProbeDefinition({ tour: undefined })
    const { onFirstAdd } = await openLibrary(base(), { registry: withTourProbe(engineRegistry, noTour) })
    fireEvent.click(probeRow())
    expect(onFirstAdd).not.toHaveBeenCalled()
  })
})
