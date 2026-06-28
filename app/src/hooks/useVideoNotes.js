// Per-user timestamped notes for a Desk video (jot at MM:SS, jump back, delete,
// export to Notebook). Keyed by youtube_id so it follows the video, not the DB row.
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export function useVideoNotes(youtubeId) {
  const key = youtubeId ? `/api/education/video-notes?youtube_id=${encodeURIComponent(youtubeId)}` : null
  const { data, mutate } = useSWR(key, fetcher, { revalidateOnFocus: false })
  const notes = Array.isArray(data?.notes) ? data.notes : []

  const add = async (t, text) => {
    const body = (text || '').trim()
    if (!youtubeId || !body) return
    await fetch('/api/education/video-notes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtube_id: youtubeId, t: Math.max(0, Math.floor(t || 0)), text: body }),
    })
    mutate()
  }

  const remove = async (id) => {
    await fetch(`/api/education/video-notes/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }

  return { notes, add, remove }
}
