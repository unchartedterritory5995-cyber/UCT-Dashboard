// app/src/pages/breadth/BreadthViewsCustomizePanel.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BreadthViewsCustomizePanel from './BreadthViewsCustomizePanel'

const metrics = [
  { key: 'breadth_score', label: 'Health', group: 'Score' },
  { key: 'vix', label: 'VIX', group: 'Regime' },
]
const optionsSchema = [
  { name: 'maxSpokes', label: 'Max spokes', type: 'select', default: 14,
    choices: [{ value: 8, label: '8' }, { value: 14, label: '14' }] },
]

function setup(over = {}) {
  const props = {
    viewLabel: 'Radar',
    metrics,
    optionsSchema,
    options: { maxSpokes: 14 },
    activePreset: 'Default',
    visibleKeys: new Set(['breadth_score', 'vix']),
    presetNames: ['Default'],
    isDefaultActive: true,
    onToggleVisible: vi.fn(),
    onSetOption: vi.fn(),
    onSavePreset: vi.fn(),
    onRenamePreset: vi.fn(),
    onDeletePreset: vi.fn(),
    onSwitchPreset: vi.fn(),
    onResetActive: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<BreadthViewsCustomizePanel {...props} />)
  return props
}

describe('BreadthViewsCustomizePanel', () => {
  it('shows the view label in the header', () => {
    setup()
    expect(screen.getByText('Customize Radar')).toBeTruthy()
  })

  it('renders an option control from the schema', () => {
    setup()
    expect(screen.getByLabelText('Max spokes')).toBeTruthy()
  })

  it('editing a metric on Default prompts a Save-as instead of toggling', () => {
    const props = setup()
    fireEvent.click(screen.getByLabelText('Health'))
    expect(props.onToggleVisible).not.toHaveBeenCalled()
    expect(screen.getByText(/Save changes as a new preset/i)).toBeTruthy()
  })

  it('toggles directly when a custom preset is active', () => {
    const props = setup({ isDefaultActive: false, activePreset: 'Mine', presetNames: ['Default', 'Mine'] })
    fireEvent.click(screen.getByLabelText('Health'))
    expect(props.onToggleVisible).toHaveBeenCalledWith('breadth_score')
  })

  it('changing an option on a custom preset calls onSetOption', () => {
    const props = setup({ isDefaultActive: false, activePreset: 'Mine', presetNames: ['Default', 'Mine'] })
    fireEvent.change(screen.getByLabelText('Max spokes'), { target: { value: '8' } })
    expect(props.onSetOption).toHaveBeenCalledWith('maxSpokes', 8)
  })
})
