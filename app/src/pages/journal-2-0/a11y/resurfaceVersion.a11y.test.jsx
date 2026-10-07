// app/src/pages/journal-2-0/a11y/resurfaceVersion.a11y.test.jsx
//
// Wave 13 lane 13D (resurfacing) through 8A's axe harness. The editor recipe runs with
// awareness_note_resurface_enabled OFF and no `?resurfaceVersion=`, so it never renders this
// sheet -- hence a recipe of its own rather than a `coveredBy` entry that would be untrue.
// Each proves its state rendered before axe runs, so an empty screen can never pass as clean:
//   * resurface-version         -- the version that first named the level, read-only;
//   * resurface-version-missing -- the version could not be opened (the one alert line).
import { describe } from 'vitest'
import { render, screen } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import ResurfaceVersionSheet from '../components/notebook/ResurfaceVersionSheet'

const VERSION = {
  id: 'v1', noteId: 'n1', title: 'NVDA swing plan', subtitle: null, createdAt: '2026-09-12T15:00:00Z',
  bodyJson: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The plan' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Stop: 100' }] },
  ] },
}

describe('lane 13D surfaces (resurfacing)', () => {
  axeSurface('resurface-version', async () => {
    installFetch([[/^\/api\/j2\/notes\/n1\/versions\/v1$/, { version: VERSION }]])
    render(<Providers><ResurfaceVersionSheet noteId="n1" versionId="v1" onClose={() => {}} /></Providers>)
    await screen.findByRole('dialog', { name: 'What you wrote then' })
    await screen.findByText('Stop: 100')
    screen.getByRole('button', { name: 'Back to the note as it is now' })
  })

  axeSurface('resurface-version-missing', async () => {
    installFetch([[/^\/api\/j2\/notes\/n1\/versions\/gone$/, [404, { detail: 'Version not found' }]]])
    render(<Providers><ResurfaceVersionSheet noteId="n1" versionId="gone" onClose={() => {}} /></Providers>)
    await screen.findByRole('alert')
  })
})
