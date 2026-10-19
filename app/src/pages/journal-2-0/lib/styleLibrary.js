/**
 * P3a: the community STYLE library's client lists and calls; P4b adds shared PAGE LAYOUTS (the
 * `page_layout` item type and the `layoutSharing` capability). LAZY-ONLY: import this file only from
 * the lazy TemplateGallery chunk or the lazy styles chunk, never from an eager Notebook
 * file (the first-open byte budget, R-P3-5).
 *
 * ⛔ ITEM_TYPES, TRADING_STYLES and LIBRARY_SORTS are ONE FACT IN TWO FILES with
 * api/services/journal_two/template_gallery.py; tests/test_style_library.py PARSES this
 * file and holds the keys equal, in order.
 *
 * ⛔ Every call mirrors templateGallery.js's `call`: a failed request is thrown as an Error carrying
 * the server's own sentence and status, and a caller shows it. Nothing here swallows a failure into
 * `null` (lib/swallowedFetch.census.test.js).
 * ⛔ An author is only ever the opaque `authorHandle` (R-P3-2). Nothing here sends or reads a user id
 * or an email.
 */
import useSWR, { mutate as globalMutate } from 'swr'
import { GALLERY_KEY, getGalleryTemplate } from './templateGallery'
import { STYLES_URL, previewJournalStyle } from './journalStyles'
import { styleLibraryEnabled } from './styleLibraryFlag'

export const ITEM_TYPES = Object.freeze([
  { key: 'outline', label: 'Outlines' },
  { key: 'style', label: 'Styles' },
  { key: 'page_layout', label: 'Page layouts' },
])

export const TRADING_STYLES = Object.freeze([
  { key: 'swing', label: 'Swing' },
  { key: 'day', label: 'Day' },
  { key: 'prop', label: 'Prop' },
  { key: 'options', label: 'Options' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'long_term', label: 'Long-term' },
])

export const LIBRARY_SORTS = Object.freeze([
  { key: 'newest', label: 'Newest' },
  { key: 'most_used', label: 'Most adopted' },
  { key: 'trending', label: 'Trending this week' },
])

export function tradingStyleLabel(key) {
  return TRADING_STYLES.find((t) => t.key === key)?.label || null
}

const enc = encodeURIComponent
export const LIBRARY_FEED_KEY = `${GALLERY_KEY}/feed`
export const LIBRARY_UPDATES_KEY = `${GALLERY_KEY}/updates`
export const authorKey = (handle) => `${GALLERY_KEY}/authors/${enc(handle)}`

