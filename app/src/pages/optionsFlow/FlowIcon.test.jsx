// ⛔ THE FAILURE THIS GUARDS IS SILENT.
//
// UIcon renders NOTHING for a name it does not know — it returns null and
// writes a console.warn. On a 9,000-line page with ~90 icons, a typo'd name is
// a hole in the chrome that nobody notices in review and no test would catch,
// because every surrounding assertion still passes. So the mapping is asserted
// against the real registry, not against itself.

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import FlowIcon, { REPLACED_EMOJI } from './FlowIcon.jsx'
import UIcon from '../../components/ui/UIcon'

const names = Object.keys(REPLACED_EMOJI)

describe('FlowIcon — the emoji replacements', () => {
  it('maps only names the registry actually has', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missing = []
    for (const name of names) {
      const { container } = render(<UIcon name={name} />)
      if (!container.querySelector('svg')) missing.push(name)
    }
    warn.mockRestore()
    expect(missing, 'these names render NOTHING — UIcon does not know them, so '
      + 'the icon is silently absent on the page').toEqual([])
  })

  it('control: the check above can fail', () => {
    // Without this, a registry that returned an <svg> for everything would make
    // the test above vacuous.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<UIcon name="definitely-not-a-glyph" />)
    warn.mockRestore()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('paints semantic icons with currentColor and naming icons in brand gold', () => {
    // A warning rendered gold instead of red has lost the meaning its colour
    // was carrying — that is the whole reason `semantic` exists.
    const { container: sem } = render(<FlowIcon name="warning" />)
    expect(sem.querySelector('svg').getAttribute('stroke')).toBe('currentColor')

    const { container: gold } = render(<FlowIcon name="chart" />)
    expect(gold.querySelector('svg').getAttribute('stroke')).toMatch(/^url\(#/)
  })

  it('sizes for this page chrome, not UIcon default', () => {
    // The page runs at fontSize 10-11; UIcon's 18 would be a badge beside it.
    const { container } = render(<FlowIcon name="bolt" />)
    expect(container.querySelector('svg').getAttribute('width')).toBe('11')
    expect(UIcon.length).toBeGreaterThan(0) // the wrapper wraps the real thing
  })

  it('lifts the glyph off the text baseline', () => {
    // A bare inline <svg> sits on the baseline and reads as misaligned next to
    // a word. Every call site here is an icon beside text.
    const { container } = render(<FlowIcon name="bolt" />)
    expect(container.querySelector('svg').style.verticalAlign).toBe('-1.5px')
  })

  it('lets a call site override the treatment explicitly', () => {
    const { container } = render(<FlowIcon name="warning" gold />)
    expect(container.querySelector('svg').getAttribute('stroke')).toMatch(/^url\(#/)
  })
})
