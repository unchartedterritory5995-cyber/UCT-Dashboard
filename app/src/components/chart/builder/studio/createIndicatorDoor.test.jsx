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
    expect(screen.getByTestId('settings-new-formula').textContent.replace(/\s+/g, ' ').trim()).toBe('New formula')   // UCT Signature soft pill
  })

  it('flag ON: "Describe one" (Create Indicator) sits beside New formula and calls its door', () => {
    const open = vi.fn()
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateFormula={() => {}} onCreateIndicator={open} />)
    openAdd()
    // ⭐ DESCRIBE FIRST (owner pick 2026-11-15): the plain-words box stands where the "Describe one"
    // pill stood. Its send button is the same door; with nothing typed it opens the studio blank.
    const btn = screen.getByTestId('settings-create-indicator')
    expect(screen.getByTestId('describe-input')).toBeTruthy()
    expect(screen.getByTestId('settings-new-formula')).toBeTruthy()
    fireEvent.click(btn)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenLastCalledWith()
  })

  it('what is typed is handed to the door as a prefilled request, trimmed; the box clears', () => {
    const open = vi.fn()
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateFormula={() => {}} onCreateIndicator={open} />)
    openAdd()
    const box = screen.getByTestId('describe-input')
    fireEvent.change(box, { target: { value: '  colour the 21 EMA green while it rises  ' } })
    fireEvent.submit(box.closest('form'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenLastCalledWith({ seed: 'colour the 21 EMA green while it rises' })
    expect(screen.getByTestId('describe-input').value).toBe('')
  })

  it('an example is one press: it hands its own words to the door', () => {
    const open = vi.fn()
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateFormula={() => {}} onCreateIndicator={open} />)
    openAdd()
    const examples = screen.getAllByTestId('describe-example')
    expect(examples).toHaveLength(3)
    fireEvent.click(examples[1])
    expect(open).toHaveBeenLastCalledWith({ seed: examples[1].textContent })
  })

  it('the other ways to start one are named in member words and open their own doors', () => {
    const door = vi.fn(); const formula = vi.fn()
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateFormula={formula} onCreateIndicator={() => {}} onOpenBuilderDoor={door} />)
    openAdd()
    expect(screen.getByTestId('describe-alt').textContent.replace(/\s+/g, ' ').trim())
      .toBe('Or paste a TradingView script, start from a picture, or write a formula.')
    fireEvent.click(screen.getByTestId('door-pine')); expect(door).toHaveBeenLastCalledWith('pine')
    fireEvent.click(screen.getByTestId('door-image')); expect(door).toHaveBeenLastCalledWith('image')
    fireEvent.click(screen.getByTestId('settings-new-formula')); expect(formula).toHaveBeenCalledTimes(1)
    expect(door).toHaveBeenCalledTimes(2)       // the formula entry is its OWN door, not a third builder door
  })

  it('without access the box is absent, and the other ways to start one are still offered', () => {
    const door = vi.fn()
    render(<Host onCreateFormula={() => {}} onCreateIndicator={() => {}} onOpenBuilderDoor={door} />)
    openAdd()
    expect(screen.queryByTestId('describe-block')).toBeNull()
    expect(screen.getByTestId('describe-alt').textContent.replace(/\s+/g, ' ').trim())
      .toBe('Start one: paste a TradingView script, start from a picture, or write a formula.')
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
