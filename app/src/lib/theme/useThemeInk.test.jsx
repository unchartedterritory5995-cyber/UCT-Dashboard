// The shared theme-ink resolver and its re-render hook.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import {
  resolveThemeColor, resolveThemeSize, resolveThemeInks, normalizeToken,
  withAlpha, isLightSurface, SEMANTIC_INK, contrastRatio, ensureContrast,
} from './index'
import { useThemeInk, __resetThemeObserverForTests } from './useThemeInk'

const root = () => document.documentElement

function clearRoot() {
  root().removeAttribute('data-theme')
  root().removeAttribute('style')
}

beforeEach(() => { clearRoot(); __resetThemeObserverForTests() })
afterEach(() => { clearRoot(); __resetThemeObserverForTests() })

// MutationObserver callbacks are microtasks; let them run.
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('resolveThemeColor', () => {
  it('reads a token off <html>, in every spelling', () => {
    root().style.setProperty('--gain', '#123456')
    expect(resolveThemeColor('--gain', '#000000')).toBe('#123456')
    expect(resolveThemeColor('gain', '#000000')).toBe('#123456')
    expect(resolveThemeColor('var(--gain)', '#000000')).toBe('#123456')
  })

  it('falls back when the token is unset (jsdom, no stylesheet)', () => {
    expect(resolveThemeColor('--info', '#5ea8f7')).toBe('#5ea8f7')
  })

  it('falls back rather than hand a canvas a colour-mix() it cannot parse (jsdom has no colour engine)', () => {
    root().style.setProperty('--mix', 'color-mix(in srgb, #dcbb5e 35%, transparent)')
    const out = resolveThemeColor('--mix', '#abcdef')
    // A real browser returns the mixed rgba; jsdom returns the fallback. Never the raw text.
    expect(out).not.toMatch(/color-mix/)
  })

  it('resolves sizes as numbers and maps', () => {
    root().style.setProperty('--text-xs', '11px')
    expect(resolveThemeSize('--text-xs', 10)).toBe(11)
    expect(resolveThemeSize('--text-nope', 10)).toBe(10)
    root().style.setProperty('--info', '#1f5d7a')
    expect(resolveThemeInks({ info: SEMANTIC_INK.info, xs: { size: '--text-xs', fallback: 10 } }))
      .toEqual({ info: '#1f5d7a', xs: 11 })
  })

  it('normalizes token names and alpha-mixes', () => {
    expect(normalizeToken('var(--x, #fff)')).toBe('--x')
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
    expect(withAlpha('rgb(1, 2, 3)', 0.2)).toBe('rgba(1, 2, 3, 0.2)')
    expect(isLightSurface('#ffffff')).toBe(true)
    expect(isLightSurface('#101012')).toBe(false)
  })
})

describe('ensureContrast', () => {
  it('returns a passing colour unchanged, and nudges a failing one to 3:1 keeping direction', () => {
    expect(ensureContrast('#5aa9e6', '#17181b')).toBe('#5aa9e6')
    const onLight = ensureContrast('#7ed957', '#ffffff')
    expect(contrastRatio(onLight, '#ffffff')).toBeGreaterThanOrEqual(3)
    const onDark = ensureContrast('#15803d', '#000000', 4.5)
    expect(contrastRatio(onDark, '#000000')).toBeGreaterThanOrEqual(4.5)
  })
  it('leaves translucent and unparsable colours alone', () => {
    expect(ensureContrast('rgba(255, 255, 255, 0.2)', '#ffffff')).toBe('rgba(255, 255, 255, 0.2)')
    expect(ensureContrast('var(--x)', '#ffffff')).toBe('var(--x)')
  })
})

function Probe({ onRender }) {
  const ink = useThemeInk({ gain: ['--gain', '#2faf68'], info: SEMANTIC_INK.info })
  onRender(ink)
  return <span data-testid="ink">{ink.gain} {ink.info}</span>
}

describe('useThemeInk', () => {
  it('re-renders with new values when data-theme changes', async () => {
    const seen = []
    const { getByTestId } = render(<Probe onRender={(i) => seen.push(i)} />)
    expect(getByTestId('ink').textContent).toBe('#2faf68 #5ea8f7')
    await act(async () => {
      root().setAttribute('data-theme', 'light')
      root().style.setProperty('--gain', '#1c7a45')
    })
    await flush()
    expect(getByTestId('ink').textContent).toBe('#1c7a45 #5ea8f7')
  })

  it('re-renders when a catalog theme changes ONLY inline tokens (data-theme unchanged)', async () => {
    root().setAttribute('data-theme', 'oled')
    const { getByTestId } = render(<Probe onRender={() => {}} />)
    expect(getByTestId('ink').textContent).toBe('#2faf68 #5ea8f7')
    await act(async () => { root().style.setProperty('--info', '#00aaff') })
    await flush()
    expect(getByTestId('ink').textContent).toBe('#2faf68 #00aaff')
  })

  it('does NOT re-render for an inline style write that is not a theme token', async () => {
    let renders = 0
    render(<Probe onRender={() => { renders += 1 }} />)
    const before = renders
    await act(async () => { root().style.overflow = 'hidden' })
    await flush()
    expect(renders).toBe(before)
  })
})
