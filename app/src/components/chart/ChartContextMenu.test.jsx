import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartContextMenu from './ChartContextMenu'

function sections(overrides = {}) {
  return [
    {
      id: 'volume',
      title: 'Volume',
      items: [
        { id: 'vis', label: 'Show volume', kind: 'toggle', checked: true, onSelect: overrides.onToggle || vi.fn() },
        { id: 'sep', label: 'Separate pane', kind: 'toggle', checked: false, onSelect: vi.fn() },
      ],
    },
    {
      id: 'chart',
      items: [
        { id: 'add', label: '+ Add to Portfolio', primary: true, onSelect: overrides.onAdd || vi.fn() },
      ],
    },
  ]
}

describe('ChartContextMenu (generic sections)', () => {
  const base = { open: true, x: 100, y: 100, onClose: vi.fn() }

  it('renders section titles and items', () => {
    render(<ChartContextMenu {...base} sections={sections()} />)
    expect(screen.getByText('Volume')).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Show volume/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '+ Add to Portfolio' })).toBeInTheDocument()
  })

  it('does not render when open=false', () => {
    render(<ChartContextMenu {...base} open={false} sections={sections()} />)
    expect(screen.queryByText('Volume')).not.toBeInTheDocument()
  })

  it('renders nothing when all sections are empty', () => {
    const { container } = render(<ChartContextMenu {...base} sections={[{ id: 'x', items: [] }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('toggle reflects checked state via aria-checked', () => {
    render(<ChartContextMenu {...base} sections={sections()} />)
    expect(screen.getByRole('menuitemcheckbox', { name: /Show volume/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: /Separate pane/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('selecting an item fires onSelect then onClose', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(<ChartContextMenu {...base} onClose={onClose} sections={sections({ onAdd })} />)
    await user.click(screen.getByRole('menuitem', { name: /Add to Portfolio/ }))
    expect(onAdd).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('disabled item does not fire onSelect', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const secs = [{ id: 's', items: [{ id: 'd', label: 'Nope', disabled: true, onSelect }] }]
    render(<ChartContextMenu {...base} sections={secs} />)
    await user.click(screen.getByRole('menuitem', { name: 'Nope' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Esc closes', () => {
    const onClose = vi.fn()
    render(<ChartContextMenu {...base} onClose={onClose} sections={sections()} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
