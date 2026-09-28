// app/src/components/chart/builder/memberPane/runtimeLaneStoreRoundTrip.test.jsx
//
// ─── ⭐⭐ A RUNTIME-LANE PANE, SAVED, LISTED, RELOADED AND COMPUTED ──────────
//
// The gap this closes: with `VITE_PINE_RUNTIME_LANE_ENABLED` on, a runtime-lane
// pane previewed and drew, and "Add this script to my chart" was refused by the
// store (`compute.kind` had to be `ast`). The store now takes a `pine` document
// behind its own flag (`PINE_RUNTIME_LANE_STORE_ENABLED`), and this file walks
// the CLIENT half of the round trip against the store's REAL answers:
//
//     build (the member door) → validate → POST → install → list (GET) →
//     install from the list → computeFor
//
// ⛔ THE BACKEND IS MOCKED WITH ITS OWN RESPONSES, NOT A GUESS OF THEM.
// `tests/fixtures/pine_store/adx_round_trip.json` carries three things:
//   · `request.definition` — what this door sends. ASSERTED here against a fresh
//     build, so the fixture cannot drift from the builder.
//   · `createResponse` / `listResponse` — what the store answered. ASSERTED by
//     `tests/test_user_definitions_pine_store.py`, which posts `request` through
//     the REAL router with the store flag on and compares the live answer to
//     them byte for byte (bar the two volatile fields it pins). So the mock below
//     is shaped exactly like the real response because it IS the real response.
// The listed definition comes back with every key SORTED (the store persists
// `sort_keys=True`), which is the case a hash over insertion order could not
// survive — and why the handle is now key-sorted (`pineRuntimeHandle.js`).
//
// Regenerate the request half, only when the builder deliberately changed:
//   PINE_STORE_WRITE_FIXTURE=1 npx vitest run <this file>
// then the response half with the pytest's own write mode (see its header).
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition, loadRuntimeLaneDoor } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { runtimeLaneHandleOf } from '../../engine/pineRuntimeHandle'
import {
  saveUserDefinition, useInstalledUserDefinitions, USER_DEFINITIONS_KEY,
} from '../../../../hooks/useUserDefinitions'
import { AuthContext } from '../../../../context/AuthContext'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE_PATH = path.join(REPO, 'tests/fixtures/pine_store/adx_round_trip.json')
const ADX = 'adx-and-di-for-v4__932'
const DRAFT_ID = 'u_member-pane-adx'
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus/committed', `${name}.pine`), 'utf8')
const SPY = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8'))
  .bars.slice(-600).map((b, i) => ({ ...b, t: 1700000000 + i * 86400 }))
const CTX = { tf: 'D', newestBarIsForming: false }

const on = () => vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
const off = () => vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')

// ⭐ The door loads the runtime lane on demand; this file builds through it
// synchronously, so the lane is loaded first. `useInstalledUserDefinitionsLaneHold
// .test.jsx` covers a stored document meeting an unloaded lane.
beforeAll(async () => { await loadRuntimeLaneDoor() })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
})

function build() {
  const d = memberPaneDefinition({ source: corpus(ADX), id: DRAFT_ID })
  expect(d.ok, d.reason).toBe(true)
  expect(d.lane).toBe('runtime')
  expect(d.definition.compute.kind).toBe('pine')
  return d
}

function readFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
}

/** A `fetch` that answers the two store routes with the store's own bodies and
 *  records what was sent. Anything else is a 404 the test would see. */
function storeFetch(fx) {
  const sent = []
  const fn = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    sent.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null })
    if (method === 'POST' && u === USER_DEFINITIONS_KEY) {
      return { ok: true, status: 200, json: async () => fx.createResponse }
    }
    if (method === 'GET' && u.split('?')[0] === USER_DEFINITIONS_KEY) {
      return { ok: true, status: 200, json: async () => fx.listResponse }
    }
    return { ok: false, status: 404, json: async () => ({ detail: `no route ${method} ${u}` }) }
  })
  return { fn, sent }
}

function wrapperFor(user) {
  return ({ children }) => createElement(
    AuthContext.Provider, { value: { user } },
    createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children),
  )
}

function preview(definition) {
  const { installed, errors } = registry.installUserDefinitions([definition])
  expect(errors, 'the install door refused the preview').toEqual([])
  const cols = registry.computeFor(installed[0], SPY, undefined, CTX)
  registry.uninstallUserDefinition(installed[0].id)
  return cols
}

