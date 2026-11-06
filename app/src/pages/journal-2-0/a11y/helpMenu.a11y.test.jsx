// S14 (audit 2026-11-05): the ONE Help menu (FeedbackWidget's), open, with every row -- axe reads it. And the Journal
// header's Help button, which replaced the second "?".
import { describe, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axeSurface } from './surface'
import { registerShortcutsHost } from '../../../components/feedbackDoor'
import { latchNotebookFlags } from '../lib/offline/notebookFlags'

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }), useIsPaid: () => true }))
vi.mock('../../../hooks/useHideOnScroll', () => ({ default: () => false }))
vi.mock('../../../hooks/useScrollLocked', () => ({ default: () => false }))

import FeedbackWidget from '../../../components/FeedbackWidget'
import HelpAnswerLink from '../components/notebook/HelpAnswerLink'

describe('the Help menu -- axe', () => {
  axeSurface('help-menu:open', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
    let release
    act(() => { release = registerShortcutsHost(() => {}) })
    render(<MemoryRouter><main><FeedbackWidget /></main></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Help & Feedback' }))
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent.trim()))
      .toEqual(['Search help', 'Quick answers', 'Keyboard shortcuts', 'Tours', 'Send feedback'])
    release()
  })

  axeSurface('help-answer-link', async () => {
    render(<MemoryRouter><main><p>Import notes <HelpAnswerLink faqId="notebook-import" topic="importing notes" /></p></main></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Help: importing notes (opens in a new tab)' })).toBeInTheDocument()
  })
})
