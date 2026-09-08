// ⛔ WHAT THE BROWSER EXTENSION MAY DO, MADE STRUCTURAL (Slice 3 §11/§12/§19).
//
// The extension is a door into the already-proven capture contract. Three
// promises were made about it, and all three are properties of its SOURCE and
// its MANIFEST rather than of anyone's intent:
//
//   1. It never possesses the member's UCT session (no `chrome.cookies`, no
//      `uct_session`, no credentialed requests).
//   2. It asks for the narrowest permission set that works.
//   3. It reads the current URL, the title, and the member's own selection —
//      and nothing else off the page.
//
// ⭐ AST, never grep. A grep for "cookies" matches this file's own comments and
// every doc that names the rejected option — the exact false-positive class
// captureConvergence.test.js documents.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import * as acorn from 'acorn'

const EXT = path.resolve(__dirname, '..', '..', '..', '..', '..', 'extension')
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'icons') jsFiles(p, out) }
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    if (['type', 'loc', 'start', 'end'].includes(k)) continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, fn)
  }
}

/** The file with every COMMENT blanked out, string literals kept.
 *
 * ⛔ THIS EXISTS BECAUSE THE RAIL CAUGHT ITSELF. The first version read raw
 * text and went red on `auth.js`'s own docstring — the one explaining that
 * chrome.cookies is deliberately NOT used and that reading `uct_session` would
 * defeat httpOnly. That is the precise false-positive class
 * captureConvergence.test.js documents ("found 5 call sites, all five of them
 * prose"), committed by a rail written to prevent it. A prohibition is about
 * CODE; a comment naming the rejected option is the opposite of a violation.
 * String literals stay in, because `'uct_session'` as a literal WOULD be real.
 */
function codeOnly(file) {
  const src = fs.readFileSync(file, 'utf8')
  const comments = []
  acorn.parse(src, { ecmaVersion: 2023, sourceType: 'module', onComment: comments })
  let out = src
  for (const c of comments) {
    out = out.slice(0, c.start) + ' '.repeat(c.end - c.start) + out.slice(c.end)
  }
  return out
}

/** Every `a.b.c` member expression in the file, as dotted strings — so a probe
 *  asks the SYNTAX whether an API is called, not whether a word appears. */
function memberPaths(file) {
  const ast = acorn.parse(fs.readFileSync(file, 'utf8'), {
    ecmaVersion: 2023, sourceType: 'module',
  })
  const paths = []
  walk(ast, (n) => {
    if (n.type !== 'MemberExpression') return
    const parts = []
    let cur = n
    while (cur && cur.type === 'MemberExpression') {
      if (cur.computed || cur.property.type !== 'Identifier') return
      parts.unshift(cur.property.name)
      cur = cur.object
    }
    if (cur && cur.type === 'Identifier') { parts.unshift(cur.name); paths.push(parts.join('.')) }
  })
  return paths
}

const FILES = jsFiles(EXT)
const ALL_PATHS = FILES.flatMap(memberPaths)

