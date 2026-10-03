import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

// COV-10 remainder: the widget dot with CHARTS_EXTRA_GROUPS_ENABLED off and on.
// The flag rides the auth payload (AuthContext.chartsExtraGroupsEnabled).
const authState = { value: {} }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authState.value }))

import WidgetHeader from './WidgetHeader'
import ChartTabStrip from './widgets/ChartTabStrip'

afterEach(() => { authState.value = {} })

function dot() { return screen.getByRole('button', { name: /color group|not linked/i }) }

describe('flag OFF', () => {
  test('D still cycles to N, never to E', () => {
    const onColorChange = vi.fn()
    render(<WidgetHeader label="W" color="D" onColorChange={onColorChange} onRemove={() => {}} />)
    dot().click()
    expect(onColorChange).toHaveBeenLastCalledWith('N')
  })

  test('a stored E is shown grey and SAID to be switched off, not remapped', () => {
    const onColorChange = vi.fn()
    render(<WidgetHeader label="W" color="E" onColorChange={onColorChange} onRemove={() => {}} />)
    const d = dot()
    expect(d).toHaveAttribute('data-group-suspended', 'E')
    expect(d.getAttribute('aria-label')).toMatch(/Group E is switched off: not linked/)
    expect(d.className).toMatch(/colorDotN/)
    expect(onColorChange).not.toHaveBeenCalled()
    d.click()
    expect(onColorChange).toHaveBeenLastCalledWith('A')
  })

  test('a suspended tab dot is still rendered (grey), so it can be clicked back', () => {
    const onCycleColor = vi.fn()
    render(<ChartTabStrip tabs={[{ id: 'main', isMain: true, label: 'Main' }, { id: 't1', isMain: false, label: 'T1' }]}
      activeIndex={1} tabColors={{ t1: 'G' }} onSelect={() => {}} onAdd={() => {}} onClose={() => {}} onRename={() => {}} onCycleColor={onCycleColor} />)
    const tabDot = screen.getByRole('button', { name: /linked color group/i })
    expect(tabDot).toHaveAttribute('data-group-suspended', 'G')
    expect(tabDot.style.background).toMatch(/107, 114, 128|#6b7280/)
  })
})

describe('flag ON', () => {
  test('D cycles to E, H to N', () => {
    authState.value = { chartsExtraGroupsEnabled: true }
    const onColorChange = vi.fn()
    const { rerender } = render(<WidgetHeader label="W" color="D" onColorChange={onColorChange} onRemove={() => {}} />)
    dot().click()
    expect(onColorChange).toHaveBeenLastCalledWith('E')
    rerender(<WidgetHeader label="W" color="H" onColorChange={onColorChange} onRemove={() => {}} />)
    dot().click()
    expect(onColorChange).toHaveBeenLastCalledWith('N')
  })

  test('a stored E is a real group: its own colour, not suspended', () => {
    authState.value = { chartsExtraGroupsEnabled: true }
    render(<WidgetHeader label="W" color="E" onColorChange={() => {}} onRemove={() => {}} />)
    const d = dot()
    expect(d).not.toHaveAttribute('data-group-suspended')
    expect(d.className).toMatch(/colorDotE/)
    expect(d.getAttribute('aria-label')).toBe('Color group E (click to cycle)')
  })

  test('only literal true is on', () => {
    authState.value = { chartsExtraGroupsEnabled: 'true' }
    const onColorChange = vi.fn()
    render(<WidgetHeader label="W" color="D" onColorChange={onColorChange} onRemove={() => {}} />)
    dot().click()
    expect(onColorChange).toHaveBeenLastCalledWith('N')
  })
})
