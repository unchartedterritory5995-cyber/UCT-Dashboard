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
import { NOTE_KIND_PROPERTY } from './noteKinds'

export const ITEM_TYPES = Object.freeze([
  { key: 'outline', label: 'Outlines' },
  { key: 'style', label: 'Styles' },
  // P3b: an example note belongs to a style and is never listed on its own (R-P3b-2). It is in this list so the
  // server's ITEM_TYPES and this one stay one fact; the library's type chips read LISTED_ITEM_TYPES below.
  { key: 'example_note', label: 'Example notes' },
  { key: 'page_layout', label: 'Page layouts' },
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

/** One view of the library: `{templates, isAdmin, exampleNotes, layoutSharing, answered, error, isLoading, refresh}`.
 *  `exampleNotes` is the server's `capabilities.exampleNotes` (P3b, ruling P3b-R6): a missing key is false, so a
 *  pod that predates P3b, or one with the switch off, offers no "Add an example note" door. P4b: `layoutSharing` is
 *  the server-only switch as the list answer reports it (`capabilities.layoutSharing`); a missing key is false. */
export function useLibraryList(filters, { enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? libraryListKey(filters) : null, fetcher, SWR_OPTS)
  return {
    templates: data?.templates || [],
    isAdmin: Boolean(data?.viewer?.admin),
    exampleNotes: data?.capabilities?.exampleNotes === true,
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

// ── P3b: example notes (an author's note shown as an example of one of their shared styles) ──
//
// ⛔ ONE FACT IN TWO FILES with api/services/journal_two/template_gallery.py (EXAMPLE_MAX_IMAGES,
// EXAMPLE_IMAGE_EXTENSIONS and the three image sentences): ExamplePreviewSheet.test.jsx READS that file and holds
// these equal. The server is the enforcer (it refuses at publish); the sheet only says the limits before Submit
// and refuses to switch on a 7th image (ruling P3b-T4-R2).
export const EXAMPLE_MAX_IMAGES = 6
export const EXAMPLE_IMAGE_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp'])
export const EXAMPLE_IMAGE_COUNT_SENTENCE = 'An example can show up to 6 images.'
export const EXAMPLE_IMAGE_TYPE_SENTENCE = 'Only PNG, JPEG or WebP images can be shared.'
export const EXAMPLE_IMAGE_SIZE_SENTENCE = 'An image in an example can be at most 2 MB.'

/** A style item of the member's own the server would link an example to: pending or approved, not hidden (the
 *  server re-checks it, under its write lock, at publish). */
export const isLinkableStyleItem = (item) => Boolean(item) && item.itemType === 'style' && !item.hidden
  && (item.status === 'approved' || item.status === 'pending')

/** The member's own library item for one of their styles (Your submissions' rows carry `sourceStyleId`). */
export const linkedStyleItem = (templates, styleId) => (styleId && Array.isArray(templates)
  ? templates.find((t) => isLinkableStyleItem(t) && t.sourceStyleId === styleId) || null
  : null)

/** The kind of note a style item is for: its listed payload's `kindId` (the kind the server checks a note against
 *  at publish), or null when it names none. */
export async function getStyleItemKind(styleItemId) {
  const template = await getGalleryTemplate(styleItemId)
  const kind = template?.payload?.kindId
  return typeof kind === 'string' && kind ? kind : null
}

/** The notes list call (GET /api/j2/notes, `notes._row_to_note_summary` rows) for the member's notes of one kind,
 *  newest first: the server filters by the `builtin:note_kind` property, and `excludeSample=1` (OI-P3b-13) leaves
 *  the sample notebook's notes out, since publishing one is refused. Null (nothing asked) without a kind. */
export function exampleCandidatesKey(kindId) {
  if (!kindId) return null
  const params = new URLSearchParams()
  params.set('sort', 'created')
  params.set('limit', '200')
  params.set('propertyFilter', JSON.stringify([{ propertyId: NOTE_KIND_PROPERTY, op: 'eq', value: kindId }]))
  params.set('excludeSample', '1')
  return `/api/j2/notes?${params.toString()}`
}

/** The member's live notes of `kindId`, newest first: `{notes, error, isLoading}`. The kind is checked here too
 *  (the list is filtered, never trusted to be): a note of any other kind, or a trashed or archived one, is never
 *  offered. A sample-notebook note is left out by the server (`excludeSample`, above): a list row cannot tell one
 *  apart, so it is not filtered here; should one arrive anyway, the server answers its 404 (P3b-R11). */
export function useExampleCandidates(kindId) {
  const { data, error, isLoading } = useSWR(exampleCandidatesKey(kindId), fetcher, SWR_OPTS)
  const notes = (Array.isArray(data?.notes) ? data.notes : []).filter((n) => n && n.id && !n.deletedAt && !n.archivedAt
    && n.propertiesJson?.[NOTE_KIND_PROPERTY] === kindId)
  return { notes, error, isLoading }
}

/** Exactly what other members would see of one of the member's notes, written nowhere:
 *  `{bodyJson, changes: [{kind, before, after, path}], counts, images: [{src, name, ocr, warnings}], title}`.
 *  ⛔ `before` is the author's own text: it is shown in the author's preview and nowhere else. */
export async function previewExample({ noteId, imagesOn = [], title }) {
  // P3b-F-R5: the title the author has TYPED is previewed too (the server scrubs it as it will at publish); with
  // none, the server previews the note's own title.
  return call(`${GALLERY_KEY}/examples/preview`, {
    method: 'POST',
    body: JSON.stringify(typeof title === 'string' ? { noteId, imagesOn, title } : { noteId, imagesOn }),
  })
}

/** P3b-F2-R2: the typed title ALONE, as other members would see it: `{title}`. The server scrubs the title and
 *  reduces nothing of the note, and this is not charged to the preview limit, so typing never spends it. */
export async function previewExampleTitle({ noteId, title }) {
  return call(`${GALLERY_KEY}/examples/preview`, {
    method: 'POST',
    body: JSON.stringify({ noteId, title, titleOnly: true }),
  })
}

/** Submit the note for review as an example of the style: `{template}`. ⛔ The body is exactly these four keys:
 *  the SERVER reads and reduces the note itself, so no body of the note ever leaves this file. */
export async function publishExample({ noteId, styleItemId, imagesOn = [], title }) {
  const out = await call(`${GALLERY_KEY}/examples`, {
    method: 'POST',
    body: JSON.stringify({ noteId, styleItemId, imagesOn, title }),
  })
  await refreshLibrary()
  return out
}

// ── P3b Task 6: a style's examples ("In use") and a reviewer's view of one ──
//
// ⛔ ONE FACT IN TWO FILES with template_gallery.py (EXAMPLE_IMAGE_PATH, REV_PENDING): ExamplesInUse.test.jsx READS
// that file and holds these equal. An example's images are always on the gallery image route; the stored address
// carries no version, and `?rev=pending` asks for a HELD revision's copy (the author's and a reviewer's only).
export const exampleImagePrefix = (itemId) => `${GALLERY_KEY}/${itemId}/images/`
export const EXAMPLE_REV_PENDING = 'pending'

/** A style item's examples as the server answers them (`examples`: up to 3 approved, newest first, each
 *  `{id, title, bodyJson, updatedAt}`). A missing key -- the example switch off, or a pod that predates P3b -- is
 *  none, and so is anything not in that shape. */
export function styleExamples(template) {
  const list = Array.isArray(template?.examples) ? template.examples : []
  return list.filter((e) => e && typeof e.id === 'string' && e.id && e.bodyJson && typeof e.bodyJson === 'object')
}

/** A HELD revision's body as it will read once approved, for the reviewer: each image on THIS item's gallery route
 *  is asked for on `?rev=pending` (the held copy, which approval moves into place). Nothing else is touched. */
export function withHeldImages(body, itemId) {
  const prefix = exampleImagePrefix(itemId)
  const walk = (node) => {
    if (!node || typeof node !== 'object') return node
    let out = node
    if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src.startsWith(prefix)
      && !node.attrs.src.includes('?')) {
      out = { ...node, attrs: { ...node.attrs, src: `${node.attrs.src}?rev=${EXAMPLE_REV_PENDING}` } }
    }
    return Array.isArray(out.content) ? { ...out, content: out.content.map(walk) } : out
  }
  return walk(body)
}

/** A listed style composed with the member's OWN data, written nowhere: the journal styles preview door
 *  with the item's listed `payload` as a draft. `{bodyJson, properties, skipped, ticker, ..., examples}` --
 *  `examples` is the style's own ("In use", P3b Task 6), from the same single read of the item. */
export async function previewLibraryStyle(item) {
  const template = await getGalleryTemplate(item.id)
  const p = template?.payload || {}
  const out = await previewJournalStyle({
    style: { kindId: p.kindId, outlineBodyJson: p.outlineBodyJson, blocks: p.blocks, properties: p.properties },
  })
  return { ...out, examples: styleExamples(template) }
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
