import useSWR from 'swr'
import { useAuth } from '../context/AuthContext'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : {})

export default function useTickerTags() {
  const { user } = useAuth()
  const { data, mutate } = useSWR(user ? '/api/ticker-tags' : null, fetcher, {
    dedupingInterval: 5000,
  })

  const tags = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {}

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

  return { tags, setTag, removeTag, getTag }
}
