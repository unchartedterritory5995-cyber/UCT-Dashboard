// RS screens (unit U5), item 2: the quick controls row as a component. Its state is the working
// spec it is handed; these tests move that spec and read the row.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { useState } from 'react'
import { vi, beforeEach, expect, test } from 'vitest'
import QuickControls from '../QuickControls'
import { controlsOf, applyOption } from '../rsScreens'
import { NEW_HIGHS, TOP_RATING, EXIT_WARNINGS } from './rsScreensFixture'

const keyed = spec => Object.fromEntries(spec.filters.map(({ key, ...rest }) => [key, rest]))
const onReset = vi.fn()
const chosen = vi.fn()
// A host that holds the working spec and edits it the way the page's editor does.
function Host({ starter, start = {} }) {
  const [w, setW] = useState({ filters: { ...keyed(starter.spec), ...(start.filters || {}) }, sort: start.sort || starter.spec.sort })
  const ed = {
    setFilter: (k, v) => setW(p => { const f = { ...p.filters }; if (v) f[k] = v; else delete f[k]; return { ...p, filters: f } }),
    setSort: v => setW(p => ({ ...p, sort: v })),
  }
  return <QuickControls controls={controlsOf(starter)} filters={w.filters} sort={w.sort}
    onChoose={(c, o) => { chosen(c.id, o.id); applyOption(ed, c, o) }}
    onReset={() => { onReset(); setW({ filters: keyed(starter.spec), sort: starter.spec.sort }) }} />
}
const row = () => screen.getByTestId('rs-controls')
const group = name => within(row()).getAllByRole('radiogroup', { name })[0]
const checked = g => within(g).getAllByRole('radio').filter(r => r.getAttribute('aria-checked') === 'true').map(r => r.textContent)

beforeEach(() => vi.clearAllMocks())

