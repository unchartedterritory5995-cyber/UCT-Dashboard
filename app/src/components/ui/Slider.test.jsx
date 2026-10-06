import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Slider from './Slider'

describe('ui/Slider', () => {
  it('is a native range input whatever type the caller passes, with its props forwarded', () => {
    const onChange = vi.fn()
    render(<Slider type="text" data-testid="s" aria-label="Session" min={0} max={10} step={1}
                   value={5} onChange={onChange} title="t" className="mine" />)
    const el = screen.getByTestId('s')
    expect(el.tagName).toBe('INPUT')
    expect(el.getAttribute('type')).toBe('range')
    expect(screen.getByRole('slider', { name: 'Session' })).toBe(el)
    expect(el.value).toBe('5')
    expect(el.getAttribute('step')).toBe('1')
    expect(el.getAttribute('title')).toBe('t')
    expect(el.className).toMatch(/mine/)
    fireEvent.change(el, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('paints the filled part of the track from the controlled value', () => {
    const { rerender } = render(<Slider data-testid="s" min={10} max={20} value={15} onChange={() => {}} />)
    expect(screen.getByTestId('s').style.getPropertyValue('--slider-fill')).toBe('50%')
    rerender(<Slider data-testid="s" min={10} max={20} value={99} onChange={() => {}} />)
    expect(screen.getByTestId('s').style.getPropertyValue('--slider-fill')).toBe('100%')
    rerender(<Slider data-testid="s" min={0} max={0} value={0} onChange={() => {}} />)
    expect(screen.getByTestId('s').style.getPropertyValue('--slider-fill')).toBe('0%')
  })

  it('keeps disabled as the native attribute', () => {
    render(<Slider data-testid="s" value={0} disabled onChange={() => {}} />)
    expect(screen.getByTestId('s')).toBeDisabled()
  })
})
