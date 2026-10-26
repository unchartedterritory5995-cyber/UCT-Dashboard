// @vitest-environment node
// F-FE-1 F2 (ruling W11-R34): the key the adoption sheet sends on Use and Adopt is the one the SERVER reads, read from
// the server's own source, never restated in a test: the header name (`template_gallery.IDEMPOTENCY_HEADER`), the
// three doors that pass it on (`key=_key(request)`), and the in-flight refusal the client must treat as unsettled
// (a 409 `conflict`, whose retry reuses the key so the server answers the first request's note).
//
// The server files land on the backend branch and reach this branch at the be -> impl merge. Until then the source is
// read from that branch with `git show`, never skipped (SharePreviewSheet.server.test.js's reader: GIT_* scrubbed,
// CRLF tolerated). After the merge the working tree holds it and git is not consulted.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { useTemplate, adoptTemplate, adoptTool, answerSettled } from './templateLibrary'

const REPO = path.resolve(__dirname, '../../../../..')
const BE_BRANCH = 'origin/feat/notebook-widgets-p2-be'
const GALLERY_PY = 'api/services/journal_two/template_gallery.py'
const ROUTER_PY = 'api/routers/notebook_template_gallery.py'

function serverSource(rel, marker) {
  const abs = path.join(REPO, rel)
  const local = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
  if (marker.test(local)) return local
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
  return execFileSync('git', ['-C', REPO, 'show', `${BE_BRANCH}:${rel}`], { env, encoding: 'utf8' })
}

const gallery = serverSource(GALLERY_PY, /^IDEMPOTENCY_HEADER = /m)
const router = serverSource(ROUTER_PY, /^def _key\(/m)
const headerName = /^IDEMPOTENCY_HEADER = "([^"]+)"\r?$/m.exec(gallery)?.[1]

/** The body of one `def <name>(` in the router: up to the next top-level decorator or def. */
const routeBody = (name) => {
  const at = router.search(new RegExp(`^def ${name}\\(`, 'm'))
  if (at < 0) return ''
  const rest = router.slice(at + 1)
  const end = rest.search(/^(?:@|def )/m)
  return end < 0 ? rest : rest.slice(0, end)
}

let fetchMock
beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  globalThis.fetch = fetchMock
})

describe("the Use and Adopt key is the server's", () => {
  it('NON-VACUITY: the server sources were read', () => {
    expect(gallery).toMatch(/^def use_library_template\(/m)
    expect(router).toMatch(/^def _key\(request: Request\)/m)
    expect(headerName).toBeTruthy()
  })

  it.each([
    ['useTemplate', () => useTemplate('g1', {})],
    ['adoptTemplate', () => adoptTemplate('g1', {})],
    ['adoptTool', () => adoptTool('g1', {})],
  ])('%s sends it under template_gallery.IDEMPOTENCY_HEADER', async (_n, run) => {
    await run()
    const headers = fetchMock.mock.calls[0][1].headers
    expect(Object.keys(headers)).toContain(headerName)
    expect(headers[headerName]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('the router reads that header and every keyed door passes it on as key=', () => {
    expect(routeBody('_key')).toMatch(/request\.headers\.get\(gallery\.IDEMPOTENCY_HEADER\)/)
    // The three doors this client keys: use-template, adopt-tool, and a template's adopt.
    expect(router).toMatch(/@router\.post\("\/\{gallery_id\}\/use-template"/)
    expect(router).toMatch(/@router\.post\("\/\{gallery_id\}\/adopt-tool"/)
    expect(router).toMatch(/@router\.post\("\/\{gallery_id\}\/adopt", /)
    for (const fn of ['adopt_tool_endpoint', 'use_template_endpoint', 'adopt_endpoint']) {
      expect(routeBody(fn), fn).toMatch(/key=_key\(request\)/)
    }
  })

  it("the in-flight refusal is a codeless GalleryConflict, answered 409 'conflict': the client treats it as unsettled", () => {
    expect(gallery).toMatch(/raise GalleryConflict\(S_KEY_IN_FLIGHT\)/)
    expect(router).toMatch(/except gallery\.GalleryConflict as e:\s*\r?\n\s*raise _err\(409, getattr\(e, "code", None\) or "conflict", str\(e\)\)/)
    expect(answerSettled({ ok: false, code: 'conflict', message: 'x' })).toBe(false)
    expect(answerSettled({ ok: false, code: 'unresolved', message: 'x' })).toBe(true)
    expect(answerSettled({ ok: true, data: {} })).toBe(true)
  })
})
