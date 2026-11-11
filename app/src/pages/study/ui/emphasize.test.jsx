import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import Emph from './emphasize'

// kit v2: the lesson's words are never changed; its numbers are set in bold so the eye can scan them
describe('Emph', () => {
  it('keeps the text and bolds the numbers a trader scans for', () => {
    const t = 'Here it opened 0.44% from the prior low, closed up 3.36% at $109.98, and ran +42.6% in 32 sessions on the 50-day.'
    const { container } = render(<p><Emph>{t}</Emph></p>)
    expect(container.textContent).toBe(t)
    expect([...container.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['0.44%', '3.36%', '$109.98', '+42.6%', '32 sessions', '50'])
  })
  it('leaves a digit glued to letters alone', () => {
    const { container } = render(<p><Emph>{'an E4H line'}</Emph></p>)
    expect(container.querySelectorAll('b')).toHaveLength(0)
  })
})
