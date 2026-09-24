// Wave 6 item 9 — the editor's tag field: chips that remove, a field that adds
// with the member's own tags suggested (TagSuggestInput), reporting DELTAS.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NoteTagsField from './NoteTagsField'

const NODES = [
  { key: 'research', path: 'research', own: 2, total: 5 },
  { key: 'research/semis', path: 'research/semis', own: 3, total: 3 },
]

describe('<NoteTagsField>', () => {
  it('shows each tag as a chip whose remove button reports THAT tag', () => {
    const onRemove = vi.fn()
    render(<NoteTagsField tags={['earnings', 'research/semis']} nodes={NODES} onRemove={onRemove} onAdd={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag research/semis' }))
    expect(onRemove).toHaveBeenCalledWith('research/semis')
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('Enter adds the typed tag (normalised, a leading # dropped) and clears the field', () => {
    const onAdd = vi.fn()
    render(<NoteTagsField tags={[]} nodes={NODES} onAdd={onAdd} onRemove={vi.fn()} />)
    const input = screen.getByRole('combobox', { name: 'Add a tag to this note' })
    fireEvent.change(input, { target: { value: '#research / nvda ' } })
    fireEvent.submit(input.closest('form'))
    expect(onAdd).toHaveBeenCalledWith('research/nvda')
    expect(input.value).toBe('')
  })

  it('suggests the member\'s own tags, hierarchy first', () => {
    render(<NoteTagsField tags={[]} nodes={NODES} onAdd={vi.fn()} onRemove={vi.fn()} />)
    const input = screen.getByRole('combobox', { name: 'Add a tag to this note' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'res' } })
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(options).toEqual(expect.arrayContaining(['research', 'research / semis']))
  })

  it('an empty field adds nothing; while busy nothing is reported', () => {
    const onAdd = vi.fn()
    const onRemove = vi.fn()
    const { rerender } = render(<NoteTagsField tags={['a']} nodes={NODES} onAdd={onAdd} onRemove={onRemove} />)
    fireEvent.submit(screen.getByRole('combobox', { name: 'Add a tag to this note' }).closest('form'))
    expect(onAdd).not.toHaveBeenCalled()
    rerender(<NoteTagsField tags={['a']} nodes={NODES} onAdd={onAdd} onRemove={onRemove} busy />)
    expect(screen.getByRole('button', { name: 'Remove tag a' }).disabled).toBe(true)
  })
})
