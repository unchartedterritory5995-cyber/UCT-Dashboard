// D-27 — Wire and Journal are two green siblings a member has to tell apart.
//
// THE FINDING THIS RAIL DEFENDS. Home's fan puts all three greens on screen at once, and the
// pair the deferred row named — Wire beside Journal — is close on BOTH channels a viewer can
// use: 2.2 degrees of hue and a WCAG ratio of 1.74. Every other tight pair in that fan is tight
// on exactly one channel (chart/journal sit at 1.007:1 but 145 degrees apart, so nobody
// confuses a purple with a green).
//
// ⛔ EVERY NUMBER BELOW IS DERIVED FROM tokens.css AND registry.js. Not one is typed. A figure
// written beside the source that owns it is the defect this repo keeps re-finding
// (`lesson_a_second_authority_over_one_value`), and a contrast table is the easiest place in
// the world to put a stale one.
//
// ⭐ TWO METRICS, BECAUSE A CHANGE CAN IMPROVE ONE AND WORSEN THE OTHER — and the deferred
// row's own fix candidate does exactly that:
//   · WCAG contrast ratio — relative luminance only. THE hue-blind viewer's one channel, and
//     the reason D-27 was filed at all.
//   · CIEDE2000 — lightness, chroma and hue in one perceptual number. What everyone else uses,
//     and the metric that notices when "separate Wire from Journal" separates it INTO Breadth.
// Checking only the metric a change was designed to improve is how a fix ships backwards.
//
// ⛔ THIS RAIL DOES NOT AUTHORISE A DEFAULT. `:root` is untouched; the new value lives behind
// `[data-hub-contrast="high"]`, which a member opts into. Whether the shipped default confuses
// a real person on real glass is `docs/plans/joystick/glass-acceptance.md` G3-15, and no test
// can answer it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { contrast, composite, hexRgb, de00, de00Lab } from '../styles/__tests__/contrastMath'
import { modesById, fanFor } from './registry'

// A `vitest -t` regex that matches nothing exits 0 and reads as a PASS, and every assertion
// below is a loop over a derived list — so an empty list would also read as a PASS. `ran()`
// counts real executions and "rail integrity" at the bottom refuses a suspiciously small count.
let executed = 0
const ran = () => { executed += 1 }

// `hub/highContrastWriter.test.jsx`'s idiom: strip the leading slash a Windows drive letter
// picks up in a file: URL, then resolve from THIS file. `fileURLToPath(new URL('../styles/…'))`
// — the form tokens.test.js uses for its own directory — is not reliably a file: URL once it
// crosses one (the same note is in `styles/tokens.reachable.test.js`, which reaches for
// `process.cwd()` instead and trips the browser-globals lint config).
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const TOKENS = readFileSync(path.join(HERE, '..', 'styles', 'tokens.css'), 'utf8')
  // Comments are stripped so a `--token:` quoted in prose can never be read as a declaration —
  // and this file's own comment block in tokens.css quotes several.
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Body of the first block with this exact selector, by brace matching. */
function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`${escaped}\\s*[,{]`).exec(TOKENS)
  if (!m) throw new Error(`selector not found in tokens.css: ${selector}`)
  const open = TOKENS.indexOf('{', m.index)
  let depth = 0
  for (let j = open; j < TOKENS.length; j++) {
    if (TOKENS[j] === '{') depth++
    else if (TOKENS[j] === '}' && --depth === 0) return TOKENS.slice(open + 1, j)
  }
  throw new Error(`unterminated block: ${selector}`)
}

const ROOT = block(':root')
const OLED = block('[data-theme="oled"]')
const HIGH = block('[data-hub-contrast="high"]')

