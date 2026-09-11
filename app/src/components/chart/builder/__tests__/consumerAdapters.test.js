import { describe, it, expect, vi } from 'vitest'
import {
  authoredResult, validateFor, saveAsCondition, saveAsInfoField, saveAsIndicator,
  CONSUMER_KINDS,
} from '../consumerAdapters'
import { parseFormula } from '../../engine/ast/parse'
import { conditionsOf } from '../../engine/conditionControls'
import { infoFieldsOf } from '../../engine/infoFieldControls'

const evalOf = (src) => {
  const parsed = parseFormula(src)
  return { ok: parsed.ok, ast: parsed.ast, source: src, readback: 'read back', verdict: { mode: 'none' } }
}
const authored = (src, bindings) => authoredResult(evalOf(src), bindings)

const BASE = { conditions: [], header: { fields: ['mcap'], infoFormulas: [] } }

describe('the authored result — what every door converges on', () => {
  it('⭐ carries no idea where it will be stored', () => {
    const a = authored('close > open')
    expect(Object.keys(a).sort()).toEqual(
      ['ast', 'bindings', 'readback', 'repaintMode', 'resultType', 'source'].sort())
  })

  it('⭐ resultType is DERIVED, and it is the same question the consumers gate on', () => {
    expect(authored('close > open').resultType).toBe('boolean')
    expect(authored('sma((high - low) / close, 21) * 100').resultType).toBe('numeric')
  })

  it('⛔ an evaluation that did not read back produces nothing to save', () => {
    expect(authoredResult({ ok: false, ast: null })).toBe(null)
    expect(authoredResult(null)).toBe(null)
  })
})

describe('typed intent — one question, three answers', () => {
  it('⛔ a CONDITION refuses a numeric tree, and names the useful next move', () => {
    const v = validateFor('condition', authored('sma(close, 20)'))
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/true or false/)
    expect(v.offer).toBe('infoValue')
  })

  it('⛔ an INFO VALUE refuses a boolean tree, and names the other one', () => {
    const v = validateFor('infoValue', authored('close > ema(close, 20)'))
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/shows a number/)
    expect(v.offer).toBe('condition')
  })

  it('⭐ an INDICATOR takes either — a 0/1 flag is a legitimate plot', () => {
    expect(validateFor('indicator', authored('close > open')).ok).toBe(true)
    expect(validateFor('indicator', authored('sma(close, 20)')).ok).toBe(true)
  })

  it('⛔⛔ the CHART consumers also refuse a screener-only column', () => {
    expect(validateFor('condition', authored('adr_pct > 5')).reason).toMatch(/adr_pct/)
    expect(validateFor('infoValue', authored('adr_pct')).reason).toMatch(/adr_pct/)
  })

  it('⛔ …and the INDICATOR lane does NOT, because it also feeds the screener', () => {
    // `ScreensManager` mounts this same sheet. Refusing a screener column in the
    // definition lane would break the lane those columns exist for.
    expect(validateFor('indicator', authored('rs_rank >= 80')).ok).toBe(true)
  })

  it('⭐ every consumer kind is covered by the same function', () => {
    for (const kind of CONSUMER_KINDS) {
      expect(typeof validateFor(kind, authored('close > open')).ok).toBe('boolean')
    }
  })
})

