// Import a tweet: the sheet and its doors.
//
// What each block proves (behaviour, asserted by RENDERED TEXT and by the request on the wire):
//   * the doors render nothing while notebook_tweet_import_enabled is off;
//   * ticks travel in tick order, a pasted link lands ticked at the top, an invalid link does nothing;
//   * a refusal keeps the selection, a warning and a partial import are shown, and every 200 lands the note;
//   * the editor door puts the cards at the caret, in tick order, once each.
// Handles and post text are invented: the repo is public.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../lib/offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => 'rev') }))
vi.mock('../../lib/noteCreation', () => ({
  createNoteViaApi: vi.fn(async ({ title }) => ({ id: 'n-new', title })),
}))

import { settleNoteWrite } from '../../lib/offline/settleNoteWrite'
import { createNoteViaApi } from '../../lib/noteCreation'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { TWEET_EVENT, tweetImportEnabled } from '../../lib/tweetImport'
import { consumePendingFocus, groupByDay, isPostLink, postHref } from '../../lib/tweetImportHelpers'
import TweetInsertHost, { ImportTweetButton } from './TweetDoors'

const NOW = Math.floor(Date.now() / 1000)
const post = (id, name, handle, kind, text, ageSeconds = 3600) => ({
  id, name, handle, kind, text, avatarUrl: null, postedAt: NOW - ageSeconds,
  url: `https://x.com/${handle}/status/${id}`, tickers: ['NVDA'], media: [],
})
const NEWS = post('1001', 'Northgate Newswire', 'northgate_wire', 'news', 'HEADLINE: $NVDA widens a cloud deal')
const TAKE = post('1002', 'Alder Street Desk', 'alderstreetdesk', 'commentary', 'My $NVDA thesis in one line')
const OTHER = post('1003', 'Harbor Macro', 'harbormacro', 'commentary', 'Treasury yields slip', 7200)
const LINKED = post('2001', 'Fieldnote Research', 'fieldnote_res', 'commentary', 'Why gross margin is the number')
const LINK = 'https://x.com/fieldnote_res/status/2001'
const NOTES = [{ id: 'n1', title: 'NVDA thesis' }, { id: 'n2', title: 'Semis' }]
const SAVED = {
  excerpts: [{ id: 'ex1', tweet: { tweetId: '1002' } }, { id: 'ex2', tweet: { tweetId: '1001' } }],
  note: { id: 'n1', updatedAt: '2026-11-08T00:00:01Z' }, warnings: [],
}

function installFetch(routes) {
  const calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    const hit = routes.find(([re, method]) => re.test(url) && (!method || method === (init.method || 'GET')))
    const [status, body] = hit ? hit[2] : [404, { detail: 'no route' }]
    return { ok: status < 300, status, json: async () => body }
  })
  return calls
}

const FEED = [/\/tweets\/recent/, 'GET', [200, { posts: [NEWS, TAKE, OTHER] }]]
const wrap = (ui) => render(<SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>)
const rowFor = (name) => screen.findByRole('checkbox', { name: new RegExp(name) })

async function openFromButton(props = {}) {
  wrap(<ImportTweetButton symbol="NVDA" notes={NOTES} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Import a tweet/ }))
  await rowFor('Northgate Newswire')
}

function fakeEditor(existingIds = []) {
  const dom = document.createElement('div')
  const inserted = []
  const editor = {
    isDestroyed: false,
    view: { dom },
    on: () => {},
    off: () => {},
    state: {
      selection: { to: 7 },
      doc: { descendants: (fn) => existingIds.forEach((id) => fn({ type: { name: 'documentExcerpt' }, attrs: { excerptId: id } })) },
    },
    chain: () => {
      const c = { focus: () => c, insertContentAt: (pos, nodes) => { inserted.push({ pos, nodes }); return c }, run: () => true }
      return c
    },
  }
  return { editor, dom, inserted }
}

