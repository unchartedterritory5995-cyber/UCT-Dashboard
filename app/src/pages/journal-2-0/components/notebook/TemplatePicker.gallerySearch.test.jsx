// Wave 10 lane DR-C (design finding D-4): the gallery's search box, category
// chips, and the "Preview before you use it" flow -- for both a built-in
// template and a member's own. None of this replaces the existing card
// click/Enter/Space behaviour (TemplatePicker.gallery.test.jsx covers that,
// unmodified, on the default unfiltered view); this file covers what's NEW.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import { TEMPLATES, FAMILIES, getTemplate } from '../../lib/notebookTemplates'

function renderPicker(props = {}) {
  const onPick = vi.fn()
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TemplatePicker onPick={onPick} {...props} />
      </SWRConfig>
    </MemoryRouter>,
  )
  return { onPick }
}

const search = () => screen.getByRole('searchbox', { name: 'Search templates' })
const allCardKeys = () => [...document.querySelectorAll('[data-template-key]')].map((el) => el.getAttribute('data-template-key'))

describe('D-4 -- the search box filters the built-in catalog', () => {
  it('typing a word from a description narrows to the templates that match it, by name', () => {
    renderPicker()
    const target = getTemplate('options-trade-plan')
    fireEvent.change(search(), { target: { value: 'greeks' } }) // only in options-trade-plan's description
    expect(allCardKeys()).toEqual([target.key])
    expect(screen.getByRole('button', { name: target.label })).toBeInTheDocument()
  })

  it('matches on the template name itself, case-insensitively', () => {
    renderPicker()
    fireEvent.change(search(), { target: { value: 'MISTAKE LOG' } })
    expect(allCardKeys()).toEqual(['mistake-log'])
  })

  it('Blank note stays offered even while a search is narrow', () => {
    renderPicker()
    fireEvent.change(search(), { target: { value: 'mistake log' } })
    // the card's accessible name also carries its description span, so this is
    // a prefix match (same convention TemplatePicker.gallery.test.jsx uses).
    expect(screen.getByRole('button', { name: /^Blank note/ })).toBeInTheDocument()
  })

  it('a query matching nothing says so, and shows no cards (non-vacuity: the catalog really has no such word)', () => {
    renderPicker()
    const nonsense = 'zzzznosuchtemplateword'
    expect(TEMPLATES.some((t) => `${t.label} ${t.description} ${t.when}`.toLowerCase().includes(nonsense))).toBe(false)
    fireEvent.change(search(), { target: { value: nonsense } })
    expect(allCardKeys()).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent(`No templates match “${nonsense}”.`)
  })

  it('the clear (x) button empties the query and restores every card', () => {
    renderPicker()
    fireEvent.change(search(), { target: { value: 'mistake log' } })
    expect(allCardKeys().length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search()).toHaveValue('')
    expect(allCardKeys().length).toBe(TEMPLATES.length)
  })

  it('also filters "Your templates" by name, leaving the daily-template picker untouched', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ templates: [
        { id: 't1', name: 'Morning plan', title: '', createdAt: '2' },
        { id: 't2', name: 'Risk audit', title: '', createdAt: '1' },
      ] }),
    }))
    renderPicker({ onPickMember: vi.fn() })
    await screen.findByRole('button', { name: 'Morning plan' })
    fireEvent.change(search(), { target: { value: 'risk' } })
    expect(screen.queryByRole('button', { name: 'Morning plan' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Risk audit' })).toBeInTheDocument()
    // the preference control still lists every saved template, search or not
    expect(within(screen.getByRole('combobox', { name: 'Daily notes start from' })).getByText('Morning plan')).toBeInTheDocument()
  })
})

describe('D-4 -- category chips browse by family', () => {
  it('every family from the catalog has a chip, plus All', () => {
    renderPicker()
    const group = screen.getByRole('group', { name: 'Filter templates by category' })
    expect(within(group).getByRole('button', { name: 'All' })).toBeInTheDocument()
    for (const fam of FAMILIES) expect(within(group).getByRole('button', { name: fam.label })).toBeInTheDocument()
  })

  it('picking a family shows only that family\'s cards', () => {
    renderPicker()
    const mind = FAMILIES.find((f) => f.key === 'mind')
    fireEvent.click(screen.getByRole('button', { name: mind.label }))
    const mindKeys = TEMPLATES.filter((t) => t.family === 'mind').map((t) => t.key)
    expect(allCardKeys().sort()).toEqual(mindKeys.sort())
    expect(screen.getByRole('button', { name: mind.label })).toHaveAttribute('aria-pressed', 'true')
  })

  it('"All" restores every family', () => {
    renderPicker()
    const mind = FAMILIES.find((f) => f.key === 'mind')
    fireEvent.click(screen.getByRole('button', { name: mind.label }))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(allCardKeys().length).toBe(TEMPLATES.length)
  })

  it('"Your templates" narrows to the member section alone', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ templates: [{ id: 't1', name: 'Morning plan', title: '', createdAt: '1' }] }) }))
    renderPicker({ onPickMember: vi.fn() })
    await screen.findByRole('button', { name: 'Morning plan' })
    fireEvent.click(screen.getByRole('button', { name: 'Your templates' }))
    expect(allCardKeys()).toEqual([])
    expect(screen.getByRole('button', { name: 'Morning plan' })).toBeInTheDocument()
  })
})

