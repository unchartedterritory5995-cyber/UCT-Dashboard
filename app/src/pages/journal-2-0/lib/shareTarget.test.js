// What a phone share sheet actually hands us, and what it must mean.
//
// ⭐ THE EVAL SET IS SHAPED LIKE REAL SHARES, NOT LIKE THE PARSER. Wave K's
// `fts_match_expr` defect survived five slices of rails because every fixture
// was written keyword-shaped, matching the code's assumption rather than the
// member's behaviour → lesson_a_fixture_that_cannot_distinguish_is_not_a_rail.
// So these cases are the payload shapes real senders produce: Chrome-on-Android
// fills `url`; news readers, Reddit, X and most messaging apps put the link
// inside `text` and send no `url` at all; some send a bare title.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractUrls, parseShare, shareFromSearch, shareIsEmpty, shareCaptureDetail,
  writePendingShare, takePendingShare, PENDING_SHARE_KEY, SHARE_PARAMS,
} from './shareTarget'

describe('finding the link a share is actually about', () => {
  it('reads an explicit url field', () => {
    const s = parseShare({ url: 'https://reuters.com/a', title: 'A', text: 'quoted bit' })
    expect(s.kind).toBe('source')
    expect(s.url).toBe('https://reuters.com/a')
    expect(s.passage).toBe('quoted bit')
  })

  it('⛔ finds a url INSIDE text when the sender left `url` empty', () => {
    // The majority case. A door that only read `url` would open blank here and
    // look broken for most of the apps a member shares from.
    const s = parseShare({ text: 'Fed holds rates steady https://wsj.com/x' })
    expect(s.kind).toBe('source')
    expect(s.url).toBe('https://wsj.com/x')
    expect(s.passage).toBe('Fed holds rates steady')
  })

  it('an explicit url wins over one found in the text', () => {
    // The sending app naming its own link is better evidence than our inference.
    const s = parseShare({ url: 'https://a.com/canonical', text: 'see https://b.com/other' })
    expect(s.url).toBe('https://a.com/canonical')
  })

  it('a share that is nothing but a link has no passage', () => {
    const s = parseShare({ text: 'https://ft.com/z' })
    expect(s.url).toBe('https://ft.com/z')
    expect(s.passage).toBe('')
  })

  it('does not keep a "passage" that is only the title repeated', () => {
    // Share sheets routinely send title and text identical. Storing that as a
    // quotation would fabricate a passage the member never selected.
    const s = parseShare({ url: 'https://x.com/a', title: 'Nvidia beats', text: 'Nvidia beats' })
    expect(s.passage).toBe('')
    expect(s.title).toBe('Nvidia beats')
  })

  it('strips sentence punctuation off a trailing link but keeps legal parens', () => {
    expect(extractUrls('read https://a.com/x.')).toEqual(['https://a.com/x'])
    expect(extractUrls('see https://en.wikipedia.org/wiki/Foo_(bar)'))
      .toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  })

  it('ignores a bare domain with no scheme', () => {
    // Guessing a scheme would invent a source URL the member never gave us.
    expect(extractUrls('reuters.com is good')).toEqual([])
  })
})

describe('⛔⛔ a share with NO url is not a source, and not a claim of authorship', () => {
  it('opens as a thought, because no document can cite it', () => {
    const s = parseShare({ text: 'margins normalize by Q3' })
    expect(s.kind).toBe('thought')
    expect(s.thought).toBe('margins normalize by Q3')
    // ⛔ The three-kind invariant: a thought must never acquire external
    // provenance. No url, no passage — not even an empty-string placeholder
    // that a later refactor could start filling.
    expect(s.url).toBe('')
    expect(s.passage).toBe('')
  })

  it('joins a title that adds something, and never one that repeats', () => {
    expect(parseShare({ title: 'Note', text: 'body here' }).thought).toBe('Note\n\nbody here')
    expect(parseShare({ title: 'body here', text: 'body here x' }).thought).toBe('body here x')
  })

  it('a title-only share still carries the title through', () => {
    expect(parseShare({ title: 'Just this' }).thought).toBe('Just this')
  })
})

describe('the detail handed to the ONE dialog', () => {
  it('a source share opens source mode with url, title and passage', () => {
    const d = shareCaptureDetail(parseShare({ url: 'https://a.com/x', title: 'T', text: 'p' }))
    expect(d.source).toBe('share')
    expect(d.initial).toEqual({ url: 'https://a.com/x', title: 'T', passage: 'p' })
  })

  it('⛔ a thought share prefills `thought`, NEVER `passage`', () => {
    // CaptureDialog picks its mode from `initial.url || initial.passage`, so
    // prefilling `passage` here would open source mode and then block on a
    // missing URL — the member would see their own text quoted back at them
    // above an error asking for a source they do not have.
    const d = shareCaptureDetail(parseShare({ text: 'a thought' }))
    expect(d.initial).toEqual({ thought: 'a thought' })
    expect(d.initial.passage).toBeUndefined()
    expect(d.initial.url).toBeUndefined()
  })

  it('⛔ the share door adds NO destination — it guesses no ticker', () => {
    // A phone share knows nothing about what the member is researching. The
    // dialog shows its picker instead of filing into the wrong security.
    const d = shareCaptureDetail(parseShare({ url: 'https://a.com/x' }))
    expect(d.destination).toBeUndefined()
  })
})

describe('reading the query string the share sheet produced', () => {
  it('uses the parameter names the manifest declares', () => {
    const qs = `?${SHARE_PARAMS.title}=T&${SHARE_PARAMS.text}=body&${SHARE_PARAMS.url}=https%3A%2F%2Fa.com%2Fx`
    const s = shareFromSearch(qs)
    expect(s.url).toBe('https://a.com/x')
    expect(s.title).toBe('T')
    expect(s.passage).toBe('body')
  })

  it('an empty invocation is empty, not an error', () => {
    expect(shareIsEmpty(shareFromSearch(''))).toBe(true)
    expect(shareIsEmpty(shareFromSearch('?url=https://a.com/x'))).toBe(false)
  })
})

describe('surviving the sign-in round trip', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('is consumed exactly once', () => {
    const s = parseShare({ url: 'https://a.com/x' })
    expect(writePendingShare(s)).toBe(true)
    expect(takePendingShare()).toEqual(s)
    // ⛔ A second read must be empty, or the dialog reopens on every mount and
    // becomes a capture the member cannot dismiss.
    expect(takePendingShare()).toBeNull()
    expect(sessionStorage.getItem(PENDING_SHARE_KEY)).toBeNull()
  })

  it('a corrupted entry is discarded, not thrown', () => {
    sessionStorage.setItem(PENDING_SHARE_KEY, '{not json')
    expect(takePendingShare()).toBeNull()
  })

  it('blocked storage fails soft — the ?next= carrier still works', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('denied') }
    try {
      expect(writePendingShare(parseShare({ url: 'https://a.com/x' }))).toBe(false)
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
