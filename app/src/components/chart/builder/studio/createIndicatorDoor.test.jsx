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

describe('Create Indicator door', () => {
  it('flag OFF (default): members see exactly the old "+ New Formula", no Create Indicator', () => {
    expect(resolveCreateIndicatorFlag()).toBe(false)
    render(<Host onCreateFormula={() => {}} onCreateIndicator={() => {}} />)
    openAdd()
    expect(screen.queryByTestId('settings-create-indicator')).toBeNull()
    expect(screen.getByTestId('settings-new-formula').textContent.replace(/\s+/g, ' ').trim()).toBe('＋New Formula')
  })

  it('flag ON: "+ Create Indicator" replaces New Formula in the same slot and calls its door', () => {
    const open = vi.fn()
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateFormula={() => {}} onCreateIndicator={open} />)
    openAdd()
    const btn = screen.getByTestId('settings-create-indicator')
    expect(btn.className).toMatch(/insNewFormula/)          // the same visual object
    expect(screen.queryByTestId('settings-new-formula')).toBeNull()
    fireEvent.click(btn)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('flag ON but a MEMBER account (server role): still exactly the old "+ New Formula"', () => {
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host role="user" onCreateFormula={() => {}} onCreateIndicator={() => {}} />)
    openAdd()
    expect(screen.queryByTestId('settings-create-indicator')).toBeNull()
    expect(screen.getByTestId('settings-new-formula')).toBeTruthy()
  })

  it('flag ON but no door from the host: no button (absent prop ⇒ absent door)', () => {
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateFormula={() => {}} />)
    openAdd()
    expect(screen.queryByTestId('settings-create-indicator')).toBeNull()
    expect(screen.getByTestId('settings-new-formula')).toBeTruthy()
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
