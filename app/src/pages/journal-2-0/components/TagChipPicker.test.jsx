import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagChipPicker from './TagChipPicker'

describe('TagChipPicker', () => {
  it('renders one chip per available tag', () => {
    render(
      <TagChipPicker
        available={['fomo', 'chasing']}
        selected={['fomo']}
        onChange={() => {}}
      />,
    )
    const fomoChip = screen.getByRole('button', { name: /fomo/i })
    const chasingChip = screen.getByRole('button', { name: /chasing/i })
    expect(fomoChip).toHaveAttribute('aria-pressed', 'true')
    expect(chasingChip).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking an unselected chip adds it to selected via onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TagChipPicker
        available={['fomo', 'chasing']}
        selected={['fomo']}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /chasing/i }))
    expect(onChange).toHaveBeenCalledWith(['fomo', 'chasing'])
  })

  it('renders placeholder when available is empty', () => {
    render(
      <TagChipPicker
        available={[]}
        selected={[]}
        onChange={() => {}}
        placeholder="No tags configured."
      />,
    )
    expect(screen.getByText(/No tags configured/i)).toBeInTheDocument()
  })
})
