// ⛔ NOTHING ALWAYS ON SCREEN MAY ANIMATE FOREVER.
//
// Measured 2026-11-10 (desktop app, real Charts board, 12 popped widgets): two endless CSS
// animations (the market clock dot in every chart widget, the voice orb's idle breath) kept every
// window producing a compositor frame at the display rate forever. ~550 presents a second
// saturated the GPU process's main thread (90% busy, 78% in Present) and held every window to
// 9-16 fps. Switching them off took 12 widgets from p95 34 ms / p99 84 ms to 17 / 18 ms and cut CPU
// 63%. A browser tab pays the same cost.
//
// This rail records every endless (`infinite`) CSS animation in the app as a known list. A NEW one
// fails here. Before adding it to the list, it must be one of:
//   - shown only while something is loading or in progress (skeleton, spinner, "thinking")
//   - shown only while the member is actively doing the thing it animates (recording, listening)
//   - on a page that is itself the experience (the Study game, the intro)
// Anything ambient on a trading surface (a "live" dot, a decorative glow) gets a finite iteration
// count or rides an existing once-a-second render instead (see `.clockDot` in
// pages/charts/ChartsWorkspace.module.css).
//
// The list must also stay tight: an entry whose rule no longer exists fails too, so fixing one
// shortens the list. Regenerate after a deliberate change:
//   UPDATE_ENDLESS_BASELINE=1 npx vitest run src/styles/endlessAnimations.test.js
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from 'vitest'

const ROOT = path.resolve(globalThis.process.cwd(), 'src')
const BASELINE = path.join(ROOT, 'styles', 'endlessAnimations.baseline.json')

function cssFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...cssFiles(full))
    } else if (entry.name.endsWith('.css')) out.push(full)
  }
  return out
}

/** Every rule (file::selector) whose declarations run an animation with `infinite`. */
export function scanEndless(root = ROOT) {
  const found = new Set()
  for (const file of cssFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/')
    const clean = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const re = /([^{}]+)\{([^{}]*)\}/g
    let m
    while ((m = re.exec(clean))) {
      if (!/animation[^;{}]*\binfinite\b/.test(m[2])) continue
      const selector = m[1].replace(/\s+/g, ' ').trim()
      if (selector.startsWith('@') || /^(from|to|\d+%)/.test(selector)) continue
      found.add(`${rel}::${selector}`)
    }
  }
  return [...found].sort()
}

test('no endless animation exists outside the reviewed list', () => {
  const now = scanEndless()
  if (globalThis.process.env.UPDATE_ENDLESS_BASELINE === '1') {
    fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n')
  }
  const known = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')))
  const added = now.filter((k) => !known.has(k))
  expect(added, 'New endless animation(s). Read the header of this test before adding to the baseline.').toEqual([])
})

test('the reviewed list holds no stale entries', () => {
  const now = new Set(scanEndless())
  const stale = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).filter((k) => !now.has(k))
  expect(stale, 'These rules no longer animate forever: remove them from the baseline.').toEqual([])
})

test('the scan can see an endless animation at all (control)', () => {
  const dir = fs.mkdtempSync(path.join(globalThis.process.env.TEMP || '/tmp', 'endless-'))
  fs.writeFileSync(path.join(dir, 'a.module.css'), '.x { animation: spin 1s linear infinite; }\n.y { animation: spin 1s linear 3; }')
  expect(scanEndless(dir)).toEqual(['a.module.css::.x'])
  fs.rmSync(dir, { recursive: true, force: true })
})

// ---- Inline styles in component code (`animation: "pulse 1.5s infinite"`): the same rule. ----
// Counted per file, because a line number moves with every edit. Today's inline ones are all
// loading, recording or maintenance states (the Options Flow summary dot is bounded by a 15 s
// timeout on its request).
const INLINE_BASELINE = path.join(ROOT, 'styles', 'endlessAnimations.inline.baseline.json')
// Anywhere in the value on that line, so a conditional (`recording ? '... infinite' : 'none'`) counts.
const INLINE_RE = /animation\s*:[^\n;]*?["'`][^"'`\n]*\binfinite\b/g

function codeFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === '__fixtures__') continue
      out.push(...codeFiles(full))
    } else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full)
  }
  return out
}

