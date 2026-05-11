import { useCallback, useEffect, useState } from 'react'

/**
 * Voice memory hook — CRUD for user facts + listing of past summaries.
 *
 * Used by the Voice Memory Settings panel.
 */
export default function useVoiceMemory() {
  const [facts, setFacts] = useState([])
  const [summaries, setSummaries] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const [factsR, sumR] = await Promise.all([
        fetch('/api/voice/memory/facts', { credentials: 'include' }),
        fetch('/api/voice/memory/summaries', { credentials: 'include' }),
      ])
      if (factsR.ok) setFacts((await factsR.json()).facts || [])
      if (sumR.ok) setSummaries((await sumR.json()).summaries || [])
      if (!factsR.ok && factsR.status === 402) {
        setErrorMsg('Voice features require a paid plan.')
      }
    } catch (e) {
      setErrorMsg(e?.message || 'Failed to load voice memory')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const addFact = useCallback(async (text, category = 'general') => {
    const r = await fetch('/api/voice/memory/facts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, category }),
    })
    if (r.ok) await reload()
    return r.ok
  }, [reload])

  const deleteFact = useCallback(async (factId) => {
    const r = await fetch(`/api/voice/memory/facts/${factId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (r.ok) await reload()
    return r.ok
  }, [reload])

  return { facts, summaries, loading, errorMsg, reload, addFact, deleteFact }
}
