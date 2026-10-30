// `DraftStatus.sameMathsAs` (#500, Agent contract 2026-10-29): the member's own saved
// definitions that calculate exactly what the draft does — by maths, never by name.
import { describe, it, expect, beforeEach } from 'vitest'
import { storeConversation } from './conversationSave'
import { _simulateReload, STORAGE_KEY } from './authoring/conversationSessions'
import { openDraft, draftTurn, draftStatus, saveDraft } from './agentAuthoring'

const PATCH = 'uct.authoring.patch/1'
const close = { type: 'series', name: 'close' }
const call = (name, ...args) => ({ type: 'call', name, args })
const num = (value) => ({ type: 'num', value })

function scripted() {
  return async ({ message, state }) => {
    const env = (ops) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
      envelope: { contract: PATCH, baseRevision: state.revision, ops, assumptions: [], disposition: 'change' } })
    const m = /rsi (\d+)/i.exec(message)
    if (m) {
      const n = Number(m[1])
      return env([{ op: 'create', name: `RSI ${n}`, placement: 'pane', outputs: [{ key: 'rsi', label: `RSI ${n}`, tree: call('rsi', close, num(n)) }] }])
    }
    return { ok: true, disposition: 'unsupported', turn: 'noop', reply: 'no', envelope: null }
  }
}

let server, seq
const fakeSave = async (doc, defId, _x, opts) => {
  const id = defId || `u_aaaaaaaaab${String(seq++).padStart(2, '0')}`
  const version = defId ? (opts?.baseVersion || 0) + 1 : 1
  server.set(id, { def_id: id, version, rev: 1, definition: { ...doc, id, version } })
  return { ok: true, row: { def_id: id, version, rev: 1 } }
}
const ctxOf = () => ({
  canAuthor: true, sym: 'AMD', tf: 'D', definitionRows: [...server.values()],
  converse: scripted(),
  store: (s, o) => storeConversation(s, { ...o, save: fakeSave }),
  readBack: async (id) => server.get(id) || null,
})

async function savedRsi(n) {
  const ref = openDraft({ create: true }, ctxOf()).draftRef
  await draftTurn(ref, `Create RSI ${n}.`, { expectedRevision: 0 }, ctxOf())
  const st = draftStatus(ref, ctxOf())
  const saved = await saveDraft(ref, { expectedRevision: st.revision }, ctxOf())
  if (!saved.ok) throw new Error(`save failed: ${JSON.stringify(saved)}`)
  return saved.defId
}
async function draftRsi(n) {
  const ref = openDraft({ create: true }, ctxOf()).draftRef
  await draftTurn(ref, `Create RSI ${n}.`, { expectedRevision: 0 }, ctxOf())
  return ref
}

beforeEach(() => {
  server = new Map(); seq = 31
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
})

describe('DraftStatus.sameMathsAs', () => {
  it('is an empty frozen list for a draft with nothing built, or with no rows', () => {
    const o = openDraft({ create: true }, ctxOf())
    expect(o.status.sameMathsAs).toEqual([])
    expect(Object.isFrozen(o.status.sameMathsAs)).toBe(true)
  })

  it('lists a saved definition with the same maths, whatever its stored name', async () => {
    const id = await savedRsi(28)
    // the stored row carries a legacy formula-style name the draft's derived name never matches
    server.get(id).definition.meta.name = 'RSI(close, 28) legacy wording'
    const ref = await draftRsi(28)
    const st = draftStatus(ref, ctxOf())
    expect(st.sameMathsAs).toEqual([{ defId: id, name: 'RSI(close, 28) legacy wording' }])
    expect(Object.isFrozen(st.sameMathsAs)).toBe(true)
    expect(Object.isFrozen(st.sameMathsAs[0])).toBe(true)
  })

  it('does not list a saved definition whose maths differ', async () => {
    await savedRsi(14)
    const ref = await draftRsi(28)
    expect(draftStatus(ref, ctxOf()).sameMathsAs).toEqual([])
  })

  it('an edit draft never matches its own definition', async () => {
    const id = await savedRsi(28)
    const o = openDraft({ edit: { defId: id } }, ctxOf())
    expect(o.ok).toBe(true)
    expect(o.status.sameMathsAs).toEqual([])
  })

  it('an edit draft does list ANOTHER saved definition with the same maths', async () => {
    const first = await savedRsi(28)
    const second = await savedRsi(28)
    const o = openDraft({ edit: { defId: second } }, ctxOf())
    expect(o.status.sameMathsAs.map((r) => r.defId)).toEqual([first])
  })
})
