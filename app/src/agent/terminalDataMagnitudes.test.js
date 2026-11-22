// TERM-066: the Agent's terminal-data money words moved onto the shared compact formatter
// (lib/presentation/presentationPrimitives.formatCompact). The text a member reads must not move:
// each migrated function is held, byte for byte, to a FROZEN ORACLE — its pre-migration body, run
// in-process here — over a grid that crosses every tier edge and rounding boundary.
import { describe, it, expect } from 'vitest'
import { millions } from './capabilities/terminalDataFormat'
import { revenueText } from './capabilities/terminalDataWave3'

// ⛔ The bodies as they stood on master 72f48e5403 (a810ab8113 / edcab81d3e). Do not "fix" them.
const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const OLD_MILLIONS = (v) => (finite(v) ? `$${(v / 1e6).toFixed(1)}M` : null)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const OLD_REVENUE = (v) => (num(v) == null || v <= 0 ? null : v >= 1000 ? `$${(v / 1000).toFixed(2)}B` : `$${v.toFixed(1)}M`)

const EDGES = [0, 1, 999, 1000, 49_999, 50_000, 99_999, 949_999, 950_000, 999_949, 999_950, 999_999,
  1e6, 1_049_999, 1_050_000, 25e6, 25_049_999, 25_050_000, 180e6, 999_949_999, 999_950_000, 999_999_999,
  1e9, 1.5e9, 2.5e12]
const REVENUE = [0.01, 0.04, 0.05, 0.4, 0.95, 1, 9.95, 99.94, 99.95, 520, 999.94, 999.95, 999.96, 999.99,
  1000, 1000.004, 1000.005, 1234.565, 50000, 52000, 2_910_000]
const ABSENT = [null, undefined, NaN, Infinity, -Infinity, '25000000', {}, []]

describe('TERM-066: the terminal-data money words read exactly as before', () => {
  it('millions(): every non-negative amount, byte for byte', () => {
    for (const v of EDGES) expect(millions(v), String(v)).toBe(OLD_MILLIONS(v))
  })

  it('millions(): a negative amount puts the sign OUTSIDE the "$" (the house grammar)', () => {
    // The one deliberate difference: "$-25.0M" was a typo-looking form; every caller today passes
    // a magnitude (net premium is Math.abs'd), so no member answer moves.
    expect(millions(-25e6)).toBe('-$25.0M')
    expect(OLD_MILLIONS(-25e6)).toBe('$-25.0M')
  })

  it('millions(): nothing to state is still null', () => {
    for (const v of ABSENT) expect(millions(v), String(v)).toBe(null)
  })

  it('revenueText(): every amount in millions, byte for byte, including the "$1000.0M" edge', () => {
    for (const v of [...REVENUE, ...EDGES.map((e) => e / 1e6)]) expect(revenueText(v), String(v)).toBe(OLD_REVENUE(v))
    for (const v of [...ABSENT, 0, -5]) expect(revenueText(v), String(v)).toBe(null)
  })
})
