// The drawer wired to the REAL useScreenSpec: a Describe keeps the universe and sets both filters.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { vi, test, expect } from 'vitest'
vi.mock('../../shell/FilterRail', () => ({ default: () => <div /> }))
vi.mock('../../shell/CriteriaBox', () => ({ default: () => <div /> }))
vi.mock('../useDescribe', () => ({
  default: () => ({
    available: true, busy: false, error: null,
    run: async () => ({ filters: [{ key: 'rs_rank', op: 'gte', min: 80 }, { key: 'price', op: 'gt', min: 10 }], explanation: [] }),
  }),
}))
import FiltersDrawer from '../FiltersDrawer'
import useScreenSpec from '../../shell/useScreenSpec'

const seen = { spec: null }
function Harness() {
  const s = useScreenSpec()
  useEffect(() => { seen.spec = s })
  return <FiltersDrawer open onClose={() => {}} meta={{ filters: [] }} filters={s.filters} logic={s.logic}
    onSetFilter={s.setFilter} onClear={() => { s.clearFilters(); s.setLogic(null) }} onSetLogic={s.setLogic} count={1} lists={[]} />
}

test('Describe with the real spec state: both filters, the chosen universe kept, logic null', async () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'UCT Universe' }))
  await waitFor(() => expect(seen.spec.filters.universe).toBeTruthy())
  fireEvent.change(screen.getByLabelText('Describe a setup'), { target: { value: 'leaders' } })
  fireEvent.submit(screen.getByLabelText('Describe a setup').closest('form'))
  await waitFor(() => expect(seen.spec.filters.price).toEqual({ op: 'gt', min: 10 }))
  expect(seen.spec.filters.rs_rank).toEqual({ op: 'gte', min: 80 })
  expect(seen.spec.filters.universe).toEqual({ op: 'eq', value: 'uct', label: 'UCT Universe' })
  expect(seen.spec.logic).toBeNull()
})
