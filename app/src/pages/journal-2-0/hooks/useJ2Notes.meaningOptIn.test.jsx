// Rail (wave 7 whole-branch fix, ruling D-H9): the meaning append is OPT-IN by request.
//
// Once NOTEBOOK_SEMANTIC_SEARCH_ENABLED is set, GET /api/j2/notes appends "related by meaning"
// rows -- but only when the request carries `meaning=1` (the server half:
// tests/test_note_semantic_meaning_optin.py). This hook is how a caller asks: `meaning: true`
// adds the parameter, and nothing else does, so the [[ picker, AddPositionModal, ThesisSection and
// Model Book (the same endpoint, no reason line to show) never receive unlabelled meaning rows.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useJ2Notes from './useJ2Notes'

function List(props) {
  useJ2Notes(props)
  return null
}

afterEach(() => { vi.unstubAllGlobals() })

function fetched(props) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(String(url))
    return { ok: true, json: async () => ({ notes: [], total: 0 }) }
  }))
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <List {...props} />
    </SWRConfig>,
  )
  return calls
}

describe('useJ2Notes -- the meaning append is asked for, never implied (D-H9)', () => {
  it('meaning: true puts meaning=1 on the request', async () => {
    const calls = fetched({ q: 'why did I sell out of fear', sort: 'relevance', meaning: true })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(new URL(calls[0], 'http://x').searchParams.get('meaning')).toBe('1')
  })

  it('CONTROL -- the same query without it carries no meaning parameter at all', async () => {
    const calls = fetched({ q: 'why did I sell out of fear', sort: 'relevance' })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(new URL(calls[0], 'http://x').searchParams.has('meaning')).toBe(false)
  })
})
