// Follow-up C (one room for templates): My tools > Templates is one sentence and one button. Templates are managed in
// Manage templates (its Archived and Recently deleted views draw the list this tab drew until now: TemplateList.test.jsx
// carries those rails, pointed at the manager). The tab stays in the tab row, and every `openMyTools({ tab:
// 'templates' })` door still lands on it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import MyToolsSheet from './MyToolsSheet'
import { managerHref } from './myToolsLib'

const flags = vi.hoisted(() => ({ eleven: true }))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => (w === 11 ? flags.eleven : true) }))

let fetchSpy
beforeEach(() => {
  flags.eleven = true
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const panel = () => screen.getByRole('tabpanel', { name: 'Templates' })

describe('My tools, Templates: the way to Manage templates', () => {
  it('the tab stays in the row and says templates are managed in one place, with one button', () => {
    render(<MyToolsSheet onClose={() => {}} uid="u1" tab="templates" />)
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveAttribute('aria-selected', 'true')
    expect(panel()).toHaveTextContent('Templates are managed in one place now.')
    expect(panel().querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Open Manage templates' })).toBeInTheDocument()
    // nothing listed here any more: no template list is asked for
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('journal-styles'))).toHaveLength(0)
  })

  it('Open Manage templates closes My tools and goes to the manager through the router it was handed', () => {
    const onClose = vi.fn()
    const navigate = vi.fn()
    render(<MyToolsSheet onClose={onClose} uid="u1" tab="templates" navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Manage templates' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/journal/notebook?styles=1')
  })

  it('without a router it makes the router\'s own history move and says so with popstate', () => {
    const onClose = vi.fn()
    const pops = []
    const onPop = () => pops.push(window.location.pathname + window.location.search)
    window.addEventListener('popstate', onPop)
    render(<MyToolsSheet onClose={onClose} uid="u1" tab="templates" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Manage templates' }))
    window.removeEventListener('popstate', onPop)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.location.pathname + window.location.search).toBe('/journal/notebook?styles=1')
    expect(pops).toEqual(['/journal/notebook?styles=1'])
  })

  it('on the notes page the manager opens over what is there (an open note stays open)', () => {
    expect(managerHref({ pathname: '/journal/notebook', search: '?note=n1' })).toBe('/journal/notebook?note=n1&styles=1')
    expect(managerHref({ pathname: '/journal/notebook', search: '?styles=1' })).toBe('/journal/notebook?styles=1')
    expect(managerHref({ pathname: '/journal/trades', search: '?id=9' })).toBe('/journal/notebook?styles=1')
  })

  it('with wave 11 off the tab is the same panel (the manager exists either way), never "coming soon"', () => {
    flags.eleven = false
    render(<MyToolsSheet onClose={() => {}} uid="u1" tab="templates" />)
    expect(panel()).toHaveTextContent('Templates are managed in one place now.')
    expect(panel()).not.toHaveTextContent(/coming soon/i)
  })

  it('openMyTools({ tab: "templates" }) still lands on the tab', async () => {
    const { openMyTools } = await import('./openMyTools')
    let close
    await act(async () => { close = openMyTools({ tab: 'templates', uid: 'u1' }) })
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Open Manage templates' })).toBeInTheDocument()
    await act(async () => { close(); await new Promise((r) => setTimeout(r, 0)) })
  })
})
