// app/src/components/chart/builder/BuilderSheet.pineRepaste.test.jsx
//
// ─── C46 — PASTING PINE INTO A SAVED FORMULA, THROUGH THE REAL DOOR ──────────
//
// A saved definition addresses its adjustable inputs by id; the server keeps the
// prior record for an id it holds and refuses one it does not (owner condition
// 15, `api/services/param_manifest.py`). Since C46 an id is the input call's place
// in the source, so a document saved BEFORE that — for a script outside the frozen
// corpus map — holds counter ids (`1, 2, …`) the fresh translation no longer
// produces. `paramCarry.js` is what makes the paste arrive under the saved ids.
//
// THE TWO HALVES, AND THE FILE THAT JOINS THEM:
//   · this file drives the SHIPPED builder (Your formulas → Edit → Import → Use →
//     Save) with nothing mocked but `fetch`, and pins the exact `compute` each
//     paste sends: `tests/fixtures/pine_param_ids/repaste-requests.json`;
//   · `tests/test_param_repaste_c46.py` feeds those SAME bodies to the real
//     `user_definitions.save()` and reads the server's own answer.
// The fetch stand-in below applies condition 15 as the server does, so the door's
// handling of a refusal is exercised here too — the pytest is the authority.
//
// ⛔ `repaste-prior-pre-c46.json` IS A RECORD OF WHAT BASE `e4e24524ef` SAVED. It
// is never regenerated. `repaste-requests.json` is rewritten only by
// `C46_REPASTE_WRITE=1`, and a diff in it is a change in what the door sends.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { reconcileParams } from './paramEdit'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { AuthContext } from '../../../context/AuthContext'

import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(__dirname, '../../../../..')
const FIX = path.join(REPO, 'tests/fixtures/pine_param_ids')
const PRIOR = JSON.parse(fs.readFileSync(path.join(FIX, 'repaste-prior-pre-c46.json'), 'utf8'))
const REQUESTS_PATH = path.join(FIX, 'repaste-requests.json')
const WRITE = !!process.env.C46_REPASTE_WRITE
const PINNED = fs.existsSync(REQUESTS_PATH) ? JSON.parse(fs.readFileSync(REQUESTS_PATH, 'utf8')) : {}
const SENT = {}

const SAME = PRIOR.script
// one input ADDED — above the others, so every ordinal below it moves — and used by a second plot
const ADDED = `//@version=5
indicator("C46 re-paste")
sig = input.int(5, "Signal")
fast = input.int(9, "Fast")
slow = input.int(21, "Slow")
plot(ta.ema(close, slow) - ta.ema(close, fast), "Spread")
plot(ta.sma(close, sig), "Sig")
`
// `fast` RENAMED to `quick`; nothing else moves
const RENAMED = `//@version=5
indicator("C46 re-paste")
quick = input.int(9, "Quick")
slow = input.int(21, "Slow")
plot(ta.ema(close, slow) - ta.ema(close, quick), "Spread")
`
// (c2) `fast` renamed AND a new input added, read by a second plot
const RENAMED_ADDED = `//@version=5
indicator("C46 re-paste")
sig = input.int(5, "Signal")
quick = input.int(9, "Quick")
slow = input.int(21, "Slow")
plot(ta.ema(close, slow) - ta.ema(close, quick), "Spread")
plot(ta.sma(close, sig), "Sig")
`
// (c3) the two inputs declared the other way round, titles unchanged
const SWAPPED = `//@version=5
indicator("C46 re-paste")
slow = input.int(21, "Slow")
fast = input.int(9, "Fast")
plot(ta.ema(close, slow) - ta.ema(close, fast), "Spread")
`
// (c4) `fast` renamed AND turned into a float, standing where `fast` stood
const RENAMED_KIND = `//@version=5
indicator("C46 re-paste")
quick = input.float(9, "Quick")
slow = input.int(21, "Slow")
plot(ta.ema(close, slow) - ta.ema(close, quick), "Spread")
`
// (c5) both inputs renamed, nothing else moved
const RENAMED_TWO = `//@version=5
indicator("C46 re-paste")
quick = input.int(9, "Quick")
lag = input.int(21, "Lag")
plot(ta.ema(close, lag) - ta.ema(close, quick), "Spread")
`
const DEF_ID = 'u_c46repaste01'
const CONDITION_15 = (pid) => `paramManifest.${pid}: refused. This logical parameter id does not exist on `
  + 'the saved definition being edited, and an ordinary save may never introduce a new '
  + 'adjustable-parameter identity'

