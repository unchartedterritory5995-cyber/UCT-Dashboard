import { render, screen, fireEvent } from '@testing-library/react'
import { vi, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ContextPopover from './ContextPopover'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(path.join(HERE, 'ContextPopover.module.css'), 'utf-8')

// Desktop (matchMedia matches:false) → anchored menu path.

test('renders items and title (desktop anchored menu)', () => {
  render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 10, y: 10 }} title="AAPL"
      items={[{ label: 'Flag' }, { label: 'Remove', danger: true }]} />,
  )
  expect(screen.getByText('AAPL')).toBeInTheDocument()
  expect(screen.getByText('Flag')).toBeInTheDocument()
  expect(screen.getByText('Remove')).toBeInTheDocument()
})

test('clicking an item fires its onClick and then onClose', () => {
  const onClose = vi.fn()
  const onClick = vi.fn()
  render(
    <ContextPopover open onClose={onClose} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag', onClick }]} />,
  )
  fireEvent.click(screen.getByText('Flag'))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('keepOpen item does not auto-close', () => {
  const onClose = vi.fn()
  render(
    <ContextPopover open onClose={onClose} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Tag', onClick: () => {}, keepOpen: true }]} />,
  )
  fireEvent.click(screen.getByText('Tag'))
  expect(onClose).not.toHaveBeenCalled()
})

test('renders nothing when closed', () => {
  render(<ContextPopover open={false} onClose={() => {}} items={[{ label: 'Flag' }]} />)
  expect(screen.queryByText('Flag')).toBeNull()
})


// ─── keyboard containment on the DESKTOP anchored menu ──────────────────────
//
// The touch branch is a `Sheet`, which traps, focuses and restores. This is the
// other branch: a `role="menu"` portalled to <body> that had NO focus
// management, so focus stayed on the trigger, Tab walked the page behind an
// open menu, and a screen-reader user was never taken to the menu at all.

test('opening moves focus INTO the menu', () => {
  render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag' }, { label: 'Remove' }]} />,
  )
  expect(document.activeElement).toBe(screen.getByText('Flag').closest('button'))
})

test('Tab from the last item wraps to the first, and Shift+Tab back', () => {
  render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag' }, { label: 'Remove' }]} />,
  )
  const first = screen.getByText('Flag').closest('button')
  const last = screen.getByText('Remove').closest('button')

  last.focus()
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(first)

  first.focus()
  fireEvent.keyDown(document, { key: 'Shift+Tab', shiftKey: true })
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last)
})

test('closing restores focus to whatever had it before', () => {
  const trigger = document.createElement('button')
  trigger.textContent = 'open me'
  document.body.appendChild(trigger)
  trigger.focus()
  expect(document.activeElement).toBe(trigger)

  const { rerender } = render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag' }]} />,
  )
  expect(document.activeElement).not.toBe(trigger)

  rerender(
    <ContextPopover open={false} onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag' }]} />,
  )
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})


// ─── TRACK B · A DENSE DESKTOP MENU, AND ONLY A DESKTOP ONE ──────────────
//
// The on-chart popover floats over a live chart, where a settings-card-sized menu
// covers the candles the member is reading. `dense` compacts the ANCHORED branch.
//
// ⛔⛔ AND IT MUST NOT REACH THE TOUCH BRANCH. There the component renders a
// `Sheet` whose rows are pinned to the 44px tap-target floor; a class that shrank
// those would make the menu unusable with a thumb.

test('⭐ `dense` marks the desktop menu, and is off by default', () => {
  const { container, unmount } = render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }} dense
      items={[{ label: 'Delete' }]} />)
  const menu = document.body.querySelector('[role="menu"]')
  expect(menu.className, 'the dense class never reached the menu').toMatch(/menuDense/)
  unmount()
  render(<ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}
    items={[{ label: 'Delete' }]} />)
  expect(document.body.querySelector('[role="menu"]').className,
    'every caller got the dense menu — the drawing and region menus too')
    .not.toMatch(/menuDense/)
  expect(container).toBeTruthy()
})

test('⛔ the dense rules are scoped to `.menu`, never to the touch sheet', () => {
  // A CSS-ARTIFACT ASSERTION, and it has to be: jsdom lays nothing out, and the
  // touch branch is chosen by `matchMedia` at mount. What can be read honestly is
  // whether any dense rule names the sheet.
  const dense = CSS.split(String.fromCharCode(10)).filter((l) => l.includes('.menuDense'))
  expect(dense.length, 'no dense rules at all — the case below is vacuous')
    .toBeGreaterThan(3)
  for (const rule of dense) {
    expect(rule, `a dense rule reaches the touch sheet: ${rule}`).not.toMatch(/sheetList/)
  }
  // …and the 44px floor is still declared for the sheet.
  expect(CSS.replace(/\s+/g, ''), 'the touch sheet lost its tap-target floor')
    .toMatch(/\.sheetList\.item\{[^}]*min-height:var\(--tap-min/)
})

test('⛔ a header renders above the rows, inert, in both branches', () => {
  render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }} dense
      header={<div data-testid="hdr">RSI(14)</div>} items={[{ label: 'Delete' }]} />)
  const menu = document.body.querySelector('[role="menu"]')
  expect(menu.querySelector('[data-testid="hdr"]'), 'the header never rendered').toBeTruthy()
  // ⛔ NOT A ROW. `renderItems` emits buttons and the focus trap walks them; a
  // header rendered as one would be a tab stop that does nothing.
  expect(menu.querySelectorAll('button')).toHaveLength(1)
})
