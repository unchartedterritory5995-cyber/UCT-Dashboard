import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isDailyShortcut, openDailyNote } from './dailyNote'

/** Wave 6 (lane E, item 4) — the daily note's request and its shortcut. */
const key = (over = {}) => ({
  code: 'KeyD', key: 'd', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
  getModifierState: () => false, ...over,
})

describe('isDailyShortcut', () => {
  it('is Ctrl+Alt+D, and Cmd+Option+D (where Option makes the key "∂")', () => {
    expect(isDailyShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isDailyShortcut(key({ metaKey: true, key: '∂' }))).toBe(true)
  })

  it('is never AltGr (a character a member meant to type), nor another combination', () => {
    expect(isDailyShortcut(key({ ctrlKey: true, getModifierState: (m) => m === 'AltGraph' }))).toBe(false)
    expect(isDailyShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isDailyShortcut(key({ ctrlKey: true, altKey: false }))).toBe(false)
    expect(isDailyShortcut(key({ altKey: true }))).toBe(false)
    expect(isDailyShortcut(key({ ctrlKey: true, code: 'KeyE' }))).toBe(false)
    expect(isDailyShortcut(null)).toBe(false)
  })
})

describe('openDailyNote', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ note: { id: 'd1' }, created: true }) }))
  })

  it('sends the member’s ET day and their daily template', async () => {
    const got = await openDailyNote({ templateId: 't1', today: () => '2026-09-24' })
    expect(got).toEqual({ note: { id: 'd1' }, created: true })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/j2/notes/daily')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ date: '2026-09-24', templateId: 't1' })
  })

  it('sends no template when there is none, and throws on a refusal', async () => {
    await openDailyNote({ today: () => '2026-09-24' })
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ date: '2026-09-24' })
    global.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }))
    await expect(openDailyNote({ today: () => 'x' })).rejects.toMatchObject({ status: 400 })
  })
})
