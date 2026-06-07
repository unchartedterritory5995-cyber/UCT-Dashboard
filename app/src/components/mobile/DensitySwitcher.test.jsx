import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import DensitySwitcher from './DensitySwitcher'

test('renders the three density options and fires onChange', () => {
  const onChange = vi.fn()
  render(<DensitySwitcher value="cards" onChange={onChange} />)
  ;['Cards', 'Compact', 'Detailed'].forEach((l) =>
    expect(screen.getByText(l)).toBeInTheDocument(),
  )
  fireEvent.click(screen.getByText('Compact'))
  expect(onChange).toHaveBeenCalledWith('compact')
})
