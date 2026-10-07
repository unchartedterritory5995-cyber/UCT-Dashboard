import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import VisionAttachButton from './VisionAttachButton'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function attach(container) {
  const input = container.querySelector('input[type="file"]')
  const file = new File([new Uint8Array([1, 2, 3])], 'chart.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('VisionAttachButton: a refused upload', () => {
  it('says the sentence the server gave, not the raw reply', async () => {
    // The upload door caps the body and answers 413 {"detail": "image too large (max 5MB)"}.
    // The button used to print that whole JSON text at the member.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: 'image too large (max 5MB)' }), { status: 413 })))
    const { container } = render(<VisionAttachButton />)
    attach(container)
    await waitFor(() => expect(screen.getByText(/image too large \(max 5MB\)/)).toBeTruthy())
    expect(container.textContent).not.toContain('{"detail"')
  })

  it('says a plain sentence when the reply carries none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })))
    const { container } = render(<VisionAttachButton />)
    attach(container)
    await waitFor(() => expect(screen.getByText(/Could not read that image/)).toBeTruthy())
    expect(container.textContent).not.toContain('<html>')
  })
})
