// ⛔⛔ THE MOBILE SHARE DOOR'S STRUCTURAL CONTRACT (Wave L Slice 4).
//
// Three things must agree for a phone share to reach the Notebook, and each of
// them lives in a different kind of file — a static JSON manifest the browser
// reads, a service worker, and the router. Nothing imports anything else, so
// none of it can be kept true by construction. This is the rail that keeps them
// honest, and every assertion here corresponds to a way the door goes silently
// dead: the share sheet stops offering UCT, or offers it and lands nowhere.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'

import { isInsideAuthGuard } from '../../testing/routeNesting'
import { SHARE_ROUTE, SHARE_PARAMS, SHARE_METHOD } from './lib/shareTarget'

// ⛔ DERIVED FROM THIS FILE, NOT FROM `process.cwd()`. The first version used
// the cwd, which is `app/` only when vitest is invoked from there — so the rail
// passed in the normal loop and died with "no tests" under the mutation harness,
// which runs from the repo root. A rail that reports a different answer
// depending on how it was invoked is untested exactly where it matters
// (`lesson_a_capture_that_only_breaks_on_failure`).
const APP = path.resolve(__dirname, '..', '..', '..')     // app/
const PUBLIC = path.join(APP, 'public')
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.json'), 'utf8'))
const SW_SRC = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8')
const APP_SRC = fs.readFileSync(path.join(APP, 'src', 'App.jsx'), 'utf8')

/** Every `self.addEventListener('<name>', …)` the worker registers, by AST.
 *  ⭐ AST, never a grep: `sw.js` explains IN PROSE that it has no fetch handler
 *  ("Intentionally NO fetch handler"), so a text search for `fetch` matches the
 *  comment that promises the opposite of what it would be reporting. */
function swEventNames(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' })
  const names = []
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'CallExpression'
        && n.callee?.type === 'MemberExpression'
        && n.callee.property?.name === 'addEventListener'
        && n.arguments?.[0]?.type === 'Literal') {
      names.push(n.arguments[0].value)
    }
    for (const k of Object.keys(n)) {
      if (k === 'type') continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v)
    }
  }
  walk(ast)
  return names
}

/** PNG width/height straight out of the IHDR header — no image library, and it
 *  reads the FILE rather than trusting the manifest's `sizes` string. */
function pngSize(file) {
  const buf = fs.readFileSync(file)
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452 /* 'IHDR' */) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

describe('the manifest and the module agree about the share contract', () => {
  const st = MANIFEST.share_target

  it('a share target is declared at all', () => {
    expect(st, 'manifest.json has no share_target — the phone door does not exist').toBeTruthy()
  })

  it('⛔ it points at the route the module owns', () => {
    // Hand-typing the path in both places is the second-authority defect: the
    // manifest would keep offering UCT in the share sheet and the share would
    // land on the SPA catch-all, which answers 200 with the app shell — so it
    // would look like the app "just did nothing" rather than like an error.
    expect(st.action).toBe(SHARE_ROUTE)
  })

  it('⛔ the parameter NAMES match the ones the page reads', () => {
    // A drift here is the quietest failure of the lot: the share sheet still
    // offers UCT, the route still loads, and the dialog opens completely empty.
    expect(st.params).toEqual(SHARE_PARAMS)
  })
})

describe('⛔⛔ GET and the service-worker kill switch are ONE decision', () => {
  it('the share target method is GET', () => {
    expect(SHARE_METHOD).toBe('GET')
    expect(MANIFEST.share_target.method).toBe(SHARE_METHOD)
  })

  it('…and `sw.js` still has NO fetch handler', () => {
    // ⛔ THE COUPLING, AND WHY BOTH HALVES ARE IN ONE TEST. A `POST` share
    // target is delivered to the page THROUGH a service worker fetch handler —
    // it cannot work without one. `sw.js` is a deliberate kill switch
    // (2026-04-26): the previous cache-first worker served stale JS/CSS bundles
    // indefinitely after every Railway deploy, so shipped code was invisible to
    // existing members until they cleared site data by hand. Switching this
    // door to POST would mean reintroducing a fetch handler, and the outage
    // class with it, to gain nothing GET does not already do.
    //
    // Asserting them separately would let someone satisfy each in turn; asserted
    // together, "make it POST" fails here and says why.
    const events = swEventNames(SW_SRC)
    expect(events).not.toContain('fetch')
    // ⭐ NON-VACUITY: the same probe SEES the worker's real listeners, so an
    // empty parse cannot pass this for the wrong reason.
    expect(events).toContain('install')
    expect(events).toContain('activate')
  })

  it('the worker still unregisters itself', () => {
    // The other half of the kill switch. If this ever stops being true, the
    // reasoning above about POST needs revisiting rather than quietly inheriting.
    expect(SW_SRC).toContain('registration.unregister()')
  })
})

