// ContextPopover's UCT Signature opt-in (docs/uct-signature-style.md §2b): group labels,
// a dimmed `detail`, an always-gold `goldIcon`, and, with the `signature` prop, gold hover
// icons and a gold check for a boolean `checked` (role="menuitemcheckbox" + aria-checked).
// The other surfaces pass none of these, so the control below pins that a plain caller's
// markup is unchanged.
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, expect, test, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import axe from 'axe-core'
import ContextPopover from './ContextPopover'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(path.join(HERE, 'ContextPopover.module.css'), 'utf-8')

afterEach(() => cleanup())

const ITEMS = (onValue = () => {}) => [
  { groupLabel: 'This line' },
  { key: 'hidden', label: 'Hide', icon: <i>e</i>, onClick: () => {} },
  { key: 'move', label: 'Display in', icon: <i>m</i>, detail: 'Own pane', keepOpen: true, onClick: () => {} },
  { groupLabel: 'Settings' },
  { key: 'info-value', label: 'Value in header', icon: <i>v</i>, checked: true, onClick: onValue },
  { key: 'modify', label: 'Modify with the UCT Agent', icon: <i data-testid="spark">s</i>, goldIcon: true, onClick: () => {} },
  { separator: true },
  { key: 'remove', label: 'Delete', icon: <i>t</i>, danger: true, onClick: () => {} },
]

test('group labels render as plain generic divs (no role), non-focusable, and never as menu items', () => {
  render(<ContextPopover open signature onClose={() => {}} anchor={{ x: 0, y: 0 }} items={ITEMS()} />)
  const label = screen.getByText('This line')
  expect(label.hasAttribute('role')).toBe(false)   // generic: what role="presentation" on a div amounts to
  expect(label.hasAttribute('tabindex')).toBe(false)
  expect(label.tagName).toBe('DIV')
  const menu = screen.getByRole('menu')
  const names = [...menu.querySelectorAll('[role^="menuitem"]')].map((n) => n.textContent)
  expect(names.some((t) => t === 'This line' || t === 'Settings')).toBe(false)
  expect(names.length).toBe(5)
})

test('a checked row is a menuitemcheckbox with aria-checked and a check; its key and click are unchanged', () => {
  const onValue = vi.fn()
  const onClose = vi.fn()
  render(<ContextPopover open signature onClose={onClose} anchor={{ x: 0, y: 0 }} items={ITEMS(onValue)} />)
  const row = screen.getByRole('menuitemcheckbox', { name: /Value in header/ })
  expect(row.getAttribute('aria-checked')).toBe('true')
  expect(row.getAttribute('data-menu-id')).toBe('info-value')
  // the ✓ glyph is the CALLER's (StockChart chipMenuSigRow draws it in `label`): Notebook first-open bytes
  fireEvent.click(row)
  expect(onValue).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('an unchecked boolean row says aria-checked="false" and shows no check', () => {
  const items = [{ key: 'v', label: 'Value in header', checked: false, onClick: () => {} }]
  render(<ContextPopover open signature onClose={() => {}} anchor={{ x: 0, y: 0 }} items={items} />)
  const row = screen.getByRole('menuitemcheckbox', { name: 'Value in header' })
  expect(row.getAttribute('aria-checked')).toBe('false')
  expect(row.querySelector('[class*="check"]')).toBeNull()
})

test("detail is the caller's to draw (in label): the popover renders icon + label only", () => {
  render(<ContextPopover open signature onClose={() => {}} anchor={{ x: 0, y: 0 }} items={ITEMS()} />)
  const row = screen.getByRole('menuitem', { name: /Display in/ })
  expect(row.textContent).toBe('mDisplay in')
})

test("the signature class is on the menu (a gold ✦ is the caller's own icon node)", () => {
  render(<ContextPopover open signature onClose={() => {}} anchor={{ x: 0, y: 0 }} items={ITEMS()} />)
  expect(screen.getByRole('menu').className).toMatch(/signature/)
})

test('arrow keys skip the group labels', () => {
  render(<ContextPopover open signature onClose={() => {}} anchor={{ x: 0, y: 0 }} items={ITEMS()} />)
  const hide = screen.getByRole('menuitem', { name: /Hide/ })
  hide.focus()
  fireEvent.keyDown(hide, { key: 'ArrowDown' })
  expect(document.activeElement.textContent).toMatch(/Display in/)
  fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
  expect(document.activeElement.getAttribute('data-menu-id')).toBe('info-value')
})

test('axe: a signature menu with labels and a checkbox row has no required-children / role violations', async () => {
  render(<main><ContextPopover open signature onClose={() => {}} anchor={{ x: 0, y: 0 }} title="RSI" items={ITEMS()} /></main>)
  const res = await axe.run(document.body, {
    runOnly: { type: 'rule', values: ['aria-required-children', 'aria-required-parent', 'aria-allowed-role', 'nested-interactive'] },
    resultTypes: ['violations'],
  })
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
})

test('the control: without `signature`, `checked` is ignored, so a plain caller is unchanged', () => {
  const items = [{ key: 'a', label: 'Alpha', checked: true, onClick: () => {} }, { label: 'Beta' }]
  render(<ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }} items={items} />)
  const a = screen.getByRole('menuitem', { name: 'Alpha' })
  expect(a.hasAttribute('aria-checked')).toBe(false)
  expect(a.querySelector('[class*="check"]')).toBeNull()
  expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
  expect(screen.getByRole('menu').className).not.toMatch(/signature/)
  // a plain row is still exactly icon? + label
  expect(a.children.length).toBe(1)
})

test('CSS: gold is flat var(--ut-gold), hover-only on the desktop menu, never on Delete; labels are not uppercased', () => {
  expect(CSS).toMatch(/\.menu\.signature \.item:not\(\.danger\):hover:not\(:disabled\) \.icon/)
  expect(CSS).toMatch(/:focus-visible \.icon \{ color: var\(--ut-gold\); \}/)   // hover/focus only; the ✦ is the caller's own gold node
  // owner 11-16: a checked row's ✓ is WHITE with a bold label (spec "Floating menu" — a ticked toggle, not gold)
  // the white ✓ is StockChart's `.sigCheck` now (the caller draws it; Notebook first-open bytes)
  expect(CSS).toMatch(/\.signature \.item\[aria-checked="true"\] \.label[^{]*\{ font-weight: 600; \}/)
  // the desktop panel is the chart right-click menu's (`.chartCtxMenu`): #111214, 1px #383b41, radius 10, padding 5
  expect(CSS).toMatch(/\.menu\.signature:not\(:has\(\[data-legend-head="readout"\]\)\) \{[^}]*background: #111214; border: 1px solid #383b41; border-radius: 10px; padding: 5px/)
  const label = CSS.match(/\.groupLabel \{[^}]*\}/)[0]
  expect(label).toMatch(/text-transform: none/)
  expect(label).not.toMatch(/uppercase/)
  expect(CSS).not.toMatch(/gradient\([^)]*ut-gold/)
})
