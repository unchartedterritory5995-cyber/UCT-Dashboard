import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import DayAttachments from './DayAttachments'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function choose(container) {
  const input = container.querySelector('input[type="file"]')
  const file = new File([new Uint8Array([1, 2, 3])], 'chart.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('DayAttachments: a refused upload', () => {
  it('says why when the server refuses the image for its size (413)', async () => {
    // The door caps the body while it reads it and answers 413 with a sentence.
    // The panel used to say "try again", which cannot work for a file that is too big.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Image must be < 5 MB' }), { status: 413 })))
    const onSave = vi.fn()
    const { container } = render(<DayAttachments date="2026-10-07" onSave={onSave} />)
    choose(container)
    await waitFor(() => expect(screen.getByText('Image must be < 5 MB. Nothing was added.')).toBeTruthy())
    expect(screen.queryByText(/try again/)).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps the plain sentence for any other failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })))
    const { container } = render(<DayAttachments date="2026-10-07" onSave={vi.fn()} />)
    choose(container)
    await waitFor(() => expect(screen.getByText(/Couldn't upload this image\. Nothing was added/)).toBeTruthy())
    expect(container.textContent).not.toContain('<html>')
  })
})
