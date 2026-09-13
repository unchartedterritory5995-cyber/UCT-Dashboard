// app/src/styles/tokens.test.js
//
// Tokens are CSS, not JS — so this is a source-text contract test, not a render
// test. It reads the real tokens.css off disk and asserts the research-kit
// token layer (spec §3.1/§3.2) exists with the exact values the kit components
// are built against.
//
// The heat ladder is deliberately checked CROSS-FILE against its source of
// truth (Breadth.module.css .bgG3….bgR3). If someone retunes Breadth, this
// fails instead of the two silently forking.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrast, composite, hexRgb, parseRgba } from './__tests__/contrastMath'

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    // Strip comments so a brace or a `--token:` mentioned in prose can never
    // be mistaken for a declaration.
    .replace(/\/\*[\s\S]*?\*\//g, '')

const TOKENS = read('./tokens.css')
const BREADTH = read('../pages/Breadth.module.css')

/** Body text of the first block whose selector matches, by brace matching.
 *
 * M2: anchored with a boundary regex (selector followed by optional
 * whitespace then `,` or `{`) rather than `indexOf`, which would happily
 * match `.bgA` inside `.bgAlt`. The selector is escaped so a literal `.` in
 * e.g. `.t-num` isn't read as a regex wildcard. */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*[,{]`)
  const m = re.exec(css)
  if (!m) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', m.index)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, j)
    }
  }
  throw new Error(`unterminated block: ${selector}`)
}

/** Declared value of a property inside a block body, or null. */
function decl(body, prop) {
  const re = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`)
  const m = re.exec(body)
  return m ? m[1].trim() : null
}

const squash = (s) => (s == null ? null : s.replace(/\s+/g, ''))

const ROOT = block(TOKENS, ':root')
const OLED = block(TOKENS, '[data-theme="oled"]')
const LIGHT = block(TOKENS, '[data-theme="light"]')

describe('tokens.css — research-kit score ramp (§3.1)', () => {
  it('defines the 5 score tokens with the hexes scoreColor() hardcodes today', () => {
    expect(decl(ROOT, '--score-elite')).toBe('#3cb868')
    expect(decl(ROOT, '--score-strong')).toBe('#7fb84e')
    expect(decl(ROOT, '--score-neutral')).toBe('#c9a84c')
    expect(decl(ROOT, '--score-weak')).toBe('#e08a3c')
    expect(decl(ROOT, '--score-poor')).toBe('#e74c3c')
  })

  it('aliases letter grades onto the score ramp (never a second hex ladder)', () => {
    expect(decl(ROOT, '--grade-a')).toBe('var(--score-elite)')
    expect(decl(ROOT, '--grade-b')).toBe('var(--score-strong)')
    expect(decl(ROOT, '--grade-c')).toBe('var(--score-neutral)')
    expect(decl(ROOT, '--grade-d')).toBe('var(--score-weak)')
    expect(decl(ROOT, '--grade-f')).toBe('var(--score-poor)')
  })
})

describe('tokens.css — heat tiers match the Breadth ladder (§3.1)', () => {
  const PAIRS = [
    ['--heat-g3', '.bgG3'],
    ['--heat-g2', '.bgG2'],
    ['--heat-g1', '.bgG1'],
    ['--heat-a', '.bgA'],
    ['--heat-r1', '.bgR1'],
    ['--heat-r2', '.bgR2'],
    ['--heat-r3', '.bgR3'],
  ]

  it.each(PAIRS)('%s equals Breadth %s background', (token, cls) => {
    const tokenValue = squash(decl(ROOT, token))
    const breadthValue = squash(decl(block(BREADTH, cls), 'background'))
    expect(tokenValue).not.toBeNull()
    expect(breadthValue).not.toBeNull()
    expect(tokenValue).toBe(breadthValue)
  })
})

