// app/src/components/chart/ColorPicker.opacity.test.jsx
//
// ⭐⭐ COLOUR + OPACITY — a Pine script's colour input is the WHOLE colour, alpha
// included, the way TradingView's style colour is (`withOpacity`). The bytes are
// TradingView's: `round(opacity × 255)`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ColorPicker from './ColorPicker'

afterEach(() => cleanup())

const open = () => fireEvent.click(screen.getByTitle('C'))

describe('ColorPicker withOpacity', () => {
  it('the slider sets the alpha byte and keeps the hue', () => {
    const onChange = vi.fn()
    render(<ColorPicker withOpacity value="#FFFFFF0D" title="C" onChange={onChange} />)
    open()
    const range = screen.getByLabelText('Opacity')
    expect(range.value).toBe('5')
    fireEvent.change(range, { target: { value: '60' } })
    expect(onChange).toHaveBeenLastCalledWith('#FFFFFF99')
    // ⭐ raising a translucent colour to 100% is an EXPLICIT opaque pick (N3)
    fireEvent.change(range, { target: { value: '100' } })
    expect(onChange).toHaveBeenLastCalledWith('#FFFFFFFF')
  })

  it('a swatch takes the hue and KEEPS the current opacity', () => {
    const onChange = vi.fn()
    render(<ColorPicker withOpacity value="rgba(33,150,243,0.6)" title="C" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByTitle('#ef4444'))
    expect(onChange).toHaveBeenLastCalledWith('#EF444499')
  })

  it('an 8-digit hex is accepted from the text box', () => {
    const onChange = vi.fn()
    render(<ColorPicker withOpacity value="#FFFFFF" title="C" onChange={onChange} />)
    open()
    const box = screen.getByLabelText('Hex color')
    fireEvent.change(box, { target: { value: '#ffeb3b80' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('#FFEB3B80')
  })

  it('⛔ CONTROL — without withOpacity there is no slider and a swatch is used verbatim', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="#FFFFFF0D" title="C" onChange={onChange} />)
    open()
    expect(screen.queryByLabelText('Opacity')).toBeNull()
    fireEvent.click(screen.getByTitle('#ef4444'))
    expect(onChange).toHaveBeenLastCalledWith('#ef4444')
  })
})