test('each control is a labelled radio group with its default option on, and nothing reads changed', () => {
  render(<Host starter={NEW_HIGHS} />)
  expect(within(row()).getAllByRole('radiogroup').map(g => g.getAttribute('aria-labelledby')).every(Boolean)).toBe(true)
  expect(checked(group('When'))).toEqual(['This week'])
  expect(checked(group('Min RS Rating'))).toEqual(['Any'])
  expect(checked(group('Market'))).toEqual(['Any day'])
  expect(screen.queryByTestId('rs-dot')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  expect(screen.queryByText('Custom')).toBeNull()
  // one option per group is in the tab order: the one that is on
  for (const g of within(row()).getAllByRole('radiogroup')) {
    expect(within(g).getAllByRole('radio').filter(r => r.tabIndex === 0).map(r => r.textContent)).toEqual(checked(g))
  }
})

test('choosing an option turns it on, marks that control with the gold dot, and offers one Reset', () => {
  render(<Host starter={NEW_HIGHS} />)
  fireEvent.click(within(group('When')).getByRole('radio', { name: 'This month' }))
  expect(chosen).toHaveBeenCalledWith('when', 'month')
  expect(checked(group(/^When/))).toEqual(['This month'])
  // the dot is on the changed control only, and said in words
  const when = row().querySelector('[data-control="when"]')
  expect(when).toHaveAttribute('data-changed')
  expect(within(when).getByTestId('rs-dot')).toBeInTheDocument()
  expect(within(row()).getAllByRole('radiogroup', { name: /^When\s*\(changed\)$/ })).toHaveLength(1)
  expect(row().querySelector('[data-control="min"]')).not.toHaveAttribute('data-changed')
  expect(within(row()).getAllByRole('button', { name: 'Reset' })).toHaveLength(1)
})

test('Reset restores every control and removes itself and the dots', () => {
  render(<Host starter={NEW_HIGHS} />)
  fireEvent.click(within(group('When')).getByRole('radio', { name: 'Today' }))
  fireEvent.click(within(group('Min RS Rating')).getByRole('radio', { name: '90' }))
  fireEvent.click(within(row()).getByRole('button', { name: 'Reset' }))
  expect(onReset).toHaveBeenCalledTimes(1)
  expect(checked(group('When'))).toEqual(['This week'])
  expect(checked(group('Min RS Rating'))).toEqual(['Any'])
  expect(screen.queryByTestId('rs-dot')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
})

test('clicking the option that is already on does nothing', () => {
  render(<Host starter={NEW_HIGHS} />)
  fireEvent.click(within(group('When')).getByRole('radio', { name: 'This week' }))
  expect(chosen).not.toHaveBeenCalled()
})

test('a spec no option matches reads Custom: shown as on, not selectable, and counted as changed', () => {
  render(<Host starter={NEW_HIGHS} start={{ filters: { rs_rank: { op: 'gte', min: 77 } } }} />)
  const g = group(/^Min RS Rating/)
  const custom = within(g).getByText('Custom')
  expect(custom).toHaveAttribute('aria-checked', 'true')
  expect(custom).toHaveAttribute('aria-disabled', 'true')
  expect(custom.tagName).toBe('SPAN')
  expect(checked(g)).toEqual(['Custom'])
  fireEvent.click(custom)
  expect(chosen).not.toHaveBeenCalled()
  expect(row().querySelector('[data-control="min"]')).toHaveAttribute('data-changed')
  expect(within(row()).getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  // while it reads Custom the first real option holds the tab stop
  expect(within(g).getAllByRole('radio').filter(r => r.tabIndex === 0).map(r => r.textContent)).toEqual(['Any'])
  // choosing a real option leaves Custom behind
  fireEvent.click(within(g).getByRole('radio', { name: '80' }))
  expect(screen.queryByText('Custom')).toBeNull()
})

test('a re-sort makes a control whose options carry a sort read Custom', () => {
  render(<Host starter={TOP_RATING} start={{ sort: { key: 'price', dir: 'desc' } }} />)
  expect(checked(group(/^Rank by/))).toEqual(['Custom'])
  expect(checked(group('Show'))).toEqual(['All'])
})

test('arrow keys move and choose inside a control, wrap at the ends, and Home and End jump', () => {
  render(<Host starter={NEW_HIGHS} />)
  const g = group('When')
  const opt = name => within(group(/^When/)).getByRole('radio', { name })
  opt('This week').focus()
  fireEvent.keyDown(opt('This week'), { key: 'ArrowRight' })
  expect(chosen).toHaveBeenLastCalledWith('when', 'month')
  expect(document.activeElement).toBe(opt('This month'))
  expect(checked(group(/^When/))).toEqual(['This month'])
  fireEvent.keyDown(opt('This month'), { key: 'ArrowRight' })      // wraps to the first
  expect(document.activeElement).toBe(opt('Today'))
  fireEvent.keyDown(opt('Today'), { key: 'ArrowLeft' })            // wraps to the last
  expect(document.activeElement).toBe(opt('This month'))
  fireEvent.keyDown(opt('This month'), { key: 'Home' })
  expect(document.activeElement).toBe(opt('Today'))
  fireEvent.keyDown(opt('Today'), { key: 'End' })
  expect(document.activeElement).toBe(opt('This month'))
  fireEvent.keyDown(opt('This month'), { key: 'ArrowUp' })
  expect(checked(group(/^When/))).toEqual(['This week'])
  expect(g).toBeInTheDocument()
})

test('an arrow key handled by a control does not reach the page', () => {
  const pageKey = vi.fn()
  render(<div onKeyDown={pageKey}><Host starter={NEW_HIGHS} /></div>)
  const el = within(group('When')).getByRole('radio', { name: 'This week' })
  fireEvent.keyDown(el, { key: 'ArrowDown' })
  expect(pageKey).not.toHaveBeenCalled()
  fireEvent.keyDown(el, { key: 'a' })          // a key the control does not use passes through
  expect(pageKey).toHaveBeenCalledTimes(1)
})

test('phone: Adjust opens the controls after the first in the bottom sheet, with the dot when anything is changed', () => {
  render(<Host starter={NEW_HIGHS} />)
  const adjust = within(row()).getByRole('button', { name: 'Adjust' })
  expect(within(adjust).queryByTestId('rs-dot')).toBeNull()
  fireEvent.click(adjust)
  const sheet = screen.getByTestId('rs-controls-sheet')
  expect(screen.getByRole('dialog', { name: 'Adjust this screen' })).toContainElement(sheet)
  // the first control stays in the row; the sheet holds the rest
  expect(within(sheet).getAllByRole('radiogroup').map(g => g.closest('[data-control]').getAttribute('data-control'))).toEqual(['min', 'down'])
  fireEvent.click(within(sheet).getByRole('radio', { name: 'Down days only' }))
  expect(chosen).toHaveBeenCalledWith('down', 'down')
  expect(within(sheet).getByRole('radio', { name: 'Down days only' })).toHaveAttribute('aria-checked', 'true')
  // (the page behind an open sheet is inert, so the button is read from the DOM, not by role)
  expect(within(row().querySelector('button[aria-haspopup="dialog"]')).getByTestId('rs-dot')).toBeInTheDocument()
  expect(row().querySelector('button[aria-haspopup="dialog"]')).toHaveTextContent(/^Adjust\s*\(changed\)$/)
  // Reset inside the sheet restores and closes it
  fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }))
  expect(onReset).toHaveBeenCalledTimes(1)
  expect(screen.queryByTestId('rs-controls-sheet')).toBeNull()
  expect(within(row()).getByRole('button', { name: 'Adjust' })).toBeInTheDocument()
})

