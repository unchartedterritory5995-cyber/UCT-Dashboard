import useSWR from 'swr'
import { useAuth } from '../context/AuthContext'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : {})
const arrayFetcher = url => fetch(url).then(r => r.ok ? r.json() : [])

export default function useTickerTags() {
  const { user } = useAuth()
  const { data, mutate } = useSWR(user ? '/api/ticker-tags' : null, fetcher, {
    dedupingInterval: 5000,
  })
  const { data: sharedColors, mutate: mutateShared } = useSWR(
    user ? '/api/ticker-tags/shared' : null, arrayFetcher, { dedupingInterval: 30000 }
  )
  const { data: publicLists, mutate: mutatePublic } = useSWR(
    user ? '/api/ticker-tags/public' : null, arrayFetcher, { refreshInterval: 60000 }
  )

  const tags = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {}
  const shared = Array.isArray(sharedColors) ? sharedColors : []
  const communityTags = Array.isArray(publicLists) ? publicLists : []

  async function setTag(sym, color) {
    try {
      await fetch('/api/ticker-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym, color }),
      })
      mutate()
    } catch {}
  }

  async function removeTag(sym) {
    try {
      await fetch(`/api/ticker-tags/${sym}`, { method: 'DELETE' })
      mutate()
    } catch {}
  }

  function getTag(sym) { return tags[sym?.toUpperCase()] || null }

  function isColorShared(color) { return shared.includes(color) }

  async function toggleShareColor(color) {
    const next = shared.includes(color) ? shared.filter(c => c !== color) : [...shared, color]
    try {
      await fetch('/api/ticker-tags/shared', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colors: next }),
      })
      mutateShared()
      mutatePublic()
    } catch {}
  }

  return { tags, setTag, removeTag, getTag, shared, isColorShared, toggleShareColor, communityTags }
}
