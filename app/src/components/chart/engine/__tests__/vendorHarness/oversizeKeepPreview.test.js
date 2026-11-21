// app/src/components/chart/engine/__tests__/vendorHarness/oversizeKeepPreview.test.js
//
// ⭐⭐ ITEM 2 (2026-11-21, coordinator ruling) — THE PREVIEW OF A SCRIPT THE STORE CANNOT HOLD STAYS THE HOST PICTURE.
// vdubus-pattern-gen-v2's host document is past the store's 64 KiB cap; Add keeps its runtime-lane document instead
// (`memberPaneDefinition.js::withOversizeKeep`, `oversizeKeep.test.jsx`). What the member PREVIEWS is untouched:
// graded on the runtime-on lane exactly as `vendorHarness.corpus.test.js` arms it, the committed RDDT capture is a
// MATCH drawn by the HOST door.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
const { __permitRuntimePaneForTests } = await import('../../runtimePaneGate')
const { __allowEveryRuntimeScriptForTests } = await import('../../runtimeKill')
const { __admitEveryRunHalfForTests } = await import('../../runHalfRailSeam')
const { __serveEveryTimeframeSettingForTests } = await import('../../runtime/runtimeInputs.js')
const { memberDoorsAtCollection } = await import('../../../../../testing/runtimeGate')
const { runHarness, REPO } = await import('./harness')

describe('⭐⭐ ITEM 2 — the oversize script\'s preview', () => {
  it('K13 — vdubus RDDT 1D (committed): MATCH, drawn by the host door', () => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    __admitEveryRunHalfForTests()
    __serveEveryTimeframeSettingForTests()
    memberDoorsAtCollection({ hkd: true })
    const run = runHarness([path.join(REPO, 'tests/fixtures/vendor/harness/vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28.json')])
    expect(run.results).toHaveLength(1)
    const [r] = run.results
    expect(r.verdict, r.reason).toBe('MATCH')
    expect(r.ourDoor).toBe('host')
    expect(r.objects && r.objects.verdict).toBe('MATCH')
  }, 240000)
})
