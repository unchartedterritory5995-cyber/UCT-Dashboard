// ─── P0 TRUTH CORPUS — gate slice "pineack" (owner decision D + HTF heading) ──
//
// Every case states ASKED / CLAIMED / DID and its outcome class. BEFORE was
// measured on 7bd868f34 (P0 merged): the member-pane door posted every Pine
// document with no `repaint_acknowledged`, so a `preview-repaints` import got
// 422 `repaint-ack` with no way to answer it; and the import box printed the
// raw fold channel key `htfLookaheadOffStepBacks` above its disclosure.
//
// The UI half (button disabled until ticked, body sent) is
// `builder/memberPaneRepaintAck.test.jsx`; the server half is
// `tests/test_p0_truth_pineack.py`, which posts the fixture pinned here.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { inspectSource } from '../../builder/PineBox'
import { FOLD_LABELS, FOLD_NOTES, noteHeading, foldLabelsOf } from '../ast/parse'
import TABLE from '../ast/closedTable.json'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/p0_pineack/member_pane_docs.json'), 'utf8'))
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

describe('D — the server fixture is the document the door builds today', () => {
  for (const kind of ['clean', 'preview', 'repaints']) {
    it(`EXACT — ${kind}: memberPaneDefinition(fixture.pine) === fixture.definition`, () => {
      const built = memberPaneDefinition({ source: FIXTURE[kind].pine, id: 'u_member-pane' })
      expect(built.ok).toBe(true)
      expect(JSON.parse(JSON.stringify(built.definition))).toEqual(FIXTURE[kind].definition)
    })
  }

  it('the three measured modes — VALUE / REFUSAL-until-ack / REFUSAL', () => {
    expect(FIXTURE.clean.definition.meta.repaint).toBe('non-repainting')
    expect(FIXTURE.preview.definition.meta.repaint).toBe('preview-repaints')
    expect(FIXTURE.repaints.definition.meta.repaint).toBe('repaints')
  })
})

describe('D — every frontend definition write goes through the server rule', () => {
  it('only `useUserDefinitions.js` POSTs/PUTs a definition; its callers are the two sheet doors', () => {
    // ASKED: can any frontend door store a definition without the server gate?
    // DID: the one writer is `saveUserDefinition` (POST/PUT /api/user-definitions);
    // its only non-test callers are BuilderSheet `save()` (Formula tab, starter
    // pick, concierge "use this formula" → setSource) and `attachPine` (MemberPane).
    // Share install is `POST …/shared/{token}/install` → `svc.install_share`.
    const callers = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__truth__') walk(p); continue }
        if (!/\.(js|jsx)$/.test(e.name) || /\.test\./.test(e.name)) continue
        const src = fs.readFileSync(p, 'utf8')
        const n = (src.match(/\bsaveUserDefinition\(/g) || []).length
        if (n) callers.push([path.relative(path.join(REPO, 'app/src'), p).replace(/\\/g, '/'), n])
      }
    }
    walk(path.join(REPO, 'app/src'))
    expect(Object.fromEntries(callers)).toEqual({
      'components/chart/builder/BuilderSheet.jsx': 2,
      'hooks/useUserDefinitions.js': 1, // the declaration
    })
    const sheet = read('app/src/components/chart/builder/BuilderSheet.jsx')
    expect(sheet).toContain('const attachPine = useCallback(async (definition, options = null) => {')
    expect(sheet).toMatch(/saveUserDefinition\(definition, null, importTelemetryRef\.current,\s*options && options\.previewAcked === true \? \{ previewAcked: true \} : null\)/)
  })
})

describe('HTF fold note — a human heading, never the channel key', () => {
  it('DISCLOSED DIFFERENCE — ASKED weekly request.security lookahead off; CLAIMED heading `htfLookaheadOffStepBacks` (BEFORE); DID human label', () => {
    const r = inspectSource('//@version=5\nindicator("t")\nplot(request.security(syminfo.tickerid, "W", close))\n')
    const names = r.outputs.flatMap((o) => (o.vendorNotes || []).map((v) => v.name))
    expect(names).toContain('htfLookaheadOffStepBacks')
    expect(noteHeading('htfLookaheadOffStepBacks')).toBe('Higher-timeframe timing differs from TradingView')
  })

  it('every fold channel that declares a member sentence also declares a label (no raw key can print)', () => {
    expect(Object.keys(FOLD_LABELS).sort()).toEqual(Object.keys(FOLD_NOTES).sort())
    for (const k of Object.keys(FOLD_NOTES)) expect(noteHeading(k)).not.toBe(k)
  })

  it('the note BODIES are unchanged and a non-fold name passes through', () => {
    expect(FOLD_NOTES.htfLookaheadOffStepBacks).toBe(TABLE._folds.htfLookaheadOffStepBacks.memberNote)
    expect(noteHeading('ta.rsi')).toBe('ta.rsi')
    expect(noteHeading('alertcondition')).toBe('alertcondition')
    expect(foldLabelsOf({ _folds: { x: { memberNote: 'n' } } })).toEqual({})
  })

  it('persisted disclosures keep their {name, note} shape (no persistence change)', () => {
    const built = memberPaneDefinition({ source: '//@version=5\nindicator("t")\nplot(request.security(syminfo.tickerid, "W", close))\n', id: 'u_member-pane' })
    if (built.ok) {
      for (const d of built.definition.meta.disclosures || []) {
        expect(Object.keys(d).sort()).not.toContain('label')
      }
    }
  })
})
