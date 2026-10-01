// Input · Select · Checkbox · FieldError — the semantics the primitives own,
// asserted on the rendered DOM. TERM-067 (FB-S10-03).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import Input from './Input'
import Select from './Select'
import Checkbox from './Checkbox'
import FieldError, { errorIdFor, fieldAria } from './FieldError'

afterEach(cleanup)
const one = (ui) => render(ui).container.firstChild
const html = (ui) => { const h = one(ui).outerHTML; cleanup(); return h }

describe('with no error, each primitive is the element a caller would have written by hand', () => {
  it('Input', () => {
    expect(html(<Input className="c" value="x" onChange={() => {}} />))
      .toBe(html(<input type="text" className="c" value="x" onChange={() => {}} />))
    expect(html(<Input type="date" className="c" value="2026-01-02" onChange={() => {}} />))
      .toBe(html(<input type="date" className="c" value="2026-01-02" onChange={() => {}} />))
  })

  it('Select, by children and by options', () => {
    const hand = html(
      <select className="c" value="b" onChange={() => {}}>
        <option value="a">A</option><option value="b">B</option>
      </select>,
    )
    expect(html(
      <Select className="c" value="b" onChange={() => {}}>
        <option value="a">A</option><option value="b">B</option>
      </Select>,
    )).toBe(hand)
    expect(html(
      <Select className="c" value="b" onChange={() => {}}
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />,
    )).toBe(hand)
  })

  it('Checkbox', () => {
    expect(html(<Checkbox checked onChange={() => {}} />))
      .toBe(html(<input type="checkbox" checked onChange={() => {}} />))
  })
})

describe('the error link — one derivation, both ends', () => {
  it('fieldAria: no error is no attributes; an error with an id points at the FieldError', () => {
    expect(fieldAria({ id: 'f', error: null })).toEqual({ 'aria-invalid': undefined, 'aria-describedby': undefined })
    expect(fieldAria({ id: 'f', error: '' })['aria-invalid']).toBeUndefined()
    expect(fieldAria({ id: 'f', error: 'bad' })).toEqual({ 'aria-invalid': true, 'aria-describedby': 'f-error' })
    expect(fieldAria({ error: 'bad' })).toEqual({ 'aria-invalid': true, 'aria-describedby': undefined })
    expect(fieldAria({ id: 'f', error: true, describedBy: 'hint' })['aria-describedby']).toBe('hint f-error')
    expect(fieldAria({ id: 'f', error: null, describedBy: 'hint' })['aria-describedby']).toBe('hint')
  })

  it.each([
    ['Input', (p) => <Input {...p} />],
    ['Select', (p) => <Select {...p} options={['a']} />],
    ['Checkbox', (p) => <Checkbox {...p} />],
  ])('%s carries aria-invalid and describes itself by the message that FieldError renders', (_n, make) => {
    const { container } = render(
      <div>
        {make({ id: 'end', error: 'End must be after start', onChange: () => {} })}
        <FieldError forId="end">End must be after start</FieldError>
      </div>,
    )
    const control = container.querySelector('#end')
    expect(control.getAttribute('aria-invalid')).toBe('true')
    const described = container.querySelector(`#${control.getAttribute('aria-describedby')}`)
    expect(described).not.toBeNull()
    expect(described.getAttribute('role')).toBe('alert')
    expect(described.textContent).toBe('End must be after start')
    expect(described.id).toBe(errorIdFor('end'))
  })

  it('a caller cannot set aria-invalid by hand — it is derived from `error`', () => {
    expect(one(<Input aria-invalid="true" />).hasAttribute('aria-invalid')).toBe(false)
    cleanup()
    expect(one(<Select aria-invalid="true" />).hasAttribute('aria-invalid')).toBe(false)
    cleanup()
    expect(one(<Checkbox aria-invalid="true" />).hasAttribute('aria-invalid')).toBe(false)
  })

  it('FieldError renders nothing without a message, and owns its id and role', () => {
    expect(render(<FieldError forId="f" />).container.firstChild).toBeNull()
    cleanup()
    expect(render(<FieldError forId="f">{''}</FieldError>).container.firstChild).toBeNull()
    cleanup()
    expect(render(<FieldError forId="f">{false}</FieldError>).container.firstChild).toBeNull()
    cleanup()
    const el = one(<FieldError forId="f" id="mine" role="note" className="e">bad</FieldError>)
    expect(el.id).toBe('f-error')
    expect(el.getAttribute('role')).toBe('alert')
    expect(el.getAttribute('class')).toBe('e')
  })
})

describe('Input', () => {
  it('defaults to text, forwards other types, and refuses the two that are not its own', () => {
    expect(one(<Input />).getAttribute('type')).toBe('text')
    cleanup()
    expect(one(<Input type="number" />).getAttribute('type')).toBe('number')
    cleanup()
    expect(one(<Input type="checkbox" />).getAttribute('type')).toBe('text')
    cleanup()
    expect(one(<Input type="radio" />).getAttribute('type')).toBe('text')
  })

  it('forwards a ref, a name and a handler', () => {
    const ref = createRef()
    const onChange = vi.fn()
    const el = one(<Input ref={ref} aria-label="Start" onChange={onChange} />)
    expect(ref.current).toBe(el)
    fireEvent.change(el, { target: { value: 'a' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('Select', () => {
  it('a string option is its own value and label; a disabled option stays disabled', () => {
    const el = one(<Select options={['D', { value: 'W', label: 'Weekly', disabled: true }]} />)
    const [d, w] = el.querySelectorAll('option')
    expect([d.value, d.textContent]).toEqual(['D', 'D'])
    expect([w.value, w.textContent, w.disabled]).toEqual(['W', 'Weekly', true])
    expect(d.hasAttribute('disabled')).toBe(false)
  })
})

describe('Checkbox', () => {
  it('is always a checkbox — a caller cannot change the type', () => {
    expect(one(<Checkbox type="text" />).getAttribute('type')).toBe('checkbox')
  })

  it('keeps the indeterminate PROPERTY in step, which no attribute can express', () => {
    const { container, rerender } = render(<Checkbox indeterminate />)
    expect(container.firstChild.indeterminate).toBe(true)
    rerender(<Checkbox indeterminate={false} />)
    expect(container.firstChild.indeterminate).toBe(false)
    rerender(<Checkbox />)
    expect(container.firstChild.indeterminate).toBe(false)
  })

  it('hands the element to an object ref and to a callback ref', () => {
    const obj = createRef()
    const el = one(<Checkbox ref={obj} />)
    expect(obj.current).toBe(el)
    cleanup()
    const fn = vi.fn()
    const el2 = one(<Checkbox ref={fn} />)
    expect(fn).toHaveBeenCalledWith(el2)
  })

  it('a click still reaches the handler', () => {
    const onChange = vi.fn()
    fireEvent.click(one(<Checkbox checked={false} onChange={onChange} />))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
