/**
 * The slot when the editor's chunk cannot load (P4a Task 7). lazyLeaf retries once in place and then THROWS
 * (it never reloads the page), so the member must be told, in a sheet they can close, rather than click
 * Customize and see nothing happen.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('./PageLayoutEditor', () => { throw new Error('Failed to fetch dynamically imported module') })

import PageLayoutEditorSlot, { LOAD_FAILED } from './PageLayoutEditorSlot'

describe('PageLayoutEditorSlot when the chunk will not load', () => {
  it('says so in a sheet the member can close', async () => {
    const onClose = vi.fn()
    render(<PageLayoutEditorSlot page="today" initialPhase="market" onClose={onClose} />)
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 })
    expect(alert.textContent).toBe(LOAD_FAILED)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
