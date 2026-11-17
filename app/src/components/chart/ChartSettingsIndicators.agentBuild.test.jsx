// app/src/components/chart/ChartSettingsIndicators.agentBuild.test.jsx
//
// ⭐ UCT SIGNATURE R2 — the Indicators window, owner-approved "Option 1" (2026-11-16):
//   · search is the first and only input ("Search indicators or symbols…");
//   · the header has ONE primary, "✦ Create indicator" → the New formula window's start view;
//   · while the search has text — matches or not — "Not quite it?" offers
//     "✦ Build “<query>” with the UCT Agent →", which opens that start view with the query
//     PRE-FILLED (`onCreateFormula({ description })`; the builder never sends it), and
//     "Or  Paste a TradingView script · Start from a picture · Write a formula" (the builder's
//     'pine' / 'image' / 'formula' doors, `onOpenBuilderDoor`);
//   · gold only on the ✦ (and the current tab's underline) — UCT Signature §2b.
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { AuthContext } from '../../context/AuthContext'
import { mergeChartSettings } from './chartDefaults'

function Host(props) {
  const [cs, setCs] = useState(() => mergeChartSettings({}))
  return (
    <AuthContext.Provider value={{ user: { id: 1, role: 'user' }, isPaid: true, loading: false }}>
      <ChartSettingsModal open settings={cs} onChange={setCs} onClose={() => {}} {...props} />
    </AuthContext.Provider>
  )
}
const openAdd = () => {
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  fireEvent.click(screen.getByTestId('add-enter'))
}
const search = () => screen.getByRole('searchbox', { name: 'Search indicators' })
const type = (text) => fireEvent.change(search(), { target: { value: text } })
const mountAll = () => {
  const doors = { formula: vi.fn(), door: vi.fn(), create: vi.fn() }
  render(<Host onCreateFormula={doors.formula} onOpenBuilderDoor={doors.door} onCreateIndicator={doors.create} />)
  openAdd()
  return doors
}

beforeEach(() => {
  // the symbol search answers nothing (no network in a unit test)
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [], definitions: [] }) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.fetch })

describe('the Indicators window — Option 1', () => {
  it('search is the first and only input, with the new placeholder', () => {
    mountAll()
    const surface = screen.getByTestId('add-surface')
    const inputs = surface.querySelectorAll('input, textarea')
    expect(inputs.length).toBe(1)
    expect(inputs[0]).toBe(search())
    expect(search().getAttribute('placeholder')).toBe('Search indicators or symbols…')
  })

  it('"✦ Create indicator" opens the New formula start view (no words)', () => {
    const doors = mountAll()
    const btn = screen.getByTestId('settings-create-indicator')
    expect(btn.textContent.trim()).toBe('✦Create indicator')
    fireEvent.click(btn)
    expect(doors.formula).toHaveBeenCalledTimes(1)
    expect(doors.formula.mock.calls[0]).toEqual([])
    expect(doors.door).not.toHaveBeenCalled()
    expect(doors.create).not.toHaveBeenCalled()
  })

  it('no "Not quite it?" while the search is empty', () => {
    mountAll()
    expect(screen.queryByTestId('agent-build')).toBeNull()
    type('   ')
    expect(screen.queryByTestId('agent-build')).toBeNull()
  })

  it('typing with matches: results first, then "Not quite it?" with the query in the UCT Agent row', () => {
    mountAll()
    type('rsi')
    const section = screen.getByTestId('agent-build')
    expect(within(section).getByText('Not quite it?')).toBeTruthy()
    const row = within(section).getByTestId('agent-build-row')
    expect(row.textContent).toContain('Build “rsi” with the UCT Agent')
    expect(row.textContent).toContain('It writes the formula and shows you a plain-English read-back and a preview before anything is added')
    // the matches are still there, ABOVE the row
    const result = screen.getAllByRole('list')[0]
    expect(result.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the UCT Agent row opens the builder with the query PRE-FILLED (description only — nothing sent from here)', () => {
    const doors = mountAll()
    type('  rsi below 30 above the 200 day ')
    fireEvent.click(screen.getByTestId('agent-build-row'))
    expect(doors.formula).toHaveBeenCalledTimes(1)
    expect(doors.formula).toHaveBeenCalledWith({ description: 'rsi below 30 above the 200 day' })
    expect(doors.create).not.toHaveBeenCalled()
    expect(globalThis.fetch.mock.calls.filter(([, init]) => init && init.method && init.method !== 'GET')).toEqual([])
  })

  it('the three links open the matching builder doors', () => {
    const doors = mountAll()
    type('rsi')
    const alt = screen.getByTestId('agent-build-doors')
    expect([...alt.children].map((c) => c.textContent)).toEqual(['Or', 'Paste a TradingView script', 'Start from a picture', 'Write a formula'])
    fireEvent.click(within(alt).getByRole('button', { name: 'Paste a TradingView script' }))
    fireEvent.click(within(alt).getByRole('button', { name: 'Start from a picture' }))
    fireEvent.click(within(alt).getByRole('button', { name: 'Write a formula' }))
    expect(doors.door.mock.calls).toEqual([['pine'], ['image'], ['formula']])
    expect(doors.formula).not.toHaveBeenCalled()
  })

  it('zero matches: the same row sits right under the empty sentence', () => {
    const doors = mountAll()
    type('qqzxv nothing like this')
    const empty = document.querySelector('[class*="indEmpty"]')
    expect(empty).toBeTruthy()
    const section = screen.getByTestId('agent-build')
    expect(empty.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(within(section).getByTestId('agent-build-row'))
    expect(doors.formula).toHaveBeenCalledWith({ description: 'qqzxv nothing like this' })
  })

  it('without the builder doors (a host that has none): no Create button, no Agent row, no links', () => {
    render(<Host />)
    openAdd()
    type('rsi')
    expect(screen.queryByTestId('settings-create-indicator')).toBeNull()
    expect(screen.queryByTestId('agent-build')).toBeNull()
  })

  it('a host with the builder but no door callback: the row, without the "Or" links', () => {
    const formula = vi.fn()
    render(<Host onCreateFormula={formula} />)
    openAdd()
    type('rsi')
    expect(screen.getByTestId('agent-build-row')).toBeTruthy()
    expect(screen.queryByTestId('agent-build-doors')).toBeNull()
  })

  it('⛔ gold only on the ✦: the button, the row and the links wear no gold class but the spark', () => {
    mountAll()
    type('rsi')
    const sparks = [screen.getByTestId('settings-create-indicator'), screen.getByTestId('agent-build')]
      .flatMap((root) => [...root.querySelectorAll('[class*="spark"]')])
    expect(sparks.length).toBe(2)
    for (const el of sparks) expect(el.textContent).toBe('✦')
  })

  it('⛔ gold only on the ✦ (CSS rail): the new rules never name the gold', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/chart/ChartSettingsIndicators.module.css'), 'utf8')
    const rules = css.split('}').filter((r) => /\.(agent\w+|addPrim)\b/.test(r.split('{')[0] || ''))
    expect(rules.length).toBeGreaterThan(5)
    for (const r of rules) expect(r, r).not.toMatch(/--ci-gold|--ut-gold|#dcbb5e/i)
  })
})
