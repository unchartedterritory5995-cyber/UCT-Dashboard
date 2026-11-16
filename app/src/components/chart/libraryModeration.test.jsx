// Library moderation, client half (the server half: tests/test_definition_library_moderation.py).
//
//  * the owner reads a licence line before publishing, and a takedown or the listing cap
//    reaches them by name with what to do;
//  * a library entry shows the licence its script declares;
//  * an ADMIN sees UCT's takedown on each entry; a member never does.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import IndicatorMembersTab from './IndicatorMembersTab'
import SharePanel from './builder/SharePanel'
import FormulaLibrary from '../../pages/formulas/FormulaLibrary'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const ENTRIES = [
  { token: 'sh_one', name: 'Ported Script', description: '', repaint: 'non-repainting', placement: 'overlay', inputs: 1, licence: 'Mozilla Public License 2.0' },
  { token: 'sh_two', name: 'Home Made', description: '', repaint: 'repaints', placement: 'pane', inputs: 0, licence: null },
]
const lib = async () => ({ ok: true, entries: ENTRIES, next: null })
const as = (role) => ({ children }) => <AuthContext.Provider value={{ user: { id: 'x', role } }}>{children}</AuthContext.Provider>

describe('the Members list', () => {
  it('shows the licence an entry\'s script declares, and nothing for one without', async () => {
    render(<IndicatorMembersTab fetchLibrary={lib} install={async () => ({ ok: true })} />)
    await act(async () => {})
    const [one, two] = screen.getAllByTestId('members-entry')
    expect(within(one).getByTestId('members-entry-licence').textContent).toBe('Licence, from its original script: Mozilla Public License 2.0')
    expect(within(two).queryByTestId('members-entry-licence')).toBeNull()
  })

  it('a member, and a mount with no signed-in context, see no takedown', async () => {
    render(<IndicatorMembersTab fetchLibrary={lib} install={async () => ({ ok: true })} />)
    await act(async () => {})
    expect(screen.queryByTestId('members-takedown')).toBeNull()
    cleanup()
    render(<IndicatorMembersTab fetchLibrary={lib} install={async () => ({ ok: true })} />, { wrapper: as('user') })
    await act(async () => {})
    expect(screen.getAllByTestId('members-entry')).toHaveLength(2)
    expect(screen.queryByTestId('members-takedown')).toBeNull()
  })

  it('an admin takes one down with a reason from the closed set, and it leaves the list', async () => {
    const moderate = vi.fn(async () => ({ ok: true, takenDown: true }))
    render(<IndicatorMembersTab fetchLibrary={lib} install={async () => ({ ok: true })} moderate={moderate} />, { wrapper: as('admin') })
    await act(async () => {})
    const one = screen.getAllByTestId('members-entry')[0]
    const select = within(one).getByTestId('members-takedown-reason')
    expect([...select.options].map((o) => o.value)).toEqual(['licence', 'misleading', 'broken', 'abuse', 'other'])
    fireEvent.change(select, { target: { value: 'licence' } })
    await act(async () => { fireEvent.click(within(one).getByTestId('members-takedown-go')) })
    expect(moderate).toHaveBeenCalledWith('sh_one', { down: true, reason: 'licence' })
    expect(screen.getAllByTestId('members-entry').map((r) => r.dataset.token)).toEqual(['sh_two'])
  })

  it('a refused takedown says why and leaves the entry', async () => {
    const moderate = async () => ({ ok: false, error: 'Admin access required' })
    render(<IndicatorMembersTab fetchLibrary={lib} install={async () => ({ ok: true })} moderate={moderate} />, { wrapper: as('admin') })
    await act(async () => {})
    const one = screen.getAllByTestId('members-entry')[0]
    await act(async () => { fireEvent.click(within(one).getByTestId('members-takedown-go')) })
    expect(within(one).getByRole('alert').textContent).toMatch(/Admin access required/)
    expect(screen.getAllByTestId('members-entry')).toHaveLength(2)
  })
})

