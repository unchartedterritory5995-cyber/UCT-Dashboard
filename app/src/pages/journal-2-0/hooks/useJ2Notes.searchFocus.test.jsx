// Rail (wave 7 whole-branch fix, frontend review M-6): a notes list that carries a search query
// (`q`) does NOT re-run on window focus.
//
// Every useJ2Notes list revalidated on focus, FolderSidebar's search list included. Past the 8 s
// dedupe each return to the tab re-sent the member's 3+ word query -- and once the meaning search
// is armed that is one more synchronous embed per focus, per open search. A search is an answer
// to a question the member asked; it is refreshed by their own writes (the key-predicate refresh
// every notebook write already runs), not by where their window focus went. Lists WITHOUT a query
// (the folder, tag and counter lists) keep following focus, so a change made elsewhere still shows.
//
// Harness: SWR's library defaults (focus revalidation ON) with the throttles removed and a fresh
// cache, so every focus revalidation a list allows fires at once and is counted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, act, waitFor } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import useJ2Notes from './useJ2Notes'

const handles = {}
function Lists() {
  useJ2Notes({ q: 'why did I sell out of fear', sort: 'relevance' }) // FolderSidebar's search list
  useJ2Notes({ folderId: 'f1' })                                    // an ordinary list, the control
  const { mutate } = useSWRConfig()
  useEffect(() => {
    // NotebookTab.refreshSidebarCounts' shape: one key-predicate revalidation over every notes key.
    handles.refreshNotes = () => mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))
  }, [mutate])
  return null
}

async function focus() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 30))
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('a list carrying a search query does not re-run on focus (M-6)', () => {
  it('focus refreshes the plain list and NOT the search; a notebook write still refreshes both', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url))
      return { ok: true, json: async () => ({ notes: [], total: 0 }) }
    }))
    const searchReads = () => calls.filter((u) => u.includes('q=')).length
    const folderReads = () => calls.filter((u) => u.includes('folder_id=f1')).length

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, focusThrottleInterval: 0 }}>
        <Lists />
      </SWRConfig>,
    )
    await waitFor(() => expect(searchReads()).toBe(1))
    await waitFor(() => expect(folderReads()).toBe(1))

    await focus()
    await waitFor(() => expect(folderReads()).toBe(2)) // control: focus DID reach the lists
    await new Promise((r) => setTimeout(r, 30))
    expect(searchReads()).toBe(1)                       // ...and did not re-send the query

    await act(async () => { await handles.refreshNotes(); await new Promise((r) => setTimeout(r, 30)) })
    expect(searchReads()).toBe(2)                       // the member's own write still refreshes it
  })
})
