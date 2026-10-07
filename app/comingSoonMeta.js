/** Pre-launch metadata swap.
 *
 * index.html's title/description/OG tags sell the product and promise a
 * 7-day free trial. While VITE_COMING_SOON=1 there is nothing to sign up for,
 * and this metadata is exactly what a social link preview shows, so it has to
 * change with the page. It must happen at BUILD time, not runtime: crawlers
 * (X, Discord, iMessage, Slack) read the served HTML and never execute JS.
 *
 * Unset the flag and the original marketing metadata comes back untouched.
 *
 * This module has NO imports on purpose: vite.config.js uses it as a plugin,
 * and tests/test_homepage_seo_shell.py runs it under plain `node` against the
 * real app/index.html, with no node_modules needed.
 *
 * WHAT A SEARCH ENGINE READS (2026-10-07). index.html is the shell for every
 * SPA route, and `/` is the address every brand search lands on. Until this
 * date the pre-launch shell said "Coming soon" and carried no text and no link,
 * so the homepage passed nothing on to /live-trading-room, the one public page
 * that is open today. Three things changed, all in the served HTML:
 *   1. TITLE and DESC name the live trading room (lengths are railed).
 *   2. A <noscript> block gives a reader that runs no JavaScript one sentence
 *      and a real <a href="/live-trading-room">. A browser that runs JavaScript
 *      never renders <noscript>, so members and the app see no change at all.
 *   3. The JSON-LD description is left as it was (the app IS still launching).
 * The page a logged-out visitor sees with JavaScript on already links to the
 * room (pages/ComingSoon.jsx); this covers the readers that never run it.
 *
 * Wording rules for TITLE, DESC and NOSCRIPT (owner): the owner is
 * "Patrick (TSDR)"; "700+ members" is the only member count; no results or
 * performance claims; no em or en dashes; say "live trading room on Discord".
 */

// Google shows about 60 characters of a title and about 155 of a description.
export const TITLE = 'UCT Intelligence | Uncharted Territory Live Trading Room'
export const DESC =
  'UCT Intelligence is the home of Uncharted Territory, a live trading room on Discord led by Patrick (TSDR), with 700+ members. The UCT app is coming soon.'

// A DIFFERENT filename, not a replacement of og-image.png: social platforms
// cache preview images hard by URL, so a new path is what actually makes the
// new card show up, and it leaves the launch card untouched for launch day.
// Served by an explicit route in api/main.py (the SPA catch-all would
// otherwise hand crawlers index.html).
//
// ⚠️ BUMP ?v= EVERY TIME THE CARD IS REGENERATED. The route sets
// max-age=86400, so Cloudflare pins the old bytes at the edge for a day
// (observed: cf-cache-status HIT serving the previous card after deploy) and
// X/Discord/iMessage cache their copy far longer. Both key on the FULL url,
// so the query string is what actually busts them. FastAPI ignores the param.
export const IMAGE = 'https://uctintelligence.com/og-coming-soon.png?v=oct16-card'

// The public page the fallback links to. A plain path: api/main.py serves it
// as static HTML (LIVE_TRADING_ROOM_PATH), the SPA has no route for it.
export const ROOM_PATH = '/live-trading-room'

// What a reader with no JavaScript gets in <body>. Inline styles only: the
// shell's stylesheet is written for the app, and this must be legible on the
// dark first-paint background without depending on it.
export const NOSCRIPT = `<noscript>
      <div style="max-width:560px;margin:18vh auto 0;padding:0 24px;font-family:'Instrument Sans',system-ui,sans-serif;color:#e9e6dc;text-align:center;line-height:1.6">
        <h1 style="font-size:22px;font-weight:600;margin:0 0 12px">UCT Intelligence by Uncharted Territory</h1>
        <p style="font-size:16px;margin:0 0 16px">Uncharted Territory runs a live trading room on Discord, led by Patrick (TSDR), and the UCT Intelligence app is coming soon.</p>
        <p style="font-size:16px;margin:0"><a href="${ROOM_PATH}" style="color:#c9a84c">Visit the live trading room</a></p>
      </div>
    </noscript>`

// The JSON-LD block declares two purchasable Offers ($200/mo, $2000/yr) and a
// 7-day free trial. That is machine-readable "you can buy this now" that
// Google can surface as a rich result with prices while /checkout is 403.
// Pre-launch it keeps the brand entity and drops every offer.
const JSONLD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'UCT Intelligence',
  applicationCategory: 'FinanceApplication',
  url: 'https://uctintelligence.com/',
  description:
    'The Trading Brain you need as a companion. Launching soon.',
  publisher: {
    '@type': 'Organization',
    name: 'Uncharted Territory',
    url: 'https://uctintelligence.com/',
  },
}, null, 2)

const ROOT_DIV = /<div id="root"><\/div>/

/** index.html as served pre-launch. Pure: same input, same output. */
export function applyComingSoonMeta(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${TITLE}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${DESC}$2`,
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
      `$1${TITLE}$2`,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      `$1${DESC}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
      `$1${TITLE}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
      `$1${DESC}$2`,
    )
    .replace(
      /(<meta\s+property="og:image"\s+content=")[^"]*(")/,
      `$1${IMAGE}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/,
      `$1${IMAGE}$2`,
    )
    .replace(
      /(<script type="application\/ld\+json">)[\s\S]*?(<\/script>)/,
      `$1\n${JSONLD}\n    $2`,
    )
    // AFTER #root, never inside it: React owns that element's children.
    .replace(ROOT_DIV, (root) => `${root}\n    ${NOSCRIPT}`)
}

export function comingSoonMeta() {
  return {
    name: 'uct-coming-soon-meta',
    transformIndexHtml(html) {
      if (process.env.VITE_COMING_SOON !== '1') return html
      return applyComingSoonMeta(html)
    },
  }
}
