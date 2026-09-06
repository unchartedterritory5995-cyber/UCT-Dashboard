/**
 * ImportWizardBoundary — crash-fallback sanitization (P1-1 fix).
 *
 * A conversion crash must not take down the Notebook tab, but the fallback
 * used to dump the raw JS exception (e.g. "TypeError: Cannot read
 * properties of…") straight to the member — an implementation detail with
 * no useful specificity to preserve, since a React render crash carries no
 * backend-authored detail (unlike NoteEditorPage's save-error paths).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ImportWizardBoundary } from './ImportWizard'

function Boom() {
  throw new TypeError("Cannot read properties of undefined (reading 'foo')")
}

describe('ImportWizardBoundary (P1-1 fix)', () => {
  it('never shows the raw JS exception text', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ImportWizardBoundary onClose={vi.fn()}><Boom /></ImportWizardBoundary>)
    expect(screen.queryByText(/TypeError/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('shows an honest, actionable recovery message instead', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ImportWizardBoundary onClose={vi.fn()}><Boom /></ImportWizardBoundary>)
    expect(screen.getByText('Something went wrong while importing.')).toBeInTheDocument()
    expect(screen.getByText(/Nothing was deleted/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('still renders children normally when nothing crashes', () => {
    render(<ImportWizardBoundary onClose={vi.fn()}><div>fine</div></ImportWizardBoundary>)
    expect(screen.getByText('fine')).toBeInTheDocument()
  })
})
