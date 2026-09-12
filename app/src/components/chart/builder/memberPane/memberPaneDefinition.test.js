// app/src/components/chart/builder/memberPane/memberPaneDefinition.test.js
//
// ─── ⭐⭐ T3 — A MEMBER'S SCRIPT REACHES THE BINDER, MEASURED ────────────────
//
// Not "the function returns an object": the document is handed to the SHIPPED
// install door (`nativeRegistry.installUserDefinitions`) and then to the SHIPPED
// instance door (`instanceControls.addInstance`), because a document that
// validates and cannot be installed is a document nobody can draw — and this
// repo has shipped exactly that shape before.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../engine/nativeRegistry'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { validateDefinition } from '../../engine/defSchema'
import { translatePine } from '../../engine/ast/pine'
import {
  memberPaneDefinition, memberPaneVariants,
  MEMBER_PANE_HEIGHT, MEMBER_PANE_DEF_PREFIX,
} from './memberPaneDefinition'

const REPO = path.resolve(process.cwd(), '..')
const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

const installed = []
const install = (def) => {
  const { installed: got } = registry.installUserDefinitions([def])
  if (got.length) installed.push(def.id)
  return got
}
afterEach(() => {
  while (installed.length) registry.uninstallUserDefinition(installed.pop())
})

describe('⭐⭐ Volume v2 becomes a definition a pane can bind', () => {
  it('builds, validates, installs, and takes an instance', () => {
    const r = memberPaneDefinition({ source: V2, id: `${MEMBER_PANE_DEF_PREFIX}-t` })
    expect(r.reason).toBe(null)
    expect(r.ok).toBe(true)

    // ⛔ THE SCHEMA'S OWN VERDICT, not this test's opinion of the shape.
    expect(validateDefinition(r.definition).ok).toBe(true)
  })

  it('⛔⛔ …and the SHIPPED INSTALL DOOR still refuses it — `resolve:window`', () => {
    // ⚰️⚰️ THE BLOCKER T3 FOUND, MEASURED RATHER THAN ASSUMED AWAY. The document
    // validates and cannot be installed:
    //
    //   compute.trees.out2: refused at registration by "resolve:window" —
    //   sma argument 1 must be a whole number of at least 1, got
    //   {op ?: [series isweekly, num 50, num 50]}
    //
    // That ternary is `timeframe.isweekly ? lenWeekly : lenDaily` — the EXACT
    // pattern `closedTable.json::_bind_time_constants` exists for. It folds at
    // BIND time, when a timeframe is known; registration has no binding, so
    // `interpret.js::maxLookback` → `ownLookback` → `windowLiteral` refuses.
    //
    // ⛔ AND THE TWO AUTHORITIES OVER "HOW FAR BACK DOES THIS TREE REACH"
    // DISAGREE. `lint.js::maxLookback` HAS the bind-foldable branch
    // (`bindFoldableWindowMax`, taking the MAX of the arms — over-claiming, the
    // safe direction) and its own comment warns about exactly this split:
    // "the door would defer, the linter would bound, and the member would get a
    // number nothing produced". `interpret.js::maxLookback` and the Python
    // mirror `ast_interpret._own_lookback` do not have it.
    //
    // ⚠️ THIS TEST PINS THE DEFECT, NOT THE DESIRED END STATE. Teaching
    // `ownLookback` the same fold WIDENS what a member may install, which is a
    // product decision and is not on file. When it is ruled, this case is the
    // one that goes red and names itself.
    const r = memberPaneDefinition({ source: V2, id: `${MEMBER_PANE_DEF_PREFIX}-i` })
    expect(r.ok).toBe(true)
    const { installed: got, errors } = registry.installUserDefinitions([r.definition])
    expect(got).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('resolve:window')
    expect(errors[0]).toContain('isweekly')
  })

  it('⭐ a script the door DOES admit reaches `indicatorInstances`', () => {
    // ⛔ THE NON-VACUITY OF THE WHOLE WIRING. Without a script that installs,
    // "the pane path works" would rest entirely on a case that refuses, and a
    // broken `addInstance` call would never be exercised.
    const r = memberPaneDefinition({
      source: '//@version=6\nindicator("plain", overlay = false)\nplot(sma(close, 20), title = "SMA")\n',
      id: `${MEMBER_PANE_DEF_PREFIX}-p`,
    })
    expect(r.ok).toBe(true)
    expect(install(r.definition)).toHaveLength(1)

    // ⛔ THE SHIPPED INSTANCE DOOR — `addInstance` is what `PreviewPane` uses,
    // and it is the step that puts the definition in `indicatorInstances` where
    // the binder looks for it.
    const stored = addInstance(
      { ...mergeChartSettings({}), indicatorInstances: [], indicators: {} },
      r.definition.id, registry)
    const list = stored.indicatorInstances
    expect(Array.isArray(list)).toBe(true)
    expect(list).toHaveLength(1)
    expect(list[0].defId).toBe(r.definition.id)
    expect(typeof list[0].instanceId).toBe('string')
  })

  it('⭐ the four drawable series, and the pane the author asked for', () => {
    const r = memberPaneDefinition({ source: V2 })
    expect(r.definition.plots.filter((p) => p.style !== 'hlines').map((p) => p.label))
      .toEqual(['Volume', 'Avg Vol Columns', 'Avg Vol Line', 'Scale Padding'])
    // ⛔⛔ FOUR, NOT FIVE — ruling D1. The fifth output is `HVE Trigger`, an
    // `alertcondition`, which draws nothing in Pine. Plotting it would put a 0/1
    // square wave on a volume scale beside four real series.
    expect(r.translation.outputs).toHaveLength(5)
    expect(r.translation.outputs[4].kind).toBe('alertcondition')
    // `indicator(..., overlay = false)` ⇒ its own sub-pane, a quarter high.
    expect(r.definition.placement).toEqual({
      target: 'pane', pane: { height: MEMBER_PANE_HEIGHT },
    })
    expect(MEMBER_PANE_HEIGHT).toBeGreaterThan(0)
    expect(MEMBER_PANE_HEIGHT).toBeLessThan(1)
  })

  it('⭐ and the member is told where the alert went', () => {
    const r = memberPaneDefinition({ source: V2 })
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0].note).toContain("'HVE Trigger'")
    expect(r.notes[0].note).toContain('not drawn on the chart')
  })

  it('⛔ an overlay script gets the PRICE pane, not a sub-pane', () => {
    // Without this, "placement is a pane at 0.25" is equally satisfied by a
    // function that ignores the declaration and hard-codes one answer.
    const r = memberPaneDefinition({
      source: '//@version=6\nindicator("ov", overlay = true)\nplot(sma(close, 20))\n',
    })
    expect(r.ok).toBe(true)
    expect(r.definition.placement).toEqual({ target: 'price' })
  })
})

