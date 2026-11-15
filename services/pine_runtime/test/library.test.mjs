// U15 Phase A rail: a runtime document's libraries on the service. The web server reads them from
// its own store (pinned by the document's `meta.libraries`) and sends them with the request; the
// protocol recomputes each sha256, and the job adapter holds the run to the document's pins and
// registers exactly those entries for that one run. Every library here is a test fixture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { parseRunRequest, INTEGRITY_GUARD, SCHEMA_GUARD, MAX_LIBRARIES } from '../protocol.mjs'
import { libraryRefusalOf, runJob, LIBRARY_CHANGED_GUARD, LIBRARY_ABSENT_GUARD } from '../job.mjs'
import { DOOR, validRequest } from './helpers.mjs'
import { buildRealBundle } from './poolFixtures.mjs'
import { pathToFileURL } from 'node:url'

const LIB = '//@version=5\nlibrary("pinlib")\nexport twice(float x) => x * 2\n'
const sha = (t) => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex')
const entry = (o = {}) => ({ path: 'tester/pinlib/1', source: LIB, sha256: sha(LIB), licence: 'MPL-2.0', attribution: 'pinlib (test fixture)', ...o })
const withLibraries = (libraries) => {
  const r = validRequest()
  r.definition.libraries = libraries
  return Buffer.from(JSON.stringify(r))
}

test('protocol: the libraries a request carries are validated, and each sha256 is recomputed here', () => {
  const ok = parseRunRequest(withLibraries([entry()]), DOOR)
  assert.equal(ok.ok, true, ok.sentence)
  assert.deepEqual(ok.request.definition.libraries.map((e) => e.path), ['tester/pinlib/1'])
  // control: a request with none carries no key at all
  const none = parseRunRequest(Buffer.from(JSON.stringify(validRequest())), DOOR)
  assert.equal(none.ok, true)
  assert.equal('libraries' in none.request.definition, false)
  // a source whose sha256 is not the one sent is integrity: nothing is computed
  const bad = parseRunRequest(withLibraries([entry({ sha256: sha('other') })]), DOOR)
  assert.equal(bad.ok, false)
  assert.equal(bad.guard, INTEGRITY_GUARD)
  for (const [why, libs] of [
    ['an empty list', []],
    ['too many', Array.from({ length: MAX_LIBRARIES + 1 }, (_, i) => entry({ path: `tester/pinlib/${i + 1}` }))],
    ['a bad path', [entry({ path: '../x/1' })]],
    ['a repeated path', [entry(), entry()]],
    ['an unknown key', [{ ...entry(), extra: 1 }]],
    ['no licence', [entry({ licence: '' })]],
  ]) {
    const r = parseRunRequest(withLibraries(libs), DOOR)
    assert.equal(r.ok, false, why)
    assert.equal(r.guard, SCHEMA_GUARD, `${why}: ${r.sentence}`)
  }
})

/** A bundle stand-in for the registry calls. */
function registryRt() {
  const rt = { registered: [], clears: 0,
    registerPineLibrary(e) { rt.registered.push(e.path); return e },
    clearPineLibraries() { rt.clears += 1; rt.registered = [] } }
  return rt
}
const docPinned = (s = sha(LIB)) => ({ id: 'u_x', compute: {}, meta: { libraries: [{ path: 'tester/pinlib/1', sha256: s }] } })

test('job: a pin met by an entry of that path and sha registers exactly that entry', () => {
  const rt = registryRt()
  assert.equal(libraryRefusalOf(rt, docPinned(), [entry(), entry({ path: 'tester/unpinned/1' })]), null)
  assert.deepEqual(rt.registered, ['tester/pinlib/1'], 'an entry no pin names is not registered')
  assert.ok(rt.clears >= 1, 'the registry is cleared before the run')
})

test('job: a pin the request does not meet refuses the run by name', () => {
  const rt = registryRt()
  const changed = libraryRefusalOf(rt, docPinned(sha('other code')), [entry()])
  assert.equal(changed.guard, LIBRARY_CHANGED_GUARD)
  assert.match(changed.sentence, /is not the code the document was saved against/)
  const absent = libraryRefusalOf(rt, docPinned(), [])
  assert.equal(absent.guard, LIBRARY_ABSENT_GUARD)
  // control: a document with no pins asks nothing and registers nothing
  const free = registryRt()
  assert.equal(libraryRefusalOf(free, { id: 'u', compute: {}, meta: {} }, [entry()]), null)
  assert.deepEqual(free.registered, [])
})

test('job: a bundle without the registry fails closed on a pinned document (and serves an unpinned one)', () => {
  const bare = {}
  assert.equal(libraryRefusalOf(bare, docPinned(), [entry()]).guard, LIBRARY_ABSENT_GUARD)
  assert.equal(libraryRefusalOf(bare, { id: 'u', compute: {}, meta: {} }, []), null)
})

test('the REAL bundle exports the registry the job adapter registers into', async () => {
  const real = await buildRealBundle()
  try {
    const rt = await import(pathToFileURL(real.outfile).href)
    assert.equal(typeof rt.registerPineLibrary, 'function')
    assert.equal(typeof rt.clearPineLibraries, 'function')
    assert.equal(libraryRefusalOf(rt, docPinned(), [entry()]), null)
    rt.clearPineLibraries()
  } finally {
    real.cleanup()
  }
})

test('job: a refused run never reaches the bundle, and the registry is cleared after every run', () => {
  const rt = { ...registryRt(), RUNTIME_FAILED_GUARD: 'runtime:failed', calls: 0,
    computeRuntimeColumns() { rt.calls += 1; throw new Error('not reached') },
    resetRuntimeSessions() {}, resetRuntimeLedgers() {} }
  rt.registerPineLibrary = (e) => e
  let clears = 0
  rt.clearPineLibraries = () => { clears += 1 }
  const job = { job: 'A|D', tf: 'D', symbol: { ticker: 'A', exchange: 'NYSE' }, ctx: { runtimeInputs: {} },
    bars: { n: 1, t: [1], o: [1], h: [1], l: [1], c: [1], v: [1] }, want: [] }
  const out = runJob(rt, docPinned(sha('other code')), job, () => 0, [entry()])
  assert.equal(out.status, 'withheld')
  assert.equal(out.refusals[0].guard, LIBRARY_CHANGED_GUARD)
  assert.equal(rt.calls, 0)
  assert.ok(clears >= 2, 'cleared before and after the run')
})
