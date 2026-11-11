// ADR-005 L5 (agent-lead, Sprint 2): an object marked `isolated: true` — an MD-1 envelope of a model-isolated
// kind (L2) — never leaves the browser in a model request. Removed at any depth from the model-bound parts of
// the body, counted (never its content); both turn routes send the cleaned body. L6 strips again on the server.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { modelSafeBody, isolationDrops, agentTurn, agentTurnStream } from './agentClient'

const SECRET = '987.654'
const MARKED = { kind: 'ratings', isolated: true, data: { composite: SECRET } }

describe('modelSafeBody', () => {
  it('removes a marked object at any depth in every model-bound part', () => {
    const body = {
      message: 'what about it?',
      context: { widgets: [{ ref: 'w1', last: MARKED }, { ref: 'w2' }], memory: { lastRead: MARKED } },
      pending: { ops: [MARKED] },
      reference: { catalog: { a: MARKED } },
      repair: { why: [MARKED] },
    }
    const out = modelSafeBody(body)
    expect(JSON.stringify(out)).not.toContain(SECRET)
    expect(out.context.widgets).toEqual([{ ref: 'w1' }, { ref: 'w2' }])
    expect(out.message).toBe('what about it?')
  })
  it('drops a marked top-level part whole', () => {
    const out = modelSafeBody({ message: 'x', context: MARKED })
    expect('context' in out).toBe(false)
  })
  it('leaves an unmarked body equal, and does not mutate the caller\'s object', () => {
    const body = { message: 'x', context: { widgets: [{ ref: 'w1', isolated: false, note: 'isolated' }] } }
    const copy = JSON.parse(JSON.stringify(body))
    expect(modelSafeBody(body)).toEqual(copy)
    const marked = { message: 'x', context: { a: MARKED } }
    modelSafeBody(marked)
    expect(marked.context.a).toBe(MARKED)
  })
  it('counts removals, never content', () => {
    const before = isolationDrops()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    modelSafeBody({ context: { a: MARKED, b: [MARKED] } })
    expect(isolationDrops() - before).toBe(2)
    expect(warn.mock.calls.flat().join(' ')).not.toContain(SECRET)
    warn.mockRestore()
  })
})

describe('both turn routes send the cleaned body', () => {
  let sent
  beforeEach(() => {
    sent = []
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      sent.push(String(init?.body || ''))
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' }
    }))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('POST /api/agent/turn', async () => {
    await agentTurn({ message: 'x', context: { a: MARKED } })
    expect(sent.length).toBe(1)
    expect(sent[0]).not.toContain(SECRET)
  })
  it('the streaming route (or its fallback)', async () => {
    await agentTurnStream({ message: 'x', context: { a: MARKED } })
    expect(sent.length).toBeGreaterThan(0)
    for (const s of sent) expect(s).not.toContain(SECRET)
  })
})
