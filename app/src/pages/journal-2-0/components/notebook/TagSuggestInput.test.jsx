import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import TagSuggestInput from './TagSuggestInput'

const NODES = [
  { path: 'research', key: 'research', own: 1, total: 4 },
  { path: 'research/semis', key: 'research/semis', own: 2, total: 3 },
  { path: 'research/semis/nvda', key: 'research/semis/nvda', own: 1, total: 1 },
  { path: 'swing', key: 'swing', own: 6, total: 6 },
]

function Harness({ onSubmit }) {
  const [v, setV] = useState('')
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(v) }}>
      <TagSuggestInput value={v} onChange={setV} nodes={NODES} ariaLabel="Tag to add" />
      <output data-testid="value">{v}</output>
    </form>
  )
}

const setup = () => {
  const onSubmit = vi.fn()
  render(<Harness onSubmit={onSubmit} />)
  return { onSubmit, input: screen.getByRole('combobox', { name: 'Tag to add' }) }
}

describe('TagSuggestInput', () => {
  it('typing offers the hierarchy as a listbox, each option showing its parents', () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: 'res' } })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      'research', 'research / semis', 'research / semis / nvda',
    ])
  })

  it('↓ then Enter takes the highlighted suggestion and does NOT submit yet', () => {
    const { input, onSubmit } = setup()
    fireEvent.change(input, { target: { value: 'res' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('value')).toHaveTextContent('research/semis')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Enter with nothing highlighted is left to the form — a brand-new tag is allowed', () => {
    const { input, onSubmit } = setup()
    fireEvent.change(input, { target: { value: 'res' } })       // list open, nothing highlighted
    // jsdom performs no implicit submission, so assert the half this
    // component owns: it did NOT swallow the Enter (default not prevented)…
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
    // …whereas with a suggestion highlighted, it does.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
    // and what the form then receives is exactly the field's text
    fireEvent.change(input, { target: { value: 'brand/new' } })
    fireEvent.submit(input.closest('form'))
    expect(onSubmit).toHaveBeenCalledWith('brand/new')
  })

  it('a pointer takes a suggestion without stealing focus from the field', () => {
    const { input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'research/' } })
    const option = screen.getByRole('option', { name: 'research / semis / nvda' })
    const down = fireEvent.mouseDown(option)
    expect(down).toBe(false) // default prevented: the input keeps focus
    expect(screen.getByTestId('value')).toHaveTextContent('research/semis/nvda')
  })

  it('Esc closes the list and the typed text stays', () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: 'sw' } })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByTestId('value')).toHaveTextContent('sw')
  })

  it('no suggestions, no empty popup', () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('the field and every suggestion are finger targets at the touch tier', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/pages/journal-2-0/components/notebook/TagSuggestInput.module.css'), 'utf8',
    ).replace(/\r\n/g, '\n')
    const touch = /@media\s*\(max-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(touch).not.toBeNull()
    expect(touch[1]).toMatch(/\.input,\s*\.option\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
  })
})
