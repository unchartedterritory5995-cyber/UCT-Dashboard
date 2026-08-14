// App-focus rails.
//
// ⭐ THE LOAD-BEARING ONE: focus adds NO STATE — its storage is the pref
// ChartsWorkspace already owns. So the key is read out of THAT FILE'S SOURCE
// and compared to the constant here. If anyone renames the pref on either
// side, this goes red instead of the app quietly growing a second, divergent
// answer to "what symbol am I on" — this repo's most repeated defect.
import fs from 'node:fs'
import path from 'node:path'
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SWRConfig } from 'swr'
import useAppFocus, { FOCUS_PREF_KEY, FOCUS_GROUP } from './useAppFocus'

const WORKSPACE = path.resolve(__dirname, '../pages/charts/ChartsWorkspace.jsx')

describe('the focus pref is the charts groups pref — one value, not two', () => {
  it('ChartsWorkspace reads and writes the key this hook claims', () => {
    const src = fs.readFileSync(WORKSPACE, 'utf8')
    // Derived, never retyped: pull the pref keys ChartsWorkspace actually uses.
    const used = new Set([...src.matchAll(/charts_workspace_\w+/g)].map((m) => m[0]))
    expect(used.has(FOCUS_PREF_KEY),
      `ChartsWorkspace no longer uses '${FOCUS_PREF_KEY}' — app focus is now `
      + 'storing to a pref nobody reads, which is a second authority over '
      + `"what symbol am I on". It uses: ${[...used].join(', ')}`).toBe(true)
    // And it writes it, not just reads it (a read-only key would mean focus
    // writes land somewhere the workspace never picks up).
    expect(new RegExp(`setPref\\(\\s*['"]${FOCUS_PREF_KEY}['"]`).test(src)).toBe(true)
    // Control: a key that does NOT exist must fail the same probe, so this
    // can't pass by matching anything.
    expect(used.has('charts_workspace_nonexistent')).toBe(false)
  })
})

const H = { prefs: {}, posted: [] }

vi.mock('./usePreferences', async (orig) => {
  const actual = await orig()
  return {
    ...actual,
    default: () => ({
      prefs: H.prefs,
      setPref: (k, v) => { H.posted.push([k, v]); H.prefs = { ...H.prefs, [k]: v }; return Promise.resolve() },
      setPrefMerged: () => Promise.resolve(),
      loading: false,
    }),
  }
})

const wrap = ({ children }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>

describe('useAppFocus', () => {
  beforeEach(() => { H.prefs = {}; H.posted = [] })
  afterEach(() => vi.clearAllMocks())

  it('reads Group A as the focused symbol', () => {
    H.prefs = { [FOCUS_PREF_KEY]: JSON.stringify({ A: 'amd', B: 'NVDA' }) }
    const { result } = renderHook(() => useAppFocus(), { wrapper: wrap })
    expect(result.current.symbol).toBe('AMD')          // normalized
  })

  it('no groups / empty slot → null, never a guessed default', () => {
    const { result } = renderHook(() => useAppFocus(), { wrapper: wrap })
    expect(result.current.symbol).toBeNull()
    H.prefs = { [FOCUS_PREF_KEY]: JSON.stringify({ A: null }) }
    const { result: r2 } = renderHook(() => useAppFocus(), { wrapper: wrap })
    expect(r2.current.symbol).toBeNull()
  })

  it('setting focus MERGES — the other comparison slots survive', async () => {
    H.prefs = { [FOCUS_PREF_KEY]: JSON.stringify({ A: 'SPY', B: 'NVDA', C: 'QQQ' }) }
    const { result } = renderHook(() => useAppFocus(), { wrapper: wrap })
    await act(async () => { result.current.setSymbol('amd') })
    const [key, value] = H.posted[0]
    expect(key).toBe(FOCUS_PREF_KEY)
    expect(JSON.parse(value)).toEqual({ A: 'AMD', B: 'NVDA', C: 'QQQ' })
    expect(FOCUS_GROUP).toBe('A')
  })

  it('a no-op write costs no request', async () => {
    H.prefs = { [FOCUS_PREF_KEY]: JSON.stringify({ A: 'AMD' }) }
    const { result } = renderHook(() => useAppFocus(), { wrapper: wrap })
    await act(async () => { result.current.setSymbol('AMD') })
    await act(async () => { result.current.setSymbol('') })
    await waitFor(() => expect(H.posted).toEqual([]))
  })
})
