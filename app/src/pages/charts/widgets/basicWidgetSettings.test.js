import { describe, it, expect } from 'vitest'
import {
  isLegacyBasicLightDefault,
  basicDefaultsForTheme,
  mergeBasicWidgetSettings,
  BASIC_WIDGET_DEFAULTS,
} from './basicWidgetSettings'

// The AI-search widget persisted a legacy white/black auto-default before the dark,
// theme-aware default existed. That stale global blob pinned the widget white on OLED.
// isLegacyBasicLightDefault lets the widget treat it as uncustomized → theme default.
describe('isLegacyBasicLightDefault', () => {
  it('matches the legacy white + pure-black blob (the observed prod value)', () => {
    expect(isLegacyBasicLightDefault({ bgMode: 'solid', bg: '#ffffff', textColor: '#000000' })).toBe(true)
  })

  it('matches the later white + #1f2328 light default too', () => {
    expect(isLegacyBasicLightDefault({ bg: '#ffffff', textColor: '#1f2328' })).toBe(true)
  })

  it('is case-insensitive on the hex', () => {
    expect(isLegacyBasicLightDefault({ bg: '#FFFFFF', textColor: '#000000' })).toBe(true)
  })

  it('does NOT match the dark default (must be kept)', () => {
    expect(isLegacyBasicLightDefault(BASIC_WIDGET_DEFAULTS)).toBe(false)
  })

  it('does NOT match a genuine custom pick (white bg but a chosen non-default text)', () => {
    expect(isLegacyBasicLightDefault({ bg: '#ffffff', textColor: '#ff0000' })).toBe(false)
  })

  it('does NOT match a gradient canvas', () => {
    expect(isLegacyBasicLightDefault({ bgMode: 'gradient', bg: '#ffffff', textColor: '#000000' })).toBe(false)
  })

  it('is false for null / non-object', () => {
    expect(isLegacyBasicLightDefault(null)).toBe(false)
    expect(isLegacyBasicLightDefault('x')).toBe(false)
  })
})

describe('AI-search resolution: legacy blob falls through to the theme default', () => {
  const legacy = { bgMode: 'solid', bg: '#ffffff', textColor: '#000000' }
  const resolve = (saved, theme) =>
    mergeBasicWidgetSettings((isLegacyBasicLightDefault(saved) ? null : saved) ?? basicDefaultsForTheme(theme))

  it('OLED + legacy blob → the theme default dark canvas (the fix)', () => {
    // Falls through to the app-theme-matched default (OLED → obsidian near-black),
    // NOT the legacy white. Assert against the theme default so it stays robust to
    // the exact matched hex.
    const bg = resolve(legacy, 'oled').bg
    expect(bg).toBe(basicDefaultsForTheme('oled').bg)
    expect(bg).not.toBe('#ffffff')
  })

  it('light theme + legacy blob → white canvas (unchanged for light users)', () => {
    expect(resolve(legacy, 'light').bg).toBe('#ffffff')
  })

  it('a genuine custom blob is preserved on any theme', () => {
    expect(resolve({ bg: '#123456', textColor: '#abcdef' }, 'oled').bg).toBe('#123456')
  })
})
