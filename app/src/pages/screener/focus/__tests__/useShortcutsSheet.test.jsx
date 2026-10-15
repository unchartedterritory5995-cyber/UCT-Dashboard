import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
import { useShortcutsSheet, isShortcutsKey, FOCUS_SHORTCUTS } from '../useShortcutsSheet'
import HelpMenu from '../HelpMenu'

function Page({ outer }) {
  const s = useShortcutsSheet()
  return (
    <div onKeyDown={outer}>
      <div data-testid="layout" onKeyDown={s.onKeyDown}>
        <div role="listbox" aria-label="Screen results" tabIndex={0} />
        <input aria-label="Find" />
        <textarea aria-label="Note" />
        <div aria-label="Rich" contentEditable suppressContentEditableWarning />
        <div role="menu" aria-label="Open menu"><button type="button" role="menuitem">Item</button></div>
        <HelpMenu shortcuts={s} />
      </div>
      {s.sheet}
    </div>
  )
}

test('"?" in the layout opens the shortcuts sheet, listing every key the page handles', () => {
  render(<Page />)
  fireEvent.keyDown(screen.getByRole('listbox'), { key: '?' })
  const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
  const list = within(sheet).getByTestId('focus-shortcuts')
  for (const s of FOCUS_SHORTCUTS) expect(list).toHaveTextContent(s.does)
})

test('"?" while typing never opens it: input, textarea, contenteditable', () => {
  render(<Page />)
  fireEvent.keyDown(screen.getByLabelText('Find'), { key: '?' })
  fireEvent.keyDown(screen.getByLabelText('Note'), { key: '?' })
  fireEvent.keyDown(screen.getByLabelText('Rich'), { key: '?' })
  expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
})

test('not from inside an open menu or dialog, not with a modifier, not on auto-repeat', () => {
  render(<Page />)
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Item' }), { key: '?' })
  fireEvent.keyDown(screen.getByRole('listbox'), { key: '?', ctrlKey: true })
  fireEvent.keyDown(screen.getByRole('listbox'), { key: '?', metaKey: true })
  fireEvent.keyDown(screen.getByRole('listbox'), { key: '?', repeat: true })
  fireEvent.keyDown(screen.getByRole('listbox'), { key: '/' })
  expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
})

test('the layout takes precedence: the key does not reach a listener further out', () => {
  const outer = vi.fn()
  render(<Page outer={outer} />)
  fireEvent.keyDown(screen.getByRole('listbox'), { key: '?' })
  expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  expect(outer).not.toHaveBeenCalled()
  // any other key still bubbles as before
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'j' })
  expect(outer).toHaveBeenCalledTimes(1)
})

test('Help > Keyboard shortcuts opens the host sheet, and its "?" hint is true because the host binds the key', () => {
  render(<Page />)
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  const item = screen.getByRole('menuitem', { name: /Keyboard shortcuts/ })
  expect(item).toHaveTextContent('?')
  fireEvent.click(item)
  const sheets = screen.getAllByRole('dialog', { name: 'Keyboard shortcuts' })
  expect(sheets).toHaveLength(1)
  expect(within(sheets[0]).getByTestId('focus-shortcuts')).toHaveTextContent('Show this list')
})

test('Help with no host binding the key: the item opens a sheet (never the old toast), with no "?" anywhere', () => {
  const toast = vi.fn()
  render(<HelpMenu onMethodology={vi.fn()} onShortcuts={toast} />)
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  const item = screen.getByRole('menuitem', { name: /Keyboard shortcuts/ })
  expect(item).not.toHaveTextContent('?')
  fireEvent.click(item)
  expect(toast).not.toHaveBeenCalled()
  const list = within(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).getByTestId('focus-shortcuts')
  expect(list).toHaveTextContent('Open the filters')
  expect(list).not.toHaveTextContent('Show this list')
})

test('isShortcutsKey: the predicate, directly', () => {
  const ev = (o = {}) => ({ key: '?', target: document.createElement('div'), ...o })
  expect(isShortcutsKey(ev())).toBe(true)
  expect(isShortcutsKey(ev({ target: document.createElement('input') }))).toBe(false)
  expect(isShortcutsKey(ev({ target: document.createElement('select') }))).toBe(false)
  const box = document.createElement('div'); box.setAttribute('role', 'textbox')
  expect(isShortcutsKey(ev({ target: box }))).toBe(false)
  expect(isShortcutsKey(ev({ isComposing: true }))).toBe(false)
  expect(isShortcutsKey(ev({ altKey: true }))).toBe(false)
  expect(isShortcutsKey(ev({ key: 'h' }))).toBe(false)
})
