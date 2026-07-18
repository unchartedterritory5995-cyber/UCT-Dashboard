// app/src/pages/charts/grid/GroupPicker.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('./groupsApi', () => ({
  fetchGroups: vi.fn(async () => [
    { id: 'space', name: 'Space', total: 6, chartable: 6 },
    { id: 'memory_chips', name: 'Memory & HBM', total: 8, chartable: 8 },
  ]),
  fetchGroupTop: vi.fn(async () => ({ syms: ['RKLB', 'ASTS', 'LUNR', 'BKSY'], etf: 'UFO', total: 6, by: 'today', ranked_as_of: 'regular' })),
}))

import GroupPicker from './GroupPicker'
import { fetchGroupTop } from './groupsApi'

const mc = {
  state: { layout: '2x2', mode: 'grid' },
  enterGrid: vi.fn(),
  fillCells: vi.fn(),
}

beforeEach(() => { mc.enterGrid.mockClear(); mc.fillCells.mockClear() })

describe('GroupPicker', () => {
  it('lists groups and fills the grid on click', async () => {
    render(<GroupPicker mc={mc} onClose={() => {}} />)
    const btn = await screen.findByRole('button', { name: /Space/ })
    fireEvent.click(btn)
    await waitFor(() => expect(fetchGroupTop).toHaveBeenCalledWith('space', { n: 4, by: 'today' }))
    expect(mc.fillCells).toHaveBeenCalledWith(
      ['UFO', 'RKLB', 'ASTS', 'LUNR'],
      { id: 'space', by: 'today', n: 4 },
    )
  })

  it('filters by search text', async () => {
    render(<GroupPicker mc={mc} onClose={() => {}} />)
    await screen.findByRole('button', { name: /Space/ })
    fireEvent.change(screen.getByPlaceholderText(/search groups/i), { target: { value: 'mem' } })
    expect(screen.queryByRole('button', { name: /Space/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Memory/ })).toBeTruthy()
  })
})
