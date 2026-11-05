// S12 (audit 2026-11-05, M9): the phone Notebook's one floating "+" -- closed (a named button) and OPEN (its Sheet,
// a named dialog of quick doors). axe reads both.
import { describe, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axeSurface } from './surface'
import NotebookPlusFab from '../components/notebook/NotebookPlusFab'

const mount = () => render(
  <MemoryRouter><main><NotebookPlusFab onQuickNote={vi.fn()} onVoiceNote={vi.fn()} onPhoto={vi.fn()} askAi /></main></MemoryRouter>,
)

describe('the floating "+" -- axe', () => {
  axeSurface('notebook-plus-fab', async () => {
    mount()
    expect(screen.getByRole('button', { name: 'Add to your notebook' })).toBeInTheDocument()
  })

  axeSurface('notebook-plus-fab:open', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add to your notebook' }))
    expect(screen.getByRole('dialog', { name: 'Add' })).toBeInTheDocument()
  })
})
