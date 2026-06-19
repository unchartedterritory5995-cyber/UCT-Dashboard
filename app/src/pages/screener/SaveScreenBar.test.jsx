import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({
    saved: [],
    starters: [{ id: 's1', name: 'Oversold', spec: { view: 'overview' } }],
    create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  }),
}))

import SaveScreenBar from './SaveScreenBar'

test('applies a starter spec on select', () => {
  const onApply = vi.fn()
  render(<SaveScreenBar currentSpec={{}} onApply={onApply} />)
  fireEvent.change(screen.getByLabelText('Saved screens'), { target: { value: 's1' } })
  expect(onApply).toHaveBeenCalledWith({ view: 'overview' })
})
