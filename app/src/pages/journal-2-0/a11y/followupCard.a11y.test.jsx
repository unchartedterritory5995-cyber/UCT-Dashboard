// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/followupCard.a11y.test.jsx
//
// Notebook P2 Tier 2 part B (Task 9): the earnings follow-up card (components/notebook/FollowupOffer.jsx, with its
// lazy slot FollowupOfferSlot.jsx) through 8A's axe harness. The card appears only for a notice's link with both
// switches on, so no tab recipe renders it -- hence a recipe of its own. It is read in its fullest state: the
// region with its heading and sentence, and the fixed failure sentence after a refused create (role="alert"),
// beside both buttons, after each of those is proved to be on screen so axe is not run over an empty shell.
import { describe, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../lib/followupCreate', async (importOriginal) => ({
  ...(await importOriginal()),
  createFollowupNote: vi.fn(async () => { throw Object.assign(new Error('x'), { status: 500 }) }),
}))
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import FollowupOfferSlot from '../components/notebook/FollowupOfferSlot'
import { FAILED_SENTENCE } from '../components/notebook/FollowupOffer'

describe('Tier 2 part B surfaces (the earnings follow-up card)', () => {
  axeSurface('followup-card', async () => {
    const params = new URLSearchParams('followup=ORCL&reportDate=2026-10-14')
    const { container } = render(
      <Providers>
        <main>
          <FollowupOfferSlot open searchParams={params} onCreated={() => {}} onDismiss={() => {}} />
        </main>
      </Providers>,
    )
    const region = await screen.findByRole('region', { name: 'Earnings follow-up' })
    expect(screen.getByRole('heading', { name: 'Earnings follow-up for ORCL' })).toBeTruthy()
    expect(region.textContent).toContain('ORCL reported on Oct 14, 2026.')
    screen.getByRole('button', { name: 'Not now' })
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    expect((await screen.findByRole('alert')).textContent).toBe(FAILED_SENTENCE)
    return { root: container }
  })
})