async function call(url, init = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...(init.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    ...init,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = typeof body?.detail === 'string' ? body.detail : ''
    } catch {
      detail = ''
    }
    const err = new Error(detail || `request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

const fetcher = (url) => call(url)
const SWR_OPTS = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true })

/** The list URL. `type` and `trading_style` sit between `category` and `sort`, so with neither set it
 *  is byte-identical to templateGallery.js's galleryListKey (the library-off gallery is today's). */
export function libraryListKey({ q = '', category = '', sort = 'newest', section = 'all', type = '', tradingStyle = '' } = {}) {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  if (category) params.set('category', category)
  if (type) params.set('type', type)
  if (tradingStyle) params.set('trading_style', tradingStyle)
  if (sort && sort !== 'newest') params.set('sort', sort)
  if (section && section !== 'all') params.set('section', section)
  const qs = params.toString()
  return qs ? `${GALLERY_KEY}?${qs}` : GALLERY_KEY
}

/** One view of the library: `{templates, isAdmin, layoutSharing, error, isLoading, refresh}`. P4b:
 *  `layoutSharing` is the server-only switch as the list answer reports it; a missing key is false. */
export function useLibraryList(filters, { enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? libraryListKey(filters) : null, fetcher, SWR_OPTS)
  return {
    templates: data?.templates || [],
    isAdmin: Boolean(data?.viewer?.admin),
    layoutSharing: data?.capabilities?.layoutSharing === true,
    // Whether a list answer is in hand: `layoutSharing: false` from an answer is the switch, while no answer yet is
    // nothing at all (P4b X11 resets a Page layouts chip only on the first).
    answered: Boolean(data),
    error,
    isLoading,
    refresh: mutate,
  }
}

/** What the authors this member follows have listed (the Following view). */
export function useLibraryFeed({ enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? LIBRARY_FEED_KEY : null, fetcher, SWR_OPTS)
  return { templates: data?.templates || [], error, isLoading, refresh: mutate }
}

/** One author's page: `{author: {handle, label, itemCount, following, mine}, items}`. */
export function useAuthorPage(handle) {
  const { data, error, isLoading, mutate } = useSWR(handle ? authorKey(handle) : null, fetcher, SWR_OPTS)
  return { author: data?.author || null, items: data?.items || [], error, isLoading, refresh: mutate }
}

/** The member's adopted styles whose community item is listed at a higher version. Fails closed on the
 *  switch: with the library off every one of these routes is a 404, so nothing is asked. A falsy `enabled`
 *  only NARROWS it (the Styles manager while it is closed); it can never widen the switch. */
export function useStyleUpdates({ enabled = true } = {}) {
  const on = Boolean(enabled) && styleLibraryEnabled()
  const { data, error, isLoading, mutate } = useSWR(on ? LIBRARY_UPDATES_KEY : null, fetcher, SWR_OPTS)
  return { updates: data?.updates || [], error, isLoading, refresh: mutate }
}

const galleryKeys = (key) => typeof key === 'string' && key.startsWith(GALLERY_KEY)

/** Every cached library and gallery view, plus the member's journal styles list. */
export async function refreshLibrary() {
  await globalMutate((key) => galleryKeys(key) || key === STYLES_URL)
}

/** Share one of the member's styles for review: `{template, droppedProperties}`. */
export async function shareStyle({ styleId, title, description, category, tradingStyle }) {
  const out = await call(`${GALLERY_KEY}/styles`, {
    method: 'POST',
    body: JSON.stringify({ styleId, title, description, category, tradingStyle }),
  })
  await refreshLibrary()
  return out
}

/** The member's own copy of a listed style: `{style, notify, credit}`. */
export async function adoptStyle(id, { notify = false } = {}) {
  const out = await call(`${GALLERY_KEY}/${enc(id)}/adopt`, {
    method: 'POST',
    body: JSON.stringify({ notify: notify === true }),
  })
  await refreshLibrary()
  return out
}

/** Mark (or unmark) an item Helpful: `{helpful, count}`. */
export async function markHelpful(id, on) {
  const out = await call(`${GALLERY_KEY}/${enc(id)}/helpful`, { method: on ? 'POST' : 'DELETE' })
  await globalMutate(galleryKeys)
  return out
}

/** Follow (or unfollow) an author by their handle: `{following}`. */
export async function followAuthor(handle, on) {
  const out = await call(`${authorKey(handle)}/follow`, { method: on ? 'POST' : 'DELETE' })
  await globalMutate(galleryKeys)
  return out
}

/** What "Update my copy" would add: `{addBlocks, addProperties, outlineChanged, newOutline, ...}`. */
export async function getUpdatePlan(styleId) {
  const { plan } = await call(`${LIBRARY_UPDATES_KEY}/${enc(styleId)}`)
  return plan
}

/** Apply the author's update to the member's copy: the updated style. A 409 means the copy changed since
 *  the plan was read, or a newer version than the previewed `toVersion` is listed now; nothing was written. */
export async function applyStyleUpdate(styleId, { takeOutline = false, baseUpdatedAt, toVersion } = {}) {
  const { style } = await call(`${LIBRARY_UPDATES_KEY}/${enc(styleId)}`, {
    method: 'POST',
    body: JSON.stringify({ takeOutline: takeOutline === true, baseUpdatedAt, toVersion }),
  })
  await refreshLibrary()
  return style
}

/** A listed style composed with the member's OWN data, written nowhere: the journal styles preview door
 *  with the item's listed `payload` as a draft. `{bodyJson, properties, skipped, ticker, ...}`. */
export async function previewLibraryStyle(item) {
  const template = await getGalleryTemplate(item.id)
  const p = template?.payload || {}
  return previewJournalStyle({
    style: { kindId: p.kindId, outlineBodyJson: p.outlineBodyJson, blocks: p.blocks, properties: p.properties },
  })
}

// ── P4b: shared PAGE LAYOUTS ─────────────────────────────────────────────────────────────────────────────────────
export const LAYOUT_STATUS_KEY = `${GALLERY_KEY}/layouts/status`

/** Share one page of the member's SAVED layout for review: `{template, droppedPanels}`. The client names the page and
 *  the form fields only, never a list: the server builds the layout from the saved preference (R-P4b-3/4). */
export async function shareLayout({ page, title, description, category, tradingStyle }) {
  const out = await call(`${GALLERY_KEY}/layouts`, {
    method: 'POST',
    body: JSON.stringify({ page, title, description, category, tradingStyle }),
  })
  await refreshLibrary()
  return out
}

/** The member's own shared layouts, `{status: {shared: {today, trade}} | null, off, error}`. While layout sharing is
 *  off every `/layouts` route is a 404, and THAT is `off: true` -- an explicit branch on the status (X12), never an
 *  error shown to the member and never a swallowed failure. Any other failure is `error`. */
export function useLayoutSharingStatus({ enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? LAYOUT_STATUS_KEY : null, fetcher, SWR_OPTS)
  const off = error?.status === 404
  return { status: data || null, off, error: off ? null : (error || null), isLoading, refresh: mutate }
}

/** The LISTED layout of a shared page, for the member's own client to apply and save: `{layout, version, credit}`.
 *  `version` is the one the member previewed; a newer listed version is a 409 and nothing is adopted. */
export async function adoptLayout(id, { version } = {}) {
  const out = await call(`${GALLERY_KEY}/${enc(id)}/adopt-layout`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
  await refreshLibrary()
  return out
}

/** What a layout the library cannot apply says: the server's own sentence for it (`LAYOUT_UNSUPPORTED_SENTENCE` in
 *  template_gallery.py; LayoutLibrary.test.jsx reads that file and holds the two equal). A layout item whose
 *  `payload` is null says this, offers no "Use this layout", and is never read further (P4b-T6b-R1). */
export const LAYOUT_UNSUPPORTED_SENTENCE = "This layout can't be used yet."
