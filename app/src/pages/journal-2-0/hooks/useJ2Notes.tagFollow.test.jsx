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
import { useEffect } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import useJ2Notes from './useJ2Notes'
import useJ2NoteTags, { NOTE_TAGS_KEY, tagSignature } from './useJ2NoteTags'

// ⚠️ A FOLDER key, not a query: since the whole-branch fix M-6 a list carrying `q` no longer
// revalidates on focus (useJ2Notes.searchFocus.test.jsx), and NotebookTab's main list sends no `q`
// anyway -- a folder list is the shape these rails are about.
function Probe({ folderId }) {
  const { notes } = useJ2Notes({ folderId })
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

    const view = render(harness(<Probe folderId="f-plan" />))
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

    // 4. a different folder is a filter change, not a refresh: its different tags ask nothing
    page = [{ id: 'n7', title: 'Macro', tags: ['rates'] }]
    view.rerender(harness(<Probe folderId="f-macro" />))
    await waitFor(() => expect(screen.getByTestId('list').textContent).toBe('Macro[rates]'))
    await new Promise((r) => setTimeout(r, 30))
    expect(tagFetches()).toBe(2)
  })
})

// Review N-2 (wave 7 fix round 2): the ask is once per REFRESH, not once per hook instance.
// NotebookTab mounts two lists (the main list and the title list, up to six useJ2Notes in all)
// and SWR never dedupes a mutate, so a per-instance decision asked the tag key once per list:
// one local tag operation cost 3 tag reads, one focus after a tag moved elsewhere cost 2. This
// is the re-review's two-instance probe (its source of truth: this file at d6e840c89ce8 plus
// the probe run against it), kept as a permanent rail with the answers the design states.
describe('two notes lists, one tag cloud: one tag read per refresh', () => {
  // What the components hand the test, written from effects (never during render).
  const handles = {}
  function stubServer(getPage) {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      calls.push(u)
      const body = u === NOTE_TAGS_KEY ? { tags: [], tree: [] } : { notes: getPage(), total: getPage().length }
      return { ok: true, json: async () => JSON.parse(JSON.stringify(body)) }
    }))
    return calls
  }
  function Notebookish() {
    useJ2Notes({ folderId: 'f-plan' }) // NotebookTab's main list
    useJ2Notes({ sort: 'title' }) // NotebookTab's title list
    useJ2NoteTags() //               FolderSidebar's tag cloud
    const { mutate } = useSWRConfig()
    // NotebookTab.refreshSidebarCounts' own shape: one key-predicate revalidation over every
    // notes key, the tag key included -- so that refresh already asks the tags ONCE itself.
    useEffect(() => {
      handles.refreshSidebarCounts = () => mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))
    }, [mutate])
    return null
  }
  const listReads = (calls) => calls.filter((u) => u !== NOTE_TAGS_KEY).length
  const tagReads = (calls) => calls.filter((u) => u === NOTE_TAGS_KEY).length

  it('one local tag operation asks the tags once (its own refresh), not once more per list', async () => {
    let page = [{ id: 'n1', title: 'Plan', tags: ['setups'] }, { id: 'n2', title: 'Recap', tags: [] }]
    const calls = stubServer(() => page)
    // App.jsx's SWR config (focus off, 8 s dedupe), with a fresh cache
    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, revalidateOnReconnect: false,
        dedupingInterval: 8000, focusThrottleInterval: 10000, errorRetryCount: 3 }}>
        <Notebookish />
      </SWRConfig>,
    )
    await waitFor(() => expect(listReads(calls)).toBe(2))
    await new Promise((r) => setTimeout(r, 50))
    const t0 = tagReads(calls)
    const l0 = listReads(calls)
    page = [page[0], { id: 'n2', title: 'Recap', tags: ['earnings'] }]
    await act(async () => { await handles.refreshSidebarCounts(); await new Promise((r) => setTimeout(r, 200)) })
    expect(listReads(calls) - l0).toBe(2) // control: both lists really refreshed and saw the tag move
    expect(tagReads(calls) - t0).toBe(1)
  })

  it('one focus after a tag moved elsewhere asks the tags once, however many lists see it', async () => {
    let page = [{ id: 'n1', title: 'Plan', tags: ['setups'] }, { id: 'n2', title: 'Recap', tags: [] }]
    const calls = stubServer(() => page)
    render(harness(<Notebookish />))
    await waitFor(() => expect(listReads(calls)).toBe(2))
    await new Promise((r) => setTimeout(r, 50))
    const t0 = tagReads(calls)
    const l0 = listReads(calls)
    page = [page[0], { id: 'n2', title: 'Recap', tags: ['earnings'] }]
    await focus()
    await new Promise((r) => setTimeout(r, 200))
    expect(listReads(calls) - l0).toBe(2) // control: both lists refreshed on the focus
    expect(tagReads(calls) - t0).toBe(1)
  })

  it('the refresh\'s own tag read counts even when it STARTED before the lists\' reads (one wave)', async () => {
    // The tag cloud mounted first, so its key comes first in SWR's cache and the key-predicate
    // revalidation starts the tag read BEFORE either list read -- in the same synchronous turn.
    // That read still follows the local write, so it answers both lists.
    let page = [{ id: 'n1', title: 'Plan', tags: ['setups'] }, { id: 'n2', title: 'Recap', tags: [] }]
    const calls = stubServer(() => page)
    function TagsFirst() {
      useJ2NoteTags()
      useJ2Notes({ folderId: 'f-plan' })
      useJ2Notes({ sort: 'title' })
      const { mutate } = useSWRConfig()
      useEffect(() => {
        handles.refreshSidebarCounts = () => mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))
      }, [mutate])
      return null
    }
    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, revalidateOnReconnect: false,
        dedupingInterval: 8000, focusThrottleInterval: 10000, errorRetryCount: 3 }}>
        <TagsFirst />
      </SWRConfig>,
    )
    await waitFor(() => expect(listReads(calls)).toBe(2))
    await new Promise((r) => setTimeout(r, 50))
    const t0 = tagReads(calls)
    const before = calls.length
    page = [page[0], { id: 'n2', title: 'Recap', tags: ['earnings'] }]
    await act(async () => { await handles.refreshSidebarCounts(); await new Promise((r) => setTimeout(r, 200)) })
    // control: the refresh really started the tag read FIRST
    expect(calls[before]).toBe(NOTE_TAGS_KEY)
    expect(tagReads(calls) - t0).toBe(1)
  })

  it('a tag read that finished BEFORE the refresh does not excuse it (the wave is what counts)', async () => {
    // An unrelated tag read (the editor's refresh after its own tag delta) lands between two
    // list refreshes; a tag then moves elsewhere and a focus brings it to both lists. That old
    // tag read predates the change, so the lists must still ask -- once.
    let page = [{ id: 'n1', title: 'Plan', tags: ['setups'] }]
    const calls = stubServer(() => page)
    function WithTagRefresh() {
      const { refresh } = useJ2NoteTags()
      useEffect(() => { handles.refreshTags = refresh }, [refresh])
      return <Notebookish />
    }
    render(harness(<WithTagRefresh />))
    await waitFor(() => expect(listReads(calls)).toBe(2))
    await act(async () => { await handles.refreshTags(); await new Promise((r) => setTimeout(r, 30)) })
    const t0 = tagReads(calls)
    page = [{ id: 'n1', title: 'Plan', tags: ['setups', 'breakout'] }]
    await focus()
    await new Promise((r) => setTimeout(r, 200))
    expect(tagReads(calls) - t0).toBe(1)
  })
})
