// Rail (wave 7, lane I, fix round 1, review M-4 -- Ruling (b)): the tag cloud follows the notes
// list's OWN refresh, and only when that refresh brings back different tags.
//
// Lane I stopped GET /api/j2/notes/tags from refetching on focus (it is the Notebook's most
// expensive read), while the notes list kept refetching on focus. A tag changed outside this
// tab then showed up in the list on return while the sidebar kept the old counts. The list hook
// now asks the tag key once when its refresh of the SAME query returns a page whose tag
// signature moved -- and never per focus: an unchanged page, or a change that moves no tag,
// costs no tag query.
//
// Harness: SWR's library defaults (focus revalidation ON) with throttles removed, and a fresh
// cache, so every focus revalidation the LIST allows fires at once and is counted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useJ2Notes from './useJ2Notes'
import useJ2NoteTags, { NOTE_TAGS_KEY, tagSignature } from './useJ2NoteTags'

function Probe({ q }) {
  const { notes } = useJ2Notes({ q })
  useJ2NoteTags() // the sidebar's tag cloud, mounted beside the list the way NotebookTab mounts both
  return <div data-testid="list">{notes.map((n) => `${n.title}[${(n.tags || []).join('|')}]`).join(',')}</div>
}

const harness = (ui) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, focusThrottleInterval: 0 }}>{ui}</SWRConfig>
)

async function focus() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 30))
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('tagSignature', () => {
  it('ignores order and untagged notes, and sees a tag moving', () => {
    const a = [{ id: 'n1', tags: ['b', 'a'] }, { id: 'n2', tags: [] }, { id: 'n3', tags: ['c'] }]
    const reordered = [{ id: 'n3', tags: ['c'] }, { id: 'n1', tags: ['a', 'b'] }]
    expect(tagSignature(reordered)).toBe(tagSignature(a))
    expect(tagSignature([...a, { id: 'n9', tags: [] }])).toBe(tagSignature(a))
    expect(tagSignature([{ id: 'n1', tags: ['a'] }, { id: 'n3', tags: ['c'] }])).not.toBe(tagSignature(a))
    expect(tagSignature(undefined)).toBe('')
  })
})

describe('useJ2Notes asks the tag counts when, and only when, its own refresh moves a tag', () => {
  it('focus with nothing changed, or with a title changed, fetches no tags; a tag moved elsewhere does', async () => {
    let page = [{ id: 'n1', title: 'Plan', tags: ['setups'] }, { id: 'n2', title: 'Recap', tags: [] }]
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      calls.push(u)
      const body = u === NOTE_TAGS_KEY
        ? { tags: [{ tag: 'setups', count: 1 }], tree: [] }
        : { notes: page, total: page.length }
      return { ok: true, json: async () => JSON.parse(JSON.stringify(body)) }
    }))
    const tagFetches = () => calls.filter((u) => u === NOTE_TAGS_KEY).length
    const listFetches = () => calls.filter((u) => u.startsWith('/api/j2/notes?') || u === '/api/j2/notes').length

    const view = render(harness(<Probe q="plan" />))
    await waitFor(() => expect(screen.getByTestId('list').textContent).toBe('Plan[setups],Recap[]'))
    expect(tagFetches()).toBe(1)

    // 1. focus, nothing changed: the list refetches (it still revalidates on focus) -- no tag query
    const before = listFetches()
    await focus()
    await waitFor(() => expect(listFetches()).toBeGreaterThan(before)) // control: the list DID refresh
    expect(tagFetches()).toBe(1)

    // 2. a title changed elsewhere: the list shows it, the tags cannot have moved -- no tag query
    page = [{ id: 'n1', title: 'Plan v2', tags: ['setups'] }, page[1]]
    await focus()
    await waitFor(() => expect(screen.getByTestId('list').textContent).toBe('Plan v2[setups],Recap[]'))
    expect(tagFetches()).toBe(1)

    // 3. a tag added elsewhere (another tab, an import, an email append): the tag cloud follows
    page = [page[0], { id: 'n2', title: 'Recap', tags: ['earnings'] }]
    await focus()
    await waitFor(() => expect(screen.getByTestId('list').textContent).toBe('Plan v2[setups],Recap[earnings]'))
    await waitFor(() => expect(tagFetches()).toBe(2))

    // 4. a different query is a filter change, not a refresh: its different tags ask nothing
    page = [{ id: 'n7', title: 'Macro', tags: ['rates'] }]
    view.rerender(harness(<Probe q="macro" />))
    await waitFor(() => expect(screen.getByTestId('list').textContent).toBe('Macro[rates]'))
    await new Promise((r) => setTimeout(r, 30))
    expect(tagFetches()).toBe(2)
  })
})
