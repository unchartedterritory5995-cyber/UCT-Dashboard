// app/src/components/chart/builder/BuilderSheet.directionA.test.jsx
//
// ⭐⭐ DIRECTION A (owner-approved 2026-11-16) — the New formula / Edit formula window's
// START VIEW and EDITOR, walked the way a member walks them.
//
//   • a new formula with no door opens on the START view: "Describe it", four starts
//     (a script, a picture, conditions, a UCT setup), "Write the formula myself →",
//     "Your formulas", and "Nothing is saved until you name it."
//   • every start — and every door a caller names — lands in the EDITOR on its own
//     Source tab; an edit opens the editor on the Formula.
//   • the name is the editor's title; an empty name keeps Save shut and says so.
//   • gold is the CURRENT tab's underline only (UCT Signature §2b).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

import BuilderSheet from './BuilderSheet'
import { startFrom, writeMyself, openTab } from '../../../testing/builder/builderStart.testkit.js'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'

const SAVED = {
  def_id: 'u_beef0123cafe', version: 3, rev: 1,
  definition: {
    id: 'u_beef0123cafe', version: 3, schemaVersion: 1,
    meta: { name: 'RSI dip', repaint: 'non-repainting' },
    compute: { kind: 'ast', source: 'sma(close, 20)', ast: parseFormula('sma(close, 20)').ast, fn: 'x', rev: 1 },
    inputs: [{ key: 'color', type: 'color', default: '#6ba3be' }],
    plots: [{ key: 'value', style: 'line' }],
    placement: { target: 'pane' },
  },
}

const H = vi.hoisted(() => ({ rows: [], propose: null }))

function stubFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (String(url).startsWith('/api/user-definitions/propose') && H.propose) {
      return { ok: true, status: 200, json: async () => H.propose }
    }
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount(props = {}) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} {...props} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const selectedTab = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')

beforeEach(() => { vi.useFakeTimers(); H.rows = []; H.propose = null; stubFetch() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete global.fetch; clearUserDefinitions() })

