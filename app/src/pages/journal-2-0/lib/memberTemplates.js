/**
 * Wave 6 (lane E, item 3) — the member's OWN templates ("Your templates").
 *
 * "Save as template" copies one of the member's notes — title, body, property
 * values — on the server (`POST /api/j2/note-templates {noteId, name}`); the
 * server reads the note, so this client never sends the body it is copying.
 * Creating from one goes through `createNoteViaApi`, the same path the built-in
 * catalog uses (a member template is never a second way to make a note).
 *
 * The picker lists names only; the full template (body + properties) is read
 * once, when the member picks it.
 */
import useSWR, { mutate as globalMutate } from 'swr'

export const MEMBER_TEMPLATES_KEY = '/api/j2/note-templates'

async function call(url, init = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...(init.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    ...init,
  })
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail).catch(() => null)
    const err = new Error(detail ? String(detail) : `request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

const fetcher = (url) => call(url).then((b) => b.templates || [])

/** The member's templates, newest saved first: `[{id, name, title, createdAt}]`. */
export function useMemberTemplates({ enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? MEMBER_TEMPLATES_KEY : null, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return { templates: data || [], error, isLoading, refresh: mutate }
}

const refreshList = () => globalMutate(MEMBER_TEMPLATES_KEY)

/** Save a note as a template. `name` blank/absent → the note's title. */
export async function saveNoteAsTemplate(noteId, name) {
  const body = { noteId, ...(typeof name === 'string' && name.trim() ? { name } : {}) }
  const { template } = await call(MEMBER_TEMPLATES_KEY, { method: 'POST', body: JSON.stringify(body) })
  await refreshList()
  return template
}

export async function renameMemberTemplate(id, name) {
  const { template } = await call(`${MEMBER_TEMPLATES_KEY}/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ name }),
  })
  await refreshList()
  return template
}

export async function deleteMemberTemplate(id) {
  await call(`${MEMBER_TEMPLATES_KEY}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await refreshList()
}

/** The full template — `{id, name, title, bodyJson, properties}`. */
export async function getMemberTemplate(id) {
  const { template } = await call(`${MEMBER_TEMPLATES_KEY}/${encodeURIComponent(id)}`)
  return template
}