test('phone: the dot on Adjust also shows for a change in the FIRST control', () => {
  render(<Host starter={NEW_HIGHS} />)
  fireEvent.click(within(group('When')).getByRole('radio', { name: 'Today' }))
  expect(within(screen.getByRole('button', { name: /^Adjust\s*\(changed\)$/ })).getByTestId('rs-dot')).toBeInTheDocument()
})

test('a screen with one control has no Adjust and no sheet; its Reset stays in the row on a phone', () => {
  render(<Host starter={EXIT_WARNINGS} />)
  expect(screen.queryByRole('button', { name: /Adjust/ })).toBeNull()
  fireEvent.click(within(group('Type')).getByRole('radio', { name: 'Quicksand' }))
  const reset = within(row()).getByRole('button', { name: 'Reset' })
  expect(reset.className).not.toMatch(/resetInRow/)
})

test('no controls, no row', () => {
  const { container } = render(<QuickControls controls={[]} filters={{}} sort={null} onChoose={() => {}} onReset={() => {}} />)
  expect(container.innerHTML).toBe('')
})

// jsdom applies no media queries, so which of the row and the sheet a phone shows is read from
// the stylesheet itself: the rules a 640 px screen runs.
test('the stylesheet: at 640 px the controls after the first and the in-row Reset hide, Adjust shows, targets are 44 px', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const css = readFileSync(path.join(here, '..', 'RsScreens.module.css'), 'utf8')
  const phone = css.slice(css.indexOf('@media (max-width: 640px)'))
  expect(css.slice(0, css.indexOf('@media (max-width: 640px)'))).toMatch(/\.adjust\s*\{\s*display:\s*none;?\s*\}/)
  expect(phone).toMatch(/\.rest,\s*\.resetInRow\s*\{\s*display:\s*none;?\s*\}/)
  expect(phone).toMatch(/\.adjust\s*\{[^}]*display:\s*inline-flex/)
  expect(phone).toMatch(/\.opt,[^{]*\.adjust[^{]*\{\s*min-height:\s*var\(--tap-min\)/)
  render(<Host starter={NEW_HIGHS} />)
  const classes = [...row().querySelectorAll(':scope > [data-control]')].map(el => el.className)
  expect(classes[0]).toMatch(/first/)
  expect(classes.slice(1).every(c => /rest/.test(c))).toBe(true)
  expect(within(row()).getByRole('button', { name: 'Adjust' }).className).toMatch(/adjust/)
})
