import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import VoiceInsightsPanel from './VoiceInsightsPanel'

// Wave 13 lane 13D — the in-app insights inbox (Settings → Compass) is where a resurfacing
// notice is read. An insight carrying the server's `link` (attached only while the flag is on)
// gets a door to the note at the version that named the level; only the Notebook's own
// `?note=` door is ever followed, and an insight without one renders exactly as before.

function insight(over = {}) {
  return {
    id: 7, kind: 'note_level_touch', symbol: 'NVDA', importance: 7, created_at: '2026-10-02 15:00:00',
    delivered_at: null, dismissed_at: null,
    headline: 'NVDA reached 100.00, the stop you named',
    body: "In “NVDA swing plan” you named 100.00 as your stop on 2026-09-12. Here's what you thought then.",
    ...over,
  }
}

function serve(insights) {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ insights }) }))
}

async function renderPanel() {
  render(<MemoryRouter><VoiceInsightsPanel /></MemoryRouter>)
  await screen.findByText('NVDA reached 100.00, the stop you named')
}

describe('VoiceInsightsPanel — lane 13D resurfacing door', () => {
  beforeEach(() => vi.clearAllMocks())

  it('labels the notice "Your notes" and opens the note at its version', async () => {
    serve([insight({ link: '/journal/notebook?note=n1&resurfaceVersion=v1' })])
    await renderPanel()
    expect(screen.getByText('Your notes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open what you wrote' }))
      .toHaveAttribute('href', '/journal/notebook?note=n1&resurfaceVersion=v1')
  })

  it('no link (flag off) renders no door; the notice still reads', async () => {
    serve([insight()])
    await renderPanel()
    expect(screen.queryByRole('link', { name: 'Open what you wrote' })).toBeNull()
  })

  it('a link that is not the Notebook door is never followed', async () => {
    serve([insight({ link: 'https://evil.example/journal/notebook?note=n1' })])
    await renderPanel()
    expect(screen.queryByRole('link', { name: 'Open what you wrote' })).toBeNull()
  })
})