describe('the fixture is what the door builds', () => {
  it('request.definition is a fresh build of the committed ADX script (or is rewritten, on demand)', () => {
    on()
    const d = build()
    if (process.env.PINE_STORE_WRITE_FIXTURE === '1') {
      const prev = fs.existsSync(FIXTURE_PATH) ? readFixture() : {}
      fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true })
      fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify({
        ...prev,
        corpus: ADX,
        draftId: DRAFT_ID,
        request: { definition: d.definition },
      }, null, 2)}\n`)
    }
    const fx = readFixture()
    expect(d.definition).toEqual(fx.request.definition)
    // ⭐ and its handle is the one the store re-derives
    const { fn, ...rest } = fx.request.definition.compute
    expect(runtimeLaneHandleOf(rest)).toBe(fn)
  })
})

describe('⭐⭐ save → list → load → computeFor, with both flags on', () => {
  it('the saved document comes back from the list, installs, and draws the SAME numbers the preview drew', async () => {
    on()
    const fx = readFixture()
    expect(fx.createResponse, 'run the pytest write mode to record the store\'s answer').toBeTruthy()
    const d = build()
    const before = preview(d.definition)
    const plotKeys = d.rows.filter((r) => !r.colourFor).map((r) => r.key)
    expect(plotKeys.length).toBe(3)

    const { fn, sent } = storeFetch(fx)
    vi.stubGlobal('fetch', fn)

    // ── the attach door's own order: validate → save → install the STORE's id ──
    const { defs, errors } = registry.validateUserDefinitions([d.definition])
    expect(errors).toEqual([])
    expect(defs).toHaveLength(1)
    const res = await saveUserDefinition(d.definition, null, null)
    expect(res.ok, res.error).toBe(true)
    const post = sent.find((s) => s.method === 'POST')
    // ⛔ what went over the wire IS the fixture's request — the pytest posts the same bytes
    expect(post.body).toEqual(fx.request)
    expect(res.row.def_id).toBe(fx.createResponse.def_id)
    expect(res.row.ast_hash).toBe(d.definition.compute.fn)

    // ── a fresh page: nothing installed, the list is read and installed ──
    for (const x of registry.listUserDefinitions()) registry.uninstallUserDefinition(x.id)
    const { result } = renderHook(() => useInstalledUserDefinitions(), {
      wrapper: wrapperFor({ id: 'member-1', plan: 'pro' }),
    })
    const storedId = fx.createResponse.def_id
    await waitFor(() => expect(result.current.installedIds).toContain(storedId))
    expect(result.current.errors).toEqual([])
    expect(sent.some((s) => s.method === 'GET' && s.url.startsWith(USER_DEFINITIONS_KEY))).toBe(true)

    const def = registry.getDefinition(storedId)
    expect(def.compute.kind).toBe('pine')
    // the listed document's keys come back SORTED — and its handle still holds
    const listed = fx.listResponse.definitions.find((r) => r.def_id === storedId).definition
    expect(Object.keys(listed.compute.columns)).toEqual([...Object.keys(listed.compute.columns)].sort())
    const { fn: listedFn, ...listedRest } = listed.compute
    expect(runtimeLaneHandleOf(listedRest)).toBe(listedFn)

    const after = registry.computeFor(def, SPY, undefined, CTX)
    expect(registry.columnErrors(after)).toEqual({})
    for (const k of plotKeys) {
      const finite = Array.from(after[k]).filter(Number.isFinite).length
      expect(finite, k).toBeGreaterThan(500)
      expect(Array.from(after[k]), k).toEqual(Array.from(before[k]))
    }
    // ⭐ and a member's setting still reaches the reloaded program
    const tuned = registry.computeFor(def, SPY, { pine_len: 30 }, CTX)
    expect(Array.from(tuned[plotKeys[0]])).not.toEqual(Array.from(after[plotKeys[0]]))
  })

  it('⛔ the same listed row on a build WITHOUT the runtime lane is listed, refused by name, and never computed', async () => {
    const fx = readFixture()
    off()
    const { fn } = storeFetch(fx)
    vi.stubGlobal('fetch', fn)
    const { result } = renderHook(() => useInstalledUserDefinitions(), {
      wrapper: wrapperFor({ id: 'member-1', plan: 'pro' }),
    })
    await waitFor(() => expect(result.current.errors.length).toBeGreaterThan(0))
    expect(result.current.installedIds).not.toContain(fx.createResponse.def_id)
    expect(result.current.errors.join('\n')).toMatch(/compute\.kind "pine" is declared but this client cannot run it/)
  })
})
