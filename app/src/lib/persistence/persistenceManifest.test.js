// TERM-076 (FB-A12-02) — every persisted member setting is DECLARED, and its device-local vs
// cross-device scope is DERIVED from the store its code actually uses.
//
// ⛔ WHAT THIS RAIL IS FOR. Some of a member's work follows the account and some follows the
// browser, and nobody decided which — "an accident of implementation order, not a decision".
// The Settings card "What syncs across your devices" publishes the answer, and it renders FROM
// `persistenceManifest.json`. This rail keeps that manifest honest in both directions:
//
//   * a key the code persists that the manifest does not list    → red, BY NAME ("undeclared")
//   * a key the manifest lists that nothing persists any more    → red, BY NAME ("stale")
//   * a key whose files/scope moved since the manifest was built → red, BY NAME ("drifted")
//
// ⭐ THE FIX IS ONE LINE, AND EVERY FAILURE PRINTS IT: `node tools/persistence_census.mjs --write`
// (then give a new key its surface/label/kind). This is a ratchet over something every frontend
// lane adds routinely, so a failure that does not say how to clear it would fail OTHER lanes'
// work with no way forward.
//
// ⛔ KEYS PLANTED BY TESTS DO NOT COUNT. `*.test.*`, `__tests__/`, `__fixtures__/`, `test-setup`
// and `app/src/testing/**` (the dev-harness pages) persist fixtures, not a member's setting.
//
// ⚠️ THE SERVER HALF IS A PYTHON RAIL. Some preference keys are written server-side only, and
// the authority for them is `_PREFERENCE_KEYS` in `api/routers/auth.py`, which only Python's
// `ast` can read. `tests/test_persistence_manifest_server_keys.py` owns that comparison; here a
// server-preference row with no client files is trusted to it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  census, repoSources, diffManifest, buildManifest, isTestFile, FIX_LINE, STORE_SCOPE,
} from '../../../../tools/persistence_census.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST = JSON.parse(readFileSync(path.join(HERE, 'persistenceManifest.json'), 'utf8'))

// One census of the real tree, shared by every case below.
const REAL = census(repoSources())

const findEntry = (store, key) => REAL.entries.find((e) => e.store === store && e.key === key)

/** A needle nobody could have typed into the tree: built by concatenation at run time, so the
 *  literal never exists in any source file — including this one. */
const NEEDLE = ['uct', 'term076', 'needle', String(Date.now())].join('.')

describe('the persistence census sees the tree before anything is compared', () => {
  // ── NON-VACUITY, FIRST. An empty census satisfies every "nothing undeclared" assertion. A census
  // that parsed nothing, or whose resolver silently stopped following imports, must go red HERE.
  it('scans the whole of app/src and parses every file', () => {
    expect(REAL.files).toBeGreaterThan(1000)
    expect(REAL.parseErrors).toEqual([])
  })

  it('finds known keys in every store, including ones only reachable through imports and wrappers', () => {
    // plain literal · module constant · imported constant through a JSX prop · IndexedDB · server pref
    expect(findEntry('localStorage', 'uct.watchlist.cols')?.files).toContain('app/src/pages/Watchlists.jsx')
    expect(findEntry('localStorage', 'uct-chart-drawings')).toBeTruthy()
    expect(findEntry('localStorage', 'uct.watchlist.cols.breadthDrill')).toBeTruthy()
    expect(findEntry('sessionStorage', 'uct.review.session')).toBeTruthy()
    expect(findEntry('indexedDB', 'uct_notebook_*/outbox')).toBeTruthy()
    expect(findEntry('server-preference', 'chart_settings')).toBeTruthy()
    expect(findEntry('server-preference', 'tracings_doc')).toBeTruthy()
  })

  it('classifies every storage-shaped call and resolves every key', () => {
    expect(REAL.unresolved).toEqual([])
    const notWeb = new Set(MANIFEST.notWebStorage)
    expect(REAL.unclassified.filter((u) => !notWeb.has(`${u.file}#${u.fn}`))).toEqual([])
  })
})

