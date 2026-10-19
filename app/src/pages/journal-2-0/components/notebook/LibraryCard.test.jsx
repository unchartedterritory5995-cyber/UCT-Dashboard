// P4b final I-M1: LibraryCard is the one card dispatcher, and P5 (next on master) gives StyleLibraryCard admin
// Feature/Unfeature/Hide through GalleryAdminActions, which reads `isAdmin` and `onChanged`. LibraryCard is a P4b-only
// file, so the merge never conflicts on it: this rail is what keeps the style branch forwarding both.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const seen = { style: null, outline: null }
vi.mock('./StyleLibraryCard', () => ({ default: (props) => { seen.style = props; return <li data-card="style" /> } }))
vi.mock('./LayoutLibraryCard', () => ({ default: () => <li data-card="layout" /> }))
vi.mock('./TemplateGallery', () => ({ GalleryCard: (props) => { seen.outline = props; return <li data-card="outline" /> } }))

const { default: LibraryCard } = await import('./LibraryCard')

beforeEach(() => { seen.style = null; seen.outline = null })

describe('LibraryCard forwards the admin props to the style card (P4b final I-M1)', () => {
  it('a style item with the library on gets isAdmin and onChanged, the same ones the outline card gets', () => {
    const onChanged = vi.fn()
    render(<ul><LibraryCard item={{ id: 's1', itemType: 'style' }} libraryOn isAdmin onChanged={onChanged} /></ul>)
    expect(document.querySelector('[data-card="style"]')).not.toBeNull()
    expect(seen.style.isAdmin).toBe(true)
    expect(seen.style.onChanged).toBe(onChanged)
  })

  it('a member (not an admin) is forwarded isAdmin false, never a missing prop read as unknown', () => {
    render(<ul><LibraryCard item={{ id: 's1', itemType: 'style' }} libraryOn onChanged={vi.fn()} /></ul>)
    expect(seen.style.isAdmin).toBe(false)
  })

  it('control: the outline card already received both', () => {
    const onChanged = vi.fn()
    render(<ul><LibraryCard item={{ id: 't1', itemType: 'template' }} isAdmin onChanged={onChanged} /></ul>)
    expect(seen.outline.isAdmin).toBe(true)
    expect(seen.outline.onChanged).toBe(onChanged)
  })
})
