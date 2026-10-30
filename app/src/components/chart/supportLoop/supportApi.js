// app/src/components/chart/supportLoop/supportApi.js
//
// ─── THE CLIENT HALF OF `/api/indicator-support` (Phase A of the support loop) ──
//
// Spec: `docs/pine/support-loop/PHASE-A.md`.
//
//   logImportGaps(payload) A2 — which Pine built-ins a paste lost, by name and kind.
//                          ⛔ ONLY `gapLogPayload`'s output is sent: allowlisted names,
//                          their kind, and a COUNT of unnamed gaps. Never the script.
//   reportsConfig()        whether A3 storage is switched on (server flag), cached
//                          for the page's life.
//   submitReport / myReports / withdrawReport   A3, the opt-in report.
//
// Best-effort everywhere except the report itself: a gap log that fails must never
// surface to the member, and a report that fails says so in the dialog.

const BASE = '/api/indicator-support'

/** A2's per-page dedupe: one paste re-translates on every debounce and every
 *  knob change, and the same gap set must be counted once per page, not per
 *  keystroke. Keyed on the payload itself, which holds no member content. */
const sentGapSets = new Set()

export function _resetForTests() {
  sentGapSets.clear()
  configPromise = null
}

/** @param payload `importGaps.gapLogPayload(...)` — and nothing else. This module
 *  imports nothing from the translator so the chart chunk can load it cheaply. */
export function logImportGaps(payload) {
  if (!payload || !Array.isArray(payload.gaps)) return false
  if (!payload.gaps.length && !payload.unlisted) return false
  const key = JSON.stringify([
    payload.gaps.map((g) => `${g.name}:${g.kind}`).sort(), payload.unlisted,
  ])
  if (sentGapSets.has(key)) return false
  sentGapSets.add(key)
  try {
    fetch(`${BASE}/gaps`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dialect: 'pine',
        gaps: payload.gaps.map((g) => ({ name: g.name, kind: g.kind })),
        unlisted: Number(payload.unlisted) || 0,
      }),
    }).catch(() => {})
  } catch { /* best-effort */ }
  return true
}

let configPromise = null

/** `{reportsEnabled, maxSourceBytes, maxNoteChars}`; never rejects. A failed read
 *  answers "off", which hides the button rather than offering one that 404s. */
export function reportsConfig() {
  if (!configPromise) {
    configPromise = fetch(`${BASE}/config`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => ({
        reportsEnabled: !!(d && d.reports_enabled === true),
        maxSourceBytes: (d && Number(d.max_source_bytes)) || 131072,
        maxNoteChars: (d && Number(d.max_note_chars)) || 1000,
      }))
      .catch(() => ({ reportsEnabled: false, maxSourceBytes: 131072, maxNoteChars: 1000 }))
  }
  return configPromise
}

async function readError(r) {
  try {
    const d = await r.json()
    if (d && typeof d.detail === 'string') return d.detail
    if (d && d.detail && typeof d.detail.message === 'string') return d.detail.message
  } catch { /* fall through */ }
  return r.status === 429
    ? 'You have sent several reports recently. Please try again later.'
    : 'The report could not be sent. Nothing was stored.'
}

export async function submitReport(body) {
  let r
  try {
    r = await fetch(`${BASE}/reports`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: 'Could not reach UCT. Nothing was sent.' }
  }
  if (!r.ok) return { ok: false, error: await readError(r) }
  return { ok: true, report: await r.json() }
}

export async function myReports() {
  try {
    const r = await fetch(`${BASE}/reports/mine`, { credentials: 'include' })
    if (!r.ok) return []
    const d = await r.json()
    return Array.isArray(d && d.reports) ? d.reports : []
  } catch {
    return []
  }
}

export async function withdrawReport(id) {
  try {
    const r = await fetch(`${BASE}/reports/mine/${encodeURIComponent(id)}`, {
      method: 'DELETE', credentials: 'include',
    })
    return r.ok
  } catch {
    return false
  }
}
