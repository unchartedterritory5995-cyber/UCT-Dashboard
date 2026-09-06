/** Wave E — property DEFINITIONS (the member's own custom + built-in
 * derived properties), shared across every note. Distinct from
 * useNoteProperties.js, which is per-note VALUES. */
import useSWR, { mutate as globalMutate } from 'swr'

const URL = '/api/j2/notes/properties'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2PropertyDefs() {
  const { data, error, isLoading, mutate } = useSWR(URL, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    properties: data?.properties ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}

async function _json(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.detail || `${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export async function createPropertyDef(payload) {
  const res = await fetch(URL, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await _json(res)
  globalMutate(URL)
  return body.property
}

export async function updatePropertyDef(defId, patch) {
  const res = await fetch(`${URL}/${defId}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = await _json(res)
  globalMutate(URL)
  return body.property
}

export async function deletePropertyDef(defId) {
  const res = await fetch(`${URL}/${defId}`, { method: 'DELETE', credentials: 'include' })
  await _json(res)
  globalMutate(URL)
}
