/**
 * Where this build talks to. ONE place, so a dev build differs from the shipped
 * build in exactly one value that a reviewer can see.
 *
 * ⛔ NO SECRETS LIVE IN EXTENSION SOURCE, and none can: everything here is a
 * public URL. The only credential this extension ever holds is the scoped
 * capture token, which is minted at runtime by the member's own authenticated
 * act and stored in chrome.storage.local — never compiled in.
 */

// Overridden only by the local-sandbox build the phone/browser audit produces.
// The shipped manifest's host_permissions pins the production origin, so a build
// pointed elsewhere cannot reach it without a manifest change a reviewer sees.
export const API_BASE = 'https://uctintelligence.com'

export const CLIENT_ID = 'uct-browser-capture'

// The first-party authorization page. A real UCT route, opened top-level.
export const CONNECT_PATH = '/journal/capture-connect'

export const ENDPOINTS = {
  token: '/api/j2/capture/token',
  capture: '/api/j2/capture',
  destinations: '/api/j2/capture/destinations',
}

// Mirrors the server ceiling (web_capture.MAX_PASSAGE_CHARS). Used ONLY to give
// the member an honest message before a round trip — the server is the
// authority, and a client that trimmed to fit would be silently editing a quote.
export const MAX_PASSAGE_CHARS = 8000
