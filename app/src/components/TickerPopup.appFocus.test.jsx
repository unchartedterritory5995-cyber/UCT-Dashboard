// Two TickerPopups open at once: only the TOPMOST speaks for the app (rule H14).
//
// Each open popup writes the app focus symbol (useAppFocus) and the Compass page hint. The
// REAL useAppFocus returns a NEW setSymbol after every write (it closes over the prefs it just
// changed), so two popups each writing their own symbol re-ran each other's effect forever:
// AAA, BBB, AAA, ... -- a preferences POST per turn and a frozen app.
//
// useAppFocus is REAL here. Only its storage is a small in-memory stand-in for usePreferences
// with the property that matters: every write yields a new `prefs` object (so a new setSymbol),
// exactly like the SWR-backed hook. The stand-in stops APPLYING writes after WRITE_CAP, so a
// regression fails this file by count instead of hanging the worker.
import { renderWithProviders, screen, fireEvent, act } from '../test-utils'
import { useState, useSyncExternalStore } from 'react'
import { vi, test, expect, describe, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({ prefs: {}, writes: [], listeners: new Set(), cap: 40 }))
vi.mock('../hooks/usePreferences', async (orig) => {
  const real = await orig()
  const subscribe = (fn) => { store.listeners.add(fn); return () => store.listeners.delete(fn) }
  const setPref = (key, value) => {
    store.writes.push([key, value])
    if (store.writes.length > store.cap) return        // frozen: a loop ends here, and fails the count
    store.prefs = { ...store.prefs, [key]: value }
    for (const fn of store.listeners) fn()
  }
  return {
    ...real,
    default: function usePreferencesStandIn() {
      const prefs = useSyncExternalStore(subscribe, () => store.prefs)
      // useAppFocus writes through `setPrefMerged` (a merge onto the stored value): the same
      // counted write, after the updater ran on what the store holds.
      const setPrefMerged = (key, updater) => {
        const raw = store.prefs[key]
        let cur
        try { cur = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { cur = undefined }
        const next = typeof updater === 'function' ? updater(cur) : updater
        if (next !== undefined) setPref(key, next)
        return Promise.resolve()
      }
      return { prefs, setPref, setPrefMerged, loading: false }
    },
  }
})
vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(), prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('./chart/pane/ChartPane', () => ({ default: () => <div data-testid="pane-stub" /> }))

import TickerPopup from './TickerPopup'
import { FOCUS_PREF_KEY } from '../hooks/useAppFocus'
import { getVoicePageHint } from '../context/VoiceContext'

const focusWrites = () => store.writes.filter(([k]) => k === FOCUS_PREF_KEY)
const focusNow = () => JSON.parse(store.prefs[FOCUS_PREF_KEY] || '{}').A || null

beforeEach(() => {
  store.prefs = {}; store.writes = []
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  }
}

// Each popup lives in its OWN component with its own state, so closing or changing one never
// re-renders the other: the lower popup learns it is topmost again only from the stack.
function Lower() {
  const [open, setOpen] = useState(true)
  const [sym, setSym] = useState('AAA')
  return (
    <>
      <button type="button" onClick={() => setSym('CCC')}>lower to CCC</button>
      <button type="button" onClick={() => setOpen(false)}>close lower</button>
      {open && <TickerPopup sym={sym} open onClose={() => setOpen(false)} />}
    </>
  )
}
function Upper() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open upper</button>
      <button type="button" onClick={() => setOpen(false)}>close upper</button>
      {open && <TickerPopup sym="BBB" open onClose={() => setOpen(false)} />}
    </>
  )
}
function Two() {
  return (<><Lower /><Upper /></>)
}

describe('app focus and the Compass hint follow the TOPMOST popup only', () => {
  test('a single popup behaves exactly as before: one focus write, its own hint', async () => {
    renderWithProviders(<TickerPopup sym="AAA" open onClose={() => {}} />)
    await settle()
    expect(focusWrites()).toHaveLength(1)
    expect(focusNow()).toBe('AAA')
    expect(getVoicePageHint()).toBe('chart of AAA')
  })

  test('two popups: a bounded number of writes, focus on the TOP one, then the lower one after it closes', async () => {
    renderWithProviders(<Two />)
    await settle()
    expect(focusNow()).toBe('AAA')
    expect(getVoicePageHint()).toBe('chart of AAA')

    fireEvent.click(screen.getByText('open upper'))
    await settle()
    // the loop wrote dozens of times; now the top popup writes once and the lower one never
    expect(focusWrites().length).toBeLessThanOrEqual(2)
    expect(focusNow()).toBe('BBB')
    expect(getVoicePageHint()).toBe('chart of BBB')

    // the popup UNDERNEATH changes ticker while the top one is open: it must not take over
    fireEvent.click(screen.getByText('lower to CCC'))
    await settle()
    expect(focusNow()).toBe('BBB')
    expect(getVoicePageHint()).toBe('chart of BBB')

    const before = focusWrites().length
    fireEvent.click(screen.getByText('close upper'))
    await settle()
    // the next one down becomes topmost and re-asserts its own (current) symbol -- once
    expect(focusNow()).toBe('CCC')
    expect(focusWrites().length - before).toBe(1)
    expect(getVoicePageHint()).toBe('chart of CCC')

    fireEvent.click(screen.getByText('close lower'))
    await settle()
    expect(getVoicePageHint()).toBeNull()
  })
})
