// Breadth drill workspace-host rails.
//
// Rail 1 — completeness, DERIVED never retyped: the real /charts provider's key
// set is parsed out of ChartsWorkspace.jsx's source (the workspaceValue
// literal) and WorkspaceContext.jsx's FALLBACK, and every key must exist in
// drillWorkspaceValue(). The workspace growing a member this host doesn't carry
// is a SILENT dead end inside the drill — this fails BY NAME instead.
//
// Modelled on frozenWorkspace.test.jsx (the journal host's equivalent). Keeping
// the two rails shaped the same is deliberate: a third host should copy this
// file, not invent a new way to check the same invariant.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderHook, act } from '@testing-library/react'
import useDrillWorkspace, { drillWorkspaceValue } from './drillWorkspace'

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** Keys of a one-line object literal: shorthand (`groupSyms,`) and
 *  `key: value` pairs at the top nesting level. */
function topLevelKeys(literal) {
  const keys = []
  let depth = 0
  for (const part of literal.split(',')) {
    if (depth === 0) {
      const m = /^\s*(\w+)\s*(?::|$)/.exec(part)
      if (m) keys.push(m[1])
    }
    for (const ch of part) {
      if (ch === '{' || ch === '(' || ch === '[') depth += 1
      if (ch === '}' || ch === ')' || ch === ']') depth -= 1
    }
  }
  return keys
}

function value(overrides = {}) {
  return drillWorkspaceValue({
    groupSyms: { A: null, B: null, C: null, D: null },
    setGroupSym: () => {},
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    activeChartRef: { current: null },
    chartApiById: { current: new Map() },
    activeWatchlistRef: { current: null },
    ...overrides,
  })
}

describe('drillWorkspaceValue — full-surface completeness (derived from source)', () => {
  it('carries every member the REAL /charts provider supplies', () => {
    const ws = src('../../charts/ChartsWorkspace.jsx')
    const m = /workspaceValue = useMemo\(\s*\(\) => \(\{(.*?)\}\)/s.exec(ws)
    expect(m, 'workspaceValue literal found in ChartsWorkspace.jsx').toBeTruthy()
    const realKeys = topLevelKeys(m[1])
    // Non-vacuity control: the parse actually saw the four members the FALLBACK
    // omits — if the extraction ever goes blind, this fails first instead of
    // the rail passing on an empty key set.
    expect(realKeys).toContain('chartApiById')
    expect(realKeys).toContain('activeWatchlistRef')
    expect(realKeys).toContain('widgetCanvasByType')
    expect(realKeys).toContain('widgetCanvasById')
    expect(realKeys.length).toBeGreaterThanOrEqual(20)

    const drill = value()
    const missing = realKeys.filter((k) => !(k in drill))
    expect(missing, `drillWorkspaceValue is missing workspace members: ${missing.join(', ')}`).toEqual([])
  })

  it('carries every member of WorkspaceContext.FALLBACK too', () => {
    const ctx = src('../../charts/WorkspaceContext.jsx')
    const m = /const FALLBACK = \{(.*?)\n\}/s.exec(ctx)
    expect(m).toBeTruthy()
    const keys = topLevelKeys(m[1])
    expect(keys).toContain('groupSyms')
    const drill = value()
    expect(keys.filter((k) => !(k in drill))).toEqual([])
  })
})

describe('drillWorkspaceValue — LIVE semantics (this host is not the frozen one)', () => {
  it('keeps the owner refs REAL, so hotkey guards can actually fail', () => {
    // ⛔ The journal host uses sentinels so an embed NEVER wins a hotkey. The
    // drill is the opposite: the list must be able to own ↑/↓ and Shift+F.
    // Watchlists' guard is `!activeRef || activeRef.current == null || ...` —
    // an UNDEFINED ref passes vacuously, which is the bug this pins.
    const v = value()
    expect(v.activeWatchlistRef).toBeDefined()
    expect(v.activeChartRef).toBeDefined()
    expect('current' in v.activeWatchlistRef).toBe(true)
    expect('current' in v.activeChartRef).toBe(true)
  })

  it('exposes chartApiById as a ref holding a Map (Send to Journal reads it)', () => {
    // ChartWidget does chartApiById.current.set(id, {...}); getCaptureState()
    // is read back off it by sendToJournal. A plain Map, or undefined, breaks
    // Send to Journal and Compare Symbols SILENTLY.
    const v = value()
    expect(v.chartApiById.current instanceof Map).toBe(true)
    expect(() => v.chartApiById.current.set('x', { getCaptureState: () => null })).not.toThrow()
  })

  it('stubs exactly the workspace-level modes, and they are safe to call', () => {
    const v = value()
    expect(v.periodSortMode).toBe(false)
    expect(v.replayCutoff).toBeNull()
    expect(v.replayArmPick).toBe(false)
    expect(v.startMarker).toBeNull()
    expect(v.aiSearchBus.request('anything')).toBe(false)
    for (const fn of ['floatNewWidget', 'applyThemeToAllCharts', 'applyThemeToAllWidgets', 'exitReplay', 'onPeriodSelected', 'onPeriodCancel', 'onReplayCutoffPicked', 'onReplayPickCancel']) {
      expect(typeof v[fn], `${fn} is callable`).toBe('function')
      expect(() => v[fn]('x', 'y')).not.toThrow()
    }
  })
})

describe('useDrillWorkspace — the live link between list and chart', () => {
  it('seeds colour group A so the chart paints on the first frame', () => {
    const { result } = renderHook(() => useDrillWorkspace({ initialSym: 'AEHR' }))
    expect(result.current.groupSyms.A).toBe('AEHR')
  })

  it('setGroupSym drives the chart, and its identity is stable across renders', () => {
    const { result, rerender } = renderHook(() => useDrillWorkspace({ initialSym: 'AEHR' }))
    const first = result.current.setGroupSym
    act(() => { result.current.setGroupSym('A', 'COHU') })
    expect(result.current.groupSyms.A).toBe('COHU')
    rerender()
    // Watchlists memoizes its row-select handler on this callback; an unstable
    // identity re-renders every row on every selection.
    expect(result.current.setGroupSym).toBe(first)
  })

  it('gives each board its own chart-api registry and crosshair bus', () => {
    const a = renderHook(() => useDrillWorkspace())
    const b = renderHook(() => useDrillWorkspace())
    expect(a.result.current.chartApiById.current).not.toBe(b.result.current.chartApiById.current)
    expect(a.result.current.crosshairBus).not.toBe(b.result.current.crosshairBus)
  })

  it('the crosshair bus actually delivers, and one bad subscriber cannot stop the rest', () => {
    const { result } = renderHook(() => useDrillWorkspace())
    const seen = []
    result.current.crosshairBus.subscribe(() => { throw new Error('bad subscriber') })
    const off = result.current.crosshairBus.subscribe((p) => seen.push(p))
    expect(() => result.current.crosshairBus.emit({ t: 1 })).not.toThrow()
    expect(seen).toEqual([{ t: 1 }])
    off()
    result.current.crosshairBus.emit({ t: 2 })
    expect(seen).toEqual([{ t: 1 }])
  })
})
