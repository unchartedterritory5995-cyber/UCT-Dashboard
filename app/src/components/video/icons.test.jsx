import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PauseIcon, CloseIcon, MinimizeIcon, ExpandIcon, NextIcon, DragIcon } from './icons'

describe('video icons', () => {
  it('every control icon renders an <svg> at the requested size', () => {
    for (const Icon of [PauseIcon, CloseIcon, MinimizeIcon, ExpandIcon, NextIcon, DragIcon]) {
      const { container } = render(<Icon size={20} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeTruthy()
      expect(svg.getAttribute('width')).toBe('20')
    }
  })
})
