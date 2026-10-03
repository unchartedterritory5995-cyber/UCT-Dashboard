/**
 * Wave 13 lane 13E-2 — the client's reads of the market context frozen at the fill.
 *
 * The server owns every number and every source/as-of (`api/services/journal_two/entry_context.py`,
 * contract: `docs/notebook/wave13-13e1.md`); this file only fetches, by the SAME key the backend
 * resolves (a position or trade id, joined server-side to symbol + entry day — never re-derived
 * here). A 402 (free plan) is NOT an error to throw: the card renders nothing for a free member,
 * the same as the flag being off, rather than a confusing "couldn't load" banner.
 *
 * Dark behind `notebook_entry_context_enabled` (latched per tab): with the gate off no key is
 * built, so nothing is fetched and every surface renders nothing.
 */
import useSWR from 'swr'
import { notebookFlag } from '../lib/offline/notebookFlags'

export const ENTRY_CONTEXT_FLAG = 'notebook_entry_context_enabled'
const BASE = '/api/j2/entry-context'

export function entryContextEnabled() {
  return notebookFlag(ENTRY_CONTEXT_FLAG) === true
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Entry context request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

const SWR_OPTS = { revalidateOnFocus: false, shouldRetryOnError: false }

/** `{version, fields, missingReasons, notCaptured, captureKinds, whyMaxChars}` — read once, never
 *  hardcoded, so a missing-reason sentence or the why limit can never drift from the server's. */
export function useEntryContextMeta() {
  const on = entryContextEnabled()
  const { data, error } = useSWR(on ? `${BASE}/meta` : null, getJson, SWR_OPTS)
  return { meta: data || null, error: error || null }
}

/** One position's or trade's context. `kind` is `'position' | 'trade'`; `id` is that item's own
 *  id — the backend resolves the (symbol, entry day) key from it, so a closed trade reaches the
 *  SAME row its position had (the card stays after the trade closes; nothing here re-derives
 *  that). A free plan's 402 renders as `paidOut`, never as `error`. */
export function useEntryContextFor(kind, id) {
  const on = entryContextEnabled()
  const key = on && id != null ? `${BASE}/${kind}/${encodeURIComponent(id)}` : null
  const { data, error, isLoading, mutate } = useSWR(key, getJson, SWR_OPTS)
  const paidOut = error?.status === 402
  return {
    enabled: on,
    paidOut,
    status: data?.status || null,
    key: data?.key || null,
    context: data?.context || null,
    reason: data?.reason || null,
    error: error && !paidOut ? error : null,
    isLoading: Boolean(key) && isLoading,
    retry: () => mutate(),
  }
}

/** Set (or, with an empty string, clear) the "why did you take it" note. Throws on failure —
 *  the caller (WhyPrompt) is the one place that renders the message. */
export async function putWhy(symbol, entryDay, text) {
  const res = await fetch(`${BASE}/why`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, entryDay, text }),
  })
  if (!res.ok) {
    let detail = `Could not save (${res.status})`
    try { const body = await res.json(); if (body?.detail) detail = body.detail } catch { /* non-JSON */ }
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  return res.json()
}
