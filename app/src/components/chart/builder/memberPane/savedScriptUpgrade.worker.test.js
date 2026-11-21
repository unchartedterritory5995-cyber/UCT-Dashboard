// app/src/components/chart/builder/memberPane/savedScriptUpgrade.worker.test.js
//
// ─── ⭐⭐ THE PASTE WORKER — A SAVED SCRIPT'S UPGRADE AT CHART LOAD BUILDS IN THE DOOR'S WORKER ─────────────────────
//
// After an engine-version bump every stale saved Pine document is translated again when a chart loads
// (`savedScriptUpgrade.js`). That ran the door (`memberPaneDefinition`) on the chart's main thread, one row per idle
// slot, each call synchronous: a heavy script froze the tab for the whole call. It now goes through the member door's
// worker service (`memberDoorAsync.memberDoorService`), loaded on demand as the translator was.
//
// A stand-in worker runs the REAL handler in a fresh module graph; every `memberPaneDefinition` call is counted by
// where it ran. The upgraded documents equal the ones the main thread made, field for field; NO door call runs on
// the main thread; a worker that stopped leaves the row drawn as stored (inconclusive), NEVER refused (a refusal is
// remembered server-side and withholds the member's script on every device).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const D = vi.hoisted(() => ({ inWorker: false, main: 0, worker: 0 }))
vi.mock('./memberPaneDefinition', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    memberPaneDefinition: (...args) => {
      if (D.inWorker) D.worker += 1
      else D.main += 1
      return m.memberPaneDefinition(...args)
    },
  }
})

import * as mpd from './memberPaneDefinition'
import {
  resolveRow, onUpgradeSettled, __resetSavedScriptUpgrade, __setTranslatorForTests, UPGRADE_NOTIFY_COALESCE_MS,
} from './savedScriptUpgrade'
import { createMemberDoorService, __setMemberDoorServiceForTests, DOOR_WORKER_STOPPED } from './memberDoorAsync'
import { FakeDoorWorker, importWorkerCore, canonOf } from '../../../../testing/builder/memberDoor.testkit.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const corpus = (n) => fs.readFileSync(path.join(REPO, 'corpus/committed', n), 'utf8')
const SCRIPTS = {
  sma: '//@version=5\nindicator("Upgrade Probe")\nplot(ta.sma(close, 14), "avg")\n',
  rvol: corpus('rvol__05fcd9e160.pine'),
  twinRange: corpus('twin-range-filter__xF3L2PeXm7.pine'),
  atrLevels: corpus('atr-support-and-resistance__3e9ddb38c4.pine'),
}

class CountingWorker extends FakeDoorWorker {
  answer(job) {
    D.inWorker = true
    try { super.answer(job) } finally { D.inWorker = false }
  }
}

let core = null
beforeAll(async () => { core = await importWorkerCore(vi) }, 120000)
let made = []
let svc = null
function withWorkers(mode = 'answer') {
  made = []
  svc = createMemberDoorService({ factory: () => { const w = new CountingWorker(core, { mode }); made.push(w); return w } })
  __setMemberDoorServiceForTests(svc)
}
beforeEach(() => { __resetSavedScriptUpgrade(); D.main = 0; D.worker = 0; vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1') })
afterEach(() => { __setMemberDoorServiceForTests(null); vi.unstubAllEnvs() })

/** A stale row of `source` as the store serves it: the door's document of yesterday (no engine stamp). */
function staleRow(name, source, i) {
  const id = `u_${String(i).padStart(12, 'a')}`
  const b = mpd.memberPaneDefinition({ source, id })
  expect(b.ok, `${name}: ${b.reason}`).toBe(true)
  const d = JSON.parse(JSON.stringify(b.definition))
  d.version = 3
  d.compute.rev = 2
  delete d.meta.engineVersion
  return { def_id: id, version: 3, rev: 2, definition: d, pine_source: source }
}
/** Resolves once every row has settled (its new translation landed and was announced). */
async function settled(rows) {
  for (let i = 0; i < 400; i += 1) {
    if (rows.every((r) => !resolveRow(r).pending)) return
    await new Promise((res) => setTimeout(res, 10))
  }
  throw new Error('the upgrades never settled')
}

describe('⭐⭐ a saved script\'s upgrade at chart load builds in the door\'s worker', () => {
  it('every row: the upgraded document is the main thread\'s, field for field, and no door call ran on the main thread', async () => {
    const rows = Object.entries(SCRIPTS).map(([name, s], i) => staleRow(name, s, i + 1))
    // THE MAIN THREAD'S ANSWER (as before: the translator handed in, called here)
    __setTranslatorForTests(mpd)
    rows.forEach((r) => resolveRow(r))
    await settled(rows)
    const here = rows.map((r) => resolveRow(r))
    expect(here.every((h) => h.definition && h.writeBack), 'each row upgraded on the main thread (the control)').toBe(true)
    // THROUGH THE DOOR'S WORKER (the production loader: `import('./memberDoorAsync')`)
    __resetSavedScriptUpgrade()
    withWorkers()
    const before = { ...D }
    rows.forEach((r) => resolveRow(r))
    await settled(rows)
    expect(D.main - before.main, 'door calls on the MAIN thread during the upgrade').toBe(0)
    expect(D.worker - before.worker, 'door calls in the worker: one per row').toBe(rows.length)
    await new Promise((res) => setTimeout(res, 20))
    expect(svc.stats().held, "each row's build released once read (the service holds nothing)").toBe(0)
    const off = rows.map((r) => resolveRow(r))
    off.forEach((o, i) => {
      expect(canonOf(o.definition, { hidden: true }), `${rows[i].def_id}: the upgraded document is the main thread's`).toBe(canonOf(here[i].definition, { hidden: true }))
      expect(!!o.writeBack).toBe(!!here[i].writeBack)
    })
  }, 300000)

  it('⛔ a worker that stops leaves the row drawn as stored, never refused (and never recorded)', async () => {
    const row = staleRow('sma', SCRIPTS.sma, 9)
    withWorkers('die')
    let heard = 0
    const off = onUpgradeSettled(() => { heard += 1 })
    resolveRow(row)
    await settled([row])
    const r = resolveRow(row)
    off()
    expect(made.length, 'the worker was asked').toBeGreaterThan(0)
    expect(r.refusal, 'a stopped check is not a refusal').toBe(null)
    expect(r.record, 'nothing remembered server-side').toBe(null)
    expect(canonOf(r.definition)).toBe(canonOf(row.definition))
    expect(heard).toBeGreaterThan(0)
    expect(D.main, 'no door call on the main thread').toBe(0)
  }, 120000)

  it('the mark the upgrade reads is the one the dead worker\'s answer carries', () => {
    expect(DOOR_WORKER_STOPPED).toBe('doorWorkerStopped')
    expect(UPGRADE_NOTIFY_COALESCE_MS).toBeGreaterThan(0)
  })
})
