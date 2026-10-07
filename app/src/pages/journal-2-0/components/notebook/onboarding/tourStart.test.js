// @vitest-environment node
// W14-C1 items (b) and (d): where a tour starts, and whether the member is already there.
// Pure functions over a router location and an injected fetch; no DOM, no React.
import { describe, it, expect, vi } from 'vitest'
import {
  SAMPLE_IMPORT_PREFIX, SCREEN_PARAMS, UNREACHABLE_COPY, atStart, notePath, openNoteId, resolveStart, tradePath,
} from './tourStart'
import { NOTEBOOK_ROOT, OTHER_TOURS, startKind } from './tourRegistry'

const loc = (pathname, search = '') => ({ pathname, search })

// ── (d) start detection ──────────────────────────────────────────────────────────────────
describe('(d) atStart compares the real location, not just the pathname', () => {
  it('a member on an OPEN NOTE is not "at" Notebook Home (the W14-B3 finding)', () => {
    expect(atStart(NOTEBOOK_ROOT, loc(NOTEBOOK_ROOT, '?note=abc'))).toBe(false)
  })

  it('nor on another notebook view, the side pane, a resurfaced version or a new note', () => {
    for (const q of ['?view=all', '?view=tasks', '?side=n2', '?resurfaceVersion=v1', '?new=1']) {
      expect(atStart(NOTEBOOK_ROOT, loc(NOTEBOOK_ROOT, q)), q).toBe(false)
    }
  })

  it('a filter on the same screen is still the start (folder, ticker, anything unnamed)', () => {
    expect(atStart(NOTEBOOK_ROOT, loc(NOTEBOOK_ROOT, '?folder=f1'))).toBe(true)
    expect(atStart(NOTEBOOK_ROOT, loc(NOTEBOOK_ROOT, '?anything=1'))).toBe(true)
    expect(atStart('/journal/notebook?view=all', loc(NOTEBOOK_ROOT, '?view=all&folder=f1'))).toBe(true)
  })

  it('a start that NAMES a screen parameter matches it exactly', () => {
    expect(atStart('/journal/notebook?view=tasks', loc(NOTEBOOK_ROOT, '?view=tasks'))).toBe(true)
    expect(atStart('/journal/notebook?view=tasks', loc(NOTEBOOK_ROOT, '?view=all'))).toBe(false)
    expect(atStart('/journal/notebook?view=all', loc(NOTEBOOK_ROOT))).toBe(false)
  })

  it('pathname still decides first; no start means anywhere', () => {
    expect(atStart('/journal-2-0/playbook', loc('/journal-2-0/playbook'))).toBe(true)
    expect(atStart('/journal/notebook/x', loc(NOTEBOOK_ROOT))).toBe(false)
    expect(atStart(undefined, loc('/anywhere'))).toBe(true)
  })

  it('the screen parameters are the ones the Notebook reads to pick a screen', () => {
    expect([...SCREEN_PARAMS].sort()).toEqual(['new', 'note', 'resurfaceVersion', 'side', 'view'])
  })
})

