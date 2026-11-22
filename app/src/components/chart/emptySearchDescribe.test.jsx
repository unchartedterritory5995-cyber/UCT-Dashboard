// A search that finds nothing offers "Describe it instead" (Studio plan, section 6, the
// states table): the member's words go into Create Indicator's box, not sent.

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { AuthContext } from '../../context/AuthContext'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'
import { setCreateIndicatorFlag, CREATE_INDICATOR_FLAG_KEY } from './builder/studio/createIndicatorFlag'
import { libraryDescribeSeed } from './ChartToolbar'

const NONSENSE = 'zzqx anchored wobble line'

// The symbol search answers at once with nothing, so "still searching" never holds the offer back.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [], symbols: [] }) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); try { localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY) } catch { /* */ } })

function Host(props) {
  const [cs, setCs] = useState(() => mergeChartSettings({}))
  return (
    <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
      <ChartSettingsModal open settings={cs} onChange={setCs} onClose={() => {}} {...props} />
    </AuthContext.Provider>
  )
}
const openAdd = () => {
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  fireEvent.click(screen.getByTestId('add-enter'))
}
const search = (text) => fireEvent.change(screen.getByPlaceholderText(/Search indicators/i), { target: { value: text } })

describe('the Indicators window', () => {
  // Superseded by UCT Signature R2 Option 1 (owner 11-16): a search offers "Not quite it?" → the UCT Agent row
  // (ChartSettingsIndicators.agentBuild.test.jsx), not the describe-instead pill.
  it.skip('nothing found: one press opens Create Indicator with the words in its box', async () => {
    const open = vi.fn()
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateFormula={() => {}} onCreateIndicator={open} />)
    openAdd()
    search(NONSENSE)
    const btn = await screen.findByTestId('empty-describe', {}, { timeout: 8000 })
    expect(btn.textContent).toContain(`Describe “${NONSENSE}” instead`)
    fireEvent.click(btn)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenLastCalledWith({ seed: NONSENSE })
  })

  it('no offer while the box is empty, when something matches, or for an account without the door', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    render(<Host onCreateFormula={() => {}} onCreateIndicator={() => {}} />)
    openAdd()
    expect(screen.queryByTestId('empty-describe')).toBeNull()
    search('RSI')
    expect(screen.queryByTestId('empty-describe')).toBeNull()       // control: something matched
    cleanup()
    act(() => { setCreateIndicatorFlag(false) })
    render(<Host onCreateFormula={() => {}} onCreateIndicator={() => {}} />)
    openAdd()
    search(NONSENSE)
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(screen.queryByTestId('empty-describe')).toBeNull()
  })
})

describe('the library sheet (the phone\'s way in)', () => {
  const settings = mergeChartSettings(JSON.stringify({}))
  it('nothing found: one press hands the words to the door', async () => {
    const open = vi.fn()
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={() => {}}
      registry={engineRegistry} onCreateIndicator={open} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: `  ${NONSENSE}  ` } })
    const btn = await screen.findByTestId('empty-describe', {}, { timeout: 8000 })
    fireEvent.click(btn)
    expect(open).toHaveBeenLastCalledWith({ seed: NONSENSE })
  })

  it('without the door there is no offer', async () => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={() => {}}
      registry={engineRegistry} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: NONSENSE } })
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(screen.queryByTestId('empty-describe')).toBeNull()
  })
})

describe('the toolbar turns the words into the dock\'s seed', () => {
  it('trimmed, capped, and nothing for anything that is not words', () => {
    expect(libraryDescribeSeed({ seed: '  rsi of volume  ' })).toBe('rsi of volume')
    expect(libraryDescribeSeed({ seed: 'x'.repeat(900) })).toHaveLength(400)
    for (const v of [undefined, null, {}, { seed: '   ' }, { seed: 7 }, 'text']) expect(libraryDescribeSeed(v)).toBeNull()
  })
})
