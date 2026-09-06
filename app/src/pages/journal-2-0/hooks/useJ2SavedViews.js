/** Wave E — saved views (stable-id query configuration over notes). */
import useSWR, { mutate as globalMutate } from 'swr'

const URL = '/api/j2/notes/saved-views'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2SavedViews() {
  const { data, error, isLoading, mutate } = useSWR(URL, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    views: data?.views ?? [],
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

export async function createSavedView(payload) {
  const res = await fetch(URL, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await _json(res)
  globalMutate(URL)
  return body.view
}

export async function updateSavedView(viewId, patch) {
  const res = await fetch(`${URL}/${viewId}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = await _json(res)
  globalMutate(URL)
  return body.view
}

export async function deleteSavedView(viewId) {
  const res = await fetch(`${URL}/${viewId}`, { method: 'DELETE', credentials: 'include' })
  await _json(res)
  globalMutate(URL)
}
