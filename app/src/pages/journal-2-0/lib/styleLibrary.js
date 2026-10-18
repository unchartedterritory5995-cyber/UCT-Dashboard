/**
 * P3a: the community STYLE library's client lists and calls. LAZY-ONLY: import this file only from
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
  // P3b: an example note belongs to a style and is never listed on its own (R-P3b-2). It is in this list so the
  // server's ITEM_TYPES and this one stay one fact; the library's type chips read LISTED_ITEM_TYPES below.
  { key: 'example_note', label: 'Example notes' },
])

/** P3b: the server's EXAMPLE_ITEM (tests/test_example_notes.py reads this line and holds the two equal). */
export const EXAMPLE_NOTE_TYPE = 'example_note'

/** The item types a member can list or filter by: every type but the example note (the server's
 *  LISTED_ITEM_TYPES). The library's type chips and its initial type read this, never ITEM_TYPES. */
export const LISTED_ITEM_TYPES = Object.freeze(ITEM_TYPES.filter((t) => t.key !== EXAMPLE_NOTE_TYPE))

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

/** One view of the library: `{templates, isAdmin, error, isLoading, refresh}`. */
export function useLibraryList(filters, { enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? libraryListKey(filters) : null, fetcher, SWR_OPTS)
  return { templates: data?.templates || [], isAdmin: Boolean(data?.viewer?.admin), error, isLoading, refresh: mutate }
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
