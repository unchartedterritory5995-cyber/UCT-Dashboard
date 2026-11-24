// ⭐ (2026-11-23, item 2, review of #2624 section 5) THE GAP BETWEEN ENTER AND THE DEFERRED TEARDOWN. Enter hides the
// dialog in the key task and unmounts it after the charts' frame. In between, every reader must already read it closed,
// and a member acting at once must not lose anything:
//   readers   utils/modalOpen.isModalOpen (the pane's type-to-search, the chart shortcuts) and lib/topLayer (the
//             page-level shortcuts) find no dialog; the accessibility tree has none; and it is off screen
//   a letter  typed on the chart in the gap (the pane's openWith) starts a FRESH search, even after the chart switch has
//             re-rendered the search, and the dialog shows again, focused, and stays open past the frame
//   the badge clicked in the gap OPENS the search (it does not close the hidden one)
//   an effect the notebook embed's door calls openWith from a passive effect, where React will not flushSync; in the
//             gap that must show the dialog too
//   Escape    pressed in the gap is not swallowed by the hidden dialog's listener
//   unmount   in the gap cancels the pending teardown quietly
import { createRef, useEffect } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { test, expect, vi, beforeEach } from 'vitest'
import SymbolSearch from './SymbolSearch'
import { isModalOpen } from '../../utils/modalOpen'
import { openLayers } from '../../lib/topLayer'

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ symbols: [], results: [] }) }))
})
const afterFrame = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 5))) })
const dialog = () => screen.queryByRole('dialog', { name: 'Symbol search' })
const input = () => screen.getByRole('textbox', { name: 'Search symbol or company' })

/** Open the search on the chart showing SPY, type `text`, press Enter: the gap begins. */
function enterOn(text, props = {}) {
  const ref = createRef()
  const onSymbolChange = vi.fn()
  const view = render(<SymbolSearch ref={ref} sym="SPY" onSymbolChange={onSymbolChange} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /SPY/ }))
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.keyDown(input(), { key: 'Enter' })
  return { ref, onSymbolChange, view }
}

test('every reader reads it closed from the Enter task on: isModalOpen, topLayer, the accessibility tree', () => {
  enterOn('amd')
  expect(dialog()).toBeNull()
  expect(isModalOpen()).toBe(false)
  expect([...openLayers()]).toEqual([])
  expect(screen.getByText('Symbol search')).not.toBeVisible()        // still mounted, and off screen
})

test('a letter typed on the chart in the gap starts a FRESH search (after the switch re-rendered it), shown and focused, and it stays open', async () => {
  const { ref, onSymbolChange, view } = enterOn('amd')
  expect(onSymbolChange).toHaveBeenCalledWith('AMD')
  view.rerender(<SymbolSearch ref={ref} sym="AMD" onSymbolChange={onSymbolChange} />)   // the chart switched
  act(() => { ref.current.openWith('T') })
  expect(dialog()).not.toBeNull()
  expect(input().value).toBe('T')                                    // not 'AMDT': a new search
  expect(document.activeElement).toBe(input())
  expect(isModalOpen()).toBe(true)
  await afterFrame()
  expect(dialog()).not.toBeNull()                                    // the pending teardown was cancelled
  expect(input().value).toBe('T')
})

test('the badge clicked in the gap opens the search (it does not close the hidden one), and it stays open', async () => {
  enterOn('amd')
  fireEvent.click(screen.getByRole('button', { name: /SPY/ }))
  expect(dialog()).not.toBeNull()
  await afterFrame()
  expect(dialog()).not.toBeNull()
})

test('a reopen from inside an effect (the notebook embed door) in the gap shows the dialog, focused, and it stays open', async () => {
  const ref = createRef()
  const onSymbolChange = vi.fn()
  function Opener() { useEffect(() => { ref.current.openWith('T') }, []); return null }
  const Host = ({ reopen }) => <><SymbolSearch ref={ref} sym="SPY" onSymbolChange={onSymbolChange} />{reopen && <Opener />}</>
  const view = render(<Host reopen={false} />)
  fireEvent.click(screen.getByRole('button', { name: /SPY/ }))
  fireEvent.change(input(), { target: { value: 'amd' } })
  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(dialog()).toBeNull()
  view.rerender(<Host reopen />)
  expect(dialog()).not.toBeNull()
  expect(input().value).toBe('T')
  expect(document.activeElement).toBe(input())
  await afterFrame()
  expect(dialog()).not.toBeNull()
})

test('Escape pressed in the gap reaches the page: the hidden dialog does not swallow it', () => {
  enterOn('amd')
  const page = vi.fn()
  document.addEventListener('keydown', page)
  try {
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(page).toHaveBeenCalledTimes(1)
  } finally { document.removeEventListener('keydown', page) }
})

test('unmounting in the gap cancels the pending teardown quietly', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { view } = enterOn('amd')
  view.unmount()
  await afterFrame()
  expect(err).not.toHaveBeenCalled()
  err.mockRestore()
})
