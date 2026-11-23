// ⭐ (2026-11-23, the typed ticker) PIN: ENTER CHANGES THE SYMBOL FIRST, IN THE KEY HANDLER. The board's same-task
// decision (hooks/handoffGroups) applies only to a setGroupSym called synchronously in the keydown; and the dialog's
// teardown is batched into that same event, never ahead of the symbol. So on Enter the host's onSymbolChange is called
// once, with the typed text, while the dialog is still in the document, and the dialog is gone when the event is over.
import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect, vi, beforeEach } from 'vitest'
import SymbolSearch from './SymbolSearch'

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ symbols: [], results: [] }) }))
})

test('Enter: onSymbolChange runs inside the key handler, before the dialog is torn down; the dialog is gone after the event', () => {
  const seen = []
  const onSymbolChange = vi.fn((s) => { seen.push({ s, dialog: !!screen.queryByRole('dialog', { name: 'Symbol search' }) }) })
  render(<SymbolSearch sym="SPY" onSymbolChange={onSymbolChange} />)
  fireEvent.click(screen.getByRole('button', { name: /SPY/ }))
  const input = screen.getByRole('textbox', { name: 'Search symbol or company' })
  fireEvent.change(input, { target: { value: 'amd' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(seen).toEqual([{ s: 'AMD', dialog: true }])
  expect(screen.queryByRole('dialog', { name: 'Symbol search' })).toBeNull()
})