describe('⛔⛔ the gate is the pane gate, not a second opinion about it', () => {
  it('a screener-lane translation is refused even though it says ok:true', () => {
    const screen = translatePine(V2, {})
    expect(screen.ok).toBe(true)
    const r = memberPaneDefinition({ source: V2, translation: screen })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('screener lane')
    expect(r.definition).toBe(null)
  })

  it('a refused script yields a REASON, never a throw and never a blank', () => {
    const r = memberPaneDefinition({
      source: '//@version=6\nindicator("x")\nplot(request.security(syminfo.tickerid, "60", close))\n',
    })
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:request')
    expect(String(r.reason).length).toBeGreaterThan(0)
  })

  it('⛔ CONTROL: junk in, a reason out', () => {
    for (const s of [null, undefined, '', '   ', 42]) {
      const r = memberPaneDefinition({ source: s })
      expect(r.ok).toBe(false)
      expect(r.reason).toBeTruthy()
    }
  })
})

describe('⭐⭐ two panes of one script that differ by a parameter', () => {
  it('two definitions, two trees, one source', () => {
    // ⛔ TWO DEFINITIONS, NOT TWO INSTANCES, AND THAT IS THE FINDING. A folded
    // `input.int` becomes an IMMUTABLE parameter baked into the tree with
    // locators pointing at it — not a `defSchema` input an instance carries a
    // value for. `applyParamEdit` rewrites the literal and returns a NEW
    // definition. Varying a folded parameter therefore costs a definition.
    const v = memberPaneVariants({
      source: V2, paramId: '__uct_param_2', values: [50, 10],
    })
    expect(v.reason).toBe(null)
    expect(v.ok).toBe(true)
    expect(v.variants).toHaveLength(2)
    const [a, b] = v.variants
    expect(a.definition.id).not.toBe(b.definition.id)
    // The trees really differ — the whole point.
    expect(JSON.stringify(a.definition.compute.trees))
      .not.toBe(JSON.stringify(b.definition.compute.trees))
    // …and both are still valid documents. ⚠️ NOT `install`ed here: v2 is held
    // out of the registry by the `resolve:window` blocker above, which is a
    // property of the SCRIPT and not of the variant mechanism.
    for (const x of v.variants) {
      expect(validateDefinition(x.definition).ok).toBe(true)
    }
  })

  it('⛔⛔ `lookbackBarsHVE` CANNOT vary this pane, and the reason is named', () => {
    // MEASURED on the real script: `__uct_param_3` appears in the HVE Trigger
    // tree and NOWHERE else. Ruling D1 sends that row to Alerts, so after the
    // pane declines it the knob has no drawn series left to move. A silent
    // success here would install two identical panes and look like it worked.
    const v = memberPaneVariants({
      source: V2, paramId: '__uct_param_3', values: [2500, 500],
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('HVE lookback')
    expect(v.reason).toContain('no series this pane draws')
    // ⛔ AND IT IS NOT SIMPLY UNKNOWN — the script declares it.
    const t = memberPaneDefinition({ source: V2 }).translation
    expect((t.inputParams || []).map((p) => p.id)).toContain('__uct_param_3')
  })
})
