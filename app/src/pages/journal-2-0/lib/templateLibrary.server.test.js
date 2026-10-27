// @vitest-environment node
// F-FE-1 F2 (ruling W11-R34): the key the adoption sheet sends on Use and Adopt is the one the SERVER reads, read from
// the server's own source, never restated in a test: the header name (`template_gallery.IDEMPOTENCY_HEADER`), the
// three doors that pass it on (`key=_key(request)`), and the in-flight refusal the client must treat as unsettled
// (a 409 `conflict`, whose retry reuses the key so the server answers the first request's note).
//
// The server files reached this branch at the be -> impl merge, so they are read from the working tree (CRLF
// tolerated); the pre-merge `git show` of the backend branch is gone with the wait it covered.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { useTemplate, adoptTemplate, adoptTool, answerSettled } from './templateLibrary'

const REPO = path.resolve(__dirname, '../../../../..')
const GALLERY_PY = 'api/services/journal_two/template_gallery.py'
const ROUTER_PY = 'api/routers/notebook_template_gallery.py'

const serverSource = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

const gallery = serverSource(GALLERY_PY)
const router = serverSource(ROUTER_PY)
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

  it('m-2: each server refusal settles a press, or not, by the code the router gives it', () => {
    // Read the codes from the router and the service, never retyped: a 503 that means "nothing was done" settles
    // (too_long: the plan ran past its time, refused before any write), the engine's own load and failure do not.
    const code = (re) => re.exec(router)?.[1]
    const tooLong = code(/except wrun\.EngineTooLong as e:\s*\r?\n\s*raise _err\(503, "(\w+)"/)
    const busy = code(/except wrun\.EngineBusy as e:\s*\r?\n\s*raise _err\(503, "(\w+)"/)
    const server = code(/except gallery\.GalleryServerError as e:\s*\r?\n\s*raise _err\(500, "(\w+)"/)
    const inFlight = code(/except gallery\.GalleryConflict as e:\s*\r?\n\s*raise _err\(409, getattr\(e, "code", None\) or "(\w+)"/)
    // A9 / W11-R60: KeyReused and a twice-moved listing answer codes of their own, read from the service's constants.
    const keyReused = /^KEY_REUSED_CODE = "(\w+)"\r?$/m.exec(gallery)?.[1]
    const listingMoved = /^LISTING_MOVED_CODE = "(\w+)"\r?$/m.exec(gallery)?.[1]
    for (const c of [tooLong, busy, server, inFlight, keyReused, listingMoved]) expect(c).toMatch(/^\w+$/)
    // ...and KeyReused really answers it (its class carries the constant, never a retyped string).
    expect(gallery).toMatch(/^class KeyReused\(ToolError\):[\s\S]*?^\s+code = KEY_REUSED_CODE\r?$/m)
    expect(answerSettled({ ok: false, code: tooLong })).toBe(true)
    expect(answerSettled({ ok: false, code: busy })).toBe(false)
    expect(answerSettled({ ok: false, code: server })).toBe(false)
    expect(answerSettled({ ok: false, code: inFlight })).toBe(false)
    // SETTLED ANSWERS (flipped at the be merge): KeyReused is a definite refusal (W11-R44), and a listing that moved
    // twice made nothing and asks for a fresh look (W11-R59/R60); each now has a code of its own, distinct from the
    // in-flight `conflict`, so each settles the press.
    expect(keyReused).toBe('key_reused')
    expect(listingMoved).toBe('listing_moved')
    expect(new Set([keyReused, listingMoved, inFlight]).size).toBe(3)
    expect(answerSettled({ ok: false, code: keyReused, message: 'x' })).toBe(true)
    expect(answerSettled({ ok: false, code: listingMoved, message: 'x' })).toBe(true)
  })

  it("the in-flight refusal is a codeless GalleryConflict, answered 409 'conflict': the client treats it as unsettled", () => {
    expect(gallery).toMatch(/raise GalleryConflict\(S_KEY_IN_FLIGHT\)/)
    expect(router).toMatch(/except gallery\.GalleryConflict as e:\s*\r?\n\s*raise _err\(409, getattr\(e, "code", None\) or "conflict", str\(e\)\)/)
    expect(answerSettled({ ok: false, code: 'conflict', message: 'x' })).toBe(false)
    expect(answerSettled({ ok: false, code: 'unresolved', message: 'x' })).toBe(true)
    expect(answerSettled({ ok: true, data: {} })).toBe(true)
  })
})
