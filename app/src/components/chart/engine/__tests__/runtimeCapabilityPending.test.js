// app/src/components/chart/engine/__tests__/runtimeCapabilityPending.test.js
//
// ─── WS-I PART 2 (final verify of #1204) — A ROW THE SERVER IS STILL CHECKING ─────
//
// With runtime capability admission on, a stored row whose capability set the server has not
// computed yet (its detector gate was busy, or the request's budget was spent) is served
// `meta.runtimeNotGraded` (the "still being checked" sentence) beside `meta.runtimePending: true`.
//   * the install door refuses it like any ungraded row, but says it is BEING CHECKED and will
//     draw once the check completes, never "comes back when it is taken off the list";
//   * the definitions list is read again on a timer ONLY while such a row exists, so it draws
//     once the check completes (`useUserDefinitions.pendingRefreshInterval`); otherwise there is
//     no periodic read, as before.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import * as registry from '../nativeRegistry'
import { latchRuntimePanePermission, __resetRuntimePanePermission } from '../runtimePaneGate'
import { pendingRefreshInterval, PENDING_REFRESH_MS } from '../../../../hooks/useUserDefinitions'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'runtime_documents', 'documents.json')
const adx = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).documents
  .find((d) => d.slug === 'adx-and-di-for-v4').definition

const PENDING_SENTENCE = 'this script (sha256 0123456789ab…) is still being checked against the parts of Pine '
  + 'graded against TradingView, so it is not drawn bar by bar yet'

function installWith(meta) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
  const d = adx()
  d.meta = { ...d.meta, ...meta }
  try {
    return registry.installUserDefinitions([d])
  } finally {
    registry.uninstallUserDefinition(d.id)
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  __resetRuntimePanePermission()
})

describe('the install door words a pending row as being checked', () => {
  it('⭐ pending: refused, and "it will draw once the check completes"', () => {
    const r = installWith({ runtimeNotGraded: PENDING_SENTENCE, runtimePending: true })
    expect(r.installed).toEqual([])
    const msg = r.errors.join('\n')
    expect(msg).toMatch(/it is being checked, and it will draw once the check completes\./)
    expect(msg).not.toMatch(/taken off the list/)
  })

  it('⛔ not pending (an ungraded row, or a killed one): the list sentence, as before', () => {
    for (const meta of [
      { runtimeNotGraded: 'this script (sha256 x…) has not yet been graded against TradingView, so it is not drawn bar by bar' },
      { runtimeKilled: 'on the kill list', runtimeNotGraded: PENDING_SENTENCE, runtimePending: true },
      { runtimeNotGraded: PENDING_SENTENCE, runtimePending: 'true' },
    ]) {
      const msg = installWith(meta).errors.join('\n')
      expect(msg).toMatch(/it comes back when it is taken off the list\./)
      expect(msg).not.toMatch(/being checked, and it will draw/)
    }
  })
})

describe('the definitions list re-reads ONLY while a row is pending', () => {
  const row = (meta) => ({ def_id: 'u_aaaaaaaaaaaa', definition: { meta } })

  it('⭐ a pending row: every PENDING_REFRESH_MS', () => {
    expect(PENDING_REFRESH_MS).toBe(15000)
    expect(pendingRefreshInterval([row({}), row({ runtimeNotGraded: PENDING_SENTENCE, runtimePending: true })]))
      .toBe(PENDING_REFRESH_MS)
  })

  it('⛔ nothing pending (or no data): no periodic read, as before', () => {
    expect(pendingRefreshInterval(undefined)).toBe(0)
    expect(pendingRefreshInterval([])).toBe(0)
    expect(pendingRefreshInterval([row({ runtimeNotGraded: 'not graded' })])).toBe(0)
    expect(pendingRefreshInterval([row({ runtimePending: true })])).toBe(0)       // no sentence: not pending
  })

  it('the hook passes it to SWR (wired, not just defined)', () => {
    const src = fs.readFileSync(path.join(REPO, 'app', 'src', 'hooks', 'useUserDefinitions.js'), 'utf8')
    expect(src).toMatch(/refreshInterval:\s*pendingRefreshInterval/)
  })
})
