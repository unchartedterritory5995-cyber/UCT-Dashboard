import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 3) — "Your templates" in the template picker: listed,
 * picked, renamed, deleted (after asking). ⛔ Feedback by RENDERED TEXT.
 */
import TemplatePicker from './TemplatePicker'

let templates
let calls
let refuseDelete
beforeEach(() => {
  templates = [
    { id: 't1', name: 'Weekly review', title: 'Week of …', createdAt: '2' },
    { id: 't2', name: 'Earnings prep', title: 'Earnings prep', createdAt: '1' },
  ]
  calls = []
  refuseDelete = false
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (u === '/api/j2/note-templates' && !init.method) return { ok: true, json: async () => ({ templates }) }
    const m = u.match(/^\/api\/j2\/note-templates\/(\w+)$/)
    if (m && init.method === 'PATCH') {
      const name = JSON.parse(init.body).name.trim()
      templates = templates.map((t) => (t.id === m[1] ? { ...t, name } : t))
      return { ok: true, json: async () => ({ template: templates.find((t) => t.id === m[1]) }) }
    }
    if (m && init.method === 'DELETE') {
      if (refuseDelete) return { ok: false, status: 500, json: async () => ({}) }
      templates = templates.filter((t) => t.id !== m[1])
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
})

const renderPicker = (props = {}) => render(
  <MemoryRouter>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TemplatePicker onPick={vi.fn()} {...props} />
    </SWRConfig>
  </MemoryRouter>,
)
const section = () => screen.getByRole('region', { name: 'Your templates' })

describe('Your templates', () => {
  it('is offered only when the picker can make a note from one', () => {
    renderPicker()
    expect(screen.queryByText('Your templates')).not.toBeInTheDocument()
  })

  it('lists the member’s templates by name and picks one', async () => {
    const onPickMember = vi.fn()
    renderPicker({ onPickMember })
    // Scoped to the section: the built-in catalog has its own "Weekly review".
    // ^ anchored: "Rename Weekly review" / "Delete Weekly review" contain it too.
    await within(section()).findByRole('button', { name: /^Weekly review/ })
    fireEvent.click(within(section()).getByRole('button', { name: /^Weekly review/ }))
    expect(onPickMember).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', name: 'Weekly review' }))
    // The title shows under the name only when it says something the name does not.
    expect(within(section()).getByText('Week of …')).toBeInTheDocument()
    expect(within(section()).getAllByText('Earnings prep')).toHaveLength(1)
  })

  it('says where templates come from when there are none', async () => {
    templates = []
    renderPicker({ onPickMember: vi.fn() })
    expect(await screen.findByText('Save any note as a template from its menu, and it appears here.')).toBeInTheDocument()
  })

  it('renames in place and says so', async () => {
    renderPicker({ onPickMember: vi.fn() })
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Weekly review' }))
    const input = screen.getByRole('textbox', { name: 'New name for Weekly review' })
    fireEvent.change(input, { target: { value: '  Friday review ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Renamed to “Friday review”.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PATCH')).toEqual({
      url: '/api/j2/note-templates/t1', method: 'PATCH', body: { name: '  Friday review ' } })
  })

  it('asks before deleting, and deletes only on the second press', async () => {
    renderPicker({ onPickMember: vi.fn() })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Earnings prep' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    const ask = screen.getByRole('group', { name: 'Delete Earnings prep?' })
    expect(within(ask).getByText('Delete “Earnings prep”? This can’t be undone.'.replace('’', "'"))).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Deleted “Earnings prep”. Notes made from it are unchanged.')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/j2/note-templates/t2'])
  })

  it('"Keep it" deletes nothing, and a refused delete says the template is still there', async () => {
    renderPicker({ onPickMember: vi.fn() })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Earnings prep' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    refuseDelete = true
    fireEvent.click(screen.getByRole('button', { name: 'Delete Earnings prep' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Earnings prep?' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t delete “Earnings prep”. It is still here.'.replace('’', "'"))
  })
})
