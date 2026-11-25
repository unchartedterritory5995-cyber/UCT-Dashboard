// app/src/components/chart/builder/memberPane/memberDoorBytes.test.js
//
// ─── ⭐⭐ THE PASTE WORKER — WHAT CROSSES TO THE PAGE, PER KIND OF MESSAGE, UNDER A STATED BUDGET ──────────────────
//
// docs/pine/evidence/2026-11-20-paste-worker/EVIDENCE.md. What a worker posts to the page is received on the page's main
// thread, and receiving is not free: #2254's first trace spent up to 1.2 s receiving one heavy script's report (62.5 MB
// of structured clone) and 0.8 s its door answer (47.8 MB). The page is now sent what it reads (`inspectView.js`, the
// hub in `inspectAsync.js`). This measures, in the structured-clone wire format (what `postMessage` writes, counted by
// `testing/builder/wireBytes.js` so the count is the same on every Node), every kind of message a paste sends the page,
// for the heaviest committed scripts, against a budget per kind.
//
// ⛔ EVERY BUDGET CAN FAIL: for each kind, what the page would have been sent before (the full report; the full door
// answer; for the status, both, which it was computed from on the page; for a Use, the full report the program rode in)
// is over the budget on at least one script here.
//
// ⭐ The two scripts of #2254's trace (A, B) are licence-held and cannot be committed: their budgets are measured by the
// same code on the developer's box, `PASTE_BYTES_LOCAL` (a JSON list of `{name, path, budgets}`), and recorded in the
// evidence; in CI this half has nothing to read and says so. ⭐ e98 P2: A/B (licence-held) never measured; the rail
// measures them with wireBytes whenever PASTE_BYTES_LOCAL is set.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import v8 from 'node:v8'
import { wireBytes } from '../../../../testing/builder/wireBytes.js'
import { memberDoorImage } from './memberDoorImage'
import { MEMBER_PANE_DEF_PREFIX, memberPaneDefinition } from './memberPaneDefinition'
import { MEMBER_DOOR_JOB, INSPECT_JOB } from './memberDoorProtocol'
import { inspectSource } from '../inspectSource'
import { importWorkerCore, fakeChannel } from '../../../../testing/builder/memberDoor.testkit.js'

const REPO = path.resolve(__dirname, '../../../../../..')

/** Bytes per kind of message to the page, for every committed script here. */
// ⭐ e98 P2 — the budgets are unchanged and keep their meaning: about 15-20% over the heaviest committed script's message of
// each kind, and under what the page was sent before on at least one script (the control below). Re-derived from the CI
// run of 2026-11-25 (Node 20.20.2, run 45705397715) in `wireBytes`, which read the SAME bytes on Node 24.13.1 for every
// script and kind (the v8.serialize lengths moved up to 18.7%: artemis door 833,818 on Node 20 vs 702,460 on Node 24).
const PAGE_BYTES_BUDGET = Object.freeze({
  report: 640 * 1024,   // PasteBox's report (heaviest committed: twin-range-filter, 552,937 B; before 1,500,065)
  door: 896 * 1024,     // the chart door's answer (twin-range-filter, 759,284 B; before 1,009,242)
  status: 64 * 1024,    // the editor status panel's status (chart-champions, 31,160 B; before 2,509,307 on twin-range)
  use: 512 * 1024,      // a Use's object program (artemis-oscillator-pro, 391,105 B; before 1,500,065 on twin-range)
})

const COMMITTED = [
  'corpus/committed/artemis-oscillator-pro__ea1097ca9e.pine',
  'corpus/committed/camarilla__jw9faob08r.pine',
  'corpus/committed/chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2.pine',
  'corpus/committed/atr-support-and-resistance__3e9ddb38c4.pine',
  'corpus/committed/twin-range-filter__xF3L2PeXm7.pine',
  'tests/fixtures/member/uncharted-clouds.pine',
]

// ⭐ e98 P2 — the measure is `wireBytes` (the structured-clone wire format, counted by the value's own rule), NOT
// `v8.serialize(v).length`, whose length moves with the V8 that runs the test (Node 20 on CI read about 18% larger
// than Node 24 for the same messages). `v8.serialize` is still logged beside it, for the record, and never asserted.
const size = (v) => wireBytes(v)
const v8size = (v) => v8.serialize(v).length

let doorCore = null
let reportCore = null
beforeAll(async () => {
  doorCore = await importWorkerCore(vi)
  reportCore = await importWorkerCore(vi)
}, 120000)

