import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { StartArena, StartBriefing, StartLegendary } from './StartLooks'

// Focus round 4: three start screens. Each must say the run's size, start it, and hold Start while the bank loads.
describe('the start screen, three versions', () => {
  it.each([['arena', StartArena, 'Start', /8 for 8/], ['legendary', StartLegendary, 'Start', /Name 8 charts/], ['briefing', StartBriefing, 'Deal the charts', /8 for 8/]])('%s starts the run and names its size', (_k, C, label, size) => {
    const onStart = vi.fn()
    const { getByText, container } = render(<C total={8} ready onStart={onStart} />)
    expect(container.textContent).toMatch(size)
    fireEvent.click(getByText(label))
    expect(onStart).toHaveBeenCalledTimes(1)
  })
  it.each([['arena', StartArena], ['legendary', StartLegendary], ['briefing', StartBriefing]])('%s holds Start while the charts load', (_k, C) => {
    const { getByText } = render(<C total={8} ready={false} onStart={() => {}} />)
    expect(getByText('Loading the charts').closest('button').disabled).toBe(true)
  })
})
