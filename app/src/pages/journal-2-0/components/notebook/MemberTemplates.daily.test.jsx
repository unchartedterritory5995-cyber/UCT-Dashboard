import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 4) — the member picks which of THEIR templates starts
 * each daily note: a preference, kept by the app's preferences store.
 */
const setPref = vi.fn()
let prefs = {}
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs, setPref }),
}))

import TemplatePicker from './TemplatePicker'

beforeEach(() => {
  setPref.mockClear()
  prefs = {}
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ templates: [{ id: 't1', name: 'Morning plan', title: 'Plan', createdAt: '1' }] }),
  }))
})

const renderPicker = () => render(
  <MemoryRouter>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TemplatePicker onPick={vi.fn()} onPickMember={vi.fn()} />
    </SWRConfig>
  </MemoryRouter>,
)

describe('the daily template', () => {
  it('defaults to a blank page, and choosing a template saves the preference', async () => {
    renderPicker()
    const select = await screen.findByRole('combobox', { name: 'Daily notes start from' })
    expect(select).toHaveValue('')
    fireEvent.change(select, { target: { value: 't1' } })
    expect(setPref).toHaveBeenCalledWith('notebook_daily_template', 't1')
  })

  it('shows the saved choice, and one whose template is gone reads as a blank page', async () => {
    prefs = { notebook_daily_template: 't1' }
    const { unmount } = renderPicker()
    expect(await screen.findByRole('combobox', { name: 'Daily notes start from' })).toHaveValue('t1')
    unmount()
    prefs = { notebook_daily_template: 'deleted-long-ago' }
    renderPicker()
    expect(await screen.findByRole('combobox', { name: 'Daily notes start from' })).toHaveValue('')
  })
})
