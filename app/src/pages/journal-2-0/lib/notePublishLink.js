// ─── ONE PLACE THAT KNOWS WHERE A PUBLISHED NOTE LIVES (wave 8 seam S8-4) ────
//
// The noteShareLink.js idiom, for publish-to-web (lane 8B): the page URL a member
// copies and the route that renders it are the SAME fact, spelled once here.
// `App.jsx` routes on PUBLISHED_ROUTE and PUBLISHED_NOTE_ROUTE; lane 8B's Publish
// door builds its copyable URL from these; PublishedPage reads PUBLISHED_ENDPOINT.
//
// ⛔⛔ PUBLISHED_PATH IS ALSO READ BY THE SERVER. `api/main.py`'s
// PUBLIC_NOTE_PATH_PREFIXES marks every SPA path under it `X-Robots-Tag: noindex,
// nofollow` + `Referrer-Policy: no-referrer`, and tests/test_public_note_headers.py
// PARSES this file to hold the two equal. Renaming it here without the server turns
// that rail red, on purpose — a published page served without noindex is the failure.
//
// ⛔ The server read (`/api/j2/published*`) is PUBLIC by design and flag-gated
// server-side (NOTEBOOK_PUBLISH_ENABLED, dark until the owner's legal sign-off,
// ruling D-B9).

/** Where published notes live in the app. */
export const PUBLISHED_PATH = '/p'

/** A publication — one note, or a folder's index — by its slug. Derived, never retyped. */
export const PUBLISHED_ROUTE = `${PUBLISHED_PATH}/:slug`

/** One note inside a published folder. `pid` is the note's id WITHIN the publication,
 *  never a member's note id (ruling D-B7: no note id leaves on a public payload). */
export const PUBLISHED_NOTE_ROUTE = `${PUBLISHED_ROUTE}/n/:pid`

/** The public read on the server. No auth: a published page is public by definition. */
export const PUBLISHED_ENDPOINT = '/api/j2/published'
