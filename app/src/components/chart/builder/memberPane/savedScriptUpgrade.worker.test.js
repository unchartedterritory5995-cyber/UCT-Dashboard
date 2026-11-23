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

// ⛔ THE PAGE'S MODULES ARE IMPORTED AFTER THE WORKER'S GRAPH IS MADE. `importWorkerCore` resets the module registry, so a
// module the page imports on demand (the upgrade's `import('./memberDoorAsync')`, the production loader) resolves in the
// registry as it stands then; the page's modules are taken from that same registry, so the service this rail installs
// is the one the upgrade finds (a static import here would be an older instance, and the rail would test nothing).
let core = null
let mpd = null
let upg = null
let door = null
beforeAll(async () => {
  core = await importWorkerCore(vi)
  mpd = await import('./memberPaneDefinition')
  upg = await import('./savedScriptUpgrade')
  door = await import('./memberDoorAsync')
}, 120000)
let made = []
let svc = null
function withWorkers(mode = 'answer') {
  made = []
  svc = door.createMemberDoorService({ factory: () => { const w = new CountingWorker(core, { mode }); made.push(w); return w } })
  door.__setMemberDoorServiceForTests(svc)
}
beforeEach(() => { upg.__resetSavedScriptUpgrade(); D.main = 0; D.worker = 0; vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1') })
afterEach(() => { door.__setMemberDoorServiceForTests(null); vi.unstubAllEnvs() })

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
  for (let i = 0; i < 2400; i += 1) {
    if (rows.every((r) => !upg.resolveRow(r).pending)) return
    await new Promise((res) => setTimeout(res, 25))
  }
  throw new Error('the upgrades never settled')
}

describe('⭐⭐ a saved script\'s upgrade at chart load builds in the door\'s worker', () => {
  it('every row: the upgraded document is the main thread\'s, field for field, and no door call ran on the main thread', async () => {
    const rows = Object.entries(SCRIPTS).map(([name, s], i) => staleRow(name, s, i + 1))
    // THE MAIN THREAD'S ANSWER (as before: the translator handed in, called here)
    upg.__setTranslatorForTests({ memberPaneDefinition: mpd.memberPaneDefinition })
    rows.forEach((r) => upg.resolveRow(r))
    await settled(rows)
    const here = rows.map((r) => upg.resolveRow(r))
    // ⭐ WHAT THE CONTROL PINS (engine 94 train): each row's outcome on the main thread, BY NAME, and the worker path
    // below must give every row the same one. Three rows fit the store and upgrade with a write-back. twin-range-filter's
    // translation is over the store's byte cap (master's ITEM 2 oversize keep, 026a8b0a53: 73,142 stored bytes against
    // 65,536 at a8f825e089 and at e94 alike), so it is drawn as stored, never written back and never refused.
    // (#2364's rail predates ITEM 2 and expected a write-back for every row.)
    const OVER_THE_STORE_CAP = new Set(['twinRange'])
    Object.keys(SCRIPTS).forEach((name, i) => {
      const h = here[i]
      expect(h.definition, `${name}: drawn on the main thread`).toBeTruthy()
      expect(h.refusal, `${name}: never refused`).toBe(null)
      expect(h.pending, `${name}: settled`).toBe(false)
      if (OVER_THE_STORE_CAP.has(name)) {
        expect(h.writeBack, `${name}: over the store's cap (ITEM 2), kept as stored, nothing written back`).toBe(null)
        expect(canonOf(h.definition), `${name}: the stored document is drawn`).toBe(canonOf(rows[i].definition))
        const b = mpd.memberPaneDefinition({ source: rows[i].pine_source, id: rows[i].def_id })
        expect(b.oversize && b.oversize.guard, `${name}: the door names the store's cap`).toBe('pine:document-size')
        expect(b.oversize.cap, `${name}: the store's cap`).toBe(64 * 1024)
        expect(b.oversize.bytes, `${name}: today's translation is over it`).toBeGreaterThan(b.oversize.cap)
      } else {
        expect(h.writeBack, `${name}: upgraded on the main thread with a write-back (the control)`).toBeTruthy()
      }
    })
    // THROUGH THE DOOR'S WORKER (the production loader: `import('./memberDoorAsync')`)
    upg.__resetSavedScriptUpgrade()
    withWorkers()
    const before = { ...D }
    rows.forEach((r) => upg.resolveRow(r))
    await settled(rows)
    expect(D.main - before.main, 'door calls on the MAIN thread during the upgrade').toBe(0)
    expect(D.worker - before.worker, 'door calls in the worker: one per row').toBe(rows.length)
    await new Promise((res) => setTimeout(res, 20))
    expect(svc.stats().held, "each row's build released once read (the service holds nothing)").toBe(0)
    const off = rows.map((r) => upg.resolveRow(r))
    off.forEach((o, i) => {
      expect(canonOf(o.definition, { hidden: true }), `${rows[i].def_id}: the upgraded document is the main thread's`).toBe(canonOf(here[i].definition, { hidden: true }))
      expect(!!o.writeBack).toBe(!!here[i].writeBack)
    })
  }, 300000)

  it('⛔ a worker that stops leaves the row drawn as stored, never refused (and never recorded)', async () => {
    const row = staleRow('sma', SCRIPTS.sma, 9)
    withWorkers('die')
    const main0 = D.main
    let heard = 0
    const off = upg.onUpgradeSettled(() => { heard += 1 })
    upg.resolveRow(row)
    await settled([row])
    // (the landing is announced once the coalescing window has passed)
    await new Promise((res) => setTimeout(res, upg.UPGRADE_NOTIFY_COALESCE_MS + 20))
    const r = upg.resolveRow(row)
    off()
    expect(made.length, 'the worker was asked').toBeGreaterThan(0)
    expect(r.refusal, 'a stopped check is not a refusal').toBe(null)
    expect(r.record, 'nothing remembered server-side').toBe(null)
    expect(canonOf(r.definition)).toBe(canonOf(row.definition))
    expect(heard, 'the landing was announced (the chart re-installs)').toBeGreaterThan(0)
    expect(D.main - main0, 'no door call on the main thread').toBe(0)
  }, 120000)

  it('the mark the upgrade reads is the one the dead worker\'s answer carries', () => {
    const dead = door.doorWorkerFailedAnswer('it stopped with an error')
    expect(dead[door.DOOR_WORKER_STOPPED]).toBe(true)
    expect(door.DOOR_WORKER_STOPPED).toBe('doorWorkerStopped')
    expect(upg.judgeRetranslation({ definition: {}, pine_source: 'x' }, dead, null).status).toBe('inconclusive')
  })
})
