/**
 * Wave 6 item 6 — which pasted links may become an embedded player, and the
 * one place an embed's iframe address is built.
 *
 * ⛔ AN EMBED'S IFRAME ADDRESS IS NEVER A STORED OR PASTED STRING. A note stores
 * `{ provider, ref }` — a provider name from this allowlist and an id that
 * passes that provider's own strict pattern — and `embedSrc` rebuilds the
 * address from those two every time it renders. A crafted note, a crafted
 * paste, or an edited `data-src` therefore cannot point an iframe anywhere:
 * an unknown provider or an id that fails its pattern renders as a plain link.
 *
 * The allowlist (brief §6): YouTube, played through youtube-nocookie.com, and
 * TradingView symbol charts through TradingView's own widget page. Nothing
 * else embeds; every other link can still be a Link or a Preview card.
 */

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com'])
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const TRADINGVIEW_HOST = /^(?:www\.|[a-z]{2}\.)?tradingview\.com$/
// EXCHANGE:SYMBOL or a bare SYMBOL, as TradingView writes them (NASDAQ:AAPL, NYSE:BRK.B, BINANCE:BTCUSDT).
const TRADINGVIEW_REF = /^(?:[A-Z0-9_]{1,20}:)?[A-Z0-9._!]{1,30}$/

export const EMBED_PROVIDERS = Object.freeze({
  youtube: {
    label: 'YouTube video',
    valid: (ref) => typeof ref === 'string' && YOUTUBE_ID.test(ref),
    src: (ref) => `https://www.youtube-nocookie.com/embed/${ref}?rel=0&modestbranding=1&playsinline=1`,
    href: (ref) => `https://www.youtube.com/watch?v=${ref}`,
  },
  tradingview: {
    label: 'TradingView chart',
    valid: (ref) => typeof ref === 'string' && TRADINGVIEW_REF.test(ref),
    src: (ref) => `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(ref)}`
      + '&interval=D&hidesidetoolbar=1&symboledit=0&saveimage=0&theme=dark&style=1&locale=en',
    href: (ref) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(ref)}`,
  },
})

/** A web link (http/https) as a URL object, or null. */
export function webUrl(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 2048) return null
  let url
  try { url = new URL(trimmed) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname || url.username || url.password) return null
  return url
}

function youtubeRef(url) {
  const host = url.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(host)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  let id = null
  if (host === 'youtu.be') id = parts[0]
  else if (url.pathname === '/watch') id = url.searchParams.get('v')
  else if (['shorts', 'embed', 'live'].includes(parts[0])) id = parts[1]
  return id && YOUTUBE_ID.test(id) ? id : null
}

function tradingviewRef(url) {
  if (!TRADINGVIEW_HOST.test(url.hostname.toLowerCase())) return null
  const parts = url.pathname.split('/').filter(Boolean)
  let ref = null
  if (parts[0] === 'symbols' && parts[1]) {
    // /symbols/NASDAQ-AAPL/ -> NASDAQ:AAPL (the FIRST dash splits exchange from symbol)
    let raw
    try { raw = decodeURIComponent(parts[1]).toUpperCase() } catch { return null }
    const dash = raw.indexOf('-')
    ref = dash > 0 ? `${raw.slice(0, dash)}:${raw.slice(dash + 1)}` : raw
  } else if (parts[0] === 'chart') {
    ref = (url.searchParams.get('symbol') || '').toUpperCase()
  }
  return ref && TRADINGVIEW_REF.test(ref) ? ref : null
}

/** `{ provider, ref }` when a link may be embedded, else null. */
export function embedFor(text) {
  const url = webUrl(text)
  if (!url) return null
  const yt = youtubeRef(url)
  if (yt) return { provider: 'youtube', ref: yt }
  const tv = tradingviewRef(url)
  if (tv) return { provider: 'tradingview', ref: tv }
  return null
}

/** The iframe address for a stored embed, or null when it fails the allowlist. */
export function embedSrc(provider, ref) {
  const p = Object.prototype.hasOwnProperty.call(EMBED_PROVIDERS, provider) ? EMBED_PROVIDERS[provider] : null
  return p && p.valid(ref) ? p.src(ref) : null
}

/** The page an embed opens outside the note, or null when it fails the allowlist. */
export function embedHref(provider, ref) {
  const p = Object.prototype.hasOwnProperty.call(EMBED_PROVIDERS, provider) ? EMBED_PROVIDERS[provider] : null
  return p && p.valid(ref) ? p.href(ref) : null
}