let seq = 0
/** One paste, as the two workers answer it: the bytes of each kind of message the page is sent, and the before. */
async function bytesOf(source) {
  const ch = fakeChannel()
  doorCore.setPeer(ch.port1, 'door')
  reportCore.setPeer(ch.port2, 'inspect')
  const posted = []
  reportCore.setPagePost((m) => posted.push(m))
  seq += 1
  const key = `R${seq}`
  const r = reportCore.answerInspectJob({ kind: INSPECT_JOB, id: seq, key, version: 1, args: { source, dialect: 'auto' }, image: memberDoorImage() })
  const d = doorCore.answerMemberDoorJob({ kind: MEMBER_DOOR_JOB, id: seq, key: `D${seq}`, version: 1, args: { source, id: MEMBER_PANE_DEF_PREFIX }, image: memberDoorImage() })
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  reportCore.acceptPageMessage({ type: 'objects-ask', askId: seq, reportKey: key, args: { source, dialect: 'auto' } })
  const ask = posted.find((m) => m.type === 'ask-answer' && m.askId === seq)
  // (this paste's statuses: a new channel is also sent the door's previous answer, whose status is another report's)
  const statuses = [...(r.statuses || []), ...posted.filter((m) => m.type === 'status' && m.reportKey === key)]
  doorCore.setPeer(null)
  reportCore.setPeer(null)
  reportCore.setPagePost(null)
  const fullReport = size(inspectSource(source, 'auto'))
  const fullDoor = size(memberPaneDefinition({ source, id: MEMBER_PANE_DEF_PREFIX }))
  return {
    ok: r.ok === true && d.ok === true && !!ask && ask.ok === true && statuses.length > 1,
    now: { report: size(r), door: size(d), status: Math.max(...statuses.map(size)), use: size(ask) },
    before: { report: fullReport, door: fullDoor, status: fullReport + fullDoor, use: fullReport },
    v8: { node: process.versions.node, report: v8size(r), door: v8size(d), status: Math.max(...statuses.map(v8size)), use: v8size(ask) },
  }
}

describe('⭐⭐ bytes posted to the page, per kind, under a stated budget', () => {
  it('the heaviest committed scripts: every kind under its budget; before, every kind over it on one of them', async () => {
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    const over = { report: 0, door: 0, status: 0, use: 0 }
    const measured = []
    for (const f of COMMITTED) {
      const got = await bytesOf(fs.readFileSync(path.join(REPO, f), 'utf8'))
      const name = path.basename(f)
      console.log(`[paste-bytes] ${name} ${JSON.stringify(got)}`)
      measured.push({ name, got })
    }
    expect(measured.length, 'every committed script was measured').toBe(COMMITTED.length)
    for (const { name, got } of measured) {
      expect(got.ok, `${name}: both workers answered, a status with the door's answer, a Use's program`).toBe(true)
      for (const kind of Object.keys(PAGE_BYTES_BUDGET)) {
        expect(got.now[kind], `${name}: ${kind} posted to the page`).toBeLessThanOrEqual(PAGE_BYTES_BUDGET[kind])
        if (got.before[kind] > PAGE_BYTES_BUDGET[kind]) over[kind] += 1
      }
    }
    // ⛔ THE CONTROL: each budget is one the page's old messages break (the rail can fail)
    for (const kind of Object.keys(PAGE_BYTES_BUDGET)) expect(over[kind], `${kind}: before, over its budget somewhere`).toBeGreaterThan(0)
    vi.unstubAllEnvs()
  }, 600000)

  it('the licence-held scripts of #2254\'s trace (A, B): measured on the developer\'s box, never in CI', async () => {
    const local = process.env.PASTE_BYTES_LOCAL ? JSON.parse(process.env.PASTE_BYTES_LOCAL) : []
    if (!local.length) {
      console.log('[paste-bytes] PASTE_BYTES_LOCAL unset: the licence-held half is not measured here (recorded in the evidence)')
      return
    }
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    for (const { name, path: p, budgets } of local) {
      const got = await bytesOf(fs.readFileSync(p, 'utf8'))
      console.log(`[paste-bytes] ${name} ${JSON.stringify(got)}`)
      expect(got.ok, `${name}: answered`).toBe(true)
      for (const kind of Object.keys(budgets || {})) expect(got.now[kind], `${name}: ${kind}`).toBeLessThanOrEqual(budgets[kind])
    }
    vi.unstubAllEnvs()
  }, 1800000)
})
