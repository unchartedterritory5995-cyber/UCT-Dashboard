// P0.11: the notes list's seven view buttons are icon-only, which on a phone says nothing. A
// labelled View select sits beside them (CSS shows one or the other by width) and drives the
// SAME viewMode state, under the same saved-view lock.
//
// ⛔ jsdom applies no layout, so this pins the DOM contract (a labelled combobox with every
// mode, wired to the same state) and the stylesheet rule that swaps them separately.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { parseRules, declarations } from '../a11y/cssAudit'
import NotebookTab from './NotebookTab'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function renderTab(route) {
  installFetch([])
  render(<Providers auth={AUTH} route={route}><NotebookTab /></Providers>)
  await settle()
}

describe('the list toolbar View select', () => {
  it('is a labelled combobox with every mode', async () => {
    await renderTab('/journal/notebook?view=all')
    const sel = screen.getByRole('combobox', { name: 'View' })
    expect([...sel.options].map((o) => o.textContent)).toEqual(['List', 'Table', 'Board', 'Calendar', 'Graph', 'Timeline', 'Tasks'])
  })

  it('changing it switches the view the buttons show as pressed', async () => {
    await renderTab('/journal/notebook?view=all')
    const sel = screen.getByRole('combobox', { name: 'View' })
    expect(sel.value).toBe('list')
    fireEvent.change(sel, { target: { value: 'board' } })
    expect(screen.getByRole('button', { name: 'Board view' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'View' }).value).toBe('board')
  })

  it('a button press moves the select too (one state, two doors)', async () => {
    await renderTab('/journal/notebook?view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(screen.getByRole('combobox', { name: 'View' }).value).toBe('table')
  })
})

describe('the stylesheet swaps the two doors by width', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs', 'NotebookTab.module.css'), 'utf8')
  const decl = (selector) => {
    const rule = parseRules(css).find((r) => r.selector === selector)
    return rule ? Object.fromEntries(declarations(rule).map((d) => [d.prop, d.value])) : null
  }

  it('the select is hidden by default (desktop keeps the icon buttons)', () => {
    expect(decl('.viewSelectWrap')?.display).toBe('none')
  })

  it('the phone block shows the select and hides the icon group', () => {
    const phoneBlock = css.slice(css.indexOf('@media (max-width: 640px)'))
    expect(phoneBlock).toMatch(/\.viewSelectWrap\s*\{[^}]*display:\s*inline-flex/)
    expect(phoneBlock).toMatch(/\.viewModeGroup\s*\{[^}]*display:\s*none/)
  })

  it('the select is a finger target on touch', () => {
    expect(css).toMatch(/@media \(max-width: 1024px\)\s*\{[^}]*\.viewSelect\b[^}]*min-height:\s*var\(--tap-min/s)
  })
})
