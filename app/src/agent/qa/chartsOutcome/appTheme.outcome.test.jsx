// CHARTS OUTCOME 6 — the app theme, through the REAL writer: host.prefs is built exactly as ChartsWorkspace builds it, over the
// REAL usePreferences hook (setPref → POST /api/auth/preferences), so the state asserted is what the server was sent and
// what the hook now holds. Whether Layout then paints it is NOT proven here (Layout's own effect: el.dataset.theme).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { mutate } from 'swr'
import { useRef } from 'react'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, must, waitFor } from './outcomeHarness'
import usePreferences from '../../../hooks/usePreferences'
import { uctThemeValue } from '../../../styles/appThemes'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)

/** A panel whose host.prefs is ChartsWorkspace's own construction over the live hook, and a preferences server. */
async function withRealPrefs({ refuse = () => false } = {}) {
  const m = open(QUAD(), QUAD_SYMS)
  const server = { theme: 'dark', default_chart_tf: 'D', posts: [] }
  const base = globalThis.fetch
  globalThis.fetch = async (u, i = {}) => {
    if (u === '/api/auth/preferences' || String(u).startsWith('/api/auth/preferences')) {
      if ((i.method || 'GET') === 'GET') return new Response(JSON.stringify(server), { status: 200, headers: { 'content-type': 'application/json' } })
      const b = JSON.parse(i.body)
      server.posts.push(b)
      if (refuse(b)) return new Response('{"detail":"no"}', { status: 500 })
      server[b.key] = b.value
      return new Response(JSON.stringify({ ok: true, version: server.posts.length }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return base(u, i)
  }
  await mutate(() => true, undefined, { revalidate: false })
  const live = { current: null }
  function Bridge() {
    const hook = usePreferences()
    const ref = useRef(hook)
    ref.current = hook
    live.current = ref.current
    return null
  }
  render(<Bridge />)
  await waitFor(() => expect(live.current?.prefs?.theme).toBe('dark'))
  // ChartsWorkspace.jsx `prefs:` — one literal writer per key
  m.h.prefs = {
    read: () => live.current.prefs,
    write: (k, v) => ({ theme: (x) => live.current.setPref('theme', x) }[k]?.(v) ?? Promise.resolve(false)),
  }
  return { ...m, server, live }
}
const ref = (c) => must(c.settings?.[0]?.ref, 'settings entry')
const THEME = (c, theme) => ({ action: 'settings.setAppTheme', target: ref(c), args: { theme } })

describe('the app theme', () => {
  it('"switch to light mode": the server and the hook hold light; the receipt names both ends; no proposal; Undo puts it back', async () => {
    const m = await withRealPrefs()
    await m.say('switch to light mode', (c) => { expect(c.settings[0].appTheme).toMatch(/Graphite/); return [THEME(c, 'light')] })
    await waitFor(() => expect(m.server.theme).toBe('light'))
    expect(m.live.current.prefs.theme).toBe('light')
    expect(m.pending()).toBe(0)
    expect(m.lastReceipt().textContent).toMatch(/Graphite.*→.*Light/)
    await m.say('undo')
    await waitFor(() => expect(m.server.theme).toBe('dark'))
    expect(m.live.current.prefs.theme).toBe('dark')
  })
  it('the natural follow-up: the next request is told the new theme, and "actually use OLED" goes from there', async () => {
    const m = await withRealPrefs()
    await m.say('switch to light mode', (c) => [THEME(c, 'light')])
    await waitFor(() => expect(m.server.theme).toBe('light'))
    await m.say('actually use OLED', (c) => { expect(c.settings[0].appTheme).toMatch(/Light/); return [THEME(c, 'oled')] })
    await waitFor(() => expect(m.server.theme).toBe('oled'))
    expect(m.lastReceipt().textContent).toMatch(/Light.*→.*OLED/)
  })
  it('a theme already on is a no-op, said as one: nothing is sent', async () => {
    const m = await withRealPrefs()
    const out = await m.say('use dark mode', (c) => [THEME(c, 'dark')])
    expect(out).toMatch(/already Graphite/)
    expect(m.server.posts).toEqual([])
  })
  it('a UCT catalog theme is stored under its uct value, the one Layout paints', async () => {
    const m = await withRealPrefs()
    await m.say('use the slate theme', (c) => [THEME(c, 'slate')])
    await waitFor(() => expect(m.server.theme).toBe(uctThemeValue('slate')))
    expect(m.live.current.prefs.theme).toBe(uctThemeValue('slate'))
    expect(m.lastReceipt().textContent).toMatch(/Slate/)
  })
  it('a server that refuses it: nothing is claimed, and the member is told the tab may keep showing it (the hook keeps a failed value on purpose)', async () => {
    const m = await withRealPrefs({ refuse: (b) => JSON.stringify(b).includes('light') })
    await m.say('switch to light mode', (c) => [THEME(c, 'light')])
    await waitFor(() => expect(m.server.posts.length).toBeGreaterThan(0))
    await m.p.idle()
    await waitFor(() => expect(m.p.transcript()).toMatch(/not saved \(this tab may keep showing it until you reload\)/))
    expect(m.server.theme).toBe('dark')
    expect(m.live.current.prefs.theme).toBe('light')              // usePreferences setPref: "the optimistic value deliberately survives a failed write"
    expect(m.p.summaries().join(' ')).not.toMatch(/→ Light/)
  })
  it('a theme name UCT does not have is refused', async () => {
    const m = await withRealPrefs()
    await m.say('use the sparkly theme', (c) => [THEME(c, 'sparkly')])
    await waitFor(() => expect(m.p.transcript()).toMatch(/didn.t change anything|isn't one of UCT's app themes/))
    expect(m.server.posts).toEqual([])
    expect(m.live.current.prefs.theme).toBe('dark')
  })
})