describe('the library page', () => {
  const routeFetch = (map) => vi.fn(async (url, opts = {}) => {
    const key = `${opts.method || 'GET'} ${url}`
    for (const [re, reply] of map) if (re.test(key)) return { ok: (reply.status || 200) < 400, status: reply.status || 200, json: async () => reply.body }
    return { ok: false, status: 404, json: async () => ({}) }
  })

  it('shows the licence, and the takedown only for an admin', async () => {
    global.fetch = routeFetch([[/^GET .*\/library/, { body: { entries: ENTRIES, next: null } }]])
    render(<MemoryRouter><FormulaLibrary /></MemoryRouter>, { wrapper: as('admin') })
    expect(await screen.findByTestId('library-licence-sh_one')).toHaveTextContent('licence: Mozilla Public License 2.0')
    expect(screen.queryByTestId('library-licence-sh_two')).toBeNull()
    expect(screen.getAllByTestId('members-takedown')).toHaveLength(2)
    cleanup()
    render(<MemoryRouter><FormulaLibrary /></MemoryRouter>, { wrapper: as('user') })
    expect(await screen.findByTestId('library-licence-sh_one')).toBeInTheDocument()
    expect(screen.queryByTestId('members-takedown')).toBeNull()
  })
})

describe('the owner\'s publish panel', () => {
  const route = (map) => vi.fn(async (url, opts = {}) => {
    const key = `${opts.method || 'GET'} ${url}`
    for (const [re, reply] of map) if (re.test(key)) return { ok: (reply.status || 200) < 400, status: reply.status || 200, json: async () => reply.body }
    return { ok: false, status: 404, json: async () => ({ detail: 'no route' }) }
  })
  const enabled = async (el) => { await waitFor(() => expect(el).not.toBeDisabled()); return el }

  it('reads the licence line before publishing: the script\'s own when it declares one', async () => {
    global.fetch = route([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/list$/, { body: { listed: false, requested: false, shared: false, licence: 'Mozilla Public License 2.0' } }],
    ])
    render(<SharePanel defId="u_abc" />)
    await waitFor(() => expect(screen.getByTestId('library-licence')).toHaveTextContent(/under the Mozilla Public License 2\.0/))
  })

  it('…and the general sentence when it declares none', async () => {
    global.fetch = route([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/list$/, { body: { listed: false, requested: false, shared: false, licence: null } }],
    ])
    render(<SharePanel defId="u_abc" />)
    await waitFor(() => expect(screen.getByTestId('library-licence')).toHaveTextContent(/Publish only what you have the right to share/))
  })

  it('a takedown reaches the owner by name, says what still works, and Publish stays off', async () => {
    global.fetch = route([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/list$/, { body: { listed: false, requested: true, shared: true } }],
      [/^POST .*\/list$/, { status: 403, body: { detail: { reason: 'taken-down', message: 'UCT took this indicator out of the library, so it cannot be listed again. Your copy and any link you sent still work.' } } }],
    ])
    render(<SharePanel defId="u_abc" />)
    const publish = await enabled(await screen.findByTestId('library-publish'))
    await act(async () => { fireEvent.click(publish) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/UCT took this indicator out of the library/)
    expect(alert.textContent).toMatch(/write to UCT from the Support page/)
    expect(alert.textContent).not.toMatch(/\(403\)/)
    expect(screen.getByTestId('library-publish')).toBeDisabled()
  })

  it('the listing cap reaches the owner as the server\'s sentence, not a status code', async () => {
    global.fetch = route([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/list$/, { body: { listed: false, requested: false, shared: false } }],
      [/^POST .*\/list$/, { status: 409, body: { detail: { reason: 'listing-limit', message: 'You already have 20 indicators in the library, the most one member can list at once. Take one out to list this one.' } } }],
    ])
    render(<SharePanel defId="u_abc" />)
    const publish = await enabled(await screen.findByTestId('library-publish'))
    await act(async () => { fireEvent.click(publish) })
    expect((await screen.findByRole('alert')).textContent).toMatch(/already have 20 indicators in the library/)
    expect(screen.getByTestId('library-publish')).not.toBeDisabled()
  })
})
