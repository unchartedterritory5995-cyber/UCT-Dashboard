import useSWR from 'swr'

export const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) {
      const e = new Error(String(r.status))
      e.status = r.status
      throw e
    }
    return r.json()
  })

export async function apiCall(url, body, method = 'POST') {
  const isForm = body instanceof FormData
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: isForm || body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error(data.detail || String(res.status))
    e.status = res.status
    throw e
  }
  return data
}

export const useCommunityStatus = () => useSWR('/api/community/status', fetcher)

export const useSpaces = (enabled) =>
  useSWR(enabled ? '/api/community/spaces' : null, fetcher, { refreshInterval: 30_000 })

export const useThreads = (space, enabled) =>
  useSWR(enabled && space ? `/api/community/threads?space=${space}` : null, fetcher,
         { refreshInterval: 30_000 })

export const useThread = (threadId) =>
  useSWR(threadId ? `/api/community/threads/${threadId}` : null, fetcher,
         { refreshInterval: 20_000 })

// Pulse channels (live chat). Light poll keeps the rail's presence + unread fresh;
// the live message stream itself is the pooled EventSource (chatStreamManager).
export const useChatChannels = (enabled) =>
  useSWR(enabled ? '/api/community/chat/channels' : null, fetcher, { refreshInterval: 20_000 })

// The Tape — global "what's alive now" (online + hot tickers).
export const useTape = (enabled) =>
  useSWR(enabled ? '/api/community/chat/tape' : null, fetcher, { refreshInterval: 15_000 })
