// P2 Track B Slice 1 — the door is DARK by default. ASKED / CLAIMED / DID.
import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ChartSettingsModal from '../../ChartSettingsModal'
import { AuthContext } from '../../../../context/AuthContext'
import { mergeChartSettings } from '../../chartDefaults'
import { setCreateIndicatorFlag, resolveCreateIndicatorFlag, CREATE_INDICATOR_FLAG_KEY } from './createIndicatorFlag'

function Host({ role = 'admin', ...props }) {
  const [cs, setCs] = useState(() => mergeChartSettings({}))
  return (
    <AuthContext.Provider value={{ user: { id: 1, role } }}>
      <ChartSettingsModal open settings={cs} onChange={setCs} onClose={() => {}} {...props} />
    </AuthContext.Provider>
  )
}
const openAdd = () => {
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  fireEvent.click(screen.getByTestId('add-enter'))
}

afterEach(() => { cleanup(); try { localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY) } catch { /* */ } })

// ⭐ UCT SIGNATURE R2 (owner Option 1, 2026-11-16): the Indicators window has ONE way to make an
// indicator — "✦ Create indicator" — and it opens the New formula window's START view (Describe it +
// the start cards) through `onCreateFormula`, for every account. ⚰️ "Describe one" (the separate
// Create Indicator door, flag-gated, "Soon" when off) and "+ New formula" are gone from this window.
describe('Create Indicator door', () => {
  const createBtn = () => screen.getByTestId('settings-create-indicator')
  const assertOneDoor = (formula, create) => {
    const btn = createBtn()
    expect(btn.textContent.replace(/\s+/g, ' ').trim()).toBe('✦Create indicator')
    expect(btn.className).toMatch(/addPrim/)          // the soft-bright primary
    expect(btn.getAttribute('data-guide')).toBe('indicators.create')
    expect(screen.queryByText(/Describe one/)).toBeNull()
    expect(screen.queryByText(/^New formula$/)).toBeNull()
    expect(screen.queryByTestId('settings-new-formula')).toBeNull()   // only under a search now
    fireEvent.click(btn)
    expect(formula).toHaveBeenCalledTimes(1)
    expect(formula.mock.calls[0]).toEqual([])          // the bare start view: nothing pre-filled
    expect(create).not.toHaveBeenCalled()
  }

  it('flag OFF (default): one "Create indicator" that opens the New formula start view', () => {
    expect(resolveCreateIndicatorFlag()).toBe(false)
    const formula = vi.fn(); const create = vi.fn()
    render(<Host onCreateFormula={formula} onCreateIndicator={create} />)
    openAdd()
    assertOneDoor(formula, create)
  })

  it('flag ON (admin): the same one button, still the New formula start view', () => {
    act(() => { setCreateIndicatorFlag(true) })
    const formula = vi.fn(); const create = vi.fn()
    render(<Host onCreateFormula={formula} onCreateIndicator={create} />)
    openAdd()
    assertOneDoor(formula, create)
  })

  it('a MEMBER account: the same one button', () => {
    act(() => { setCreateIndicatorFlag(true) })
    const formula = vi.fn(); const create = vi.fn()
    render(<Host role="user" onCreateFormula={formula} onCreateIndicator={create} />)
    openAdd()
    assertOneDoor(formula, create)
  })

  it('no builder door from the host: no button (absent prop ⇒ absent door)', () => {
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateIndicator={() => {}} />)
    openAdd()
    expect(screen.queryByTestId('settings-create-indicator')).toBeNull()
    expect(screen.queryByText(/Describe one/)).toBeNull()
  })
})

describe('persistence boundary rails (source-level)', () => {
  const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
  it('StockChart strips the preview at its one persist writer and lays it over csView only', () => {
    const s = src('../../../StockChart.jsx')
    expect(s).toMatch(/newSettings = stripPreview\(newSettings\)/)
    // ⭐ PHASE 4 — an EDIT's preview may stand in for its definition's own instances.
    expect(s).toMatch(/return withPreviewInstance\(view, studioPreview, studioPreviewReplaces\)/)
    // the toolbar is handed the STORED blob, never the view
    expect(s).toMatch(/chartSettings=\{cs\}\s+volumePaneFixed=\{volumePaneFixed\}\s+onUpdateSettings=\{handleUpdateChartSettings\}\s+[\s\S]{0,400}onStudioPreview=\{handleStudioPreview\}/)
  })
  it('⚰️ browser-found: StockChart forwards openCreateIndicator through its published toolbar API', () => {
    // Without it the Indicators button closed the modal and opened nothing.
    // ⭐ PHASE 4 — it forwards `{defId}` too (Modify with UCT Intelligence).
    expect(src('../../../StockChart.jsx')).toMatch(/openCreateIndicator: \(opts = null\) => \{\s*try \{ return toolbarRef\.current\?\.openCreateIndicator\?\.\(opts\)/)
  })
  it('⚰️ browser-found: the repaint no-op fingerprint sees definition installs and the preview', () => {
    // Without these, "make it 50" recomputed the column and the chart skipped setData.
    const s = src('../../../StockChart.jsx')
    expect(s).toMatch(/defsGen: userDefsGeneration,/)
    expect(s).toMatch(/preview: studioPreview \? studioPreview\.instanceId : null,/)
  })
  it('no product module imports the scripted model stub', () => {
    const files = ['CreateIndicatorPanel.jsx', 'useIndicatorConversation.js', 'chartPreview.js', '../../ChartToolbar.jsx']
    for (const f of files) expect(src(f)).not.toMatch(/scriptedConverse/)
  })
})