// ── (b) in-note and on-trade starts ─────────────────────────────────────────────────────────
/** A fetch that answers the three read endpoints from `db`; anything else is a 404. */
function fakeFetch(db) {
  return vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (url === '/api/j2/notes/import/check' && method === 'POST') {
      const keys = JSON.parse(init.body).importKeys
      const existing = {}
      for (const k of keys) if (db.samples?.[k]) existing[k] = { id: db.samples[k] }
      return ok({ existing })
    }
    if (url.startsWith('/api/j2/notes?') && method === 'GET') {
      const q = new URLSearchParams(url.split('?')[1])
      const list = (db.notes || []).filter((n) => !q.get('embed_widget') || n.embeds?.includes(q.get('embed_widget')))
      return ok({ notes: list.slice(0, Number(q.get('limit') || 100)) })
    }
    if (url.startsWith('/api/j2/trades?') && method === 'GET') return ok({ trades: db.trades || [] })
    if (db.fail) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const writes = (f) => f.mock.calls.filter(([u, i = {}]) => (i.method || 'GET').toUpperCase() !== 'GET'
  && u !== '/api/j2/notes/import/check')

describe('(b) a note start opens a SUITABLE note, never creates one', () => {
  const sample = { start: { note: 'sample:plan', embed: 'chart' } }

  it('prefers the W14-E example note for that capability', async () => {
    const f = fakeFetch({ samples: { [`${SAMPLE_IMPORT_PREFIX}plan`]: 'n-sample' }, notes: [{ id: 'n-recent', embeds: ['chart'] }] })
    expect(await resolveStart(sample, loc(NOTEBOOK_ROOT), { fetchImpl: f })).toEqual({ path: notePath('n-sample') })
    expect(writes(f)).toEqual([])
  })

  it('without the example, the member\'s most recent note holding that widget', async () => {
    const f = fakeFetch({ notes: [{ id: 'n-plain', embeds: [] }, { id: 'n-chart', embeds: ['chart'] }] })
    expect(await resolveStart(sample, loc(NOTEBOOK_ROOT), { fetchImpl: f })).toEqual({ path: notePath('n-chart') })
    const listCall = f.mock.calls.find(([u]) => u.startsWith('/api/j2/notes?'))[0]
    expect(listCall).toContain('embed_widget=chart')
    expect(listCall).toContain('sort=updated')
  })

  it('with no note at all, it says so: `none: note`, and the card has a way out', async () => {
    const f = fakeFetch({ notes: [] })
    expect(await resolveStart(sample, loc(NOTEBOOK_ROOT), { fetchImpl: f })).toEqual({ none: 'note' })
    expect(UNREACHABLE_COPY.note.exitPath).toBe(NOTEBOOK_ROOT)
    expect(UNREACHABLE_COPY.note.body).not.toMatch(/[—–!]/)
  })

  it('`recent`: any open note already is the right screen (no fetch)', async () => {
    const f = fakeFetch({ notes: [{ id: 'other' }] })
    expect(await resolveStart({ start: { note: 'recent' } }, loc(NOTEBOOK_ROOT, '?note=mine'), { fetchImpl: f })).toEqual({ stay: true })
    expect(f).not.toHaveBeenCalled()
  })

  it('`recent` from elsewhere: the most recent note', async () => {
    const f = fakeFetch({ notes: [{ id: 'n1' }] })
    expect(await resolveStart({ start: { note: 'recent' } }, loc('/journal'), { fetchImpl: f })).toEqual({ path: notePath('n1') })
  })

  it('already on the resolved note: stay', async () => {
    const f = fakeFetch({ samples: { [`${SAMPLE_IMPORT_PREFIX}plan`]: 'n-sample' } })
    expect(await resolveStart(sample, loc(NOTEBOOK_ROOT, '?note=n-sample'), { fetchImpl: f })).toEqual({ stay: true })
  })

  it('a failed lookup is reported, never guessed: `none: error`', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    expect(await resolveStart(sample, loc(NOTEBOOK_ROOT), { fetchImpl: f })).toEqual({ none: 'error' })
    const thrower = vi.fn(async () => { throw new Error('offline') })
    expect(await resolveStart(sample, loc(NOTEBOOK_ROOT), { fetchImpl: thrower })).toEqual({ none: 'error' })
  })
})

describe('(b) a trade start opens the member\'s most recent trade page', () => {
  it('found', async () => {
    const f = fakeFetch({ trades: [{ id: 42 }, { id: 41 }] })
    expect(await resolveStart({ start: { trade: 'recent' } }, loc('/journal'), { fetchImpl: f })).toEqual({ path: tradePath('42') })
    expect(tradePath('42')).toBe('/journal-2-0/trade/42')
  })
  it('none', async () => {
    const f = fakeFetch({ trades: [] })
    expect(await resolveStart({ start: { trade: 'recent' } }, loc('/journal'), { fetchImpl: f })).toEqual({ none: 'trade' })
  })
})

describe('(a) a path start navigates only when the member is not already there', () => {
  it('path', async () => {
    const e = { start: '/journal-2-0/playbook' }
    expect(await resolveStart(e, loc('/journal'))).toEqual({ path: '/journal-2-0/playbook' })
    expect(await resolveStart(e, loc('/journal-2-0/playbook'))).toEqual({ stay: true })
    expect(await resolveStart({}, loc('/x'))).toEqual({ stay: true })
  })
  it('openNoteId reads the note on the Notebook only', () => {
    expect(openNoteId(loc(NOTEBOOK_ROOT, '?note=a'))).toBe('a')
    expect(openNoteId(loc('/journal', '?note=a'))).toBeNull()
  })
})

describe('the real registry: every replayable tour has a start the engine can act on', () => {
  it('every start kind is resolvable by resolveStart (no unknown kind slips through)', async () => {
    const f = fakeFetch({ samples: { [`${SAMPLE_IMPORT_PREFIX}plan`]: 's1', [`${SAMPLE_IMPORT_PREFIX}transcript`]: 's2' }, notes: [{ id: 'n', embeds: ['chart'] }], trades: [{ id: 1 }] })
    for (const t of OTHER_TOURS) {
      const r = await resolveStart(t, loc('/dashboard'), { fetchImpl: f })
      if (!startKind(t)) expect(r, t.id).toEqual({ stay: true })
      else expect(r.path, `${t.id} -> ${JSON.stringify(r)}`).toBeTruthy()
    }
  })
})