describe('the START view — a new formula with no door', () => {
  it('shows "Describe it", the four starts, "Write the formula myself", and saves nothing yet', async () => {
    mount()
    await flush()
    const dialog = screen.getByRole('dialog', { name: 'New formula' })
    expect(within(dialog).getByRole('heading', { name: 'New formula' })).toBeInTheDocument()
    expect(screen.getByLabelText('Describe it')).toBeInTheDocument()
    for (const name of [/Paste a script/, /From a picture/, /Build from conditions/, /A UCT setup/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /Write the formula myself/ })).toBeInTheDocument()
    expect(screen.getByText('Nothing is saved until you name it.')).toBeInTheDocument()
    // no editor yet: no tabs, no formula box, no Save — only Cancel
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByLabelText('Formula')).toBeNull()
    expect(screen.queryByTestId('sheet-save')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it.each([
    ['pine', 'Script', null, 'pine-box'],
    ['image', 'Picture', 'From a picture', 'image-box'],
    ['picker', 'Conditions', 'From conditions', 'criteria-picker'],
    ['library', 'Setup', 'From a setup', 'starter-library'],
  ])('the %s start opens the editor on its own Source tab (%s)', async (kind, tab, chip, panel) => {
    mount()
    await flush()
    startFrom(kind)
    await flush()
    expect(screen.getByRole('tablist', { name: 'How to build this' })).toBeInTheDocument()
    expect(selectedTab()).toHaveTextContent(tab)
    expect(screen.getByTestId(panel)).toBeInTheDocument()
    if (chip) expect(screen.getByTestId('source-chip')).toHaveTextContent(chip)
    // the name is the title, and ‹ goes back to the start view
    expect(screen.getByLabelText('Name')).toHaveAttribute('placeholder', 'Name it')
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }))
    expect(screen.getByRole('button', { name: /Paste a script/ })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('"Write the formula myself" opens the editor on the Formula tab, with no Source tab', async () => {
    mount()
    await flush()
    writeMyself()
    expect(selectedTab()).toHaveTextContent('Formula')
    expect(screen.getByLabelText('Formula')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tab')).toBeNull()
    expect(screen.queryByTestId('source-chip')).toBeNull()
    const names = screen.getAllByRole('tab').map((t) => t.textContent.trim())
    expect(names[0]).toBe('Formula')
    expect(names.some((n) => /^Inputs/.test(n))).toBe(true)
    expect(names.some((n) => /^Plots/.test(n))).toBe(true)
    expect(names.some((n) => /Ask the UCT Agent to change it/.test(n))).toBe(true)
  })

  it('a describe answer accepted on the start view lands in the editor, on the Formula tab', async () => {
    vi.useRealTimers()
    H.propose = { ok: true, ast: parseFormula('sma(close, 20)').ast, source: 'sma(close, 20)', repaint: 'non-repainting' }
    mount()
    await flush()
    fireEvent.change(screen.getByLabelText('Describe it'), { target: { value: 'the 20 bar average' } })
    fireEvent.click(screen.getByRole('button', { name: 'Write it' }))
    fireEvent.click(await screen.findByRole('button', { name: /use this formula/i }, { timeout: 4000 }))
    await flush()
    expect(selectedTab()).toHaveTextContent('Formula')
    expect(screen.getByLabelText('Formula').value).toBe('sma(close, 20)')
  })

  it('"Your formulas" lists the saved rows as a card with each line\'s colour bar, and Edit opens the editor', async () => {
    vi.useRealTimers()
    H.rows = [SAVED]
    mount()
    const edit = await screen.findByRole('button', { name: 'Edit RSI dip' }, { timeout: 4000 })
    expect(screen.getByRole('heading', { name: 'Your indicators' })).toBeInTheDocument()
    fireEvent.click(edit)
    await flush()
    expect(screen.getByRole('dialog', { name: 'Edit formula' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name').value).toBe('RSI dip')
    expect(selectedTab()).toHaveTextContent('Formula')
    // an edit has no "back to start" — it is not a new formula — and saves as "Save"
    expect(screen.queryByRole('button', { name: 'Back to start' })).toBeNull()
    expect(screen.getByTestId('sheet-save')).toHaveTextContent(/^Save$/)
  })
})

describe('the DOORS open straight into the editor', () => {
  it.each([
    ['pine', 'Script', 'pine-box'],
    ['image', 'Picture', 'image-box'],
    ['picker', 'Conditions', 'criteria-picker'],
    ['library', 'Setup', 'starter-library'],
  ])('initialMode=%s → the editor on the %s tab, never the start view', async (mode, tab, panel) => {
    mount({ initialMode: mode })
    await flush()
    expect(screen.queryByRole('button', { name: /Write the formula myself/ })).toBeNull()
    expect(selectedTab()).toHaveTextContent(tab)
    expect(screen.getByTestId(panel)).toBeInTheDocument()
  })

  it('an EDIT (editRow) opens the editor on the Formula, with the stored name as the title', async () => {
    mount({ editRow: SAVED })
    await flush()
    expect(screen.getByRole('dialog', { name: 'Edit formula' })).toBeInTheDocument()
    expect(selectedTab()).toHaveTextContent('Formula')
    expect(screen.getByLabelText('Name').value).toBe('RSI dip')
    expect(screen.getByLabelText('Formula').value).toBe('sma(close, 20)')
    // the edit-only tabs are reachable
    expect(screen.getByRole('tab', { name: 'Evidence' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Share' })).toBeInTheDocument()
  })
})

describe('the editor', () => {
  it('an EMPTY name keeps Save shut and the footer says "Name it to save."', async () => {
    mount({ settings: { indicators: {}, indicatorInstances: [] }, onChange: () => {} })
    await flush()
    writeMyself()
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'sma(close, 20)' } })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    const save = screen.getByTestId('sheet-save')
    expect(save).toHaveTextContent('Save and add')
    expect(save).toBeDisabled()
    expect(screen.getByTestId('save-hint')).toHaveTextContent('Name it to save.')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '20-bar average' } })
    await flush()
    expect(save).toBeEnabled()
    expect(screen.queryByTestId('save-hint')).toBeNull()
  })

  it('the read-back sits under the formula with a ✓, and the preview stays on the Formula tab', async () => {
    mount()
    await flush()
    writeMyself()
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'sma(close, 20)' } })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    const panel = screen.getByTestId('panel-formula')
    expect(within(panel).getByTestId('readback').textContent).toBeTruthy()
    expect(within(panel).getByText('Reads as:')).toBeInTheDocument()
    expect(within(panel).getByText('✓')).toBeInTheDocument()
  })

  it('only the CURRENT tab carries the current-tab class; switching moves it', async () => {
    mount()
    await flush()
    writeMyself()
    const on = () => screen.getAllByRole('tab').filter((t) => /tabOn/.test(t.className))
    expect(on()).toHaveLength(1)
    expect(on()[0]).toHaveTextContent('Formula')
    openTab(/^Inputs/)
    expect(on()).toHaveLength(1)
    expect(on()[0]).toHaveTextContent(/^Inputs/)
    expect(on()[0]).toHaveAttribute('aria-selected', 'true')
    // the inputs panel is the one on show, and the formula box is kept (hidden), not dropped
    expect(screen.getByTestId('panel-inputs')).not.toHaveAttribute('hidden')
    expect(screen.getByTestId('panel-formula')).toHaveAttribute('hidden')
  })

  it('⛔ gold is the current tab\'s underline and the ✦ mark, and nothing else in the stylesheet', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/builder/BuilderSheet.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const goldRules = css.split('}').filter((b) => /--ut-gold|--gold\b|#dcbb5e|#c9a84c/i.test(b))
      .map((b) => b.slice(0, b.indexOf('{')).trim())
    expect(goldRules.sort()).toEqual(['.spark', '.tabOn'])
    // the positive control: the scan does find a planted gold rule
    expect('.saveBtn { background: var(--ut-gold); }'.split('}').filter((b) => /--ut-gold/.test(b))).toHaveLength(1)
  })
})
