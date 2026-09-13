/**
 * §8 — "No analytics", and the ONE marker that records where it would go.
 *
 * The master spec is explicit: there is no authenticated in-app event sink in this app, so the hub
 * emits nothing. What it must carry is exactly one `TODO(hub-analytics): emit here` at the fire
 * path, plus one line in `deferred.md` (D-22). This rail pins both halves of "exactly one".
 *
 * ⭐ WHY A COUNT IS THE ASSERTION. A marker is a promise about WHERE analytics would attach. Two
 * markers is worse than none: the next engineer wires the first one they find, and a `confirm`
 * action — which passes `runAction` once and then writes from its sheet — would report twice while
 * a `navigate` reported once. The count is the contract.
 *
 * ⚠️ It also pins the LOCATION, not just the number. A single marker parked in a dead branch
 * satisfies a count and records nothing true.
 *
 * ⭐ The scan covers PRODUCT files only. Tests that talk ABOUT the marker are not markers, and a
 * rail that counts its own prose is measuring itself.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// vitest runs with cwd = app/. The non-vacuity control below fails loudly if this resolves wrong,
// rather than letting an empty scan clear the count.
const HUB_DIR = resolve(process.cwd(), 'src', 'hub')
// ⛔ ASSEMBLED, NOT WRITTEN OUT. A scan over sources counts the file doing the asking: the first
// version of this rail found THREE markers — HubRoot's real one plus its own docstring and its own
// constant — and failed on its own text (`lesson_a_search_over_sources_counts_the_searcher`).
// Building the literal from parts means this file contains no occurrence of it.
const MARKER = ['TODO', '(hub-analytics)'].join('')

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return jsFiles(p)
    if (/\.test\.(js|jsx)$/.test(name)) return []   // a test discussing the marker is not one
    return /\.(js|jsx)$/.test(name) ? [p] : []
  })
}

/** Every marker occurrence under app/src/hub/**, as {file, line}. */
function markers() {
  return jsFiles(HUB_DIR).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((text, i) => ({ file, line: i + 1, text }))
      .filter((r) => r.text.includes(MARKER)),
  )
}

describe('§8 — exactly one hub-analytics marker', () => {
  it('the scan can see the hub at all — the non-vacuity control', () => {
    const files = jsFiles(HUB_DIR)
    expect(files.length, 'no product JS found under app/src/hub — the scan is looking at nothing')
      .toBeGreaterThan(10)
    expect(files.some((f) => /\.test\./.test(f)), 'test files must be excluded from the scan').toBe(false)
    expect(files.some((f) => f.endsWith('HubRoot.jsx')), 'HubRoot.jsx not in the scan').toBe(true)
  })

  it('⛔ there is EXACTLY ONE, and a second would be a double-count', () => {
    const found = markers()
    expect(
      found.length,
      `§8 mandates exactly one "${MARKER}" marker under app/src/hub. Found ${found.length}:\n` +
      found.map((m) => `  ${m.file.replace(HUB_DIR, 'hub')}:${m.line}`).join('\n'),
    ).toBe(1)
  })

  it('⛔ it sits on the ONE dispatch every action passes through, not in a branch', () => {
    const [m] = markers()
    expect(m.file.endsWith('HubRoot.jsx'), `the marker is in ${m.file}, not HubRoot.jsx`).toBe(true)
    const src = readFileSync(m.file, 'utf8').split('\n')
    // It must be inside runAction, and ABOVE every kind branch — a marker below the `home` or
    // `navigate` early-returns would never see those actions at all.
    const dispatch = src.findIndex((l) => l.includes('const runAction = useCallback'))
    const firstBranch = src.findIndex((l, i) => i > dispatch && l.includes("action.kind === 'home'"))
    expect(dispatch, 'runAction not found').toBeGreaterThan(-1)
    expect(m.line - 1).toBeGreaterThan(dispatch)
    expect(
      m.line - 1,
      'the marker sits BELOW the first kind branch, so navigate/home actions would pass it by',
    ).toBeLessThan(firstBranch)
  })
})
