/**
 * Compass Chat hook.
 *
 * Returns: { messages, status, isLoading, send, confirm, cancel, forget,
 *            forgetAll, isStreaming, streamingTokens, pendingAction,
 *            error, refresh }.
 *
 * SSE consumed via fetch + getReader (POST bodies are required).
 */
import { useState, useCallback, useRef } from 'react'
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

async function* sseFromFetch(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (line) {
        try { yield JSON.parse(line.slice(6)) } catch { /* skip */ }
      }
    }
  }
}

export default function useJ2CoachChat(accountId) {
  const messagesUrl = accountId ? `/api/j2/accounts/${accountId}/coach/chat/messages?limit=200` : null
  const statusUrl = accountId ? `/api/j2/accounts/${accountId}/coach/chat/status` : null
  const { data: messagesData, error, isLoading, mutate: refreshMessages } = useSWR(
    messagesUrl, fetcher,
    { revalidateOnFocus: true, shouldRetryOnError: false },
  )
  const { data: status, mutate: refreshStatus } = useSWR(
    statusUrl, fetcher,
    { revalidateOnFocus: true, refreshInterval: 30000 },
  )

  const [isStreaming, setStreaming] = useState(false)
  const [streamingTokens, setStreamingTokens] = useState('')
  const [pendingAction, setPendingAction] = useState(null)
  const [streamError, setStreamError] = useState(null)
  const abortRef = useRef(null)

  const consumeStream = useCallback(async (url, body) => {
    setStreamError(null)
    setStreaming(true)
    setStreamingTokens('')
    setPendingAction(null)
    abortRef.current = new AbortController()
    try {
      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: abortRef.current.signal,
      })
      if (!resp.ok) {
        let msg = `${resp.status}`
        try { const j = await resp.json(); if (j?.detail) msg = j.detail } catch {}
        throw new Error(msg)
      }
      for await (const event of sseFromFetch(resp)) {
        if (event.type === 'token') {
          setStreamingTokens((s) => s + (event.text || ''))
        } else if (event.type === 'tool_call_pending') {
          setPendingAction({
            message_id: event.message_id,
            tool_call_id: event.tool_call_id,
            name: event.name,
            args: event.args,
            preview: event.preview,
          })
        } else if (event.type === 'error') {
          throw new Error(event.message || event.code || 'chat error')
        } else if (event.type === 'complete') {
          await refreshMessages()
          await refreshStatus()
        }
      }
    } catch (e) {
      setStreamError(String(e.message || e))
    } finally {
      setStreaming(false)
      setStreamingTokens('')
      abortRef.current = null
    }
  }, [refreshMessages, refreshStatus])

  const send = useCallback((text) => {
    if (!accountId || !text?.trim()) return
    return consumeStream(
      `/api/j2/accounts/${accountId}/coach/chat/stream`,
      { message: text.trim() },
    )
  }, [accountId, consumeStream])

  const confirm = useCallback((message_id, tool_call_id) => {
    if (!accountId) return
    return consumeStream(
      `/api/j2/accounts/${accountId}/coach/chat/confirm`,
      { message_id, tool_call_id },
    )
  }, [accountId, consumeStream])

  const cancel = useCallback((message_id, tool_call_id) => {
    if (!accountId) return
    return consumeStream(
      `/api/j2/accounts/${accountId}/coach/chat/cancel`,
      { message_id, tool_call_id },
    )
  }, [accountId, consumeStream])

  const forget = useCallback(async (message_id) => {
    if (!accountId) return
    await fetch(`/api/j2/accounts/${accountId}/coach/chat/forget`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id }),
    })
    await refreshMessages()
  }, [accountId, refreshMessages])

  const forgetAll = useCallback(async () => {
    if (!accountId) return
    await fetch(`/api/j2/accounts/${accountId}/coach/chat/forget`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    await refreshMessages()
  }, [accountId, refreshMessages])

  return {
    messages: messagesData?.messages ?? [],
    status: status ?? { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0 },
    isLoading,
    error: error || streamError,
    isStreaming,
    streamingTokens,
    pendingAction,
    send,
    confirm,
    cancel,
    forget,
    forgetAll,
    refresh: refreshMessages,
  }
}
