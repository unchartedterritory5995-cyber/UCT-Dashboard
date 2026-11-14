import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 4) — the member picks which of THEIR plain templates starts each daily note: a preference,
 * kept by the app's preferences store. Follow-up C (one room for templates): the control lives in Manage templates'
 * Plain templates group; the New note sheet's "Your templates" keeps a link that names the choice and opens the
 * manager at the control.
 */
const setPref = vi.fn()
let prefs = {}
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs, setPref }),
}))

import TemplatePicker from './TemplatePicker'
import { PlainTemplatesManage } from './MemberTemplates'

const TEMPLATES = [{ id: 't1', name: 'Morning plan', title: 'Plan', createdAt: '1' },
  { id: 't2', name: 'Weekly wrap', title: 'Wrap', createdAt: '2' }]
beforeEach(() => {
  setPref.mockClear()
  prefs = {}
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ templates: TEMPLATES }) }))
})

const wrap = (ui) => render(
  <MemoryRouter>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  </MemoryRouter>,
)
const renderGroup = () => wrap(<PlainTemplatesManage />)
const renderPicker = (props = {}) => wrap(<TemplatePicker onPick={vi.fn()} onPickMember={vi.fn()} {...props} />)

describe('the daily template, in Manage templates', () => {
  it('defaults to a blank page, lists plain templates only, says so, and choosing one saves the preference', async () => {
    renderGroup()
    const select = await screen.findByRole('combobox', { name: 'Daily notes start from' })
    expect(select).toHaveValue('')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['A blank page', 'Morning plan', 'Weekly wrap'])
    expect(select).toHaveAccessibleDescription('Daily notes can start from a plain template.')
    fireEvent.change(select, { target: { value: 't1' } })
    expect(setPref).toHaveBeenCalledWith('notebook_daily_template', 't1')
  })

  it('shows the saved choice, and one whose template is gone reads as a blank page', async () => {
    prefs = { notebook_daily_template: 't1' }
    const { unmount } = renderGroup()
    expect(await screen.findByRole('combobox', { name: 'Daily notes start from' })).toHaveValue('t1')
    unmount()
    prefs = { notebook_daily_template: 'deleted-long-ago' }
    renderGroup()
    expect(await screen.findByRole('combobox', { name: 'Daily notes start from' })).toHaveValue('')
  })
})

describe('the daily template, from the New note sheet', () => {
  it('the picker names the choice in a link and has no control of its own', async () => {
    prefs = { notebook_daily_template: 't2' }
    renderPicker({ onManageTemplates: vi.fn() })
    const line = await screen.findByText(/^Daily notes start from: Weekly wrap\./)
    expect(within(line).getByRole('button', { name: 'Change what daily notes start from' })).toHaveTextContent('Change')
    expect(screen.queryByRole('combobox', { name: 'Daily notes start from' })).toBeNull()
  })

  it('"None" when nothing is chosen, or when the chosen template is gone', async () => {
    const { unmount } = renderPicker({ onManageTemplates: vi.fn() })
    expect(await screen.findByText(/^Daily notes start from: None\./)).toBeInTheDocument()
    unmount()
    prefs = { notebook_daily_template: 'deleted-long-ago' }
    renderPicker({ onManageTemplates: vi.fn() })
    expect(await screen.findByText(/^Daily notes start from: None\./)).toBeInTheDocument()
  })

  it('Change opens the manager at the daily control; Manage opens it at the Plain templates group', async () => {
    const onManageTemplates = vi.fn()
    renderPicker({ onManageTemplates })
    fireEvent.click(await screen.findByRole('button', { name: 'Change what daily notes start from' }))
    expect(onManageTemplates).toHaveBeenLastCalledWith('daily')   // the place only (final fix 2c: no opener is handed up)
    fireEvent.click(screen.getByRole('button', { name: 'Manage your plain templates' }))
    expect(onManageTemplates).toHaveBeenLastCalledWith('plain')
  })

  it('the picker picks: Use (the card) and Preview stay; Rename, Delete and Share are the manager\'s now', async () => {
    renderPicker({ onManageTemplates: vi.fn() })
    expect(await screen.findByRole('button', { name: /^Morning plan/ })).toBeInTheDocument()   // the card is Use
    expect(screen.getByRole('button', { name: 'Preview Morning plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Rename / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Share .* to the Template library$/ })).toBeNull()
  })

  // Fix round 1 (2c): when the manager's door cannot open (its switch not latched yet, an offline cold start), the
  // picker keeps its own controls, so a plain template is never without a manager.
  it('without a door to the manager: no links, and the picker keeps its own Rename, Delete and daily control', async () => {
    prefs = { notebook_daily_template: 't2' }
    renderPicker()
    expect(await screen.findByRole('button', { name: /^Morning plan/ })).toBeInTheDocument()  // the card still picks
    expect(screen.queryByRole('button', { name: 'Manage your plain templates' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change what daily notes start from' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Rename Morning plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Morning plan' })).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: 'Daily notes start from' })
    expect(select).toHaveValue('t2')
    fireEvent.change(select, { target: { value: 't1' } })
    expect(setPref).toHaveBeenCalledWith('notebook_daily_template', 't1')
  })
})