const H = vi.hoisted(() => ({ requests: [], store: new Map(), counter: 0 }))

/** A stateful stand-in for `api/routers/user_definitions.py` that applies the
 *  server's manifest rule on an edit: an id the stored document holds keeps its
 *  PRIOR record, an id it does not hold refuses the whole save (condition 15). */
function stubStatefulFetch() {
  H.requests = []
  H.store = new Map()
  H.counter = 0
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const u = String(url)
    H.requests.push({ url: u, method, body: init.body ?? null })
    if (method === 'GET' && u.startsWith('/api/user-definitions')) {
      return { ok: true, status: 200, json: async () => ({ definitions: [...H.store.values()] }) }
    }
    if (method === 'POST' && u === '/api/user-definitions') {
      const { definition } = JSON.parse(init.body)
      H.counter += 1
      const defId = `u_${String(H.counter).padStart(12, '0')}`
      const compute = { ...definition.compute }
      if (compute.paramManifest) compute.paramState = reconcileParams({ compute })
      const row = { def_id: defId, version: 1, rev: 1, ast_hash: compute.fn, definition: { ...definition, id: defId, compute }, created_at: 1 }
      H.store.set(defId, row)
      return { ok: true, status: 200, json: async () => row }
    }
    if (method === 'PUT' && u.startsWith('/api/user-definitions/')) {
      const defId = decodeURIComponent(u.slice('/api/user-definitions/'.length))
      const prior = H.store.get(defId)
      const { definition } = JSON.parse(init.body)
      const compute = { ...definition.compute }
      const was = (prior && prior.definition.compute.paramManifest) || {}
      const canonical = {}
      for (const pid of Object.keys(compute.paramManifest || {})) {
        if (!(pid in was)) return { ok: false, status: 400, json: async () => ({ detail: CONDITION_15(pid) }) }
        canonical[pid] = was[pid]
      }
      if (compute.paramManifest) { compute.paramManifest = canonical; compute.paramState = reconcileParams({ compute }) }
      const row = { def_id: defId, version: (prior?.version || 1) + 1, rev: 1, ast_hash: compute.fn, definition: { ...definition, id: defId, compute }, created_at: 1 }
      H.store.set(defId, row)
      return { ok: true, status: 200, json: async () => row }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

// ⛔ `getByText`/`getByRole`, NEVER `findByText`/`findByRole` — this file runs
// under fake timers to drive both debounces (`BuilderSheet.pine.test.jsx`'s
// own rule, restated here because this file needs it for a THIRD reason:
// `findBy*`'s internal `waitFor` polls on a REAL timer, which fake timers
// freeze forever). `flushSwr` advances fake time too, in case SWR's own
// revalidation scheduling uses a timer internally, THEN flushes microtasks —
// so a synchronous `getByText` after it sees the settled DOM either way.
const flushSwr = async () => {
  await act(async () => { vi.advanceTimersByTime(1000) })
  await flush()
}

const noop = () => {}

/** A FRESH render with a FRESH SWR cache each time -- simulating a real
 *  close-and-reopen (or a page reload), never a cache the previous mount's
 *  save already warmed in place. */
function mountFresh() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const formulaField = () => screen.getByLabelText('Formula')
const pineField = () => screen.getByTestId('pine-box').querySelector('textarea')
const tab = (name) => screen.getByRole('tab', { name })

async function settlePine() {
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

async function settleFormula() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

async function paste(script) {
  fireEvent.click(tab(/^import$/i))
  fireEvent.change(pineField(), { target: { value: script } })
  await settlePine()
}

const seedPrior = () => {
  const compute = { ...PRIOR.definition.compute }
  compute.paramState = reconcileParams({ compute })
  H.store.set(DEF_ID, { def_id: DEF_ID, version: 1, rev: 1, ast_hash: compute.fn, definition: { ...PRIOR.definition, id: DEF_ID, compute }, created_at: 1 })
}
const ids = (compute) => Object.fromEntries(Object.entries(compute.paramManifest || {}).map(([id, e]) => [id, e.sourceName]))
const values = (compute) => { const s = reconcileParams({ compute }); return Object.fromEntries(Object.keys(s).map((id) => [id, s[id].value])) }

/** Your formulas → Edit → Import → paste → Use → Save changes. Returns the PUT's compute. */
async function repasteIntoSaved(script) {
  seedPrior()
  mountFresh()
  await flushSwr()
  const listRow = screen.getByText('C46 repaste').closest('li')
  fireEvent.click(within(listRow).getByRole('button', { name: /^Edit C46 repaste$/i }))
  await settleFormula()
  await paste(script)
  fireEvent.click(screen.getByTestId('pine-use'))
  await settleFormula()
  const note = screen.queryByTestId('param-carry-note')
  const noteText = note ? note.textContent : null
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
  await flush()
  const put = H.requests.find((r) => r.method === 'PUT')
  expect(put, 'the edit PUT never fired').toBeTruthy()
  expect(put.url).toBe(`/api/user-definitions/${DEF_ID}`)
  return { compute: JSON.parse(put.body).definition.compute, noteText }
}

/** The request the door sent is the request the server test was run against. */
function pin(name, compute) {
  SENT[name] = compute
  if (WRITE) return
  expect(PINNED[name], `repaste-requests.json has no "${name}" — run C46_REPASTE_WRITE=1`).toBeTruthy()
  expect(compute).toEqual(PINNED[name])
}

beforeEach(() => { vi.useFakeTimers(); stubStatefulFetch() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
afterAll(() => {
  if (!WRITE) return
  const about = 'C46 - the compute each Pine paste SENT, captured from the shipped builder by BuilderSheet.pineRepaste.test.jsx (C46_REPASTE_WRITE=1). every key but fresh is a PUT over repaste-prior-pre-c46.json; fresh is a POST. tests/test_param_repaste_c46.py feeds these to the real user_definitions.save().'
  fs.writeFileSync(REQUESTS_PATH, `${JSON.stringify({ _about: about, ...SENT }, null, 1)}\n`, 'utf8')
})

describe('C46 — pasting Pine into a saved formula keeps the parameter ids it was saved with', () => {
  it('NON-VACUITY — the saved document holds COUNTER ids, in walk order, for a script the frozen map does not know', () => {
    expect(ids(PRIOR.definition.compute)).toEqual({ __uct_param_1: 'slow', __uct_param_2: 'fast' })
    // source order is fast, slow — so position and name disagree, which is what the carry must get right
    expect(PRIOR.script.indexOf('fast =')).toBeLessThan(PRIOR.script.indexOf('slow ='))
  })

  it('⛔⛔ (a) the SAME Pine pasted over the pre-C46 document: saves, same ids, same values', async () => {
    const { compute, noteText } = await repasteIntoSaved(SAME)
    expect(ids(compute)).toEqual({ __uct_param_1: 'slow', __uct_param_2: 'fast' })
    expect(values(compute)).toEqual({ __uct_param_1: 21, __uct_param_2: 9 })
    expect(values(compute)).toEqual(values(PRIOR.definition.compute))
    expect(compute.paramManifest).toEqual(PRIOR.definition.compute.paramManifest)
    expect(noteText).toBeNull()
    // nothing was refused, and what is stored still answers by the saved ids
    expect(screen.queryByTestId('store-error')).toBeNull()
    expect(values(H.store.get(DEF_ID).definition.compute)).toEqual({ __uct_param_1: 21, __uct_param_2: 9 })
    pin('same', compute)
  })

  it('⛔⛔ (b) one input ADDED above the others: the old ids are kept BY NAME, the new input is at its source id', async () => {
    const { compute, noteText } = await repasteIntoSaved(ADDED)
    // `sig` is the script's first input call → 1001. `fast` and `slow` moved to
    // ordinals 2 and 3 and still hold the ids the document was saved with.
    expect(ids(compute)).toEqual({ __uct_param_1: 'slow', __uct_param_2: 'fast', __uct_param_1001: 'sig' })
    expect(noteText).toMatch(/`Signal` is not among the adjustable settings this formula was saved with/)
    // ⛔ and the server refuses it, as it did before C46 for any input added on an
    // edit (condition 15): the stored document is untouched.
    expect(screen.getByTestId('store-error').textContent).toMatch(/__uct_param_1001: refused/)
    expect(H.store.get(DEF_ID).version).toBe(1)
    pin('added', compute)
  })

  it('⛔⛔ (c) one input RENAMED, nothing else moved: it keeps the saved id, saves, and the member is told', async () => {
    const { compute, noteText } = await repasteIntoSaved(RENAMED)
    // `quick` stands exactly where `fast` stood (the walk's second input, an int),
    // and `fast` is gone: the same saved setting under a new name. This paste
    // saved before C46 — the counter gave `quick` the number `fast` had held.
    expect(ids(compute)).toEqual({ __uct_param_1: 'slow', __uct_param_2: 'quick' })
    expect(values(compute)).toEqual({ __uct_param_1: 21, __uct_param_2: 9 })
    expect(noteText).toBe('The input "Fast" is now "Quick". It is the same saved setting under its new name.')
    expect(screen.queryByTestId('store-error')).toBeNull()
    expect(H.store.get(DEF_ID).version).toBe(2)
    expect(values(H.store.get(DEF_ID).definition.compute)).toEqual({ __uct_param_1: 21, __uct_param_2: 9 })
    pin('renamed', compute)
  })

  it('⛔⛔ (c2) a rename AND an added input in one paste: the rename still carries, and only the ADDED input is refused', async () => {
    const { compute, noteText } = await repasteIntoSaved(RENAMED_ADDED)
    expect(ids(compute)).toEqual({ __uct_param_1: 'slow', __uct_param_2: 'quick', __uct_param_1001: 'sig' })
    expect(noteText).toMatch(/^The input "Fast" is now "Quick"\. It is the same saved setting under its new name\. /)
    expect(noteText).toMatch(/`Signal` is not among the adjustable settings this formula was saved with/)
    expect(noteText).not.toMatch(/`Quick` is not among/)
    // refused for the added input, as (b) — and for nothing else
    const refusal = screen.getByTestId('store-error').textContent
    expect(refusal).toMatch(/__uct_param_1001: refused/)
    expect(refusal).not.toMatch(/__uct_param_2\b/)
    expect(H.store.get(DEF_ID).version).toBe(1)
    pin('renamed_added', compute)
  })

  it('⛔⛔ (c3) the two inputs SWAPPED in the source, titles unchanged: matched by name, no rename involved', async () => {
    const { compute, noteText } = await repasteIntoSaved(SWAPPED)
    expect(ids(compute)).toEqual({ __uct_param_1: 'slow', __uct_param_2: 'fast' })
    expect(values(compute)).toEqual({ __uct_param_1: 21, __uct_param_2: 9 })
    expect(noteText).toBeNull()
    expect(screen.queryByTestId('store-error')).toBeNull()
    pin('swapped', compute)
  })

  it('⛔⛔ (c4) a rename AND a change of kind: not a rename — a new input at its source id, refused', async () => {
    const { compute, noteText } = await repasteIntoSaved(RENAMED_KIND)
    // same place as `fast`, but a float is not the int that was saved there
    expect(ids(compute)).toEqual({ __uct_param_1: 'slow', __uct_param_1001: 'quick' })
    expect(compute.paramManifest.__uct_param_1001.type).toBe('float')
    expect(noteText).toMatch(/`Quick` is not among the adjustable settings/)
    expect(noteText).not.toMatch(/is now "Quick"/)
    expect(screen.getByTestId('store-error').textContent).toMatch(/__uct_param_1001: refused/)
    expect(H.store.get(DEF_ID).version).toBe(1)
    pin('renamed_kind', compute)
  })

  it('⛔⛔ (c5) BOTH inputs renamed, each still in its place: both keep their saved ids, and it saves', async () => {
    const { compute, noteText } = await repasteIntoSaved(RENAMED_TWO)
    expect(ids(compute)).toEqual({ __uct_param_1: 'lag', __uct_param_2: 'quick' })
    expect(values(compute)).toEqual({ __uct_param_1: 21, __uct_param_2: 9 })
    expect(noteText).toMatch(/The input "Fast" is now "Quick"\./)
    expect(noteText).toMatch(/The input "Slow" is now "Lag"\./)
    expect(screen.queryByTestId('store-error')).toBeNull()
    expect(H.store.get(DEF_ID).version).toBe(2)
    pin('renamed_two', compute)
  })

  it('⛔⛔ (d) a FRESH paste into a new formula: source ids, no carry, no notice', async () => {
    seedPrior() // a saved formula exists, and is NOT being edited
    mountFresh()
    await flush()
    await paste(SAME)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    expect(screen.queryByTestId('param-carry-note')).toBeNull()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'C46 fresh' } })
    await settleFormula()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await flush()
    const post = H.requests.find((r) => r.method === 'POST' && r.url === '/api/user-definitions')
    expect(post, 'the create POST never fired').toBeTruthy()
    const compute = JSON.parse(post.body).definition.compute
    expect(ids(compute)).toEqual({ __uct_param_1001: 'fast', __uct_param_1002: 'slow' })
    expect(H.requests.some((r) => r.method === 'PUT')).toBe(false)
    pin('fresh', compute)
  })
})