export function scanInlineEndless(root = ROOT) {
  const counts = {}
  for (const file of codeFiles(root)) {
    const n = (fs.readFileSync(file, 'utf8').match(INLINE_RE) || []).length
    if (n) counts[path.relative(root, file).split(path.sep).join('/')] = n
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

test('no inline endless animation exists outside the reviewed counts', () => {
  const now = scanInlineEndless()
  if (globalThis.process.env.UPDATE_ENDLESS_BASELINE === '1') fs.writeFileSync(INLINE_BASELINE, JSON.stringify(now, null, 2) + '\n')
  const known = JSON.parse(fs.readFileSync(INLINE_BASELINE, 'utf8'))
  const over = Object.entries(now).filter(([f, n]) => n > (known[f] || 0)).map(([f, n]) => `${f}: ${n} (reviewed ${known[f] || 0})`)
  expect(over, 'New inline endless animation(s). Read the header of this test before raising a count.').toEqual([])
  const stale = Object.entries(known).filter(([f, n]) => (now[f] || 0) < n).map(([f, n]) => `${f}: reviewed ${n}, now ${now[f] || 0}`)
  expect(stale, 'Fewer inline endless animations than reviewed: lower the counts.').toEqual([])
})

test('the inline scan can see one at all (control)', () => {
  const dir = fs.mkdtempSync(path.join(globalThis.process.env.TEMP || '/tmp', 'endless-inline-'))
  fs.writeFileSync(path.join(dir, 'A.jsx'), 'const s = { animation: "pulse 1.5s infinite" }; const t = { animation: "pulse 1s 3" }\nconst u = { animation: on ? \'x 1s infinite\' : \'none\' }')
  expect(scanInlineEndless(dir)).toEqual({ 'A.jsx': 2 })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the four always-on surfaces fixed on 2026-11-10 stay off the list', () => {
  const now = scanEndless().join('\n')
  expect(now).not.toMatch(/ChartsWorkspace\.module\.css::\.clockDot/)
  expect(now).not.toMatch(/tiles\/MarketClock\.module\.css::\.open \.dot/)
  expect(now).not.toMatch(/voice\/FloatingOrb\.module\.css::\.orb\b/)
  expect(now).not.toMatch(/ModelBook\.module\.css::\.hub/)
})

// ---- SVG SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`) that never ends ----
// Invisible to document.getAnimations(), so the motion sweep and the CSS scan above cannot see it,
// yet Blink services it every frame: on 2026-11-10 one `repeatCount="indefinite"` gradient sweep in
// the Dashboard's Journal tile cost 60 layouts and 60 style recalcs a second while the page sat idle.
// None is allowed: sweep a few times and rest (repeatCount="2"), or ride a CSS animation that rests.
const SMIL_RE = /\b(?:repeatCount|repeatDur)\s*=\s*\{?\s*["'`]indefinite["'`]/g

export function scanSmilEndless(root = ROOT) {
  const hits = []
  for (const file of codeFiles(root)) {
    const n = (fs.readFileSync(file, 'utf8').match(SMIL_RE) || []).length
    if (n) hits.push(`${path.relative(root, file).split(path.sep).join('/')}: ${n}`)
  }
  for (const file of fs.readdirSync(path.join(ROOT, '..', 'public'), { recursive: true })) {
    if (!String(file).endsWith('.svg')) continue
    const full = path.join(ROOT, '..', 'public', String(file))
    const n = (fs.readFileSync(full, 'utf8').match(SMIL_RE) || []).length
    if (n) hits.push(`public/${String(file).split(path.sep).join('/')}: ${n}`)
  }
  return hits.sort()
}

test('no SVG SMIL animation repeats forever', () => {
  expect(scanSmilEndless(), 'An endless SMIL animation re-lays-out the page every frame. Let it run a few times and rest.').toEqual([])
})

test('the SMIL scan can see one at all (control)', () => {
  const dir = fs.mkdtempSync(path.join(globalThis.process.env.TEMP || '/tmp', 'endless-smil-'))
  fs.writeFileSync(path.join(dir, 'A.jsx'), ['<animateTransform dur="3s" repeatCount="indefinite" />', '<animate repeatCount={"indefinite"} />', '<animate repeatCount="2" />'].join('\n'))
  const hits = []
  for (const file of codeFiles(dir)) hits.push((fs.readFileSync(file, 'utf8').match(SMIL_RE) || []).length)
  expect(hits).toEqual([2])
  fs.rmSync(dir, { recursive: true, force: true })
})
