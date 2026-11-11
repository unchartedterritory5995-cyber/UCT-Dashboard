/**
 * UCT News — the verified original press-release link on a headline
 * (api/services/trade_exchange_news/release_links.py).
 *
 * The server only ever sends a link it verified (exact headline, same company,
 * matching time). The browser checks it again before it becomes an <a href>:
 * https only, on a host of the kind the label names, nothing else. Anything
 * that fails is not rendered — a missing link is better than a wrong one.
 */

const WIRE_HOSTS = ['globenewswire.com', 'businesswire.com', 'prnewswire.com', 'newsfilecorp.com',
  'accessnewswire.com', 'accesswire.com']
const SEC_HOSTS = ['www.sec.gov']

const onHost = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`))

/** { href, label, title } for a verified link, or null. */
export function releaseLinkFor(item) {
  const link = item?.link
  if (!link || typeof link.url !== 'string' || link.url.length > 1024) return null
  let u
  try {
    u = new URL(link.url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
  const host = u.hostname.toLowerCase()
  if (link.kind === 'original_release' && onHost(host, WIRE_HOSTS)) {
    return { href: u.href, label: 'Original release', title: `Original press release on ${link.publisher || host} (opens in a new tab)` }
  }
  if (link.kind === 'sec_filing' && onHost(host, SEC_HOSTS)) {
    return { href: u.href, label: 'SEC filing', title: 'The press release as filed with the SEC (EDGAR, opens in a new tab)' }
  }
  return null
}

/** A `link` stream event applied to the items that carry its seq. */
export function applyLinkEvent(items, ev) {
  if (!ev || !ev.link || !Number.isFinite(ev.seq)) return items
  let hit = false
  const next = items.map((it) => {
    if (it.seq !== ev.seq || (ev.id && it.id && it.id !== ev.id)) return it
    hit = true
    return { ...it, link: ev.link }
  })
  return hit ? next : items
}
