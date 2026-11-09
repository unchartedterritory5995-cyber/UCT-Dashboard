// app/src/components/chart/ChartSettingsIndicators.addFocus.test.jsx
//
// ─── AFTER AN ADD, KEYBOARD FOCUS LANDS ON THE NEW ROW (2026-11-08) ─────────
//
// ⚰️ MEASURED: Chart Settings → Indicators → "＋ Add to Chart", search, Enter on a
// result. The add worked and the Add surface closed (by design — the new row's
// Inspector takes the right column), but the focused result button left the DOM
// with the surface and focus fell to <body>.
//
// ⭐ Now focus goes to the new row's name button in the structure list (it is the
// selected row, so its Inspector is what the right column shows). At the narrow
// layout the list is not on screen, so it goes to the Inspector's first control.
//
// In jsdom a button's Enter is a click, so the add is driven by focusing the
// result's title button and clicking it — which is what Enter does in a browser.
import { useState } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { resultRows } from './__tests__/resultRows'

function Host({ initial, onSeen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal open settings={cs} onClose={() => {}}
      onChange={(next) => { onSeen(next); setCs(next) }} />
  )
}
function show() {
  const seen = { cs: null }
  render(<Host initial={mergeChartSettings(null)} onSeen={(next) => { seen.cs = next }} />)
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  return seen
}
/** Search the Add surface, focus the result's title button, and press it. */
function addByKeyboard(query, defId) {
  if (!document.body.querySelector('[data-testid="add-surface"]')) fireEvent.click(screen.getByTestId('add-enter'))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
  const row = resultRows().find((r) => r.dataset.defId === defId)
  expect(row, `the add surface does not list ${defId}`).toBeTruthy()
  const btn = row.querySelector('[data-result-primary="true"]')
  btn.focus()
  expect(document.activeElement).toBe(btn)
  fireEvent.click(btn)
}
const liveIds = (cs, defId) => ((cs && cs.indicatorInstances) || [])
  .filter((i) => i && i.defId === defId && !i.deleted).map((i) => i.instanceId)

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Chart Settings → Indicators: focus after an add', () => {
  it('lands on the NEW row in the structure list, never on <body>', () => {
    const seen = show()
    addByKeyboard('rsi', 'rsi')
    const [id] = liveIds(seen.cs, 'rsi')
    expect(id, 'RSI was not added').toBeTruthy()
    const active = document.activeElement
    expect(active, 'focus fell to <body> after the add').not.toBe(document.body)
    expect(active.getAttribute('data-row-primary'), 'focus is not on the new row').toBe(id)
    // …and that row is the selected one, so its Inspector is on screen
    expect(active.getAttribute('aria-current')).toBe('true')
    expect(document.body.querySelector(`[data-inspector-for="${id}"]`), 'the new row has no Inspector').toBeTruthy()
  })

  it('a second add moves focus to the second new row', () => {
    const seen = show()
    addByKeyboard('rsi', 'rsi')
    addByKeyboard('macd', 'macd')
    const [id] = liveIds(seen.cs, 'macd')
    expect(id).toBeTruthy()
    expect(document.activeElement.getAttribute('data-row-primary')).toBe(id)
  })

  it('CONTROL: focus the member put somewhere else is not taken', () => {
    const seen = show()
    const outside = document.createElement('button')
    outside.textContent = 'elsewhere'
    document.body.appendChild(outside)
    if (!document.body.querySelector('[data-testid="add-surface"]')) fireEvent.click(screen.getByTestId('add-enter'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'rsi' } })
    const row = resultRows().find((r) => r.dataset.defId === 'rsi')
    outside.focus()
    fireEvent.click(row)               // a pointer add while focus is outside the modal
    expect(liveIds(seen.cs, 'rsi')).toHaveLength(1)
    expect(document.activeElement, 'the add took focus from where the member had put it').toBe(outside)
    outside.remove()
  })

  it('at the narrow layout focus goes to the new row\'s Inspector (the list is not on screen)', () => {
    const real = window.matchMedia
    vi.stubGlobal('matchMedia', (q) => ({
      matches: q === '(max-width: 620px)', media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false },
    }))
    try {
      const seen = show()
      addByKeyboard('rsi', 'rsi')
      const [id] = liveIds(seen.cs, 'rsi')
      expect(id).toBeTruthy()
      const panel = document.body.querySelector(`[data-inspector-for="${id}"]`)
      expect(panel, 'the narrow view did not switch to the Inspector').toBeTruthy()
      expect(document.activeElement, 'focus fell to <body> at the narrow layout').not.toBe(document.body)
      expect(panel.contains(document.activeElement), 'focus is not inside the new row\'s Inspector').toBe(true)
    } finally {
      window.matchMedia = real
    }
  })
})
