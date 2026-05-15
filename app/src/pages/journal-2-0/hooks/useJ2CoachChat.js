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
import { compassScope } from './compassScope'

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
  const scope = compassScope(accountId)
  const messagesUrl = `/api/j2/accounts/${scope}/coach/chat/messages?limit=200`
  const statusUrl = `/api/j2/accounts/${scope}/coach/chat/status`
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
    if (!text?.trim()) return
    return consumeStream(
      `/api/j2/accounts/${scope}/coach/chat/stream`,
      { message: text.trim() },
    )
  }, [scope, consumeStream])

  const confirm = useCallback((message_id, tool_call_id) => {
    return consumeStream(
      `/api/j2/accounts/${scope}/coach/chat/confirm`,
      { message_id, tool_call_id },
    )
  }, [scope, consumeStream])

  const cancel = useCallback((message_id, tool_call_id) => {
    return consumeStream(
      `/api/j2/accounts/${scope}/coach/chat/cancel`,
      { message_id, tool_call_id },
    )
  }, [scope, consumeStream])

  const forget = useCallback(async (message_id) => {
    await fetch(`/api/j2/accounts/${scope}/coach/chat/forget`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id }),
    })
    await refreshMessages()
  }, [scope, refreshMessages])

  const forgetAll = useCallback(async () => {
    await fetch(`/api/j2/accounts/${scope}/coach/chat/forget`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    await refreshMessages()
  }, [scope, refreshMessages])

  const startOnboarding = useCallback(() => {
    return consumeStream(
      `/api/j2/accounts/${scope}/coach/chat/start_onboarding`,
      {},
    )
  }, [scope, consumeStream])

  const skipOnboarding = useCallback(async () => {
    await fetch(`/api/j2/accounts/${scope}/coach/chat/skip_onboarding`, {
      method: 'POST', credentials: 'include',
    })
    await refreshStatus()
    await refreshMessages()
  }, [scope, refreshStatus, refreshMessages])

  const redoOnboarding = useCallback(() => {
    return consumeStream(
      `/api/j2/accounts/${scope}/coach/chat/redo_onboarding`,
      {},
    )
  }, [scope, consumeStream])

  return {
    messages: messagesData?.messages ?? [],
    status: status ?? {
      enabled: true,
      rate_limit_remaining: 200,
      conversation_message_count: 0,
      onboarded: false,
      onboarding_mode: false,
    },
    isLoading,
    error: error || streamError,
    isStreaming,
    streamingTokens,
    pendingAction,
    isOnboarding: !!status?.onboarding_mode,
    needsOnboarding: status?.onboarded === false && status?.onboarding_mode === false,
    send,
    confirm,
    cancel,
    forget,
    forgetAll,
    startOnboarding,
    skipOnboarding,
    redoOnboarding,
    refresh: refreshMessages,
  }
}
