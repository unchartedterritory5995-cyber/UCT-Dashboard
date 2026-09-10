/**
 * R-G — ONE navigation authority, two doors.
 *
 * `ctx.navigate` exists so a registry-declared mode can act without being mounted from its page.
 * The risk it introduces is obvious and worth railing rather than reviewing: a second way to
 * navigate, drifting from the first.
 *
 * TWO ASSERTIONS, and they fail for different reasons:
 *   IDENTITY     — what ctx exposes is the SAME function `runAction` uses, not a lookalike.
 *   SINGULARITY  — no other navigation path exists anywhere under `app/src/hub/**`.
 *
 * ⚠️ Identity is checked at the SOURCE, because no render of a mode can tell you whether the
 * navigate branch calls the same symbol — the same reason `contractArity.test.js` reads its
 * caller's argument list instead of invoking it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const HUB = resolve(process.cwd(), 'src', 'hub')
const HUB_ROOT = join(HUB, 'HubRoot.jsx')

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function productFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return productFiles(p)
    if (/\.test\.(js|jsx)$/.test(name)) return []
    return /\.(js|jsx)$/.test(name) ? [p] : []
  })
}

/** Every way to move the router, as {file, line, what}. */
function navigationSites() {
  const patterns = [
    [/\buseNavigate\s*\(/, 'useNavigate()'],
    [/history\.pushState\s*\(/, 'history.pushState'],
    [/history\.replaceState\s*\(/, 'history.replaceState'],
    [/window\.location\s*\.\s*(assign|replace)\s*\(/, 'window.location.assign/replace'],
    [/window\.location\.href\s*=/, 'window.location.href ='],
  ]
  return productFiles(HUB).flatMap((file) =>
    strip(readFileSync(file, 'utf8')).split('\n').flatMap((text, i) => {
      const hit = patterns.find(([re]) => re.test(text))
      return hit ? [{ file: file.replace(HUB, 'hub'), line: i + 1, what: hit[1] }] : []
    }))
}

describe('R-G — one navigation authority', () => {
  it('the scan can see the hub and finds the known site — the non-vacuity control', () => {
    const files = productFiles(HUB)
    expect(files.length, 'no product files found under app/src/hub').toBeGreaterThan(10)
    expect(files.some((f) => f.endsWith('HubRoot.jsx'))).toBe(true)
    // If the pattern list ever stops matching, this fails HERE rather than reporting "zero second
    // paths" — an empty result is a failed invocation until proven otherwise (rule 14).
    expect(navigationSites().length, 'the scan found NO navigation at all — the patterns are broken')
      .toBeGreaterThanOrEqual(1)
  })

  it('⛔ EXACTLY ONE navigation site exists under app/src/hub, and it is HubRoot', () => {
    const sites = navigationSites()
    expect(
      sites.map((s) => `${s.file.split(sep).join('/')} ${s.what}`),
      'a SECOND navigation path appeared under app/src/hub. ctx.navigate exists so there is one '
      + 'authority; a second one drifts from it silently, and the member gets two different answers '
      + 'to "where does this go".',
    ).toEqual(['hub/HubRoot.jsx useNavigate()'])
  })

  it('⛔ IDENTITY — ctx exposes the same function the navigate branch calls', () => {
    const src = strip(readFileSync(HUB_ROOT, 'utf8'))

    // The seam is defined once, wrapping the router's navigate with the registry's own resolver.
    expect(src, 'the navigateTo seam is gone or renamed')
      .toMatch(/const\s+navigateTo\s*=\s*useCallback\(\(to\)\s*=>\s*navigate\(resolveNavTarget\(to\)\)/)

    // ctx hands out that symbol, not a fresh arrow.
    expect(src, 'ctx does not expose navigateTo — a mode cannot navigate, or gets a second function')
      .toMatch(/navigate:\s*navigateTo\b/)

    // runAction's navigate branch calls the SAME symbol.
    expect(src, "runAction's navigate branch does not use navigateTo — the two doors have drifted")
      .toMatch(/action\.kind === 'navigate'\s*\)\s*\{\s*navigateTo\(/)

    // And goHome, so home is not a third path.
    expect(src, 'goHome does not use navigateTo').toMatch(/goHome\s*=\s*useCallback\(\(\)\s*=>\s*navigateTo\(/)
  })

  it('the raw router navigate is NOT what ctx hands out', () => {
    // `navigate: navigate` would type-check, render fine, and silently drop resolveNavTarget — so a
    // mode passing a mode id would navigate to the literal string 'screener'.
    const src = strip(readFileSync(HUB_ROOT, 'utf8'))
    expect(src).not.toMatch(/navigate:\s*navigate\b/)
  })
})
