// TWT: rendered text and real behaviour against a fake network (the tweets route is served by a
// fake `fetch`; nothing on the panel's path is mocked).
//   * posts render newest first, with author, ET time, counts and a link out;
//   * an empty week says no posts were found in the last 7 days (it must not look broken);
//   * a failed read is an error with Retry, never "no posts";
//   * VITE_TWITTER_UI_ENABLED="0" switches the panel off and reads nothing;
//   * the registry: `NVDA TWT` resolves to this panel.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import TwtPanel, { countText, TWT_SHOWN, tweetRows, tweetsUrl } from './TwtPanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

const T = (id, created_at, text, extra = {}) => ({
  id, created_at, text, author_handle: 'DeItaone', author_name: 'Walter Bloomberg',
  url: `https://x.com/DeItaone/status/${id}`, like_count: 1200, retweet_count: 30, ...extra,
})
const POSTS = [T('1', 1_790_000_000, '$NVDA older post'), T('2', 1_790_003_600, '$NVDA newer post'), T('1', 1_790_000_000, 'dup')]

const realFetch = globalThis.fetch
function serve(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    const hit = routes[String(url)]
    if (hit === undefined) return new Response('{}', { status: 404 })
    if (typeof hit === 'number') return new Response('{"detail":"x"}', { status: hit })
    return new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}
function renderPanel(sym = 'NVDA') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <TwtPanel sym={sym} />
    </SWRConfig>,
  )
}
afterEach(() => { cleanup(); globalThis.fetch = realFetch; vi.unstubAllEnvs() })

describe('tweetRows', () => {
  it('drops duplicates and blanks, newest first', () => {
    expect(tweetRows([...POSTS, { id: '9', text: '' }, null]).map((t) => t.id)).toEqual(['2', '1'])
    expect(tweetRows(undefined)).toEqual([])
  })
})

describe('TwtPanel', () => {
  it('lists posts newest first with author, ET time, counts and a link out', async () => {
    serve({ [tweetsUrl('NVDA')]: POSTS })
    renderPanel()
    const list = await screen.findByTestId('terminal-twt-list')
    const items = within(list).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-testid'))).toEqual(['terminal-twt-post-2', 'terminal-twt-post-1'])
    expect(items[0].textContent).toContain('@DeItaone')
    expect(items[0].textContent).toContain('ET')
    expect(items[0].textContent).toContain('1,200 likes, 30 reposts')
    expect(within(items[0]).getByRole('link', { name: /^Open on X: post by @DeItaone/ }).getAttribute('href')).toBe('https://x.com/DeItaone/status/2')
    expect(screen.getByTestId('terminal-twt-count').textContent).toContain('2 posts mentioning $NVDA in the last 7 days')
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/tweets/ticker/NVDA?hours=168', undefined)
  })

  it('an empty week says no posts were found in the last 7 days', async () => {
    serve({ [tweetsUrl('ZZZ')]: [] })
    renderPanel('ZZZ')
    const empty = await screen.findByTestId('terminal-twt-empty')
    expect(empty.textContent).toContain('No posts about ZZZ were found in the last 7 days.')
    expect(screen.queryByTestId('terminal-twt-error')).toBeNull()
  })

  it('a failed read is an error with Retry, never "no posts"', async () => {
    serve({ [tweetsUrl('NVDA')]: 500 })
    renderPanel()
    const err = await screen.findByTestId('terminal-twt-error')
    expect(err.textContent).toContain('Could not read posts about NVDA')
    expect(screen.queryByTestId('terminal-twt-empty')).toBeNull()
    serve({ [tweetsUrl('NVDA')]: POSTS })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-twt-list')).toBeTruthy()
  })

  it('caps the list and counts the rest', async () => {
    const many = Array.from({ length: TWT_SHOWN + 5 }, (_, i) => T(String(i + 10), 1_790_000_000 + i, `post ${i}`))
    serve({ [tweetsUrl('NVDA')]: many })
    renderPanel()
    expect((await screen.findByTestId('terminal-twt-more')).textContent).toContain(`newest ${TWT_SHOWN} of ${TWT_SHOWN + 5}`)
  })

  it('VITE_TWITTER_UI_ENABLED="0" switches it off and reads nothing', () => {
    vi.stubEnv('VITE_TWITTER_UI_ENABLED', '0')
    serve({ [tweetsUrl('NVDA')]: POSTS })
    renderPanel()
    expect(screen.getByTestId('terminal-twt-off').textContent).toContain('switched off')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('with no ticker it asks for one and fetches nothing', () => {
    serve({})
    render(<TwtPanel sym={null} />)
    expect(screen.getByText('TWT needs a ticker.')).toBeTruthy()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('TWT in the registry', () => {
  it('NVDA TWT opens the Twt panel', async () => {
    expect(BY_CODE.TWT.group).toBe('Security')
    expect(variantFor('TWT', true).variant.panel).toBe('Twt')
    expect(parseCommand('NVDA TWT')).toMatchObject({ ok: true, type: 'function', code: 'TWT', sym: 'NVDA' })
    expect((await PANEL_IMPORTERS.Twt()).default).toBe(TwtPanel)
  })
})

describe('TWT locked states (wave 9)', () => {
  it('a 402 says paid plan and a 404 says not switched on, neither with Retry', async () => {
    serve({ [tweetsUrl('NVDA')]: 402 })
    renderPanel()
    const paid = await screen.findByTestId('terminal-twt-error')
    expect(paid.textContent).toContain('paid plan')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    serve({ [tweetsUrl('NVDA')]: 404 })
    renderPanel()
    const off = await screen.findByTestId('terminal-twt-error')
    expect(off.textContent).toContain('not switched on')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})

describe('TWT counts', () => {
  it('puts the noun in the right number', () => {
    expect(countText(1, 'repost')).toBe('1 repost')
    expect(countText(0, 'like')).toBe('0 likes')
    expect(countText(1200, 'like')).toBe('1,200 likes')
    expect(countText(undefined, 'repost')).toBe('0 reposts')
  })
})
