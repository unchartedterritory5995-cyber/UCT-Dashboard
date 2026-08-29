import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BreadthViewSwitcher from './BreadthViewSwitcher'
import { STYLES, VIEW_CONFIG } from './views/viewMetricConfig'

describe('BreadthViewSwitcher', () => {
  it('renders a button per style and marks the active one pressed', () => {
    render(<BreadthViewSwitcher viewStyle="rings" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Treemap' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Rings' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('calls onSelect with the chosen style', () => {
    const onSelect = vi.fn()
    render(<BreadthViewSwitcher viewStyle="treemap" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tug' }))
    expect(onSelect).toHaveBeenCalledWith('tug')
  })

  it('renders a button for every registered style and no others', () => {
    const { getAllByRole } = render(<BreadthViewSwitcher viewStyle="treemap" onSelect={() => {}} />)
    const labels = getAllByRole('button').map(b => b.textContent)
    expect(labels.sort()).toEqual(STYLES.map(s => VIEW_CONFIG[s].label).sort())
  })
})
