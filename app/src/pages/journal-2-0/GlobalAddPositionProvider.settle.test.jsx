/**
 * ⛔⛔ Q1-F3 — THE REAL PROVIDER, THROUGH ITS REAL ENTRY POINT.
 *
 * `GlobalAddPositionProvider` opens the hero door from a place no other rail
 * reaches: a member right-clicks a chart, picks "Save to Notebook", and the
 * provider creates a note AND uploads the chart screenshot as its hero — in one
 * flow, with no editor mounted anywhere.
 *
 * ⚰️ IT WAS THE ONE DOOR LEFT WITH ONLY STRUCTURAL COVERAGE. The settle-site
 * gauntlet reported it RED on the enumeration rail alone, and the reason given
 * was that the flow "ends in `window.location.href`, which jsdom cannot drive".
 * That was a reason to design the rail carefully, not a reason to skip it: the
 * navigation happens AFTER the settle, so the settle is observable and the
 * assignment is merely noisy.
 *
 * ⭐ DRIVEN THROUGH THE EVENT, NOT THROUGH A HANDLER. The provider's entry point
 * is a `uct:chart-contextmenu` CustomEvent that every chart surface dispatches;
 * calling `handleSaveToNotebook` directly would test a function this component
 * happens to contain rather than the door a member opens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import * as settleModule from './lib/offline/settleNoteWrite'

const T2 = '2026-09-12T14:00:00.000000+00:00'

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }))
vi.mock('./hooks/useJ2Settings', () => ({ default: () => ({ settings: {} }) }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', accounts: [] }) }))
vi.mock('../../hooks/useWatchlistAlerts', () => ({ default: () => ({ createAlert: vi.fn() }) }))
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ toggle: vi.fn(), isFlagged: () => false }) }))
vi.mock('../../hooks/useTickerTags', () => ({
  default: () => ({ getTag: () => null, setTag: vi.fn(), removeTag: vi.fn() }),
}))
// ⛔ an ARRAY: the provider maps over it. A {} passes typeof but not .map.
vi.mock('../../hooks/useTagColors', () => ({ default: () => ({ tagColors: [] }) }))
vi.mock('swr', () => ({
  default: () => ({ data: [], mutate: vi.fn() }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))
// The modal is a different surface with its own rails; it must not render here.
vi.mock('./components/AddPositionModal', () => ({ default: () => null }))

import GlobalAddPositionProvider from './GlobalAddPositionProvider'

let spy
beforeEach(() => {
  vi.clearAllMocks()
  spy = vi.spyOn(settleModule, 'settleNoteWrite').mockResolvedValue(T2)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** The member's own path: right-click a chart, then pick Save to Notebook. */
async function saveToNotebookFromAChart({ withScreenshot = true } = {}) {
  render(<GlobalAddPositionProvider />)
  await act(async () => {
    window.dispatchEvent(new CustomEvent('uct:chart-contextmenu', {
      detail: {
        sym: 'NVDA',
        bar: { t: 1757700000, c: 180.5, l: 178, h: 182 },
        clientX: 100,
        clientY: 100,
        sections: [],
        getScreenshotBlob: withScreenshot
          ? async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
          : undefined,
      },
    }))
  })
  const item = await screen.findByText(/Save to Notebook/i)
  await act(async () => { fireEvent.click(item) })
}

describe('⛔⛔ the chart → Notebook flow lands its hero revision', () => {
  it('creates the note, uploads the hero, and LANDS the revision that upload created', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${String(url)}`)
      if (String(url) === '/api/j2/notes' && opts.method === 'POST') {
        return { ok: true, json: async () => ({ note: { id: 'n-chart', title: 'NVDA' } }) }
      }
      return { ok: true, json: async () => ({ note: { id: 'n-chart', updatedAt: T2 } }) }
    }))

    await saveToNotebookFromAChart()

    // ⭐ Non-vacuity first: the hero door must actually have been opened, or a
    // green settle assertion would be measuring a flow that never ran.
    await waitFor(() => expect(calls.some((c) => c === 'POST /api/j2/notes/n-chart/hero')).toBe(true))
    await waitFor(() => expect(spy, '⛔ the chart→Notebook hero door did not land its revision').toHaveBeenCalled())
    expect(spy.mock.calls[0][0]).toBe('n-chart')
  })

  it('⛔ CONTROL — a REFUSED hero upload lands nothing, and the note still exists', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${String(url)}`)
      if (String(url) === '/api/j2/notes' && opts.method === 'POST') {
        return { ok: true, json: async () => ({ note: { id: 'n-chart', title: 'NVDA' } }) }
      }
      if (String(url).endsWith('/hero')) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => ({}) }
    }))

    await saveToNotebookFromAChart()

    await waitFor(() => expect(calls.some((c) => c.endsWith('/hero'))).toBe(true))
    expect(spy, 'an upload the server refused advanced nothing').not.toHaveBeenCalled()
    // …and the note itself was still created — a failed hero never costs the note.
    expect(calls).toContain('POST /api/j2/notes')
  })

  it('⛔ CONTROL — with NO screenshot there is no hero door at all, so nothing lands', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${String(url)}`)
      return { ok: true, json: async () => ({ note: { id: 'n-chart', title: 'NVDA' } }) }
    }))

    await saveToNotebookFromAChart({ withScreenshot: false })

    await waitFor(() => expect(calls).toContain('POST /api/j2/notes'))
    expect(calls.some((c) => c.endsWith('/hero')), 'no screenshot ⇒ no hero upload').toBe(false)
    expect(spy, 'no door was opened, so no revision exists').not.toHaveBeenCalled()
  })
})
