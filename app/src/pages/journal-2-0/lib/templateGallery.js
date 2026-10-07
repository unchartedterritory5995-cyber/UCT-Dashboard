/**
 * Wave 12 (lane 12A) — the COMMUNITY template gallery's client.
 *
 * Named "community gallery" in code and copy, never just "gallery": wave 10 already
 * made the BUILT-IN Templates dialog a browsable gallery (TemplatePicker.jsx).
 *
 * The server owns every rule (api/services/journal_two/template_gallery.py): what a
 * published copy keeps, who may see a pending one, what "use" copies. This file only
 * calls it. Two lists are ONE FACT IN TWO FILES with the server's CATEGORIES and
 * REPORT_REASONS; tests/test_notebook_template_gallery.py PARSES this file and holds
 * them equal, so a category the server refuses can never be offered here.
 *
 * ⛔ Every failure is thrown as an Error carrying the server's own sentence and status;
 * a caller shows it. Nothing here swallows a failed request into `null`
 * (lib/swallowedFetch.census.test.js).
 */
import useSWR, { mutate as globalMutate } from 'swr'
import { notebookFlag } from './offline/notebookFlags'
import { MEMBER_TEMPLATES_KEY } from './memberTemplates'

export const GALLERY_FLAG = 'notebook_template_gallery_enabled'
export const GALLERY_KEY = '/api/j2/template-gallery'
export const GALLERY_QUEUE_KEY = `${GALLERY_KEY}/admin/queue`

export const GALLERY_CATEGORIES = Object.freeze([
  { key: 'trade_plan', label: 'Trade plan' },
  { key: 'journal', label: 'Journal' },
  { key: 'research', label: 'Research' },
  { key: 'review', label: 'Review' },
])

export const REPORT_REASONS = Object.freeze([
  { key: 'spam', label: 'Spam or advertising' },
  { key: 'personal_info', label: 'Shows someone’s personal information' },
  { key: 'offensive', label: 'Offensive or abusive' },
  { key: 'broken', label: 'Broken or empty' },
  { key: 'other', label: 'Something else' },
])

export const GALLERY_SORTS = Object.freeze([
  { key: 'newest', label: 'Newest' },
  { key: 'most_used', label: 'Most used' },
])

export const STATUS_LABELS = Object.freeze({
  pending: 'Waiting for review',
  approved: 'Listed',
  rejected: 'Not approved',
})

export function categoryLabel(key) {
  return GALLERY_CATEGORIES.find((c) => c.key === key)?.label || 'Other'
}

/** Is the gallery on for this tab? The latched flag (true only), never a guess. */
export function templateGalleryEnabled() {
  return notebookFlag(GALLERY_FLAG) === true
}

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

export function galleryListKey({ q = '', category = '', sort = 'newest', section = 'all' } = {}) {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  if (category) params.set('category', category)
  if (sort && sort !== 'newest') params.set('sort', sort)
  if (section && section !== 'all') params.set('section', section)
  const qs = params.toString()
  return qs ? `${GALLERY_KEY}?${qs}` : GALLERY_KEY
}

const listFetcher = (url) => call(url)

/** One view of the gallery: `{templates, viewer: {admin}}`. */
export function useTemplateGallery(filters, { enabled = true } = {}) {
  const key = enabled ? galleryListKey(filters) : null
  const { data, error, isLoading, mutate } = useSWR(key, listFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: true,
  })
  return {
    templates: data?.templates || [],
    isAdmin: Boolean(data?.viewer?.admin),
    error,
    isLoading,
    refresh: mutate,
  }
}

/** The review queue (admins only): `{pending, reported, hidden}`. */
export function useGalleryQueue({ enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? GALLERY_QUEUE_KEY : null, listFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return { queue: data || { pending: [], reported: [], hidden: [] }, error, isLoading, refresh: mutate }
}

/** Every cached gallery view, the queue, and (after a Use) Your templates. */
export async function refreshGallery({ memberTemplates = false } = {}) {
  await globalMutate((key) => typeof key === 'string' && key.startsWith(GALLERY_KEY))
  if (memberTemplates) await globalMutate(MEMBER_TEMPLATES_KEY)
}

/** The full template (`bodyJson`, `propertyDefs`) for the preview. */
export async function getGalleryTemplate(id) {
  const { template } = await call(`${GALLERY_KEY}/${encodeURIComponent(id)}`)
  return template
}

/** Submit one of Your templates for review (or resubmit it). */
export async function publishToGallery({ templateId, title, description, category }) {
  const { template } = await call(GALLERY_KEY, {
    method: 'POST',
    body: JSON.stringify({ templateId, title, description, category }),
  })
  await refreshGallery()
  return template
}

export async function unpublishFromGallery(id) {
  await call(`${GALLERY_KEY}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await refreshGallery()
}

/** Copy a listed template into Your templates: `{template, properties: {added, existing, skipped}}`. */
export async function copyGalleryTemplate(id) {
  const out = await call(`${GALLERY_KEY}/${encodeURIComponent(id)}/use`, { method: 'POST' })
  await refreshGallery({ memberTemplates: true })
  return out
}

export async function reportGalleryTemplate(id, { reason, note = '' }) {
  return call(`${GALLERY_KEY}/${encodeURIComponent(id)}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, note }),
  })
}

/**
 * approve | reject | hide | unhide | feature | unfeature (admins).
 *
 * An APPROVAL names the version the reviewer saw: `reviewedUpdatedAt` is that template's
 * `updatedAt` (the queue row and the preview both carry it). If the author published again
 * in between, the server answers 409 with a sentence saying to look again, and lists nothing.
 */
export async function reviewGalleryTemplate(id, action, note = '', reviewedUpdatedAt = null) {
  const { template } = await call(`${GALLERY_KEY}/admin/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(action === 'approve' ? { action, note, reviewedUpdatedAt } : { action, note }),
  })
  await refreshGallery()
  return template
}

/** hide | dismiss one open report (admins). */
export async function resolveGalleryReport(reportId, action) {
  await call(`${GALLERY_KEY}/admin/reports/${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  })
  await refreshGallery()
}