describe('tokens.css — glass surfaces (§3.1)', () => {
  it('defines the glass surface set on the dark default', () => {
    expect(decl(ROOT, '--glass-surface')).toBe('rgba(34, 37, 30, 0.55)')
    expect(decl(ROOT, '--glass-elevated')).toBe('rgba(42, 45, 36, 0.58)')
    expect(decl(ROOT, '--glass-border-neutral')).toBe('rgba(224, 218, 200, 0.10)')
    expect(decl(ROOT, '--glass-border-accent')).toBe('rgba(201, 168, 76, 0.42)')
    expect(decl(ROOT, '--glass-inner-glow')).not.toBeNull()
  })

  it('--glass-chrome is near-opaque so pinned text never sits on translucency', () => {
    const chrome = decl(ROOT, '--glass-chrome')
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(chrome)?.[1])
    expect(Number.isFinite(alpha)).toBe(true)
    expect(alpha).toBeGreaterThanOrEqual(0.92)
  })

  it('re-states the glass surfaces for the oled theme', () => {
    expect(decl(OLED, '--glass-surface')).not.toBeNull()
    expect(decl(OLED, '--glass-elevated')).not.toBeNull()
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(decl(OLED, '--glass-chrome'))?.[1])
    expect(alpha).toBeGreaterThanOrEqual(0.92)
  })

  it('does NOT define glass on the light theme — §3.2 defers it, deliberately', () => {
    // When the post-launch app-wide token sweep (§10) adapts glass to light,
    // DELETE this test in the same commit. Until then it keeps the deferral a
    // recorded decision instead of an accidental half-migration.
    expect(/--glass-[a-z-]+\s*:/.test(LIGHT)).toBe(false)
  })
})

describe('tokens.css — focus ring + display size (§3.1/§3.2)', () => {
  it('defines --focus-ring', () => {
    expect(decl(ROOT, '--focus-ring')).not.toBeNull()
  })

  it('defines --text-display at ~40px (the 24px scale cap is insufficient)', () => {
    expect(decl(ROOT, '--text-display')).toBe('40px')
  })
})

describe('tokens.css — .t-num utility (§3.2)', () => {
  it('exists as a global class and sets tabular-nums', () => {
    const body = block(TOKENS, '.t-num')
    expect(/font-variant-numeric\s*:\s*tabular-nums/.test(body)).toBe(true)
  })
})

// ─── Controller amendment: computed contrast floor (§3.2) ──────────────────
//
// The glass alpha values above were chosen by the plan author, not measured.
// §3.2's contrast floor is normative now, not deferred to a later polish
// phase — so this composites the dimmest permitted ink (--text-muted) and the
// body ink (--text) over --glass-surface atop --bg and asserts real WCAG AA
// (4.5:1) on the RESULT a user actually sees, not on the flat token in
// isolation (a translucent surface's effective color depends on what's
// behind it).
// ⭐ THE MATH MOVED OUT, IT DID NOT GET COPIED. `srgbToLin`/`relLum`/`contrast`/
// `composite`/`hexRgb`/`parseRgba` used to be private to this file; the D-27
// accent-separation rail (`hub/modeAccentSeparation.test.js`) needs the same
// six, and two copies of one formula are two authorities the moment either is
// touched. They now live in `./__tests__/contrastMath.js` and both rails import them.
// ⚰️ THE PATH IS THE CLASSIFICATION, not tidiness. It sat at `styles/contrastMath.js` and
// `reachable.test.js` correctly reported it as a module no route reaches — it is imported by
// rails and by nothing a member can navigate to, and it never will be. `__tests__/` is what
// that sweep's TEST_INFRA rule already recognises, so saying what the file IS beats filing an
// exemption for what it is not.

