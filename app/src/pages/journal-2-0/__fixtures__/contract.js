/**
 * Contract fixtures: the server's REAL answers for the wave 12 to 15 Notebook routes.
 *
 * Every file under `./contract/` was written by `tools/notebook_contract_fixtures.py`, which
 * asks the real routers (in process, on a temporary database). `tests/test_notebook_contract_fixtures.py`
 * regenerates them and fails when the committed files differ, so a server change that moves a
 * shape forces a deliberate regeneration, and the regenerated file then runs through every
 * frontend test that loads it here.
 *
 * ⛔ NEVER edit a file under `./contract/` by hand, and never copy its contents into a test as
 * a literal. A test that goes red after a regeneration has found a real difference between
 * what the server sends and what the client reads: report both shapes, do not patch either
 * side to make it pass.
 *
 * Test infrastructure only (`__fixtures__`): nothing the app ships imports this.
 */
const files = import.meta.glob('./contract/*.json', { eager: true, import: 'default' })

const clone = (v) => JSON.parse(JSON.stringify(v))

/** Every fixture name on disk, sorted. */
export const contractNames = () => Object.keys(files).map((p) => p.slice('./contract/'.length, -'.json'.length)).sort()

/** One fixture, `{ _contract: {endpoint, case, status, path, ...}, body }`. A fresh copy each
 *  call, so a test that mutates it cannot leak into the next one. An unknown name THROWS: a
 *  typo must never read as "the server sent nothing". */
export function contract(name) {
  const hit = files[`./contract/${name}.json`]
  if (!hit) throw new Error(`No contract fixture named "${name}". Run: python tools/notebook_contract_fixtures.py --list`)
  return clone(hit)
}

/** Just the response body. */
export const contractBody = (name) => contract(name).body

/** The recorded HTTP status. */
export const contractStatus = (name) => contract(name)._contract.status

/** A `fetch` Response stand-in carrying the recorded status and body, for a fake server. */
export function contractResponse(name) {
  const { _contract: meta, body } = contract(name)
  return { ok: meta.status >= 200 && meta.status < 300, status: meta.status, json: async () => clone(body) }
}

/** A response with a body that is not JSON (a proxy's HTML error page), for the paths that
 *  must not render "undefined" when `res.json()` rejects. */
export function nonJsonResponse(status) {
  return { ok: false, status, json: async () => { throw new SyntaxError('Unexpected token < in JSON') } }
}
