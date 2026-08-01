import { describe, it, expect } from 'vitest'
import { IND_TOKENS, ALPHA, resolveToken, resolveZone, MARKER_SHAPES, MARKER_SIZES, ZONE_STATES, LINE_WIDTHS } from './designTokens'
import { PRESETS } from './chartDefaults'

describe('chart design tokens', () => {
  it('covers all four chart presets', () => {
    expect(Object.keys(IND_TOKENS).sort()).toEqual(['classic', 'light', 'oled', 'tradingview'])
  })

  it('every preset defines every semantic role', () => {
    const roles = ['bull','bear','neutral','warn','info','premium','ink','inkMuted','surface']
    for (const [preset, map] of Object.entries(IND_TOKENS)) {
      for (const r of roles) expect(map[r], `${preset}.${r}`).toBeTruthy()
    }
  })

  it('warn is NOT gold in any preset — the spec forbids conflating them', () => {
    for (const [preset, map] of Object.entries(IND_TOKENS)) {
      expect(map.warn.toLowerCase(), preset).not.toBe(map.premium.toLowerCase())
    }
  })

  it('resolves a bare token to that preset colour', () => {
    expect(resolveToken('token:bull', 'classic')).toBe(IND_TOKENS.classic.bull)
  })

  it('resolves an @alpha suffix to rgba at the named ramp step', () => {
    const out = resolveToken('token:bull@band', 'classic')
    expect(out).toMatch(/^rgba\(/)
    expect(out).toContain('0.16')
  })

  it('passes raw colours through untouched', () => {
    expect(resolveToken('#ff0000', 'classic')).toBe('#ff0000')
    expect(resolveToken('rgba(1,2,3,0.5)', 'classic')).toBe('rgba(1,2,3,0.5)')
  })

  it('returns null for an unknown token rather than a wrong colour', () => {
    expect(resolveToken('token:nope', 'classic')).toBeNull()
    expect(resolveToken('token:bull@nope', 'classic')).toBeNull()
  })

  it('exposes the locked marker + zone + width vocabularies', () => {
    expect(MARKER_SHAPES).toHaveLength(6)
    expect(Object.isFrozen(MARKER_SHAPES)).toBe(true)
    expect(Object.keys(MARKER_SIZES)).toEqual(['s','m','l'])
    expect(Object.keys(ZONE_STATES)).toEqual(['forming','active','mitigated','invalidated'])
    expect(LINE_WIDTHS).toEqual([1, 1.5, 2])
  })

  it('ALPHA is the named ramp, ascending', () => {
    const vals = Object.values(ALPHA)
    expect(vals).toEqual([...vals].sort((a,b) => a-b))
    expect(ALPHA['fill-faint']).toBe(0.08)
    expect(ALPHA.solid).toBe(1)
  })

  it('@solid returns the base colour, not a pointless rgba(...,1)', () => {
    expect(resolveToken('token:bull@solid', 'classic')).toBe(IND_TOKENS.classic.bull)
  })

  it('resolveZone applies the state ramp, and invalidated greys out to neutral', () => {
    const active = resolveZone('bull', 'active', 'classic')
    expect(active.border).toBe(IND_TOKENS.classic.bull)
    expect(active.fill).toContain('0.16')          // ALPHA.band
    expect(active.borderStyle).toBe('solid')

    // An invalidated zone no longer carries a bull/bear opinion.
    const dead = resolveZone('bull', 'invalidated', 'classic')
    expect(dead.border).toBe(IND_TOKENS.classic.neutral)
    expect(dead.fill).toContain('0.08')            // ALPHA['fill-faint']

    expect(resolveZone('bull', 'nope', 'classic')).toBeNull()
    expect(resolveZone('nope', 'active', 'classic')).toBeNull()
  })

  // The canvas colours live in chartDefaults.js PRESETS. designTokens.js
  // duplicates each preset's background/textColor as surface/ink so it stays a
  // dependency-free palette — this is the gate that stops the two drifting.
  it("each preset's surface + ink still match chartDefaults PRESETS", () => {
    for (const [preset, map] of Object.entries(IND_TOKENS)) {
      const settings = PRESETS[preset].settings
      expect(map.surface, `${preset}.surface vs PRESETS.${preset}.background`)
        .toBe(settings.background)
      expect(map.ink, `${preset}.ink vs PRESETS.${preset}.textColor`)
        .toBe(settings.textColor)
    }
  })
})
