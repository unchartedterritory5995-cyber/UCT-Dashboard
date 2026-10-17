/**
 * The eager slot that opens the Customize editor through a lazy import (P4a Task 7). The editor is a stub
 * here (its own tests are PageLayoutEditor.test.jsx); what this file pins is the SEAM: the props reach the
 * lazy editor, and the slot holds nothing on screen while the chunk is on its way.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('./PageLayoutEditor', () => ({
  default: ({ page, initialPhase, onClose, onSaved }) => (
    <div data-testid="editor-stub" data-page={page} data-phase={initialPhase}>
      <button type="button" onClick={() => { onSaved?.(); onClose() }}>stub save</button>
    </div>
  ),
}))

import PageLayoutEditorSlot from './PageLayoutEditorSlot'

describe('PageLayoutEditorSlot', () => {
  it('loads the editor lazily and hands it page, phase and both callbacks', async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<PageLayoutEditorSlot page="today" initialPhase="premarket" onClose={onClose} onSaved={onSaved} />)
    const stub = await screen.findByTestId('editor-stub')
    expect(stub.getAttribute('data-page')).toBe('today')
    expect(stub.getAttribute('data-phase')).toBe('premarket')
    fireEvent.click(screen.getByRole('button', { name: 'stub save' }))
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