const decl = (body, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`).exec(body)
  return m ? m[1].trim() : null
}

/** A CASCADE is the ordered list of blocks that apply, least specific first — exactly the
 *  situation a member is in. `[dark]`, `[dark, high]`, `[oled]`, `[oled, high]`.
 *  ⛔ Light theme is absent ON PURPOSE and it is not an omission: tokens.css declares no
 *  `--hub-*` under `[data-theme="light"]` (D-24, its own deferred row), so "the hub on a light
 *  theme" is not a state this file can measure. `tokens.test.js` scopes its own glass contrast
 *  floor to the same two themes for the same reason. */
const resolve = (cascade, token) => {
  for (let i = cascade.length - 1; i >= 0; i--) {
    const v = decl(cascade[i], token)
    if (v != null) return v
  }
  throw new Error(`no declaration of ${token} in this cascade`)
}

/** Resolve a token all the way down to opaque [r,g,b] as painted over `--bg`.
 *  Handles the three value shapes tokens.css actually uses for these tokens; anything else
 *  THROWS rather than being skipped, because a silently skipped case is a vacuous pass. */
function toRgb(cascade, value, depth = 0) {
  if (depth > 8) throw new Error(`var() cycle resolving: ${value}`)
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return hexRgb(v)
  const varOnly = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v)
  if (varOnly) return toRgb(cascade, resolve(cascade, varOnly[1]), depth + 1)
  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*var\(\s*(--[\w-]+)\s*\)\s+([\d.]+)%\s*,\s*transparent\s*\)$/.exec(v)
  if (mix) {
    const over = toRgb(cascade, resolve(cascade, '--bg'), depth + 1)
    return composite(toRgb(cascade, resolve(cascade, mix[1]), depth + 1), Number(mix[2]) / 100, over)
  }
  throw new Error(`unhandled colour form (the resolver must not guess): ${v}`)
}

const CASCADES = {
  'dark': [ROOT],
  'dark · high contrast': [ROOT, HIGH],
  'oled': [ROOT, OLED],
  'oled · high contrast': [ROOT, OLED, HIGH],
}

/** The two glass tiers §2a measures mode accents against: the resting tint and the
 *  pressed/"worst case" one. Derived from the token names, not from their values. */
const TIER_TOKENS = ['--hub-glass-tint', '--hub-glass-tint-strong']

/** Every glass surface a bubble can sit on, as opaque rgb: 4 cascades x 2 tiers. */
const TIERS = Object.entries(CASCADES).flatMap(([name, cascade]) =>
  TIER_TOKENS.map((t) => ({
    name: `${name} / ${t.replace('--hub-glass-tint', 'tint')}`,
    cascade,
    rgb: toRgb(cascade, resolve(cascade, t)),
  })))

/** Every `--hub-mode-*` declared anywhere in tokens.css, DERIVED — so an accent added tomorrow
 *  is covered today, and so is any block that starts redefining one. */
const ACCENT_NAMES = [...new Set([...TOKENS.matchAll(/(--hub-mode-[\w-]+)\s*:/g)].map((m) => m[1]))].sort()

/** The accents that actually co-occur on screen in Home's fan.
 *  ⚠️ DERIVED FROM THE REGISTRY, and that matters: the deferred row's prose names Wire and
 *  Journal, but `voice('home')` takes `--hub-mode-${mode}`, so Home's accent is on screen in
 *  Home's own fan too — as the Voice bubble. All THREE greens co-occur, not two. Both the
 *  declared fan and the preview projection are unioned so this survives the preview exit. */
const HOME_FAN_ACCENTS = [...new Set([
  ...modesById.home.fan.map((a) => a.color),
  ...fanFor(modesById.home).map((a) => a.color),
])].filter((c) => c.startsWith('--hub-mode-')).sort()

const WIRE = '--hub-mode-wire'
const JOURNAL = '--hub-mode-journal'
const HOME = '--hub-mode-home'
const GREENS = [HOME, JOURNAL, WIRE]

const accent = (cascade, name) => toRgb(cascade, resolve(cascade, name))
const NEIGHBOURS = HOME_FAN_ACCENTS.filter((c) => c !== WIRE)

/** Wire's separation from everything it shares Home's fan with, on both metrics. */
function wireSeparation(cascade) {
  const w = accent(cascade, WIRE)
  const pairs = NEIGHBOURS.map((n) => ({ n, ct: contrast(w, accent(cascade, n)), de: de00(w, accent(cascade, n)) }))
  return {
    vsJournalCt: contrast(w, accent(cascade, JOURNAL)),
    vsJournalDe: de00(w, accent(cascade, JOURNAL)),
    minCt: Math.min(...pairs.map((p) => p.ct)),
    minDe: Math.min(...pairs.map((p) => p.de)),
    worstDe: pairs.slice().sort((a, b) => a.de - b.de)[0],
  }
}

const NORMAL = wireSeparation(CASCADES.dark)
const CONTRASTED = wireSeparation(CASCADES['dark · high contrast'])

describe('D-27 CONTROLS — the derivation read the real sources and found the real colours', () => {
  // ⛔ NAMED MEMBERS, NEVER A COUNT. "found 10 accents" passes just as happily against a
  // resolver that matched the wrong file, or against a regex that picked up a comment.
  it('the accent set derived from tokens.css contains the three greens by name', () => {
    ran()
    expect(ACCENT_NAMES).toContain(HOME)
    expect(ACCENT_NAMES).toContain(JOURNAL)
    expect(ACCENT_NAMES).toContain(WIRE)
  })

  it('each green resolves to a distinct opaque colour, so nothing below compares a token to itself', () => {
    ran()
    const seen = GREENS.map((g) => accent(CASCADES.dark, g))
    for (const rgb of seen) expect(rgb, 'a green did not resolve to 3 channels').toHaveLength(3)
    expect(new Set(seen.map(String)).size, 'two greens resolved to the SAME rgb — the '
      + 'siblings collapsed back to one value, which is the v1.2 defect the token block warns '
      + 'about').toBe(3)
  })

  it("Home's co-occurring accent set is derived from the registry and includes Home itself, via Voice", () => {
    ran()
    expect(HOME_FAN_ACCENTS).toContain(WIRE)
    expect(HOME_FAN_ACCENTS).toContain(JOURNAL)
    // The row's prose says "Wire and Journal co-occur". The registry says all three do:
    // `voice('home')` wears `--hub-mode-home`. If this ever stops being true the rail below
    // gets easier to pass, so it is asserted rather than assumed.
    expect(HOME_FAN_ACCENTS, 'the Voice bubble stopped carrying Home\'s accent — Wire\'s '
      + 'neighbour list just changed and the separation numbers below mean something else')
      .toContain(HOME)
    expect(NEIGHBOURS).not.toContain(WIRE)
  })

  it('the glass tiers resolved to real, DIFFERENT surfaces (a resolver returning one colour would pass every floor)', () => {
    ran()
    expect(TIERS.map((t) => t.name)).toContain('dark / tint')
    expect(TIERS.map((t) => t.name)).toContain('oled · high contrast / tint-strong')
    expect(new Set(TIERS.map((t) => String(t.rgb))).size, 'the glass tiers did not resolve to '
      + 'distinct surfaces — the resolver is collapsing them').toBeGreaterThan(1)
    for (const [name, cascade] of Object.entries(CASCADES)) {
      const rest = toRgb(cascade, resolve(cascade, '--hub-glass-tint'))
      const press = toRgb(cascade, resolve(cascade, '--hub-glass-tint-strong'))
      expect(String(rest), `${name}: resting and pressed tiers resolved identically`).not.toBe(String(press))
    }
  })

  it('CIEDE2000 is the real formula — 13 published Sharma et al. reference pairs', () => {
    ran()
    // The metric has to be right before any conclusion drawn from it means anything. A naive
    // CIEDE2000 transcription fails on exactly these: the hue-mean discontinuity (rows 1-3)
    // and the neutral/atan2 cases (rows 4-6).
    const REFERENCE = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
      [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
      [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0000],
      [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0000],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[50, 2.5, 0], [61, -5, 29], 22.8977],
      [[50, 2.5, 0], [56, -27, -3], 31.9030],
      [[50, 2.5, 0], [58, 24, 15], 19.4535],
      [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0000],
      [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    ]
    for (const [a, b, want] of REFERENCE) expect(de00Lab(a, b)).toBeCloseTo(want, 3)
  })
})

describe('D-27 — the property the row already established must not regress', () => {
  // "The three greens all clear 3:1 against every glass tier." That is the finding the deferred
  // row banked, and the high-contrast override must not spend it.
  const CASES = GREENS.flatMap((g) => TIERS.map((t) => [g, t.name, g, t]))
  it.each(CASES)('%s clears 3:1 on %s', (_label, _tier, green, tier) => {
    ran()
    expect(contrast(accent(tier.cascade, green), tier.rgb)).toBeGreaterThanOrEqual(3)
  })
})

describe('D-27 — high contrast separates Wire from Journal on BOTH channels', () => {
  it('the WCAG ratio against Journal strictly improves — the hue-blind viewer\'s only channel', () => {
    ran()
    expect(CONTRASTED.vsJournalCt).toBeGreaterThan(NORMAL.vsJournalCt)
  })

  it('CIEDE2000 against Journal strictly improves — what everyone else sees', () => {
    ran()
    expect(CONTRASTED.vsJournalDe).toBeGreaterThan(NORMAL.vsJournalDe)
  })

  it('Wire\'s WORST neighbour in Home\'s fan improves too — the fix must not walk into a third bubble', () => {
    ran()
    // The deferred row's own candidate fails precisely here: it opens the Journal gap by moving
    // Wire onto Breadth, which shares ring 0 with it. A rail that watched only the named pair
    // would have called that a success.
    expect(CONTRASTED.minDe).toBeGreaterThan(NORMAL.minDe)
  })

  it('and no neighbour is left worse off on luminance than the shipped default leaves it', () => {
    ran()
    expect(CONTRASTED.minCt).toBeGreaterThanOrEqual(NORMAL.minCt)
  })

  it('⛔ the deferred row\'s OWN candidate (#8FE0B0) is measured WORSE, and is not what shipped', () => {
    ran()
    // Kept as a rail, not as prose, because the row's prose is what a future reader will find
    // first. `#8FE0B0` LOWERS the WCAG ratio against Journal — the exact channel the row was
    // filed about — and lowers Wire's worst CIEDE2000 neighbour by landing near Breadth.
    const candidate = hexRgb('#8FE0B0')
    const shipped = accent(CASCADES.dark, WIRE)
    const journal = accent(CASCADES.dark, JOURNAL)
    expect(contrast(candidate, journal)).toBeLessThan(contrast(shipped, journal))
    const candMinDe = Math.min(...NEIGHBOURS.map((n) => de00(candidate, accent(CASCADES.dark, n))))
    expect(candMinDe).toBeLessThan(NORMAL.minDe)
    // And what DID ship beats it on both.
    expect(CONTRASTED.vsJournalCt).toBeGreaterThan(contrast(candidate, journal))
    expect(CONTRASTED.minDe).toBeGreaterThan(candMinDe)
  })
})