describe('tokens.css — glass-surface contrast floor (§3.2, computed)', () => {
  it('--bg is the expected dark canvas (#101012, the catalog Graphite ramp) — sanity check on the fixture', () => {
    expect(decl(ROOT, '--bg')).toBe('#101012')
  })

  // C1: the floor covers every glass surface (--glass-surface/-elevated/-chrome)
  // against both inks permitted on glass (--text-muted, the dimmest; --text,
  // the body ink), for BOTH the dark :root defaults and the [data-theme="oled"]
  // overrides. oled never restates --text/--text-muted (they're theme-invariant
  // ink), so unresolved tokens fall through to :root — the composited color a
  // user actually sees on either theme, not the flat token in isolation.
  const resolveToken = (themeBlock, token) => decl(themeBlock, token) ?? decl(ROOT, token)
  const THEME_BLOCKS = { dark: ROOT, oled: OLED }
  const SURFACES = ['--glass-surface', '--glass-elevated', '--glass-chrome']
  // C1 (extended, P1F-B): --text-bright is the shell's heading ink and now sits
  // on --glass-elevated (the active rail item) and --glass-chrome (banner, rail,
  // footer), so it belongs in the matrix beside the body and dimmest inks.
  // --text-heading (final-wave addendum): IdentityBanner's price line
  // (`.price`, IdentityBanner.module.css) also sits directly on --glass-chrome
  // using this token, so it needs the same computed-contrast proof as the
  // other inks that render on glass.
  const INKS = ['--text-muted', '--text', '--text-bright', '--text-heading']

  const CASES = Object.keys(THEME_BLOCKS).flatMap((themeName) =>
    SURFACES.flatMap((surfaceToken) => INKS.map((inkToken) => [themeName, surfaceToken, inkToken])),
  )

  it.each(CASES)('%s theme: %s meets AA 4.5:1 for %s', (themeName, surfaceToken, inkToken) => {
    const themeBlock = THEME_BLOCKS[themeName]
    const bgRgb = hexRgb(resolveToken(themeBlock, '--bg'))
    const inkRgb = hexRgb(resolveToken(themeBlock, inkToken))
    const { rgb: surfRgb, alpha: surfAlpha } = parseRgba(resolveToken(themeBlock, surfaceToken))
    const composited = composite(surfRgb, surfAlpha, bgRgb)
    expect(contrast(inkRgb, composited)).toBeGreaterThanOrEqual(4.5)
  })
})

