import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
import NameDialog, { ZERO_MATCH_NOTE } from '../NameDialog'

test('B17: a note is shown under the name and read with the field', () => {
  render(<NameDialog title="Save as a screen" label="Screen name" note={ZERO_MATCH_NOTE} onSubmit={vi.fn()} onCancel={vi.fn()} />)
  const note = screen.getByTestId('name-dialog-note')
  expect(note).toHaveTextContent(/Nothing matches this screen today/)
  const input = screen.getByLabelText('Screen name')
  expect(input.getAttribute('aria-describedby')).toBe(note.id)
})

test('the note does not block saving', () => {
  const onSubmit = vi.fn()
  render(<NameDialog title="Save as a screen" label="Screen name" note={ZERO_MATCH_NOTE} onSubmit={onSubmit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Screen name'), { target: { value: 'Empty one' } })
  fireEvent.submit(screen.getByRole('dialog'))
  expect(onSubmit).toHaveBeenCalledWith('Empty one')
})

test('no note, no describedby and nothing extra rendered', () => {
  render(<NameDialog title="Save as a screen" label="Screen name" onSubmit={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.queryByTestId('name-dialog-note')).toBeNull()
  expect(screen.getByLabelText('Screen name')).not.toHaveAttribute('aria-describedby')
})
