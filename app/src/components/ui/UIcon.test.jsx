import { render } from '@testing-library/react'
import UIcon, { UICON_NAMES } from './UIcon'

// PACKET-S CP3 (RG-21 §1c) — one new X-wordmark glyph added to the UIcon
// registry per this repo's icon convention (CLAUDE.md "UI Icons — UIcon"),
// rather than a raw inline SVG or an emoji.

test('xWordmark is registered in the icon set', () => {
  expect(UICON_NAMES).toContain('xWordmark')
})

test('xWordmark renders an svg, not null / a console warning', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { container } = render(<UIcon name="xWordmark" size={12} />)
  expect(container.querySelector('svg')).toBeTruthy()
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

// Control: an unregistered name DOES warn and renders nothing — proves the
// assertion above is actually exercising the "found" branch, not a silent
// no-op shared by every name.
test('an unknown icon name warns and renders nothing (control)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { container } = render(<UIcon name="not-a-real-icon-xyz" />)
  expect(container.querySelector('svg')).toBeNull()
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-a-real-icon-xyz'))
  warn.mockRestore()
})

test('xWordmark is distinct from the existing generic "x" close-icon', () => {
  const a = render(<UIcon name="x" gold={false} />).container.querySelector('svg').innerHTML
  const b = render(<UIcon name="xWordmark" gold={false} />).container.querySelector('svg').innerHTML
  expect(a).not.toBe(b)
})
