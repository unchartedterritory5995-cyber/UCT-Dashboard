import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { AuthContext } from '../../context/AuthContext'
import SaveQuoteButton from './SaveQuoteButton'
import { quoteNoteBody, quoteNoteTitle } from './quoteNote'

let mockUser = { id: 1, email: 'a@b.c' }

const QUOTE = { t: 'Only price pays.', a: 'Brian Shannon', src: 'Alphatrends', tags: ['momentum'] }

// The real context, not a module mock: the button reads AuthContext directly so
// it can render inside trees that have no AuthProvider at all.
function mount(props = {}) {
  return render(
    <AuthContext.Provider value={{ user: mockUser }}>
      <MemoryRouter><SaveQuoteButton quote={QUOTE} {...props} /></MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('quoteNoteBody', () => {
  it('is a TipTap doc: blockquote with the quote, then an italic attribution line', () => {
    const doc = quoteNoteBody(QUOTE)
    expect(doc.type).toBe('doc')                      // the server's validator requires this
    expect(doc.content[0].type).toBe('blockquote')
    expect(doc.content[0].content[0].content[0].text).toBe('“Only price pays.”')
    const attribution = doc.content[1].content[0]
    expect(attribution.text).toBe('— Brian Shannon · Alphatrends')
    expect(attribution.marks).toEqual([{ type: 'italic' }])
    expect(quoteNoteTitle(QUOTE)).toBe('Brian Shannon — Quote of the Day')
  })

  it('omits the source separator when there is no source', () => {
    expect(quoteNoteBody({ t: 'x', a: 'A' }).content[1].content[0].text).toBe('— A')
  })
})

describe('SaveQuoteButton', () => {
  beforeEach(() => { mockUser = { id: 1, email: 'a@b.c' } })
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders nothing when logged out — the banner is public, the note is not', () => {
    mockUser = null
    const { container } = mount()
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders nothing — and does not throw — in a tree with no AuthProvider', () => {
    const { container } = render(<MemoryRouter><SaveQuoteButton quote={QUOTE} /></MemoryRouter>)
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders nothing without a quote', () => {
    const { container } = render(<MemoryRouter><SaveQuoteButton quote={null} /></MemoryRouter>)
    expect(container.querySelector('button')).toBeNull()
  })

  it('posts a tagged note with cookie auth and flips to a deep link to it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ note: { id: 77 } }) })
    vi.stubGlobal('fetch', fetchMock)
    mount()
    fireEvent.click(screen.getByRole('button', { name: /save this quote/i }))
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/journal?j2tab=notebook&note=77'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/j2/notes')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body)
    expect(body.title).toBe('Brian Shannon — Quote of the Day')
    expect(body.tags).toEqual(['quote'])
    expect(body.bodyJson).toEqual(quoteNoteBody(QUOTE))
  })

  it('offers a retry when the save fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: /save this quote/i }))
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/retry save/i))
  })
})
