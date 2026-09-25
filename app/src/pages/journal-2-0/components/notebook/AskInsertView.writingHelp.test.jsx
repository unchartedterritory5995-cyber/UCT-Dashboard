// Wave 7 lane H (H2, ruling D-H1) — the askInsert node's label for an accepted
// writing-help result, and the no-schema-bump argument's other half: a node
// WITHOUT the new attrs (every Ask insert, every wave-5 insert) renders EXACTLY
// as it did before.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AskInsertView, { writingHelpLabel, insertedTimeLabel } from './AskInsertView'

const ASK = { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'What about margins?' }
const WH = {
  insertedAt: '2026-09-25T09:41:00', scope: 'selection', question: 'Rewrite — shorter',
  action: 'rewrite', model: 'claude-sonnet-5',
}

describe('AskInsertView — an Ask insert is untouched by the new attrs', () => {
  it('renders byte-identical HTML whether the new attrs are absent or null', () => {
    const { container: a } = render(<AskInsertView node={{ attrs: ASK }} />)
    const { container: b } = render(<AskInsertView node={{ attrs: { ...ASK, action: null, model: null } }} />)
    // UIcon numbers its gradient ids per render (uig1, uig2, …) — the only
    // difference two renders of the SAME markup can have; normalise it away.
    const norm = (html) => html.replace(/uig\d+/g, 'uigN')
    expect(norm(b.innerHTML)).toBe(norm(a.innerHTML))
  })

  it('keeps the Ask label, its date and its accessible name', () => {
    const { container } = render(<AskInsertView node={{ attrs: { ...ASK, action: null, model: null } }} />)
    expect(container.querySelector('[contenteditable="false"]').textContent)
      .toBe('From Ask Notebook · Sep 22, 2026')
    expect(screen.getByRole('group', { name: 'Answer from Ask Notebook to: What about margins?' }))
      .toBeInTheDocument()
  })
})

describe('AskInsertView — a writing-help result', () => {
  it('reads "Compass · Rewrite · claude-sonnet-5 · 09:41"', () => {
    const { container } = render(<AskInsertView node={{ attrs: WH }} />)
    expect(container.querySelector('[contenteditable="false"]').textContent)
      .toBe('Compass · Rewrite · claude-sonnet-5 · 09:41')
    expect(screen.queryByText('From Ask Notebook')).toBeNull()
  })

  it('is named for assistive tech by what was asked', () => {
    render(<AskInsertView node={{ attrs: WH }} />)
    expect(screen.getByRole('group', { name: 'Written with Compass writing help: Rewrite — shorter' }))
      .toBeInTheDocument()
  })

  it('the label row is chrome, never editable', () => {
    render(<AskInsertView node={{ attrs: WH }} />)
    expect(screen.getByText('Compass · Rewrite · claude-sonnet-5 · 09:41').closest('[contenteditable="false"]'))
      .not.toBeNull()
  })

  it('says only what it knows — never a raw attr, never "undefined"', () => {
    expect(writingHelpLabel({ action: 'summarize' })).toBe('Compass · Summarize')
    expect(writingHelpLabel({ action: 'hack<b>', model: 'm' })).toBe('Compass · m')
    expect(insertedTimeLabel('not a date')).toBe('')
    expect(writingHelpLabel({ action: 'translate', model: null, insertedAt: null })).toBe('Compass · Translate')
  })
})
