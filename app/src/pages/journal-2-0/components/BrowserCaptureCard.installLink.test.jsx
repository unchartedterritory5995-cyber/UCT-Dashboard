// The Browser Capture card links to the extension's (unlisted) Chrome Web Store page. Unlisted
// means store search never shows it, so this link is the only door a member has. Asserted by
// rendered text and href, never by a constant alone.
import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, test, vi } from 'vitest'
import BrowserCaptureCard, { CAPTURE_EXTENSION_ID, CAPTURE_INSTALL_URL } from './BrowserCaptureCard'

function renderWith(connections) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ connections }) })))
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BrowserCaptureCard />
    </SWRConfig>,
  )
}

afterEach(() => { vi.unstubAllGlobals() })

describe('BrowserCaptureCard install link', () => {
  test('the published store id is the one in the link', () => {
    expect(CAPTURE_EXTENSION_ID).toMatch(/^[a-p]{32}$/)
    expect(CAPTURE_INSTALL_URL).toBe(
      'https://chromewebstore.google.com/detail/uct-browser-capture/kpogeikeoejgkefdcjdpeoonmbiflnlk',
    )
  })

  test('not connected: the sentence that says "install" is the link to the store page', async () => {
    renderWith([])
    const link = await screen.findByRole('link', { name: 'Install the UCT Browser Capture extension' })
    expect(link).toHaveAttribute('href', CAPTURE_INSTALL_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  test('connected: a quieter "Get the extension" link for another computer', async () => {
    renderWith([{ id: 'c1', label: 'Chrome on Windows', createdAt: '2026-10-01T12:00:00Z' }])
    const link = await screen.findByRole('link', { name: 'Get the extension' })
    expect(link).toHaveAttribute('href', CAPTURE_INSTALL_URL)
    expect(screen.queryByRole('link', { name: 'Install the UCT Browser Capture extension' })).toBeNull()
  })
})