describe('D-4 -- preview a built-in template before using it', () => {
  it('opens a read-only render of the body (never the raw JSON), named by the template', async () => {
    renderPicker()
    const tpl = getTemplate('trade-plan')
    fireEvent.click(screen.getByRole('button', { name: `Preview ${tpl.label}` }))
    const dialog = await screen.findByRole('dialog', { name: tpl.label })
    // a heading from the template's own body renders as a real heading, not a JSON string
    expect(within(dialog).getByRole('heading', { name: 'Entry / Stop / Target / Size' })).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/"type":\s*"doc"/)
    expect(dialog.textContent).not.toContain('{"type"')
  })

  it('"Use this template" hands onPick the SAME catalog object the card itself would, then closes', async () => {
    const { onPick } = renderPicker()
    const tpl = getTemplate('weekly-review')
    fireEvent.click(screen.getByRole('button', { name: `Preview ${tpl.label}` }))
    await screen.findByRole('dialog', { name: tpl.label })
    fireEvent.click(screen.getByRole('button', { name: 'Use this template' }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(getTemplate(tpl.key))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Escape closes the preview and returns focus to the Preview button that opened it', async () => {
    renderPicker()
    const tpl = getTemplate('goals')
    const opener = screen.getByRole('button', { name: `Preview ${tpl.label}` })
    opener.focus()
    fireEvent.click(opener)
    await screen.findByRole('dialog', { name: tpl.label })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(opener)
  })

  it('Cancel closes without ever calling onPick', async () => {
    const { onPick } = renderPicker()
    const tpl = getTemplate('risk-checklist')
    fireEvent.click(screen.getByRole('button', { name: `Preview ${tpl.label}` }))
    await screen.findByRole('dialog', { name: tpl.label })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onPick).not.toHaveBeenCalled()
  })

  it('the arrow-key roving group ignores the Preview buttons (only [data-template-card] cards move)', () => {
    renderPicker()
    const previews = screen.getAllByRole('button', { name: /^Preview /u })
    expect(previews.length).toBe(TEMPLATES.length)
    for (const btn of previews) expect(btn.hasAttribute('data-template-card')).toBe(false)
  })
})

describe('D-4 -- preview a member template before using it', () => {
  const templates = [{ id: 't1', name: 'Morning plan', title: '', createdAt: '1' }]
  const fullBody = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Focus list' }] }] }

  beforeEach(() => {
    global.fetch = vi.fn(async (url) => {
      const u = String(url)
      if (u === '/api/j2/note-templates') return { ok: true, json: async () => ({ templates }) }
      if (u === '/api/j2/note-templates/t1') {
        return { ok: true, json: async () => ({ template: { ...templates[0], bodyJson: fullBody, properties: {} } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  })

  it('reads the full body on demand and renders it read-only', async () => {
    renderPicker({ onPickMember: vi.fn() })
    await screen.findByRole('button', { name: 'Morning plan' })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Morning plan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Morning plan' })
    await within(dialog).findByRole('heading', { name: 'Focus list' })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/note-templates/t1', expect.anything())
  })

  it('"Use this template" calls the picker\'s own onPickMember with the summary (same door as the card)', async () => {
    const onPickMember = vi.fn()
    renderPicker({ onPickMember })
    await screen.findByRole('button', { name: 'Morning plan' })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Morning plan' }))
    await screen.findByRole('dialog', { name: 'Morning plan' })
    await within(screen.getByRole('dialog')).findByRole('heading', { name: 'Focus list' })
    fireEvent.click(screen.getByRole('button', { name: 'Use this template' }))
    expect(onPickMember).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', name: 'Morning plan' }))
  })

  it('a failed read says so, in words, and disables "Use this template"', async () => {
    global.fetch = vi.fn(async (url) => {
      const u = String(url)
      if (u === '/api/j2/note-templates') return { ok: true, json: async () => ({ templates }) }
      return { ok: false, status: 500, json: async () => ({}) }
    })
    renderPicker({ onPickMember: vi.fn() })
    await screen.findByRole('button', { name: 'Morning plan' })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Morning plan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Morning plan' })
    await within(dialog).findByRole('alert')
    expect(within(dialog).getByRole('button', { name: 'Use this template' })).toBeDisabled()
  })
})
