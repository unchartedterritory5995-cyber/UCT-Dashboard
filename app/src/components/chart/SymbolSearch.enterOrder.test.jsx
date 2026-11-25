// ⭐ (2026-11-23, the typed ticker) PIN: ENTER CHANGES THE SYMBOL IN THE KEY HANDLER, WITH THE DIALOG ALREADY OFF SCREEN,
// AND THE DIALOG'S REACT TEARDOWN RUNS AFTER THE CHARTS' FRAME (item 2, review of #2624 section 5; this pin was
// "onSymbolChange before the teardown, the dialog gone at the end of the event", rewritten on purpose). The board's
// same-task decision (hooks/handoffGroups) applies only to a setGroupSym called synchronously in the keydown. At that
// call the dialog is already hidden (display:none on the portal root, no dialog role): not in the accessibility tree,
// still in the document. It is still in the document when the event is over, and gone after the next frame.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { test, expect, vi, beforeEach } from 'vitest'
import SymbolSearch from './SymbolSearch'

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ symbols: [], results: [] }) }))
})
const afterFrame = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 5))) })
const inputEl = () => document.querySelector('input[aria-label="Search symbol or company"]')

test('Enter: onSymbolChange runs in the key handler with the dialog already off screen; the teardown waits for the frame', async () => {
  const seen = []
  const onSymbolChange = vi.fn((s) => {
    seen.push({ s, accessible: !!screen.queryByRole('dialog', { name: 'Symbol search' }), mounted: !!inputEl() })
  })
  render(<SymbolSearch sym="SPY" onSymbolChange={onSymbolChange} />)
  fireEvent.click(screen.getByRole('button', { name: /SPY/ }))
  const input = screen.getByRole('textbox', { name: 'Search symbol or company' })
  fireEvent.change(input, { target: { value: 'amd' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(seen).toEqual([{ s: 'AMD', accessible: false, mounted: true }])   // hidden BEFORE the symbol, not unmounted
  expect(screen.queryByRole('dialog', { name: 'Symbol search' })).toBeNull()
  expect(inputEl()).not.toBeNull()                                     // the React teardown has not run in the key task
  await afterFrame()
  expect(inputEl()).toBeNull()                                         // ...it runs after the frame
})