describe('the extension never possesses the session', () => {
  it('calls no chrome.cookies API', () => {
    expect(ALL_PATHS.filter((p) => p.startsWith('chrome.cookies'))).toEqual([])
  })

  it('the probe can actually see the chrome APIs it does use', () => {
    // Non-vacuity: a memberPaths that returned nothing would pass the assertion
    // above for the wrong reason.
    expect(ALL_PATHS).toContain('chrome.storage.local.get')
    expect(ALL_PATHS).toContain('chrome.identity.launchWebAuthFlow')
  })

  it('names the session cookie nowhere in its code', () => {
    for (const f of FILES) {
      expect(codeOnly(f), `${path.basename(f)} names uct_session in code`)
        .not.toContain('uct_session')
    }
  })

  it('never sends credentials with a request', () => {
    // Every fetch in the extension passes credentials: 'omit'. A default fetch
    // would not send the Lax cookie cross-site anyway — but relying on a browser
    // default for a security property is how the property silently changes.
    const src = FILES.map(codeOnly).join('\n')
    const fetches = (src.match(/\bfetch\(/g) || []).length
    const omits = (src.match(/credentials: 'omit'/g) || []).length
    expect(fetches).toBeGreaterThan(0)
    expect(omits).toBe(fetches)
    expect(src).not.toContain("credentials: 'include'")
  })
})

describe('the manifest asks for the narrowest set that works', () => {
  it('requests exactly the four justified permissions', () => {
    // activeTab  — the current tab, only on explicit invocation
    // storage    — chrome.storage.local for the scoped credential
    // identity   — launchWebAuthFlow, the first-party handshake
    // scripting  — reading the member's own selection from the active tab
    expect([...MANIFEST.permissions].sort())
      .toEqual(['activeTab', 'identity', 'scripting', 'storage'])
  })

  it('requests none of the permissions the ruling named', () => {
    const forbidden = ['cookies', 'tabs', 'history', 'clipboardRead', 'clipboardWrite',
                       'webRequest', 'background', 'declarativeNetRequest', 'downloads']
    for (const p of forbidden) expect(MANIFEST.permissions).not.toContain(p)
    expect(MANIFEST.optional_permissions || []).toEqual([])
  })

  it('holds ONE host permission and it is not a wildcard', () => {
    expect(MANIFEST.host_permissions).toEqual(['https://uctintelligence.com/*'])
    for (const h of MANIFEST.host_permissions) {
      expect(h).not.toContain('<all_urls>')
      expect(h.startsWith('https://')).toBe(true)
    }
  })

  it('declares no content scripts at all', () => {
    // A declared content script runs on pages whether or not the member invoked
    // anything. Selection reading is injected on invocation instead.
    expect(MANIFEST.content_scripts).toBeUndefined()
  })

  it('has a strict CSP with no remote or inline script', () => {
    const csp = MANIFEST.content_security_policy?.extension_pages || ''
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('http')
  })

  it('is Manifest V3', () => {
    expect(MANIFEST.manifest_version).toBe(3)
  })
})

describe('no remote code and no embedded secret', () => {
  it('loads no script from anywhere but the extension package', () => {
    for (const f of [...FILES, path.join(EXT, 'popup.html')]) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/<script[^>]+src=["']https?:/)
      expect(src).not.toMatch(/\bimport\(\s*["']https?:/)
      expect(src).not.toMatch(/\beval\s*\(/)
      expect(src).not.toMatch(/new\s+Function\s*\(/)
    }
  })

  it('carries no inline event handlers in its HTML', () => {
    // The CSP would refuse them; this says so before a reviewer has to test it.
    const html = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8')
    expect(html).not.toMatch(/\son[a-z]+\s*=\s*["']/i)
  })

  it('embeds no credential-shaped literal', () => {
    for (const f of FILES) {
      const src = codeOnly(f)
      // The token prefix appearing as a LITERAL would mean a baked-in credential.
      expect(src).not.toMatch(/["']uctcap_[A-Za-z0-9_-]{8,}["']/)
      expect(src).not.toMatch(/(api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{8,}["']/i)
    }
  })
})

describe('page access is one expression, and it is the selection', () => {
  const popup = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8')

  it('injects exactly one function into a page', () => {
    const calls = memberPaths(path.join(EXT, 'popup.js'))
      .filter((p) => p === 'chrome.scripting.executeScript')
    expect(calls).toHaveLength(1)
  })

  it('the injected function reads the selection and nothing else', () => {
    const ast = acorn.parse(popup, { ecmaVersion: 2023, sourceType: 'module' })
    let fn = null
    walk(ast, (n) => {
      if (n.type === 'FunctionDeclaration' && n.id?.name === 'readSelection') fn = n
    })
    expect(fn, 'readSelection is the whole page-access surface — do not rename it').toBeTruthy()
    const inside = []
    walk(fn, (n) => {
      if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
        inside.push(n.property.name)
      }
    })
    // ⛔ If this list grows, the extension started reading the page. That is a
    // rights and privacy decision, not a refactor.
    expect([...new Set(inside)].sort()).toEqual(['getSelection', 'toString'])
  })

  it('touches none of the DOM-crawling APIs anywhere', () => {
    const banned = ['querySelectorAll', 'getElementsByTagName', 'innerHTML', 'outerHTML',
                    'documentElement', 'forms', 'cookie']
    for (const f of FILES) {
      const src = codeOnly(f)
      for (const b of banned) {
        expect(src, `${path.basename(f)} references ${b}`).not.toContain(`.${b}`)
      }
    }
  })
})