describe('the adapters — each through the door that already exists', () => {
  it('⭐ saveAsCondition adds one, carrying formula and bindings', () => {
    const next = saveAsCondition(BASE, authored('a > 50', { a: '@legacy:rsi::rsi' }), { name: 'Trend' })
    const list = conditionsOf(next)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Trend')
    expect(list[0].formula).toBe('a > 50')
    expect(list[0].bindings).toEqual({ a: '@legacy:rsi::rsi' })
  })

  it('⛔ a refused type returns the SAME settings object — the whole of a caller’s error handling', () => {
    const next = saveAsCondition(BASE, authored('sma(close, 20)'), { name: 'Nope' })
    expect(next).toBe(BASE)
  })

  it('⛔ an EDIT keeps the condition id — the visual actions are keyed on it', () => {
    const added = saveAsCondition(BASE, authored('close > open'), { name: 'One' })
    const id = conditionsOf(added)[0].id
    const edited = saveAsCondition(added, authored('high < high[1] && low > low[1]'), { name: 'Two', editId: id })
    const list = conditionsOf(edited)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].name).toBe('Two')
    expect(list[0].formula).toBe('high < high[1] && low > low[1]')
  })

  it('⭐ saveAsInfoField adds one AND puts it in the row', () => {
    const next = saveAsInfoField(BASE, authored('sma((high - low) / close, 21) * 100'), {
      label: 'ADR', format: 'number', decimals: 2, suffix: '%',
    })
    const fields = infoFieldsOf(next)
    expect(fields).toHaveLength(1)
    expect(fields[0].label).toBe('ADR')
    expect(fields[0].suffix).toBe('%')
    expect(next.header.fields).toContain(fields[0].id)
  })

  it('⛔ saveAsInfoField refuses a boolean, and writes nothing', () => {
    expect(saveAsInfoField(BASE, authored('close > open'), { label: 'X' })).toBe(BASE)
  })

  it('⛔ an EDIT keeps the info-field id', () => {
    const added = saveAsInfoField(BASE, authored('close'), { label: 'Px' })
    const id = infoFieldsOf(added)[0].id
    const edited = saveAsInfoField(added, authored('sma(close, 20)'), { label: 'MA20', editId: id })
    const list = infoFieldsOf(edited)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].formula).toBe('sma(close, 20)')
  })
})

describe('saveAsIndicator — the one consumer whose store is a SERVER document', () => {
  const store = (over = {}) => ({
    buildDocument: vi.fn((a) => ({ id: 'u_1', source: a.source })),
    validate: vi.fn((docs) => ({ defs: docs, errors: [] })),
    save: vi.fn(async () => ({ ok: true, row: { id: 'u_server', version: 1 } })),
    install: vi.fn(() => ({ ok: true })),
    attach: vi.fn(() => true),
    ...over,
  })

  it('⛔⛔ it takes its store as an ARGUMENT — the shell imports no persistence', async () => {
    const s = store()
    const res = await saveAsIndicator(authored('sma(close, 20)'), s)
    expect(res.ok).toBe(true)
    expect(s.buildDocument).toHaveBeenCalled()
    expect(s.validate).toHaveBeenCalled()
    expect(s.save).toHaveBeenCalled()
    // The STORE's row is what gets installed and attached, never the draft.
    expect(s.install).toHaveBeenCalledWith({ id: 'u_server', version: 1 })
    expect(res.attached).toBe(true)
  })

  it('⛔ a registry refusal never reaches the network', async () => {
    const s = store({ validate: vi.fn(() => ({ defs: [], errors: ['no'] })) })
    const res = await saveAsIndicator(authored('sma(close, 20)'), s)
    expect(res.ok).toBe(false)
    expect(s.save).not.toHaveBeenCalled()
  })

  it('⛔ a formula that cannot DRAW is reported, not quietly added to the chart', async () => {
    const s = store({ install: vi.fn(() => ({ ok: false, error: 'stale verdict' })) })
    const res = await saveAsIndicator(authored('sma(close, 20)'), s)
    expect(res.ok).toBe(true)          // the save stands
    expect(res.attached).toBe(false)   // …and nothing was attached
    expect(res.warning).toBe('stale verdict')
    expect(s.attach).not.toHaveBeenCalled()
  })

  it('⛔ a failed save is reported rather than swallowed', async () => {
    const s = store({ save: vi.fn(async () => ({ ok: false, error: 'offline' })) })
    const res = await saveAsIndicator(authored('sma(close, 20)'), s)
    expect(res).toEqual({ ok: false, error: 'offline' })
  })
})
