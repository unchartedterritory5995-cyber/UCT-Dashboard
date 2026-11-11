// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/tickerSuggestion.a11y.test.jsx
//
// Audit 2026-11-05, spec S2: the offer a note makes once its body names a $TICKER twice
// (components/notebook/TickerSuggestion.jsx), through 8A's axe harness. The editor's own rail opens a
// note that names none, so the offer is never on screen there; it gets a recipe of its own, read
// after its group, its sentence and both buttons are proved to be there.
import { describe } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeSurface } from './surface'
import TickerSuggestion from '../components/notebook/TickerSuggestion'

const editor = { isDestroyed: false, getText: () => '$NVDA held the 50. $NVDA into earnings.', on() {}, off() {} }

describe('the ticker suggestion', () => {
  axeSurface('ticker-suggestion', async () => {
    localStorage.clear()
    const { container } = render(
      <main>
        <TickerSuggestion editor={editor} noteId="n-a11y" ticker={null} onLink={() => {}} />
      </main>,
    )
    const group = screen.getByRole('group', { name: 'Ticker suggestion' })
    if (!group.textContent.includes('Link this note to $NVDA?')) throw new Error('the offer sentence is missing')
    screen.getByRole('button', { name: 'Link note to $NVDA' })
    screen.getByRole('button', { name: "No, don't link" })
    return { root: container }
  })
})
