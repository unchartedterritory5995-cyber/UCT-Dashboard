// The Breadth Views' palette follows the live surface: unchanged on dark, every
// ink nudged to 3:1 on a light theme, and re-resolved on a theme switch.
import { describe, it, expect, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import useViewColors, { adaptViewColors } from './useViewColors'
import { PALETTES, resolveViewColors } from './breadthViewShared'
import { contrastRatio } from '../../../lib/theme'

const root = () => document.documentElement
afterEach(() => { root().removeAttribute('data-theme'); root().removeAttribute('style') })

describe('adaptViewColors', () => {
  it('returns every palette exactly as declared on a dark surface', () => {
    for (const key of Object.keys(PALETTES)) {
      const c = resolveViewColors(key)
      expect(adaptViewColors(c, '#17181b')).toBe(c)
    }
  })

  it('clears 3:1 for every ink of every palette on a light surface', () => {
    for (const key of Object.keys(PALETTES)) {
      const c = adaptViewColors(resolveViewColors(key), '#f4f5f6')
      for (const ink of [...Object.values(c.tier), c.bull, c.bear]) {
        expect(contrastRatio(ink, '#f4f5f6'), `${key} ${ink}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

function Probe() {
  const c = useViewColors('classic', 'normal')
  return <span data-testid="g1">{c.tier.g1}</span>
}

describe('useViewColors', () => {
  it('re-resolves when the member switches to a light theme', async () => {
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('g1').textContent).toBe(PALETTES.classic.tier.g1)
    await act(async () => {
      root().setAttribute('data-theme', 'light')
      root().style.setProperty('--bg-surface', '#f4f5f6')
    })
    await act(async () => { await Promise.resolve() })
    const g1 = getByTestId('g1').textContent
    expect(g1).not.toBe(PALETTES.classic.tier.g1)
    expect(contrastRatio(g1, '#f4f5f6')).toBeGreaterThanOrEqual(3)
  })
})
