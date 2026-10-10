// Finish program, lane KEYS3 round 3 (the final browser walk's finding F1).
//
// "Skip to folder navigation" went nowhere. Its address was "#notebook-folder-nav" and nothing
// in the page carried that id; its handler put focus on a hidden heading above the panel's own
// header buttons, and with the folders panel HIDDEN it put focus on a heading that was off
// screen. A skip link must always land on something the member can see and use.
//
// Now: the link lands on the folder tree's own Tab stop (the folder navigation itself). With the
// panel hidden it shows the panel first, then lands. With the panel in search mode (no tree on
// screen) it lands on the panel's heading, which carries the id the link names.
//
// The REAL Notebook tab and the REAL folder panel are mounted. Each of the Notebook's skip
// links is pressed and `document.activeElement` is read. ("Skip to main content" belongs to the
// app shell, `Layout.jsx`, and has its own rail there.) jsdom applies no stylesheet, so the
// widths differ here only by what the code decides; the browser run in fin-clicks.md section
// 16 is the check at 1280, 820 and 390 px.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers } from './fixtures'
import NotebookTab from '../tabs/NotebookTab'

const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const SIDEBAR_KEY = 'uct.j2.nb.sidebarOpen'

async function renderTab(route = '/journal/notebook?folder=f1') {
  render(<Providers route={route}><NotebookTab /></Providers>)
  await screen.findAllByText('Theses')
  await settle()
}
const link = (name) => screen.getByRole('link', { name })
const tree = () => document.querySelector('[role="tree"][aria-label="Folders"]')
const press = async (el) => { el.focus(); fireEvent.click(el); await settle(80) }

beforeEach(() => { installFetch(); latchWave8Flags(true); localStorage.removeItem(SIDEBAR_KEY) })
afterEach(() => { localStorage.removeItem(SIDEBAR_KEY) })

describe('the Notebook\'s skip links always land (walk finding F1)', () => {
  it('the address the folder link names exists in the page', async () => {
    await renderTab()
    const href = link('Skip to folder navigation').getAttribute('href')
    expect(href).toBe('#notebook-folder-nav')
    expect(document.getElementById('notebook-folder-nav')).not.toBeNull()
  })

  it('panel shown: "Skip to folder navigation" lands on the folder tree\'s own Tab stop', async () => {
    await renderTab()
    await press(link('Skip to folder navigation'))
    const at = document.activeElement
    expect(at.getAttribute('role')).toBe('treeitem')
    expect(tree().contains(at)).toBe(true)
    expect(at.getAttribute('tabindex')).toBe('0')
  })

  it('panel HIDDEN: the link shows the panel, then lands on the tree', async () => {
    localStorage.setItem(SIDEBAR_KEY, '0')
    await renderTab()
    expect(screen.getByRole('button', { name: 'Show folders panel' })).toBeTruthy()     // it is hidden
    await press(link('Skip to folder navigation'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show folders panel' })).toBeNull())
    await waitFor(() => expect(document.activeElement.getAttribute('role')).toBe('treeitem'))
    expect(tree().contains(document.activeElement)).toBe(true)
  })

  // Desktop crawl, 2026-10-09: the hidden panel slid off-screen but stayed reachable, so Tab and a
  // screen reader walked its folder tree, All notes and Trash -- controls nobody could see.
  it('panel HIDDEN: its controls are out of reach (inert) until it is shown again', async () => {
    localStorage.setItem(SIDEBAR_KEY, '0')
    await renderTab()
    expect(tree().closest('[inert]'), 'the hidden panel is still reachable by Tab and screen readers').not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show folders panel' }))
    await waitFor(() => expect(tree().closest('[inert]')).toBeNull())
  })

  it('panel in search mode (no tree on screen): the link lands on the panel\'s heading', async () => {
    await renderTab()
    fireEvent.click(screen.getByRole('tab', { name: 'Search notes' }))
    await settle()
    expect(tree()).toBeNull()
    await press(link('Skip to folder navigation'))
    const at = document.activeElement
    expect(at.id).toBe('notebook-folder-nav')
    expect(at.textContent).toBe('Folder navigation')
  })

  it('CONTROL: "Skip to notes list" still lands inside the notes pane', async () => {
    await renderTab()
    await press(link('Skip to notes list'))
    expect(document.getElementById('notebook-pane').contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(document.body)
  })
})
