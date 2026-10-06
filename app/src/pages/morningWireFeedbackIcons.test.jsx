import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import UIcon from '../components/ui/UIcon'
import { FEEDBACK_ICON_PATHS, feedbackIconSvg } from './morningWireFeedbackIcons'

const pathsOf = (root) => [...root.querySelectorAll('path')].map((p) => p.getAttribute('d'))

describe('Morning Wire feedback icons', () => {
  for (const name of Object.keys(FEEDBACK_ICON_PATHS)) {
    it(`${name} carries exactly UIcon's path data`, () => {
      const { container } = render(<UIcon name={name} gold={false} />)
      const real = pathsOf(container)
      expect(real.length).toBeGreaterThan(0)
      expect(FEEDBACK_ICON_PATHS[name]).toEqual(real)
    })
  }

  it('renders currentColor svg markup with no emoji', () => {
    const html = feedbackIconSvg('thumbsUp', 14)
    const host = document.createElement('div')
    host.innerHTML = html
    expect(host.querySelector('svg').getAttribute('stroke')).toBe('currentColor')
    expect(pathsOf(host)).toEqual(FEEDBACK_ICON_PATHS.thumbsUp)
    expect(html).not.toMatch(/[\u{1F44D}\u{1F44E}✎]/u)
  })

  it('returns empty for an unknown glyph (control: the lookup can miss)', () => {
    expect(feedbackIconSvg('nope')).toBe('')
  })
})
