// RAILS: the declared-givens registry (givens.mjs) and its merge into the rule-built given (given.mjs). Node-side only: what a
// case declares becomes the board, the routes and the member's act the browser runner builds. LOCAL.
import { describe, it, expect } from 'vitest'
import { GIVENS, applyGivens, declaredGivens } from './givens.mjs'
import { givenFor, boardFor, fixturesFor } from './given.mjs'

import CASE_GIVENS from './caseGivens.json' with { type: 'json' }

describe('declared givens', () => {
  it('a case declares givens on itself and, by id, in caseGivens.json: both, once each, in order', () => {
    expect(declaredGivens({ id: 'X', given: ['aiAnswer'] }, { X: ['noteOpen', 'aiAnswer'] })).toEqual(['aiAnswer', 'noteOpen'])
    expect(declaredGivens({ id: 'Y' }, {})).toEqual([])
  })
  it('an unknown given is an error, never a silent plain board', () => {
    expect(() => applyGivens({}, ['noSuchGiven'])).toThrow(/unknown given "noSuchGiven"/)
  })
  it('every name caseGivens.json uses is in the registry', () => {
    for (const [id, names] of Object.entries(CASE_GIVENS)) if (!id.startsWith('_')) for (const n of names) expect(GIVENS[n], `${id}: ${n}`).toBeTruthy()
  })
  it('two givens that each set a board cannot be combined', () => {
    expect(() => applyGivens({}, ['aiAnswer', 'noteOpen'])).toThrow(/sets a board/)
  })
  it('aiAnswer: the board holds an AI Search widget, its own routes answer it, and the member asks (a prelude)', () => {
    const g = givenFor({ id: 'C3-198', say: 'show me how to save that answer', feature: 'control', title: 'Saving an answer' })
    expect(g.declared).toEqual(['aiAnswer'])
    expect(JSON.parse(boardFor(g).charts_workspace_layout).widgets.map(w => w.type)).toContain('aisearch')
    const routes = fixturesFor(g).routes.map(r => r.match)
    expect(routes.slice(0, 2)).toEqual(['^POST /api/ai-search/stream', '^POST /api/ai-search$'])
    expect(typeof GIVENS.aiAnswer.prelude).toBe('function')
  })
  it('noteOpen: the Notebook widget opens the note by its own opts.noteId, served on the Journal routes', () => {
    const g = givenFor({ id: 'HG-05', say: 'how do I rename my note', given: ['noteOpen'] })
    const nb = JSON.parse(boardFor(g).charts_workspace_layout).widgets.find(w => w.type === 'notebook')
    expect(nb.opts.noteId).toBe('n-teach')
    expect(fixturesFor(g).routes.some(r => new RegExp(r.match).test('GET /api/j2/notes/n-teach'))).toBe(true)
  })
  it('a case with no declared given is built exactly as before (rules only)', () => {
    const c = { id: 'C1-009', say: 'how do I delete custom interval', feature: 'panelAction', title: 'Deleting a custom timeframe' }
    const g = givenFor(c)
    expect(g.declared).toBeUndefined()
    expect(g.widgets).toBeUndefined()
    expect(g.chartSettings).toEqual({ header: { customTimeframes: ['45'] } })
  })
})
