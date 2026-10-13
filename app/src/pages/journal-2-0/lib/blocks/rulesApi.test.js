// The rule edit door (Notebook P2b, Task 8; spec §P2 item 2). It writes RULES, never a note.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DISMISSED_SENTENCE, UNAVAILABLE_SENTENCE, editRule, versionLine } from './rulesApi'

const realFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = vi.fn() })
afterEach(() => { globalThis.fetch = realFetch })

describe('rulesApi', () => {
  it('versionLine reads the version and the ET day it changed', () => {
    expect(versionLine({ version: 3, changedAt: '2026-10-02T15:00:00+00:00' })).toBe('v3 · changed Oct 2')
    expect(versionLine({ version: 1, changedAt: '2026-01-02T00:00:00+00:00' })).toBe('v1 · made Jan 1')
  })
  it('versionLine: a CONTROL that the ET day is not the UTC day (a UTC reading would say Jan 2)', () => {
    const utc = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    expect(utc.format(new Date('2026-01-02T00:00:00+00:00'))).toBe('Jan 2')
    expect(versionLine({ version: 1, changedAt: '2026-01-02T00:00:00+00:00' })).not.toContain('Jan 2')
  })
  it('versionLine: no day on hand says the version alone, never "Invalid Date"', () => {
    expect(versionLine({ version: 2 })).toBe('v2')
    expect(versionLine({ version: 2, changedAt: 'not a date' })).toBe('v2')
    expect(versionLine({})).toBe('v1')
  })
  it('editRule PUTs to the rule route and reports the server sentence on 400', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ detail: 'A rule needs words.' }) }))
    expect(await editRule('r1', { label: '' })).toEqual({ ok: false, error: 'A rule needs words.' })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/rules/r1', expect.objectContaining({ method: 'PUT' }))
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ label: '' })
  })
  it('editRule: a 404 the server marks rule_dismissed is a dismissed rule, said in words (R-M1-1, R-T8-1)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ detail: 'rule_dismissed' }) }))
    const got = await editRule('r1', { beforeEntry: true })
    expect(got).toEqual({ ok: false, error: DISMISSED_SENTENCE, gone: true })
    expect(DISMISSED_SENTENCE).toBe("This rule was dismissed, so it can't be edited.")
    expect(got.error).not.toMatch(/404|rule_dismissed/)
  })
  it('editRule (m2): any other 404 (another member\'s rule, a missing one, the switch off) is never called dismissed', async () => {
    for (const body of [{ detail: 'Not found' }, {}]) {
      globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => body }))
      const got = await editRule('r1', { beforeEntry: true })
      expect(got).toEqual({ ok: false, error: UNAVAILABLE_SENTENCE, gone: true })
    }
    expect(UNAVAILABLE_SENTENCE).toBe("This rule isn't available to edit.")
  })
  it('editRule: success hands back the saved rule', async () => {
    const saved = { id: 'r 1', label: 'Wait', version: 2 }
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => saved }))
    expect(await editRule('r 1', { label: 'Wait' })).toEqual({ ok: true, rule: saved })
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/j2/trader-blocks/rules/r%201')
  })
  it('editRule: another failure and no answer at all each have a sentence of their own', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('html') } }))
    expect(await editRule('r1', { label: 'x' })).toEqual({ ok: false, error: 'The rule could not be saved. Nothing changed.' })
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await editRule('r1', { label: 'x' })).toEqual({ ok: false, error: 'You are offline. The rule was not saved.' })
  })
})
