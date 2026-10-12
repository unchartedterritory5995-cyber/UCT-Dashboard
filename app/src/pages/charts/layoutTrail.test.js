import { describe, it, expect } from 'vitest'
import { recordSwitch, observeActive, recentLayouts, TRAIL_MAX } from './layoutTrail'

const L = (id, name, scope = 'user') => ({ id, name, scope })

describe('layoutTrail — this tab\'s previously open layouts', () => {
  it('the layout LEFT goes to the front; the one open now is never listed', () => {
    let t = recordSwitch([], L(1, 'A'), L(2, 'B'))
    expect(t).toEqual([L(1, 'A')])
    t = recordSwitch(t, L(2, 'B'), L(1, 'A'))
    expect(recentLayouts(t, 1)).toEqual([L(2, 'B')])           // Alt-Tab: back from A is B
  })
  it('de-duplicates by id, keeps at most TRAIL_MAX, and never records an unsaved board', () => {
    let t = []
    for (let i = 1; i <= TRAIL_MAX + 3; i++) t = recordSwitch(t, L(i, `L${i}`), L(i + 1, `L${i + 1}`))
    expect(t).toHaveLength(TRAIL_MAX)
    t = recordSwitch(t, L(5, 'L5'), L(99, 'X'))
    expect(t.filter(e => e.id === 5)).toHaveLength(1)
    expect(t[0].id).toBe(5)
    expect(recordSwitch(t, null, L(7, 'L7'))).toBe(t)            // a blank board left: nothing to go back to
    expect(recordSwitch(t, { id: null }, L(7, 'L7'))).toBe(t)
  })
  it('observeActive: every pointer change is one switch; a re-render or a rename is not', () => {
    const s = { last: null, trail: [] }
    observeActive(s, L(1, 'A'))                                 // first load: nothing was left
    expect(s.trail).toEqual([])
    observeActive(s, L(1, 'A'))
    observeActive(s, L(1, 'A renamed'))                         // same id
    expect(s.trail).toEqual([])
    observeActive(s, L(2, 'B'))
    expect(s.trail).toEqual([L(1, 'A renamed')])
    observeActive(s, null)                                      // New layout: a blank board
    observeActive(s, L(3, 'C'))
    expect(s.trail.map(e => e.id)).toEqual([2, 1])              // the blank board is not an entry
    observeActive(s, L(3, 'C'))                                 // StrictMode double render: idempotent
    expect(s.trail.map(e => e.id)).toEqual([2, 1])
  })
})
