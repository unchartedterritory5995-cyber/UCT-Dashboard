// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/refusedCopyOffer.a11y.test.jsx
//
// I-A (Restore-then-Undo word loss), fix rounds 3-5: the offer a note shows for a copy of its words the server
// refused to create (components/notebook/RefusedCopyOffer.jsx). It appears only after a refused create, so no tab
// or editor recipe renders it -- hence recipes of its own. Each is read in its fullest state, after proving it is
// on screen so axe is not run over an empty shell: the offer with its sentence, the words preview, every button
// and a filled status line; and the Discard confirm with its question, the same preview and its three buttons.
import { describe, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { axeSurface } from './surface'
import RefusedCopyOffer from '../components/notebook/RefusedCopyOffer'

const COPY = {
  id: 'copy-1',
  title: 'NVDA plan (conflicted copy)',
  subtitle: 'Entry above the pivot',
  bodyText: 'Entry on Oct 16, 2026 at 128.40\nsee filing (https://example.com/filing)',
  hiddenItems: true,
  reason: 'This copy of your note couldn’t be saved because the server can’t store some of its content, so it’s kept on this device. Save as plain text makes it its own note without their formatting, and keeps this copy.',
  offerPlain: true,
  offerSeparate: false,
  plainSaved: null,
}

function renderOffer() {
  return render(
    <main>
      <RefusedCopyOffer copy={COPY} onSave={() => {}} onSavePlain={() => {}} onDiscard={async () => false} />
    </main>,
  )
}

describe('I-A surfaces (the refused-copy offer)', () => {
  axeSurface('refused-copy-offer', async () => {
    const { container } = renderOffer()
    const offer = screen.getByRole('region', { name: 'A copy of this note’s words' })
    expect(screen.getByTestId('refused-copy-reason').textContent).toBe(COPY.reason)
    expect(screen.getByRole('region', { name: 'Words in this copy' }).textContent).toContain('128.40')
    screen.getByRole('button', { name: 'Save as plain text' })
    screen.getByRole('button', { name: 'Discard' })
    // No clipboard in jsdom: the fallback selects the words and fills the ONE status line.
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    expect((await screen.findByRole('status')).textContent).toContain('The words are selected.')
    expect(offer).toBeTruthy()
    return { root: container }
  })

  axeSurface('refused-copy-confirm', async () => {
    const { container } = renderOffer()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    const group = await screen.findByRole('group')
    expect(group.textContent).toContain('Delete this copy from this device?')
    expect(screen.getByRole('region', { name: 'Words in this copy' }).textContent).toContain('128.40')
    screen.getByRole('button', { name: 'Delete copy' })
    screen.getByRole('button', { name: 'Keep it' })
    screen.getByRole('button', { name: 'Copy text' })
    return { root: container }
  })
})
