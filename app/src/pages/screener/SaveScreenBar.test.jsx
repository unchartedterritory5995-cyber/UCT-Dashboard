import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

const create = vi.fn()
vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({
    saved: [{ id: 9, name: 'My RSI', spec: { view: 'technical' } }],
    starters: [{ id: 's1', name: 'Oversold', spec: { view: 'overview' } }],
    create, update: vi.fn(), remove: vi.fn(),
  }),
}))

import SaveScreenBar from './SaveScreenBar'

beforeEach(() => create.mockClear())

test('applies a starter spec on click', () => {
  const onApply = vi.fn()
  render(<SaveScreenBar currentSpec={{}} onApply={onApply} />)
  fireEvent.click(screen.getByText('Screens ▾'))
  fireEvent.click(screen.getByText('Oversold'))
  expect(onApply).toHaveBeenCalledWith({ view: 'overview' })
})

test('saves the current spec under a typed name', () => {
  render(<SaveScreenBar currentSpec={{ filters: [] }} onApply={() => {}} />)
  fireEvent.click(screen.getByText('Screens ▾'))
  fireEvent.change(screen.getByPlaceholderText('Name this screen…'), { target: { value: 'Breakouts' } })
  fireEvent.click(screen.getByText('Save current'))
  expect(create).toHaveBeenCalledWith('Breakouts', { filters: [] })
})
