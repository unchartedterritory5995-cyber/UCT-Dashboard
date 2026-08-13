// FrozenWorkspaceProvider rails.
//
// Rail 1 — completeness, DERIVED never retyped: the real /charts provider's
// key set is parsed out of ChartsWorkspace.jsx's source (the workspaceValue
// literal) and WorkspaceContext.jsx's FALLBACK, and every key must exist in
// frozenWorkspaceValue(). The workspace growing a member the frozen host
// doesn't carry is a SILENT dead end inside embeds (the A6 blast radius) —
// this fails BY NAME instead.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { frozenWorkspaceValue, FROZEN_OWNER } from './frozenWorkspace'

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

describe('frozenWorkspaceValue — full-surface completeness (derived from source)', () => {
  it('carries every member the REAL /charts provider supplies', () => {
    const ws = src('../../../charts/ChartsWorkspace.jsx')
    const m = /workspaceValue = useMemo\(\s*\(\) => \(\{(.*?)\}\)/s.exec(ws)
    expect(m, 'workspaceValue literal found in ChartsWorkspace.jsx').toBeTruthy()
    const realKeys = topLevelKeys(m[1])
    // Non-vacuity control: the parse actually saw the members the FALLBACK
    // omits — if the extraction ever goes blind, this fails first.
    expect(realKeys).toContain('chartApiById')
    expect(realKeys).toContain('activeWatchlistRef')
    expect(realKeys.length).toBeGreaterThanOrEqual(15)

    const frozen = frozenWorkspaceValue()
    const missing = realKeys.filter((k) => !(k in frozen))
    expect(missing, `frozenWorkspaceValue is missing workspace members: ${missing.join(', ')}`).toEqual([])
  })

  it('carries every member of WorkspaceContext.FALLBACK too', () => {
    const ctx = src('../../../charts/WorkspaceContext.jsx')
    const m = /const FALLBACK = \{(.*?)\n\}/s.exec(ctx)
    expect(m).toBeTruthy()
    const keys = topLevelKeys(m[1])
    expect(keys).toContain('groupSyms')
    const frozen = frozenWorkspaceValue()
    expect(keys.filter((k) => !(k in frozen))).toEqual([])
  })

  it('pins the frozen semantics: inert writes, sentinel owners, pinned groups', () => {
    const v = frozenWorkspaceValue({ symbol: 'AMD' })
    expect(v.groupSyms).toEqual({ A: 'AMD', B: 'AMD', C: 'AMD', D: 'AMD' })
    expect(() => v.setGroupSym('A', 'NVDA')).not.toThrow()
    expect(v.groupSyms.A).toBe('AMD')                       // write was inert
    expect(v.activeChartRef.current).toBe(FROZEN_OWNER)     // never matches a widget id
    expect(v.activeWatchlistRef.current).toBe(FROZEN_OWNER) // keydown-ownership guards must FAIL
    const unsub = v.crosshairBus.subscribe(() => {})
    expect(typeof unsub).toBe('function')
    expect(v.aiSearchBus.request('q')).toBe(false)
    // Per-instance registries — two embeds must not share a chart-api map.
    expect(frozenWorkspaceValue().chartApiById.current).not.toBe(v.chartApiById.current)
  })
})

// Rail 2 — CalendarEmbed hands the REAL widget the frozen day under the
// frozen context. The widget itself is stubbed (it drags SWR + the calendar
// endpoints into jsdom); the probe surfaces exactly the props under test.
vi.mock('../../../charts/widgets/CalendarWidget', () => ({
  default: (props) => (
    <div
      data-testid="calendar-widget-stub"
      data-date={props.opts?.date || ''}
      data-journal-door={String(props.journalDoor)}
      data-on-opts={String(!!props.onOptsChange)}
    />
  ),
}))

describe('CalendarEmbed — frozen mount contract', () => {
  it('restores the captured day, closes the journal door, and keeps writes inert', async () => {
    const { default: CalendarEmbed } = await import('./CalendarEmbed')
    render(<CalendarEmbed attrs={{ params: { date: '2026-08-06', econStars: 2 } }} height={400} />)
    const stub = screen.getByTestId('calendar-widget-stub')
    expect(stub.getAttribute('data-date')).toBe('2026-08-06')
    expect(stub.getAttribute('data-journal-door')).toBe('false')
    expect(stub.getAttribute('data-on-opts')).toBe('false')
  })
})
