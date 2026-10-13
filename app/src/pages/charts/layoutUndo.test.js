// app/src/pages/charts/layoutUndo.test.js — A1.3b (owner Q7): layout-apply Undo, Agent parity
import { describe, it, expect } from 'vitest'
import { planLayoutUndo, layoutUndoDecision, LAYOUT_UNDO_SENTENCES } from './layoutUndo'

const entries = [{ id: 1, name: 'Swing' }, { id: 2, name: 'Day' }, { id: 'uct-default', name: 'UCT Default' }]
const snap = (over = {}) => ({ entries, active: { id: 1, name: 'Swing' }, unsaved: false, ...over })

describe('A1.3b — layout-apply Undo', () => {
  it('reopens the previous saved layout when nothing was discarded', () => {
    const plan = planLayoutUndo(snap(), { id: 2, name: 'Day' })
    expect(layoutUndoDecision(plan, snap({ active: { id: 2, name: 'Day' } }))).toEqual({ ok: true, open: { id: 1, name: 'Swing' } })
  })
  it('⛔ REFUSES when the switch discarded unsaved board state — and never claims it was recovered', () => {
    const plan = planLayoutUndo(snap({ unsaved: true }), { id: 2, name: 'Day' })
    const d = layoutUndoDecision(plan, snap({ active: { id: 2, name: 'Day' } }))
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('discarded')
    expect(d.sentence).toBe(LAYOUT_UNDO_SENTENCES.discarded)
    expect(d.sentence).not.toMatch(/recover|restored your|saved your/i)
  })
  it('refuses with no previous layout (a blank or unknown board)', () => {
    const plan = planLayoutUndo(snap({ active: null }), { id: 2, name: 'Day' })
    expect(layoutUndoDecision(plan, snap({ active: { id: 2, name: 'Day' } })).reason).toBe('no-previous')
  })
  it('stale: another layout opened since, the list changed, or the previous layout is gone', () => {
    const plan = planLayoutUndo(snap(), { id: 2, name: 'Day' })
    expect(layoutUndoDecision(plan, snap({ active: { id: 'uct-default', name: 'UCT Default' } })).reason).toBe('changed')
    expect(layoutUndoDecision(plan, snap({ active: { id: 2, name: 'Day' }, entries: [...entries, { id: 3, name: 'New' }] })).reason).toBe('changed')
    expect(layoutUndoDecision(plan, { ...snap({ active: { id: 2, name: 'Day' } }), entries: entries.map((e) => (e.id === 1 ? { ...e, name: 'Renamed' } : e)) }).reason).toBe('changed')
  })
  it('refuses when switching back would discard edits made to THIS board since', () => {
    const plan = planLayoutUndo(snap(), { id: 2, name: 'Day' })
    expect(layoutUndoDecision(plan, snap({ active: { id: 2, name: 'Day' }, unsaved: true })).reason).toBe('unsaved-now')
  })
})
