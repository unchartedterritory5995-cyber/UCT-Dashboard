import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AskInsertView from './AskInsertView'

const node = { attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'What about margins?' } }

describe('AskInsertView', () => {
  it('labels the block as coming from Ask Notebook, with its date', () => {
    render(<AskInsertView node={node} />)
    expect(screen.getByText('From Ask Notebook')).toBeInTheDocument()
    expect(screen.getByText(/Sep 22, 2026/)).toBeInTheDocument()
  })

  it('names the block with its question for assistive tech', () => {
    render(<AskInsertView node={node} />)
    expect(screen.getByRole('group', { name: 'Answer from Ask Notebook to: What about margins?' })).toBeInTheDocument()
  })

  it('the label row is not editable', () => {
    render(<AskInsertView node={node} />)
    expect(screen.getByText('From Ask Notebook').closest('[contenteditable="false"]')).not.toBeNull()
  })
})
