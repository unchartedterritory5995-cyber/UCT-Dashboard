// Rail (wave 7, lane I): GET /api/j2/notes/tags is fetched only when a tag COULD have
// changed -- never because the member switched back to the tab.
//
// The hook used to pass `revalidateOnFocus: true`, overriding the app-wide `false`, so
// every focus paid for the whole-library tag count + tag tree (~1.4 s at 50k notes before
// wave 7, review R1-N4). The harness below runs under SWR's OWN defaults, where focus
// revalidation is ON, so the hook must switch it off by itself. Inheriting App.jsx's
// provider is not enough, because a surface mounted outside it would still get the fetch.
//
// Mutation-proved: flipping the hook back to `revalidateOnFocus: true` turns the focus
// case red. The CONTROL (an explicit refresh, the way a tag edit revalidates) proves the
// counter can move at all.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useJ2NoteTags, { NOTE_TAGS_KEY } from './useJ2NoteTags'

function Probe({ onRefresh }) {
  const { tagCounts, refresh } = useJ2NoteTags()
  onRefresh(refresh)
  return <div data-testid="tag-count">{tagCounts.length}</div>
}

function harness(ui) {
  // SWR's library defaults (revalidateOnFocus: true) with the throttles removed, so a
  // focus revalidation -- if the hook allowed one -- fires immediately and is counted.
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, focusThrottleInterval: 0 }}>
      {ui}
    </SWRConfig>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useJ2NoteTags revalidation', () => {
  it('a focus event with no tag change fetches nothing; an explicit refresh does fetch', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url))
      return { ok: true, json: async () => ({ tags: [{ tag: 'setups', count: 3 }], tree: [] }) }
    }))
    const tagFetches = () => calls.filter((u) => u === NOTE_TAGS_KEY).length
    let refresh = null
    render(harness(<Probe onRefresh={(r) => { refresh = r }} />))
    await waitFor(() => expect(screen.getByTestId('tag-count').textContent).toBe('1'))
    expect(tagFetches()).toBe(1)

    // Both of SWR's focus signals: window focus, and the tab becoming visible again.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(tagFetches(), 'a focus with no tag change must not re-run the tag count').toBe(1)

    // CONTROL: the revalidation a tag change triggers still reaches the server.
    await act(async () => { await refresh() })
    await waitFor(() => expect(tagFetches()).toBe(2))
  })
})