describe('D-27 — the DEFAULT path is untouched, which is what makes this safe to ship dark', () => {
  it('[data-hub-contrast="high"] is the ONLY non-:root block in tokens.css that declares a --hub-mode-* token', () => {
    ran()
    // Derived by walking every top-level block: a `[data-theme]` variant would (a) change what
    // a member sees with high contrast OFF and (b) make every theme island in the app
    // incomplete — `styles/themeIslands.test.js` derives its required set from exactly this
    // shape. Asserting the selector set is how this rail proves neither happened.
    const owners = []
    const re = /(^|})\s*([^{}@]+?)\s*\{/g
    let m
    while ((m = re.exec(TOKENS)) != null) {
      const selector = m[2].trim()
      const open = TOKENS.indexOf('{', m.index + m[1].length)
      let depth = 0
      let body = ''
      for (let j = open; j < TOKENS.length; j++) {
        if (TOKENS[j] === '{') depth++
        else if (TOKENS[j] === '}' && --depth === 0) { body = TOKENS.slice(open + 1, j); break }
      }
      if (/--hub-mode-[\w-]+\s*:/.test(body)) owners.push(selector)
    }
    expect(owners, 'the scan found no block declaring a mode accent — it is not reading '
      + 'tokens.css').toContain(':root')
    expect(owners.sort()).toEqual([':root', '[data-hub-contrast="high"]'])
  })

  it('with the attribute absent, every accent resolves to its :root value — including Wire', () => {
    ran()
    for (const name of ACCENT_NAMES) {
      expect(resolve([ROOT], name)).toBe(decl(ROOT, name))
    }
    // Named explicitly: Wire is the token this change moves, so "unchanged by default" is the
    // half of the claim most worth stating out loud.
    expect(String(accent(CASCADES.dark, WIRE))).toBe(String(hexRgb(decl(ROOT, WIRE))))
    expect(String(accent(CASCADES['dark · high contrast'], WIRE)))
      .not.toBe(String(accent(CASCADES.dark, WIRE)))
  })
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    // 5 controls + 3 greens x 8 tiers + 5 separation + 2 default-path.
    expect(executed).toBeGreaterThanOrEqual(5 + GREENS.length * TIERS.length + 5 + 2)
    expect(TIERS.length, 'the tier matrix collapsed').toBe(8)
  })
})