// ─── D-24: the hub's glass on a LIGHT theme, measured ──────────────────────
//
// ⛔⛔ THIS FILE ALREADY ASSERTS THE ABSENCE ("does NOT define glass on the light theme — §3.2
// defers it, deliberately"), and `deferred.md` D-24 asks whether that omission leaves the joystick
// hub illegible on white. The answer is a MEASUREMENT, and it is not the one the row's wording
// implies:
//
//   1. THE HUB USES NO `--glass-*` TOKEN AT ALL. Measured across `app/src/hub/**` — every surface
//      it paints is a `--hub-*` token. So the light theme's deliberate `--glass-*` omission, which
//      is what D-24 cites (`tokens.css:432-436` in the row's numbering), cannot reach the hub.
//      The case below asserts that, because it is the whole premise.
//
//   2. THE `--hub-*` TOKENS ADAPT ON THEIR OWN. Each is `color-mix(in srgb, var(--text-heading) N%,
//      transparent)` over a canvas of `--bg`, and the light theme redefines BOTH — so the resting
//      glass composites to a light grey on white exactly as it composites to a dark grey on black.
//      That is why `tokens.css` says of them: "No [data-theme='light'] --hub-* set anywhere in this
//      file — deliberate ... not an oversight for a later sweep to 'fix'."
//
// ⚠️ ONE PAIR IS BELOW AA ON LIGHT AND IT IS NAMED, NOT ROUNDED AWAY: `--text-muted` on
// `--hub-glass-tint-strong` composites to 4.18:1 on white (6.34:1 on the dark default). 4.18
// clears AA-Large (3.0) and misses AA (4.5), and it is pinned from both sides below rather than
// waved through.
//
// ⚰️ CORRECTED AT INTEGRATION (D-37): an earlier version of this comment said that surface was
// "the CURSOR HIGHLIGHT". **It is not, and it was already not when the sentence was written.**
// `[data-hub-cursor="active"]` paints `--hub-cursor-fill` (D-29 gave the cursor its own dial in
// this same increment and moved it off the pressed tier, 20% -> 12%). `--hub-glass-tint-strong` is
// the ACTIONS BUTTON (`hub.module.css`), whose ink is `--text`, not `--text-muted` — that pair
// measures 10.354:1 on light. So this exception is a CROSS-PRODUCT pair, conservative by
// construction, not a surface a member reads muted text on. The cursor's own floors are railed in
// the D-37 block at the bottom of this file, where the real numbers are.
describe('tokens.css — the hub\'s glass carries the light theme too (D-24, computed)', () => {
  const HUB_CSS = read('../hub/hub.module.css')

  /** `color-mix(in srgb, var(--x) N%, transparent)` -> { ref, alpha }. Throws by name rather than
   *  returning a default, so a token that stops being a color-mix fails loudly instead of silently
   *  being measured as something else. */
  function parseColorMix(value) {
    const m = /color-mix\(\s*in\s+srgb\s*,\s*var\(\s*(--[\w-]+)\s*\)\s*([\d.]+)%\s*,\s*transparent\s*\)/.exec(value)
    if (!m) throw new Error(`not a color-mix over transparent: ${value}`)
    return { ref: m[1], alpha: Number(m[2]) / 100 }
  }

  const resolve = (themeBlock, token) => decl(themeBlock, token) ?? decl(ROOT, token)
  const THEMES = { dark: ROOT, oled: OLED, light: LIGHT }

  /** Every `--hub-glass-*` token the hub actually paints a background with — derived from the CSS,
   *  plus the one global cursor rule, which lives in tokens.css rather than the module. */
  const SURFACES = [...new Set([
    ...[...HUB_CSS.matchAll(/background:\s*var\((--hub-glass-[\w-]+)\)/g)].map((m) => m[1]),
    ...[...TOKENS.matchAll(/background:\s*var\((--hub-glass-[\w-]+)\)/g)].map((m) => m[1]),
  ])].sort()

  /** Every `--text*` ink the hub colours text with on those surfaces — also derived. */
  const INKS = [...new Set(
    [...HUB_CSS.matchAll(/color:\s*var\((--text[\w-]*)\)/g)].map((m) => m[1]),
  )].sort()

  const pairContrast = (themeName, surfaceToken, inkToken) => {
    const themeBlock = THEMES[themeName]
    const bg = hexRgb(resolve(themeBlock, '--bg'))
    const ink = hexRgb(resolve(themeBlock, inkToken))
    const { ref, alpha } = parseColorMix(resolve(themeBlock, surfaceToken))
    return contrast(ink, composite(hexRgb(resolve(themeBlock, ref)), alpha, bg))
  }

  it('⛔ THE PREMISE: the hub paints no --glass-* surface, so the light omission cannot reach it', () => {
    // If this ever stops being true, D-24 becomes a real gap and this whole block is measuring the
    // wrong family. Named here rather than assumed in prose.
    expect(HUB_CSS, 'the hub now uses a --glass-* token, which the light theme deliberately omits')
      .not.toMatch(/var\(\s*--glass-/)
  })

  it('the derivation found real surfaces and real inks — the non-vacuity control', () => {
    // Every assertion below is a loop over these two lists; empty lists would pass everything.
    expect(SURFACES, 'no --hub-glass-* background found — the derivation regex is broken')
      .toContain('--hub-glass-tint')
    expect(SURFACES).toContain('--hub-glass-tint-strong')
    expect(INKS, 'no --text* ink found on hub glass — the derivation regex is broken')
      .toEqual(expect.arrayContaining(['--text', '--text-muted']))
    // ⛔ AND THE INK LIST IS NOT HYPOTHETICAL FOR THE CURSOR ROW. `[data-hub-cursor="active"]`
    // paints `--hub-cursor-fill` onto rows the hub does not own; the Screener's phone card is one
    // of them and colours its company line with the dimmest ink. Asserted against that file so the
    // justification cannot rot into a comment nobody re-checked. (⚰️ This said the cursor painted
    // --hub-glass-tint-strong; D-29 moved it to its own token in this increment. Corrected D-37.)
    expect(read('../pages/screener/shell/ScannerShell.module.css'),
      'the screener card no longer uses --text-muted — re-derive which ink the cursor row carries')
      .toMatch(/\.cardCompany\s*\{[^}]*color:\s*var\(--text-muted\)/)
  })

  const CASES = Object.keys(THEMES).flatMap((t) =>
    SURFACES.flatMap((s) => INKS.map((i) => [t, s, i])))

  it.each(CASES)('%s theme: %s clears the 3:1 floor for %s', (themeName, surfaceToken, inkToken) => {
    // ⛔ THE FLOOR THE HUB MUST NEVER DROP BELOW, on any theme. Below this the chip and the cursor
    // row stop being readable rather than merely dim, which is the question D-24 actually asks.
    expect(pairContrast(themeName, surfaceToken, inkToken)).toBeGreaterThanOrEqual(3.0)
  })

  // ⛔ THE ONE EXCEPTION, BY NAME AND NUMBER. Anything not on this list must clear full AA.
  const BELOW_AA = new Set(['light|--hub-glass-tint-strong|--text-muted'])

  it.each(CASES)('%s theme: %s meets AA 4.5:1 for %s, or is the one named exception',
    (themeName, surfaceToken, inkToken) => {
      const measured = pairContrast(themeName, surfaceToken, inkToken)
      if (BELOW_AA.has(`${themeName}|${surfaceToken}|${inkToken}`)) {
        // Pinned from BOTH sides: it must still be the sub-AA case (so a fix deletes this entry
        // rather than leaving a stale exemption behind) and it must not get any worse.
        expect(measured, 'this pair now CLEARS AA — delete it from BELOW_AA rather than leaving an '
          + 'exemption that has stopped describing anything').toBeLessThan(4.5)
        expect(measured, 'the one sub-AA hub pair got WORSE — 4.18:1 was the recorded limit')
          .toBeGreaterThanOrEqual(4.1)
        return
      }
      expect(measured).toBeGreaterThanOrEqual(4.5)
    })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// D-37 — THE CURSOR'S TWO FLOORS, AND WHY THEY NEED TWO DIFFERENT TOKENS.
//
// `[data-hub-cursor="active"]` has one job a member can feel: say "you are here" on a row the hub
// does not own, without making that row's own text harder to read. Those pull in opposite
// directions, and a single token cannot serve both — measured, not argued:
//
//   FLOOR A  the row's dimmest ink (`--text-muted`) on the cursor FILL  >= 4.5:1  (WCAG 1.4.3, AA)
//   FLOOR B  the cursor OUTLINE against the plain row                  >= 3.0:1  (WCAG 1.4.11,
//            non-text contrast — the clause that governs "information required to identify ...
//            states". A cursor highlight is a state indicator, so 3:1 is the standard's own
//            number for it, not one picked to be passed.)
//
// ⛔ THE FILL CANNOT CARRY BOTH. Sweeping `--text-heading` over a white row: Floor A holds only up
// to 16% (4.583:1), where the fill is 1.394:1 against the row; Floor B needs ~48%, by which point
// Floor A has collapsed to ~2.5:1. There is no opacity that satisfies both, which is why the
// OUTLINE carries B and the fill carries A.
//
// ⚰️ AND THE DEFECT THIS BLOCK WAS OPENED FOR HAD ALREADY BEEN FIXED. D-37 was filed on a measured
// 4.18:1 for muted ink on the cursor — a real number taken from `--hub-glass-tint-strong`, which
// had stopped being the cursor's fill earlier in the same increment. On the shipped 12% fill the
// real figure is 5.000:1 (light), 8.458 (dark), 10.142 (oled): Floor A was already met. The live
// gap was Floor B, which nobody had measured: the outline borrowed the knob's `--hub-rim-highlight`
// at 35%, which is 2.202:1 on a white row. The knob's rim sits on glass; the cursor's sits on a
// page. One value could not serve both, so the cursor's outline is now its own declaration at 50%.
describe('tokens.css — the cursor says "you are here" without dimming the row (D-37)', () => {
  const HUB_CSS_D37 = read('../hub/hub.module.css')
  const THEMES_D37 = { dark: ROOT, oled: OLED, light: LIGHT }
  const resolve37 = (themeBlock, token) => decl(themeBlock, token) ?? decl(ROOT, token)

  /** `color-mix(in srgb, var(--x) N%, transparent)` -> composited rgb over `bg`. Throws by name. */
  const mixOver = (themeBlock, token, bg) => {
    const raw = resolve37(themeBlock, token)
    const m = /color-mix\(\s*in\s+srgb\s*,\s*var\(\s*(--[\w-]+)\s*\)\s*([\d.]+)%\s*,\s*transparent\s*\)/.exec(raw)
    if (!m) throw new Error(`${token} is not a color-mix over transparent: ${raw}`)
    return composite(hexRgb(resolve37(themeBlock, m[1])), Number(m[2]) / 100, bg)
  }

  // ⛔ A AND B ARE COMPUTED SEPARATELY, AND THAT IS NOT TIDINESS. The first version returned both
  // from one function, so when `mixOver` threw on the OUTLINE (it throws by name if a token stops
  // being a color-mix) the throw took FLOOR A down with it — and the mutation proof for B reported
  // three FLOOR A failures. A rail whose failure message names the wrong token sends the next
  // reader to the wrong file, which is the whole disease this suite exists to catch.
  const row = (themeName) => hexRgb(resolve37(THEMES_D37[themeName], '--bg'))
  const floorA = (themeName) => contrast(
    hexRgb(resolve37(THEMES_D37[themeName], '--text-muted')),   // the dimmest ink the row carries
    mixOver(THEMES_D37[themeName], '--hub-cursor-fill', row(themeName)),
  )
  const floorB = (themeName) => contrast(
    mixOver(THEMES_D37[themeName], '--hub-cursor-outline', row(themeName)),
    row(themeName),
  )
  const floors = (themeName) => ({ a: floorA(themeName), b: floorB(themeName) })

  it('CONTROL: the cursor rule really reads these two tokens, and nothing else paints it', () => {
    // ⛔ NON-VACUITY, and it is the load-bearing half: if the rule stopped using these tokens the
    // floors below would measure something no member ever sees. Read from the CSS, not assumed.
    const rule = /\[data-hub-cursor="active"\]\s*\{([^}]*)\}/.exec(TOKENS)
    expect(rule, 'the [data-hub-cursor="active"] rule is gone — re-derive what paints the cursor')
      .not.toBeNull()
    expect(rule[1]).toMatch(/background:\s*var\(--hub-cursor-fill\)/)
    expect(rule[1]).toMatch(/outline:[^;]*var\(--hub-cursor-outline\)/)
    // and the ink really is the dim one, on a real row the cursor lands on
    expect(read('../pages/screener/shell/ScannerShell.module.css'))
      .toMatch(/\.cardCompany\s*\{[^}]*color:\s*var\(--text-muted\)/)
  })

  it('CONTROL: the three themes resolve to DIFFERENT numbers, so the loop is not measuring one', () => {
    const all = Object.keys(THEMES_D37).map((t) => floorA(t))
    expect(new Set(all.map((n) => n.toFixed(3))).size,
      'every theme produced the same ratio — the theme cascade is not being applied').toBeGreaterThan(1)
  })

  it.each(Object.keys(THEMES_D37))(
    'FLOOR A — %s: the row\'s muted ink on the cursor fill clears AA 4.5:1', (themeName) => {
      expect(floorA(themeName),
        'the cursor highlight has made the row\'s own text harder to read than AA allows. The fill '
        + 'is the token to move (--hub-cursor-fill); --text-muted belongs to the product, not the '
        + 'hub, and darkening the fill is what breaks this.').toBeGreaterThanOrEqual(4.5)
    })

  it.each(Object.keys(THEMES_D37))(
    'FLOOR B — %s: the cursor outline clears 3:1 against the plain row (WCAG 1.4.11)', (themeName) => {
      expect(floorB(themeName),
        'the cursor no longer reads as "you are here": its outline is under the 3:1 the standard '
        + 'sets for state information. Raise --hub-cursor-outline. ⛔ Do NOT raise the fill to '
        + 'compensate — the fill cannot reach 3:1 without breaking FLOOR A, which is the whole '
        + 'reason these are two tokens.').toBeGreaterThanOrEqual(3.0)
    })

  it('⛔ the outline is the hub\'s OWN token, not the knob\'s rim', () => {
    // The regression this guards: reverting to `var(--hub-rim-highlight)` silently reintroduces
    // 2.202:1 on light, because that token is tuned for a rim sitting on glass.
    expect(decl(ROOT, '--hub-cursor-outline'),
      'the cursor outline borrows --hub-rim-highlight again — that value is tuned for the knob, '
      + 'which sits on glass, and gives 2.202:1 on a white row').not.toMatch(/--hub-rim-highlight/)
  })

  it('⛔ no [data-theme] variant, so no theme island needs a new pin', () => {
    // themeIslands.test.js derives its required set from selectors containing `data-theme`. Keeping
    // both cursor tokens theme-free is what keeps this fix narrow.
    for (const t of ['--hub-cursor-fill', '--hub-cursor-outline']) {
      expect(decl(LIGHT, t), `${t} gained a light-theme variant — every theme island now needs it`)
        .toBeNull()
      expect(decl(OLED, t), `${t} gained an oled variant — every theme island now needs it`).toBeNull()
    }
  })
})
