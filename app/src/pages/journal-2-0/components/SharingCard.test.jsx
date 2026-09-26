import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SharingCard from './SharingCard'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'

// Wave 8 seam S8-5 — Settings → Sharing & publishing, a STUB lane 8B fills.
//
// ⛔ DARK MEANS ABSENT. Both gates (J2_SHARE_LINKS_ENABLED, NOTEBOOK_PUBLISH_ENABLED) stay
// off until the owner's legal sign-off (ruling D-B9), so for every member today this card
// renders NOTHING — and a tab that has not heard from the server yet (nothing latched) is
// treated as off, never as on.

afterEach(() => { cleanup(); __resetNotebookFlags() })

describe('SharingCard (S8-5 stub)', () => {
  it('renders NOTHING while no flag has latched (the payload has not arrived)', () => {
    const { container } = render(<SharingCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders NOTHING while both sharing gates are off', () => {
    latchNotebookFlags({ j2_share_links_enabled: false, notebook_publish_enabled: false })
    const { container } = render(<SharingCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['share links on', { j2_share_links_enabled: true, notebook_publish_enabled: false }],
    ['publish on', { j2_share_links_enabled: false, notebook_publish_enabled: true }],
    ['both on', { j2_share_links_enabled: true, notebook_publish_enabled: true }],
  ])('renders the card when %s', (_label, flags) => {
    latchNotebookFlags(flags)
    render(<SharingCard />)
    expect(screen.getByRole('region', { name: 'Sharing & publishing' })).toBeInTheDocument()
  })

  it('an unrelated flag being on does not open it', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_writing_help_enabled: true })
    const { container } = render(<SharingCard />)
    expect(container).toBeEmptyDOMElement()
  })
})
