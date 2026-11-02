import { describe, expect, it } from 'vitest'
import { applyLinkEvent, releaseLinkFor } from './tradeExchangeNewsReleaseLink'

const GNW = 'https://www.globenewswire.com/news-release/2026/10/29/3176543/0/en/Acme-Corp-Reports-Results.html'
const SEC = 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000123/ex99-1.htm'

describe('releaseLinkFor', () => {
  it('labels a verified wire link "Original release"', () => {
    const l = releaseLinkFor({ link: { kind: 'original_release', url: GNW, publisher: 'GlobeNewswire' } })
    expect(l).toEqual(expect.objectContaining({ href: GNW, label: 'Original release' }))
    expect(l.title).toContain('GlobeNewswire')
  })

  it('labels an EDGAR document "SEC filing"', () => {
    expect(releaseLinkFor({ link: { kind: 'sec_filing', url: SEC, publisher: 'SEC EDGAR' } }).label).toBe('SEC filing')
  })

  it('renders nothing without a link', () => {
    expect(releaseLinkFor({})).toBeNull()
    expect(releaseLinkFor(null)).toBeNull()
  })

  it.each([
    ['http', { kind: 'original_release', url: GNW.replace('https:', 'http:') }],
    ['javascript', { kind: 'original_release', url: 'javascript:alert(1)' }],
    ['data', { kind: 'original_release', url: 'data:text/html,<script>1</script>' }],
    ['credentials', { kind: 'original_release', url: 'https://a:b@www.globenewswire.com/x' }],
    ['port', { kind: 'original_release', url: 'https://www.globenewswire.com:8443/x' }],
    ['lookalike host', { kind: 'original_release', url: 'https://globenewswire.com.evil.example/x' }],
    ['other host', { kind: 'original_release', url: 'https://example.com/press' }],
    ['SEC kind on a wire host', { kind: 'sec_filing', url: GNW }],
    ['wire kind on SEC', { kind: 'original_release', url: SEC }],
    ['unknown kind', { kind: 'other', url: GNW }],
    ['not a string', { kind: 'original_release', url: 42 }],
    ['too long', { kind: 'original_release', url: `${GNW}?${'a'.repeat(1100)}` }],
    ['malformed', { kind: 'original_release', url: 'https://' }],
  ])('refuses %s', (_name, link) => {
    expect(releaseLinkFor({ link })).toBeNull()
  })
})

describe('applyLinkEvent', () => {
  const items = [{ seq: 1, id: 'a' }, { seq: 2, id: 'b' }]
  const link = { kind: 'original_release', url: GNW, publisher: 'GlobeNewswire' }

  it('patches only the item with that seq', () => {
    const out = applyLinkEvent(items, { seq: 2, id: 'b', link })
    expect(out[1].link).toEqual(link)
    expect(out[0]).toBe(items[0])
  })

  it('ignores an id that does not match the seq, or a malformed event', () => {
    expect(applyLinkEvent(items, { seq: 2, id: 'zzz', link })).toBe(items)
    expect(applyLinkEvent(items, { seq: 'x', link })).toBe(items)
    expect(applyLinkEvent(items, null)).toBe(items)
    expect(applyLinkEvent(items, { seq: 9, link })).toBe(items)
  })
})