describe('Import a tweet', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_tweet_import_enabled: true })
    settleNoteWrite.mockClear()
    createNoteViaApi.mockClear()
  })
  afterEach(() => __resetNotebookFlags())

  it('door renders nothing while the flag is off', () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_tweet_import_enabled: false })
    const { container } = wrap(<ImportTweetButton symbol="NVDA" notes={NOTES} />)
    expect(container.innerHTML).toBe('')
  })

  describe('the app-wide tweet kill switch', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('VITE_TWITTER_UI_ENABLED="0" hides the door even with the Notebook flag on', () => {
      vi.stubEnv('VITE_TWITTER_UI_ENABLED', '0')
      expect(tweetImportEnabled()).toBe(false)
      const { container } = wrap(<ImportTweetButton symbol="NVDA" notes={NOTES} />)
      expect(container.innerHTML).toBe('')
    })

    it('any other value leaves the door on, and the Notebook flag still decides', () => {
      vi.stubEnv('VITE_TWITTER_UI_ENABLED', '1')
      expect(tweetImportEnabled()).toBe(true)
      __resetNotebookFlags()
      latchNotebookFlags({ notebook_tweet_import_enabled: false })
      expect(tweetImportEnabled()).toBe(false)
    })
  })

  it('ticking two posts and importing sends both ids in tick order', async () => {
    const calls = installFetch([FEED, [/\/tweets\/save$/, 'POST', [200, SAVED]]])
    await openFromButton()
    fireEvent.change(screen.getByRole('combobox', { name: 'Save to' }), { target: { value: 'n1' } })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(await rowFor('Northgate Newswire'))
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 posts' }))
    await waitFor(() => expect(settleNoteWrite).toHaveBeenCalledWith('n1', SAVED))
    const save = calls.find((c) => c.method === 'POST')
    expect(save.body).toEqual({ noteId: 'n1', tweetIds: ['1002', '1001'] })
  })

  it('a valid link appears ticked under From your link', async () => {
    const calls = installFetch([FEED, [/\/tweets\/resolve$/, 'POST', [200, { post: LINKED }]]])
    await openFromButton()
    fireEvent.change(screen.getByRole('textbox', { name: 'Link to a post on X' }), { target: { value: LINK } })
    const row = await rowFor('Fieldnote Research')
    expect(row).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('From your link')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ url: LINK })
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })

  it.each([
    'https://x.com/i/web/status/2001',
    'https://twitter.com/i/web/status/2001?s=20',
  ])('a share link with no handle reaches the resolve call: %s', async (url) => {
    const calls = installFetch([FEED, [/\/tweets\/resolve$/, 'POST', [200, { post: LINKED }]]])
    await openFromButton()
    fireEvent.change(screen.getByRole('textbox', { name: 'Link to a post on X' }), { target: { value: url } })
    expect(await rowFor('Fieldnote Research')).toHaveAttribute('aria-checked', 'true')
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ url })
  })

  it('postHref keeps a share link with no handle, and the host rules are unchanged', () => {
    expect(postHref('https://x.com/i/web/status/2001')).toBe('https://x.com/i/web/status/2001')
    expect(postHref('twitter.com/i/web/status/2001')).toBe('https://twitter.com/i/web/status/2001')
    expect(postHref('https://mobile.twitter.com/i/web/status/2001/photo/1'))
      .toBe('https://mobile.twitter.com/i/web/status/2001/photo/1')
    for (const bad of [
      'https://x.com.evil.test/i/web/status/2001',
      'https://notx.com/i/web/status/2001',
      'https://evil.test/x.com/i/web/status/2001',
      'https://x.com@evil.test/i/web/status/2001',
      'https://x.com/i/web/status/abc',
      'https://x.com/i/web/2001',
    ]) {
      expect(isPostLink(bad)).toBe(false)
      expect(postHref(bad)).toBeNull()
    }
  })

  it('an invalid link shows the sentence and changes nothing', async () => {
    const calls = installFetch([FEED])
    await openFromButton()
    fireEvent.change(screen.getByRole('textbox', { name: 'Link to a post on X' }), { target: { value: 'https://notx.com/a/status/1' } })
    await screen.findByText("That doesn't look like a link to a post on X.")
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    expect(screen.getByText('Nothing saved until you import')).toBeInTheDocument()
    expect(screen.queryByText('From your link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('a post already in the note cannot be ticked', async () => {
    installFetch([FEED, [/\/notes\/n1\/excerpts$/, 'GET', [200, { excerpts: [{ id: 'ex9', tweet: { tweetId: '1001' } }] }]]])
    const parts = fakeEditor()
    wrap(<TweetInsertHost editor={parts.editor} noteId="n1" ticker="NVDA" />)
    await act(async () => { parts.dom.dispatchEvent(new CustomEvent(TWEET_EVENT, { bubbles: true })) })
    await rowFor('Alder Street Desk')
    await screen.findByText('Already in this note')
    const row = await rowFor('Northgate Newswire')
    expect(row).toBeDisabled()
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('a post saved in another note says so and can still be ticked', async () => {
    const feed = [/\/tweets\/recent/, 'GET', [200, { posts: [{ ...TAKE, savedInNote: true }, { ...NEWS, savedInNote: false }] }]]
    installFetch([feed, [/\/notes\/n1\/excerpts$/, 'GET', [200, { excerpts: [] }]]])
    const parts = fakeEditor()
    wrap(<TweetInsertHost editor={parts.editor} noteId="n1" ticker="NVDA" />)
    await act(async () => { parts.dom.dispatchEvent(new CustomEvent(TWEET_EVENT, { bubbles: true })) })
    const row = await rowFor('Alder Street Desk')
    expect(screen.getAllByText('Saved in one of your notes')).toHaveLength(1)
    expect(row.textContent).toContain('Saved in one of your notes')
    expect(row).toBeEnabled()
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
    // CONTROL: the row the server did not mark carries no label.
    expect((await rowFor('Northgate Newswire')).textContent).not.toContain('Saved in one of your notes')
  })

  it('a post already in the open note says only that, even when the server marks it saved', async () => {
    const feed = [/\/tweets\/recent/, 'GET', [200, { posts: [{ ...NEWS, savedInNote: true }, TAKE] }]]
    installFetch([feed, [/\/notes\/n1\/excerpts$/, 'GET', [200, { excerpts: [{ id: 'ex9', tweet: { tweetId: '1001' } }] }]]])
    const parts = fakeEditor()
    wrap(<TweetInsertHost editor={parts.editor} noteId="n1" ticker="NVDA" />)
    await act(async () => { parts.dom.dispatchEvent(new CustomEvent(TWEET_EVENT, { bubbles: true })) })
    await screen.findByText('Already in this note')
    expect(screen.queryByText('Saved in one of your notes')).toBeNull()
    expect(await rowFor('Northgate Newswire')).toBeDisabled()
  })

  it('Import is disabled with nothing ticked', async () => {
    installFetch([FEED])
    await openFromButton()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.getByText('Nothing saved until you import')).toBeInTheDocument()
  })

  it('a server refusal shows its detail and keeps the selection', async () => {
    installFetch([FEED, [/\/tweets\/save$/, 'POST', [404, { detail: 'That post could not be found.' }]]])
    await openFromButton()
    fireEvent.change(screen.getByRole('combobox', { name: 'Save to' }), { target: { value: 'n1' } })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('That post could not be found.')
    expect(await rowFor('Alder Street Desk')).toHaveAttribute('aria-checked', 'true')
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })

  it('a refusal after creating a new note retries into that same note', async () => {
    let attempt = 0
    installFetch([FEED])
    const base = global.fetch
    global.fetch = vi.fn(async (url, init = {}) => {
      if (/\/tweets\/save$/.test(url)) {
        attempt += 1
        const body = attempt === 1 ? { detail: 'X is not answering right now.' } : { ...SAVED, excerpts: [SAVED.excerpts[0]] }
        return { ok: attempt > 1, status: attempt > 1 ? 200 : 503, json: async () => body }
      }
      return base(url, init)
    })
    await openFromButton({ onOpenNote: vi.fn() })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('X is not answering right now.')
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(settleNoteWrite).toHaveBeenCalled())
    expect(createNoteViaApi).toHaveBeenCalledTimes(1)
  })

  it('closing after every attempt failed trashes the note the sheet made', async () => {
    const calls = installFetch([FEED, [/\/tweets\/save$/, 'POST', [503, { detail: 'X is not answering right now.' }]]])
    await openFromButton({ onOpenNote: vi.fn() })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('X is not answering right now.')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/j2/notes/n-new'))
  })

  it('a note that received posts is never trashed on close', async () => {
    const calls = installFetch([FEED, [/\/tweets\/save$/, 'POST', [200, { ...SAVED, note: { id: 'n-new', updatedAt: 'x' } }]]])
    await openFromButton({ onOpenNote: vi.fn() })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('a warning from the server is shown after import', async () => {
    const out = { ...SAVED, warnings: ['An image from @alderstreetdesk could not be copied.'] }
    installFetch([FEED, [/\/tweets\/save$/, 'POST', [200, out]]])
    const onOpenNote = vi.fn()
    await openFromButton({ onOpenNote })
    fireEvent.change(screen.getByRole('combobox', { name: 'Save to' }), { target: { value: 'n1' } })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('An image from @alderstreetdesk could not be copied.')
    expect(settleNoteWrite).toHaveBeenCalledWith('n1', out)
    // The sheet stays so the sentence can be read; the note is one press away.
    expect(onOpenNote).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open the note' }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'n1' })
  })

  it('a partial import shows the stopped sentence and still settles the note', async () => {
    const out = {
      excerpts: [SAVED.excerpts[0]], note: SAVED.note, warnings: [],
      stopped: 'That post could not be found. 1 of your posts was saved.',
    }
    installFetch([FEED, [/\/tweets\/save$/, 'POST', [200, out]]])
    const onOpenNote = vi.fn()
    await openFromButton({ onOpenNote })
    fireEvent.change(screen.getByRole('combobox', { name: 'Save to' }), { target: { value: 'n1' } })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(await rowFor('Northgate Newswire'))
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 posts' }))
    await screen.findByText('That post could not be found. 1 of your posts was saved.')
    expect(settleNoteWrite).toHaveBeenCalledWith('n1', out)
    expect(onOpenNote).not.toHaveBeenCalled()
    // The saved post is off the tick list; the one that did not make it stays ticked for a retry.
    expect(await rowFor('Alder Street Desk')).toHaveAttribute('aria-checked', 'false')
    expect(await rowFor('Northgate Newswire')).toHaveAttribute('aria-checked', 'true')
  })

  it('a clean import closes the sheet and opens the note, with the first card marked for focus', async () => {
    installFetch([FEED, [/\/tweets\/save$/, 'POST', [200, SAVED]]])
    const onOpenNote = vi.fn()
    await openFromButton({ onOpenNote })
    fireEvent.change(screen.getByRole('combobox', { name: 'Save to' }), { target: { value: 'n1' } })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith({ id: 'n1' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(consumePendingFocus('ex1')).toBe(true)
    expect(consumePendingFocus('ex1')).toBe(false)
  })

  it('saving to a new note creates it with the ticker and the agreed title', async () => {
    const calls = installFetch([FEED, [/\/tweets\/save$/, 'POST', [200, { ...SAVED, note: { id: 'n-new', updatedAt: 'x' } }]]])
    await openFromButton({ onOpenNote: vi.fn() })
    expect(screen.getByRole('combobox', { name: 'Save to' }).value).toBe('__new__')
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalledWith({ title: 'NVDA: what people are saying', ticker: 'NVDA' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body.noteId).toBe('n-new'))
  })

  it('Headlines shows only news-account posts', async () => {
    installFetch([FEED])
    await openFromButton()
    fireEvent.click(screen.getByRole('button', { name: 'Headlines' }))
    await rowFor('Northgate Newswire')
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Alder Street Desk/ })).toBeNull())
    // Pressed again, the filter is off.
    fireEvent.click(screen.getByRole('button', { name: 'Headlines' }))
    await rowFor('Alder Street Desk')
  })

  it('Theses and takes shows only commentary, and search narrows the loaded posts', async () => {
    installFetch([FEED])
    await openFromButton()
    fireEvent.click(screen.getByRole('button', { name: 'Theses and takes' }))
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Northgate/ })).toBeNull())
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search posts' }), { target: { value: 'harbormacro' } })
    await rowFor('Harbor Macro')
    expect(screen.queryByRole('checkbox', { name: /Alder Street Desk/ })).toBeNull()
  })

  it('opened from a note with no ticker it starts on All recent and hides the ticker chip', async () => {
    const calls = installFetch([FEED, [/\/notes\/n1\/excerpts$/, 'GET', [200, { excerpts: [] }]]])
    const parts = fakeEditor()
    wrap(<TweetInsertHost editor={parts.editor} noteId="n1" ticker={null} />)
    await act(async () => { parts.dom.dispatchEvent(new CustomEvent(TWEET_EVENT, { bubbles: true })) })
    await rowFor('Northgate Newswire')
    expect(calls.find((c) => /\/tweets\/recent/.test(c.url)).url).toContain('scope=all')
    expect(screen.queryByRole('button', { name: /^\$/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'All recent' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('the editor door lands the cards at the caret in tick order, once each', async () => {
    installFetch([FEED, [/\/notes\/n1\/excerpts$/, 'GET', [200, { excerpts: [] }]], [/\/tweets\/save$/, 'POST', [200, SAVED]]])
    const parts = fakeEditor(['ex2'])
    wrap(<TweetInsertHost editor={parts.editor} noteId="n1" ticker="NVDA" noteTitle="NVDA thesis" />)
    await act(async () => { parts.dom.dispatchEvent(new CustomEvent(TWEET_EVENT, { bubbles: true })) })
    fireEvent.click(await rowFor('Alder Street Desk'))
    fireEvent.click(await rowFor('Northgate Newswire'))
    expect(screen.queryByRole('combobox', { name: 'Save to' })).toBeNull()
    expect(screen.getByText('NVDA thesis')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 posts' }))
    await waitFor(() => expect(parts.inserted).toHaveLength(1))
    expect(parts.inserted[0]).toEqual({ pos: 7, nodes: [{ type: 'documentExcerpt', attrs: { excerptId: 'ex1' } }] })
  })

  it('groupByDay puts today first and names the older days', () => {
    const today = post('1', 'A', 'a', 'news', 't', 60)
    const old = { ...post('2', 'B', 'b', 'news', 't'), postedAt: NOW - 3 * 86400 }
    const groups = groupByDay([old, today])
    expect(groups.map((g) => g.posts.map((p) => p.id))).toEqual([['1'], ['2']])
    expect(groups[0].day).toBe('Today')
    expect(groups[1].day).toMatch(/^[A-Z][a-z]+, [A-Z][a-z]{2} \d{1,2}$/)
  })
})