describe('the PWA is installable, because the share sheet is gated on it', () => {
  it('declares a scope and an id', () => {
    // Without a scope the share target action can be judged out of scope and
    // the whole member is dropped from the manifest.
    expect(MANIFEST.scope).toBe('/')
    expect(MANIFEST.id).toBeTruthy()
    expect(MANIFEST.display).toBe('standalone')
  })

  it('⛔ ships real 192 and 512 PNG icons, verified on disk', () => {
    // An SVG-only icon set is the difference between "installable" and "the
    // share sheet never offers UCT at all" on some Android builds — and this
    // door only exists once the app is installed. The manifest's `sizes` string
    // is a claim; the IHDR header is the fact.
    for (const want of [192, 512]) {
      const icon = MANIFEST.icons.find((i) => i.sizes === `${want}x${want}` && i.purpose === 'any')
      expect(icon, `no ${want}x${want} "any" icon declared`).toBeTruthy()
      const size = pngSize(path.join(PUBLIC, icon.src.replace(/^\//, '')))
      expect(size, `${icon.src} is missing or not a PNG`).toBeTruthy()
      expect(size).toEqual({ w: want, h: want })
    }
  })

  it('⭐ ships a SEPARATE maskable icon', () => {
    // Android crops a maskable icon to the inner safe zone under a
    // launcher-chosen shape. Declaring one file as both `any` and `maskable`
    // means one of the two is wrong — full-bleed gets its edges cropped, or the
    // padded version renders shrunken in the tab. `tools/gen_pwa_icons.py`
    // renders them as two different pictures on purpose.
    const maskable = MANIFEST.icons.find((i) => i.purpose === 'maskable')
    expect(maskable, 'no maskable icon — the installed launcher icon will be cropped').toBeTruthy()
    expect(maskable.purpose).not.toContain('any')
    expect(pngSize(path.join(PUBLIC, maskable.src.replace(/^\//, '')))).toEqual({ w: 512, h: 512 })
  })
})

describe('the landing route is registered, and OUTSIDE the auth guard', () => {
  it('App.jsx routes the share path', () => {
    expect(APP_SRC).toContain(`<Route path="${SHARE_ROUTE}"`)
  })

  it('⛔ …and it is NOT nested inside AuthGuard', () => {
    // AuthGuard redirects an unauthenticated visitor to /login keeping NO record
    // of the destination, so a share landing inside it loses the member's
    // article the moment their session has lapsed — the likeliest case on a
    // phone that has not opened UCT in weeks. The page owns that case itself.
    expect(isInsideAuthGuard(APP_SRC, SHARE_ROUTE)).toBe(false)
  })

  it('⭐ the probe can tell the two apart (non-vacuity, both directions)', () => {
    // Without this, `false` above could mean "outside the guard" OR "the walker
    // found nothing" OR "no element ever matches AuthGuard" — three different
    // facts, one indistinguishable result.
    expect(isInsideAuthGuard(APP_SRC, '/dashboard')).toBe(true)
    expect(isInsideAuthGuard(APP_SRC, '/journal/capture-connect')).toBe(false)
    // A route that does not exist reads as null, never as a passing `false`.
    expect(isInsideAuthGuard(APP_SRC, '/no/such/route')).toBeNull()
  })

  it('⛔ the share path does not join FREE_PAGES by accident', () => {
    // Notebook is paid. The page tells a free member so; it must not become
    // reachable as a free page through the guard's own allowlist instead.
    const guard = fs.readFileSync(path.join(APP, 'src', 'components', 'AuthGuard.jsx'), 'utf8')
    const freeLine = /const FREE_PAGES = \[([^\]]*)\]/.exec(guard)
    expect(freeLine, 'FREE_PAGES could not be read').toBeTruthy()
    expect(freeLine[1]).not.toContain('/journal')
  })
})

describe('⛔⛔ the sign-in continuation carries no member content', () => {
  // ⛔ WHY THIS IS STRUCTURAL AND NOT ONLY BEHAVIOURAL. The component test that
  // reads the rendered href passes even with the payload put back into `next`,
  // because the URL-scrub effect has already replaced the query away by the
  // time Testing Library flushes effects and reads the DOM. That makes the
  // behavioural assertion depend on effect ORDERING rather than on the
  // invariant — a mutation check proved it green against a restored leak.
  // The invariant is: `next` is the route, and nothing is appended to it.
  const PAGE = path.join(APP, 'src/pages/journal-2-0/components/notebook/ShareTargetPage.jsx')

  function nextInitialiser() {
    const Parser = acorn.Parser.extend(jsx())
    const ast = Parser.parse(fs.readFileSync(PAGE, 'utf8'),
      { ecmaVersion: 'latest', sourceType: 'module' })
    let found
    const walk = (n) => {
      if (!n || typeof n.type !== 'string' || found) return
      if (n.type === 'VariableDeclarator' && n.id?.name === 'next') { found = n.init; return }
      for (const k of Object.keys(n)) {
        if (k === 'type') continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v)
      }
    }
    walk(ast)
    return found
  }

  it('`next` is the bare route identifier — never a template over the search', () => {
    const init = nextInitialiser()
    expect(init, 'ShareTargetPage no longer declares `next`').toBeTruthy()
    // A template literal here is exactly how the payload got in the first time.
    expect(init.type).toBe('Identifier')
    expect(init.name).toBe('SHARE_ROUTE')
  })

  it('⭐ the probe can see a template literal (non-vacuity)', () => {
    const Parser = acorn.Parser.extend(jsx())
    const ast = Parser.parse('const next = `${A}${b.search}`', { ecmaVersion: 'latest', sourceType: 'module' })
    const decl = ast.body[0].declarations[0]
    expect(decl.id.name).toBe('next')
    expect(decl.init.type).toBe('TemplateLiteral')
  })
})
