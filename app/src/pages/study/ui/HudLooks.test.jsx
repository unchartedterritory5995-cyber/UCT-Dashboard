import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { HudJourney, HudRoute, HudScoreboard } from './HudLooks'

// Focus round 1: three status lines on the same inputs as Hud. Each must say where the run is and how many were named,
// and mark a miss as a miss, whatever it looks like.
const RUN = { step: 3, total: 8, results: [true, true, false, true], live: false }

describe('the status line, three versions', () => {
  it.each([['journey', HudJourney], ['scoreboard', HudScoreboard], ['route', HudRoute]])('%s names the chart in play and the count named', (_k, C) => {
    const { getByRole } = render(<C {...RUN} />)
    expect(getByRole('group').getAttribute('aria-label')).toBe('Hard mode, chart 4 of 8, 3 named')
  })
  it('journey fills to the charts answered and notches the one miss', () => {
    const { container } = render(<HudJourney {...RUN} />)
    expect(container.querySelector('[class*="jFill"]').style.width).toBe('50%')
    expect(container.querySelectorAll('[class*="jMiss"]')).toHaveLength(1)
  })
  it('journey counts a streak only from the end of the run', () => {
    const { container } = render(<HudJourney step={4} total={8} results={[true, false, true, true, true]} />)
    expect(container.querySelector('[class*="flame"] b').textContent).toBe('3')
  })
  it('scoreboard lights one slot per answered chart, a miss red', () => {
    const { container } = render(<HudScoreboard {...RUN} />)
    const slots = [...container.querySelector('[class*="bSlots"]').children]
    expect(slots).toHaveLength(8)
    expect(slots.filter((x) => x.className.includes('done'))).toHaveLength(3)
    expect(slots.filter((x) => x.className.includes('miss'))).toHaveLength(1)
  })
  it('route puts the compass on the chart in play', () => {
    const { container } = render(<HudRoute step={2} total={8} results={[true, false]} live />)
    expect(container.querySelector('[class*="rShip"]').style.left).toBe(`${4 + (2 / 7) * 92}%`)
  })
})