describe('the manifest is current', () => {
  const problems = diffManifest(REAL, MANIFEST)

  it('declares every key the code persists (fix: ' + FIX_LINE + ')', () => {
    expect(problems.undeclared).toEqual([])
  })

  it('lists nothing the code no longer persists', () => {
    expect(problems.stale).toEqual([])
  })

  it('records the files and scope the code actually uses', () => {
    expect(problems.drifted).toEqual([])
  })

  it('names every entry for members (surface, label, kind)', () => {
    expect(problems.unnamed).toEqual([])
  })

  it('derives scope from store for every entry — never typed', () => {
    for (const e of MANIFEST.entries) expect(e.scope, `${e.store}:${e.key}`).toBe(STORE_SCOPE[e.store])
  })
})

describe('the rail can fail, and fails by name', () => {
  const planted = (file, src) => census([...repoSources().filter((f) => f.path !== file), { path: file, src }])

  it('CONTROL: a new localStorage key in a shipped file is reported by name, with the fix', () => {
    const r = planted('app/src/pages/__term076Probe.jsx', `export const K = '${NEEDLE}'\nexport function f() { localStorage.setItem(K, '1') }`)
    const p = diffManifest(r, MANIFEST)
    const line = p.undeclared.find((l) => l.includes(`'${NEEDLE}'`))
    expect(line).toBeTruthy()
    expect(line).toContain('app/src/pages/__term076Probe.jsx:2')
    expect(line).toContain(FIX_LINE)
  })

  it('does not count a key planted by a TEST file', () => {
    expect(isTestFile('app/src/pages/Foo.test.jsx')).toBe(true)
    expect(isTestFile('app/src/testing/device/steps.js')).toBe(true)
    expect(isTestFile('app/src/pages/journal-2-0/lib/offline/__fixtures__/x.js')).toBe(true)
    expect(isTestFile('app/src/pages/Foo.jsx')).toBe(false)
    const shipped = repoSources().filter((f) => f.path.endsWith('.test.js')).length
    expect(shipped).toBe(0)
  })

  it('does not count a storage call that exists only in a comment or a string', () => {
    const src = [
      `// localStorage.setItem('${NEEDLE}', '1')`,
      `/* sessionStorage.getItem('${NEEDLE}') */`,
      `export const prose = "localStorage.setItem('${NEEDLE}', '1')"`,
    ].join('\n')
    const r = census([{ path: 'app/src/x.js', src }])
    expect(r.entries).toEqual([])
    // …while the identical call as CODE is seen — the control that makes the line above mean something.
    const live = census([{ path: 'app/src/x.js', src: `localStorage.setItem('${NEEDLE}', '1')` }])
    expect(live.entries.map((e) => e.key)).toEqual([NEEDLE])
  })

  it('reports a declared key that nothing persists any more as stale, by name', () => {
    const extra = { key: NEEDLE, store: 'localStorage', scope: 'device-local', surface: 'x', kind: 'state', label: 'x', files: ['app/src/x.js'] }
    const p = diffManifest(REAL, { ...MANIFEST, entries: [...MANIFEST.entries, extra] })
    expect(p.stale.some((l) => l.includes(`'${NEEDLE}'`) && l.includes(FIX_LINE))).toBe(true)
  })

  it('a key moved from localStorage to the account preference flips from device-local to cross-device', () => {
    const before = census([{ path: 'app/src/p.jsx', src: `export default function P() { localStorage.setItem('probe_key', '1') }` }])
    const after = census([{ path: 'app/src/p.jsx', src: `export default function P({ setPref }) { setPref('probe_key', '1') }` }])
    const scopeOf = (r) => buildManifest(r, [], null).entries.find((e) => e.key === 'probe_key').scope
    expect(scopeOf(before)).toBe('device-local')
    expect(scopeOf(after)).toBe('cross-device')
  })
})
