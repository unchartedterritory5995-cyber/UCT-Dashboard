import useSWR from 'swr'
import { useAuth } from '../context/AuthContext'

const fetcher = url => fetch(url).then(r => r.json())

export default function useTickerTags() {
  const { user } = useAuth()
  const { data, mutate } = useSWR(user ? '/api/ticker-tags' : null, fetcher, {
    dedupingInterval: 30000,
  })

  const tags = data || {} // {SYM: color}

  async function setTag(sym, color) {
    await fetch('/api/ticker-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym, color }),
    })
    mutate()
  }

  async function removeTag(sym) {
    await fetch(`/api/ticker-tags/${sym}`, { method: 'DELETE' })
    mutate()
  }

  function getTag(sym) { return tags[sym?.toUpperCase()] || null }

  return { tags, setTag, removeTag, getTag }
}
