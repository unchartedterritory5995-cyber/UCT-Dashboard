/**
 * ⭐⭐ D3b fix round 2 (review NN-2) — WHAT `ownerReconcilePlan` CALLS "LANDED".
 *
 * LANDED answers "is anything at risk?", not "who wrote it": the server already
 * holds EXACTLY the authored content (title, subtitle, body) the 409'd send
 * carried, so nothing of the member's is missing and nothing of anyone else's
 * would be overwritten (`wave6-D3b-review.md`, re-review, focus (a)).
 *
 * The two edges of that sentence, pinned here because both were "right by
 * construction" and no cell said so:
 *   · a METADATA-only difference (folder, tags, hero, favourite, ticker, the
 *     revision) IS landed — the editor never sends metadata, so the server's
 *     stands;
 *   · a TITLE-only or SUBTITLE-only difference is NOT — those are words a person
 *     wrote; the classifier decides, and a title that moved forks.
 * The real-editor half of both is in `f5p1OwnerSendsQueued.test.jsx` (fix round 2).
 */
import { describe, it, expect } from 'vitest'
import { ownerReconcilePlan, LANDED, RETRY, FORK } from './ownerReconcile'
import { APPEND_ONLY, BODY_REWRITE, METADATA_ONLY } from './serverChange'

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const T0 = '2026-09-23T09:00:00.000000+00:00'
const T1 = '2026-09-23T09:05:00.000000+00:00'
const WIDGET = { type: 'widgetEmbed', attrs: { widgetId: 'w-1', capturedAt: '2026-09-23T09:04:00Z', searchText: 'NVDA' } }

const ONLINE = para('typed online.')
const MINE = doc(ONLINE, para('typed offline while away.'))
// What the words were written on, and EXACTLY what the 409'd send carried.
const BASE = { title: 'Thesis', subtitle: 'why', bodyJson: doc(ONLINE), updatedAt: T0 }
const SENT = { title: 'Thesis', subtitle: 'why', bodyJson: MINE }
// The server's copy as the note read returns it: authored content AND metadata.
const serverCopy = (over = {}) => ({
  id: 'n1', title: 'Thesis', subtitle: 'why', bodyJson: MINE, updatedAt: T1,
  folderId: null, ticker: null, tags: [], heroImageUrl: null, isFavorite: false,
  ...over,
})

describe('ownerReconcilePlan — LANDED is exactly the authored content: nothing looser, nothing tighter', () => {
  it('⭐ CONTROL: identical authored content ⇒ LANDED', () => {
    expect(ownerReconcilePlan({ fresh: serverCopy(), base: BASE, sent: SENT })).toEqual({ plan: LANDED, shape: null })
  })

  it('⭐⭐ a METADATA-only difference is LANDED — a door moved folder, tags, hero, favourite and ticker; the editor sends none of them, so the server’s stand', () => {
    const fresh = serverCopy({
      folderId: 'folder-moved-by-a-door', tags: ['moved-by-a-door'], heroImageUrl: 'https://example.test/hero.png',
      isFavorite: true, ticker: 'NVDA', updatedAt: '2026-09-23T09:09:00.000000+00:00',
    })
    expect(ownerReconcilePlan({ fresh, base: BASE, sent: SENT }), 'metadata the editor never sends turned a landing into a conflict')
      .toEqual({ plan: LANDED, shape: null })
  })

  it('⭐ an absent and an empty field are the same content (null and \'\' normalise to \'\') ⇒ LANDED', () => {
    expect(ownerReconcilePlan({ fresh: serverCopy({ subtitle: null }), base: BASE, sent: { ...SENT, subtitle: '' } }).plan)
      .toBe(LANDED)
  })

  it('⛔⛔ a TITLE-only difference is NOT landed — another device renamed it: the classifier decides, and a moved title FORKS', () => {
    const plan = ownerReconcilePlan({ fresh: serverCopy({ title: 'Renamed on another device' }), base: BASE, sent: SENT })
    expect(plan.plan, 'a rename by someone else was taken for our own landing').not.toBe(LANDED)
    expect(plan).toEqual({ plan: FORK, shape: BODY_REWRITE })
  })

  it('⛔⛔ a SUBTITLE-only difference is NOT landed either ⇒ FORK', () => {
    const plan = ownerReconcilePlan({ fresh: serverCopy({ subtitle: 'rewritten elsewhere' }), base: BASE, sent: SENT })
    expect(plan.plan).not.toBe(LANDED)
    expect(plan).toEqual({ plan: FORK, shape: BODY_REWRITE })
  })

  it('⛔ a title CLEARED elsewhere is a difference too (empty is content, not the absence of it) ⇒ FORK', () => {
    expect(ownerReconcilePlan({ fresh: serverCopy({ title: '' }), base: BASE, sent: SENT }))
      .toEqual({ plan: FORK, shape: BODY_REWRITE })
  })

  it('⭐ CONTROL: not landed, a door only MOVED it (the server still holds the base’s words) ⇒ the classifier’s RETRY, as before', () => {
    const fresh = serverCopy({ bodyJson: doc(ONLINE), folderId: 'folder-moved-by-a-door' })
    expect(ownerReconcilePlan({ fresh, base: BASE, sent: SENT })).toEqual({ plan: RETRY, shape: METADATA_ONLY })
  })

  it('⭐ CONTROL: not landed, a door APPENDED a widget ⇒ RETRY (the merge), as before', () => {
    const fresh = serverCopy({ bodyJson: doc(ONLINE, WIDGET) })
    expect(ownerReconcilePlan({ fresh, base: BASE, sent: SENT })).toEqual({ plan: RETRY, shape: APPEND_ONLY })
  })

  it('⛔ no server copy, or no record of what was sent ⇒ never LANDED (missing evidence is never a licence)', () => {
    expect(ownerReconcilePlan({ fresh: null, base: BASE, sent: SENT })).toEqual({ plan: FORK, shape: BODY_REWRITE })
    expect(ownerReconcilePlan({ fresh: serverCopy(), base: BASE, sent: null })).toEqual({ plan: FORK, shape: BODY_REWRITE })
  })

  it('⛔ NN-3, accepted: the server holding a PREFIX of what was sent is NOT landed ⇒ FORK — a duplicate, never a loss', () => {
    // A frozen tab's queued words were swept while it slept (N-3 lets go of the
    // lock); on resume the member typed more, and the send carries swept + new on
    // the editor's old base. A prefix is ALSO what another device's deletion of the
    // note's tail leaves, and content alone cannot tell the two apart, so "extend
    // a prefix" would send the member's body over that deletion. The fork keeps
    // both (`f5-fixes-2026-09-23.md` §G.6).
    const sent = { ...SENT, bodyJson: doc(ONLINE, para('typed offline while away.'), para('typed after the tab resumed.')) }
    expect(ownerReconcilePlan({ fresh: serverCopy({ bodyJson: MINE }), base: BASE, sent }))
      .toEqual({ plan: FORK, shape: BODY_REWRITE })
  })
})
