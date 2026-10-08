import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createEmptyNamedLayout } from './dockCreate'

// ⛔ GATE B (2026-10-08 audit): the Dock's "＋ New layout" saved WITHOUT create-only, and the
// server upserts by name — typing an existing layout's name replaced it with an empty board.
describe('Layout Dock ＋ New layout — create-only, never a replace', () => {
  it('saves an EMPTY layout create-only', async () => {
    const saveLayout = vi.fn(async (b) => ({ id: 9, name: b.name, scope: 'user' }))
    const r = await createEmptyNamedLayout('  Research ', { saveLayout, cols: 24 })
    expect(r).toEqual({ ok: true, saved: { id: 9, name: 'Research', scope: 'user' } })
    expect(saveLayout).toHaveBeenCalledWith({ name: 'Research', layout: { widgets: [], cols: 24 }, groups: null, scope: 'user', createOnly: true })
  })
  it('an existing name is REFUSED (the server\'s 409) with a sentence — nothing replaced', async () => {
    const saveLayout = vi.fn(async () => { throw new Error('You already have a layout with that name') })
    const r = await createEmptyNamedLayout('Main Trading', { saveLayout, cols: 24 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/already have a layout named “Main Trading” — nothing was replaced/)
  })
  it('a blank name never calls the server', async () => {
    const saveLayout = vi.fn()
    expect((await createEmptyNamedLayout('  ', { saveLayout, cols: 24 })).ok).toBe(false)
    expect(saveLayout).not.toHaveBeenCalled()
  })
  it('the workspace blanks the board only AFTER the create succeeds, opening it in the same commit (source rail)', () => {
    const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'ChartsWorkspace.jsx'), 'utf8')
    const body = src.slice(src.indexOf('const handleDockCreate'), src.indexOf('const handleDockCreate') + 700)
    expect(body.indexOf('createEmptyNamedLayout(')).toBeGreaterThan(-1)
    expect(body.indexOf('createEmptyNamedLayout(')).toBeLessThan(body.indexOf('handleNewLayout('))
    expect(body).toContain('handleNewLayout({ activeTemplate:')
    expect(body).not.toMatch(/saveLayout\(\{[^}]*scope: 'user' \}\)/)   // no upsert save left behind
  })
})
