// The grid's group header carries data-guide="multiChart.groupHeader" (attribute only, Lead-approved 2026-11-10): the box the
// guide rings the "also in:" chips inside, by their own title ("Switch to <group>"), for pl-grid's pickGroup-by-chip
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import GroupHeatHeader from '../pages/charts/grid/GroupHeatHeader'

describe('the group header is a guide box', () => {
  it('its root carries data-guide="multiChart.groupHeader", and the chips inside keep their own titles', () => {
    const { container } = render(<GroupHeatHeader groupName="Space" holdings={[]} alsoIn={[{ id: 'g2', name: 'Satellites' }]} onSwitch={() => {}} />)
    const box = container.querySelector('[data-guide="multiChart.groupHeader"]')
    expect(box).toBeTruthy()
    expect(box.className).toBe('groupHeatHeader')
    expect(box.querySelector('[title="Switch to Satellites"]')).toBeTruthy()
  })
})
