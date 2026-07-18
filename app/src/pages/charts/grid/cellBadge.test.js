import { describe, it, expect } from 'vitest'
import { buildCellBadges } from './cellBadge'

describe('buildCellBadges', () => {
  it('merges live today% with static tier/rationale, index-aligned', () => {
    const cells = [{ id: 'a', sym: 'RKLB' }, { id: 'b', sym: 'ASTS' }, { id: 'c', sym: null }]
    const meta = { RKLB: { tier: 'core', rationale: 'Launch' }, ASTS: { tier: 'core', rationale: 'Sats' } }
    const live = { RKLB: { change_pct: 8.2 }, ASTS: { change_pct: -1.1 } }
    const out = buildCellBadges(cells, meta, live)
    expect(out[0]).toEqual({ changePct: 8.2, tier: 'core', rationale: 'Launch' })
    expect(out[1]).toEqual({ changePct: -1.1, tier: 'core', rationale: 'Sats' })
    expect(out[2]).toBeNull()   // empty cell -> no badge
  })

  it('tolerates missing meta / live (partial data)', () => {
    const cells = [{ id: 'a', sym: 'XYZ' }]
    const out = buildCellBadges(cells, {}, {})
    expect(out[0]).toEqual({ changePct: null, tier: null, rationale: '' })
  })
})
