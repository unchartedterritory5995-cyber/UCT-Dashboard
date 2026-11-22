import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isDailyShortcut, openDailyNote, queueNotebookNotice, takeQueuedNotebookNotice, NOTICE_MAX_AGE_MS } from './dailyNote'

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

// Fix round 2 (re-review N3): the queued notice had no expiry and no target -- a navigation that
// never reached the Notebook left it to surface an hour later on an unrelated visit.
describe('the queued Notebook notice is fresh and for the right note', () => {
  beforeEach(() => sessionStorage.clear())

  it('said for the note it names, once', () => {
    queueNotebookNotice('Saved in your Daily folder.', { noteId: 'n1', now: 1000 })
    expect(takeQueuedNotebookNotice({ noteId: 'n1', now: 1500 })).toBe('Saved in your Daily folder.')
    expect(takeQueuedNotebookNotice({ noteId: 'n1', now: 1600 })).toBeNull()
  })

  it('dropped when another note (or no note) is what opened', () => {
    queueNotebookNotice('Saved in your Daily folder.', { noteId: 'n1', now: 1000 })
    expect(takeQueuedNotebookNotice({ noteId: 'n2', now: 1500 })).toBeNull()
    expect(takeQueuedNotebookNotice({ noteId: 'n1', now: 1600 })).toBeNull()   // gone, not kept for later
    queueNotebookNotice('Saved in your Daily folder.', { noteId: 'n1', now: 1000 })
    expect(takeQueuedNotebookNotice({ noteId: null, now: 1500 })).toBeNull()
  })

  it('dropped when it is stale', () => {
    queueNotebookNotice('Saved in your Daily folder.', { noteId: 'n1', now: 1000 })
    expect(takeQueuedNotebookNotice({ noteId: 'n1', now: 1000 + NOTICE_MAX_AGE_MS + 1 })).toBeNull()
    expect(NOTICE_MAX_AGE_MS).toBeLessThanOrEqual(30_000)
  })
})

// Follow-up A (fix round 1, I3): a door named by its caller counts once as today_door_used, after the server answered.
describe('openDailyNote: today_door_used', () => {
  const telemetry = (spy) => spy.mock.calls.filter(([u]) => u === '/api/j2/telemetry').map(([, i]) => JSON.parse(i.body))

  it("the Journal Today page's door sends one {journal_panel, created} and nothing about the note", async () => {
    const spy = vi.fn(async (url) => (url === '/api/j2/notes/daily'
      ? { ok: true, json: async () => ({ note: { id: 'n7', title: 'NVDA day' }, created: true }) }
      : { ok: true }))
    vi.stubGlobal('fetch', spy)
    await openDailyNote({ door: 'journal_panel' })
    expect(telemetry(spy)).toEqual([{ event: 'today_door_used', props: { door: 'journal_panel', created: true } }])
    expect(JSON.stringify(telemetry(spy))).not.toContain('NVDA')
    vi.unstubAllGlobals()
  })

  it('CONTROL: a caller with no door (the first run) sends nothing, and a failed request sends nothing', async () => {
    const spy = vi.fn(async (url) => (url === '/api/j2/notes/daily'
      ? { ok: true, json: async () => ({ note: { id: 'n7' }, created: false }) } : { ok: true }))
    vi.stubGlobal('fetch', spy)
    await openDailyNote({})
    spy.mockImplementation(async () => ({ ok: false, status: 500 }))
    await openDailyNote({ door: 'shortcut' }).catch(() => {})
    expect(telemetry(spy)).toEqual([])
    vi.unstubAllGlobals()
  })
})
