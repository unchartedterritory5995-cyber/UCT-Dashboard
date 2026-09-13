// tools/hub_accent_cvd.mjs — G3-16 (b), measured instead of eyeballed.
//
// "Does high contrast make Wire MORE separable from Journal than the default does?" is the half
// of glass-acceptance G3-16 that does not need a human, and this is the instrument that answers
// it. It adds exactly ONE axis to what `hub/modeAccentSeparation.test.js` already rails:
// **simulated dichromacy**.
//
// ⛔ IT DOES NOT RE-IMPLEMENT THE COLOUR MATH. `contrast()` and `de00()` come from
// `app/src/styles/__tests__/contrastMath.js`, the repo's single authority on "how far apart are
// these two colours". A second ΔE in this file would be a second authority over one value, and
// it would agree with the rail right up until the moment the two disagreed — which is the only
// moment anyone would read this (`lesson_a_second_authority_over_one_value`). The CVD simulation
// below is genuinely new, so it lives here; everything else is imported.
//
// ⚠️ WHAT THIS CANNOT SAY. It measures TOKENS. The bubbles are painted on `backdrop-filter`
// glass over live page content, so what a member sees is a composite of these values with
// whatever is behind them, and "can you tell them apart at a glance" is a perceptual question
// about two greens rather than a distance. G3-16 **(a)** stays the owner's eye. This answers (b).
//
// Usage:
//   node tools/hub_accent_cvd.mjs               # the table
//   node tools/hub_accent_cvd.mjs --self-check  # proves the simulation can see a deficiency
import { contrast, de00, hexRgb } from '../app/src/styles/__tests__/contrastMath.js'

/** The two tokens under test, read from the RUNNING PRODUCTION BUILD on an iPhone 15 Pro /
 *  iOS 17.6 on 2026-09-12 (`getComputedStyle(document.documentElement)`), not from tokens.css —
 *  so the table describes what shipped, not what the tree says shipped. They agree today; the
 *  provenance is recorded because the day they disagree is the day this matters. */
export const TOKENS = Object.freeze({
  wireDefault: '#9FE887',   // --hub-mode-wire, :root
  wireHigh: '#D4FEE4',      // --hub-mode-wire, [data-hub-contrast="high"]
  journal: '#4FB833',       // --hub-mode-journal, both blocks
})

// ── Dichromacy simulation (Viénot, Brettel & Mollon 1999) ────────────────────────────────────
//
// ⭐ WHY A SIMULATION AND NOT THE WCAG RATIO. `modeAccentSeparation.test.js`'s header calls the
// contrast ratio "THE hue-blind viewer's one channel", which is the right instinct and a coarse
// model: it assumes a hue-blind viewer sees luminance only. A dichromat does not — they see a
// reduced but real colour space, and two greens can stay distinguishable in it while their
// luminance ratio says otherwise. This projects each colour onto the dichromatic plane in LMS and
// converts back, so the SAME ΔE00 the sighted row uses can be applied to what they see.
const RGB_TO_LMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
]
const LMS_TO_RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
]
const DICHROMAT = {
  protanopia: [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  deuteranopia: [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
  tritanopia: [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]],
}
export const DEFICIENCIES = Object.freeze(Object.keys(DICHROMAT))

const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
const toLinear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => {
  const clamped = Math.min(1, Math.max(0, c))
  const v = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
}

/** What `hex` looks like to a dichromat of `kind`, as an [r,g,b] triple. */
export function simulate(hex, kind) {
  const m = DICHROMAT[kind]
  if (!m) throw new Error(`unknown deficiency: ${kind}`)
  const linear = hexRgb(hex).map(toLinear)
  return mul(LMS_TO_RGB, mul(m, mul(RGB_TO_LMS, linear))).map(toSrgb)
}

/** One row of the table: how far apart the pair is, for one kind of vision. */
export function separation(kind) {
  const view = kind === 'normal' ? (hex) => hexRgb(hex) : (hex) => simulate(hex, kind)
  const j = view(TOKENS.journal)
  const d = view(TOKENS.wireDefault)
  const h = view(TOKENS.wireHigh)
  return {
    kind,
    defaultDe: de00(d, j),
    highDe: de00(h, j),
    defaultCt: contrast(d, j),
    highCt: contrast(h, j),
    better: de00(h, j) > de00(d, j),
  }
}

function selfCheck() {
  const fails = []
  const de = (a, b) => de00(a, b)

  // 1. A colour is zero distance from itself — the metric is wired up at all.
  if (de(hexRgb(TOKENS.journal), hexRgb(TOKENS.journal)) > 1e-9) fails.push('de00(x, x) is not 0')

  // 2. ⭐ THE CONTROL. A simulation that cannot SEE a deficiency would report every pair
  //    unchanged and every verdict would be the sighted one wearing a costume. Pure red and pure
  //    green are the textbook protanopic confusion pair: they must collapse under protanopia and
  //    must NOT collapse for normal vision. Without this case the whole file could be an
  //    elaborate identity function (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
  const redVsGreenNormal = de(hexRgb('#FF0000'), hexRgb('#00FF00'))
  const redVsGreenProtan = de(simulate('#FF0000', 'protanopia'), simulate('#00FF00', 'protanopia'))
  if (!(redVsGreenNormal > 60)) fails.push(`red/green should be far apart for normal vision, got ${redVsGreenNormal.toFixed(1)}`)
  if (!(redVsGreenProtan < redVsGreenNormal / 2)) {
    fails.push(`protanopia should collapse red/green, got ${redVsGreenProtan.toFixed(1)} vs ${redVsGreenNormal.toFixed(1)}`)
  }

  // 3. Greys carry no hue, so no deficiency may move them. Catches a transposed matrix, which
  //    would otherwise still produce plausible-looking numbers.
  for (const kind of DEFICIENCIES) {
    const [r, g, b] = simulate('#808080', kind)
    if (Math.max(Math.abs(r - 128), Math.abs(g - 128), Math.abs(b - 128)) > 4) {
      fails.push(`${kind} moved a neutral grey to ${[r, g, b].join(',')}`)
    }
  }

  // 4. An unknown deficiency throws rather than silently returning the input.
  let threw = false
  try { simulate('#808080', 'nonesuch') } catch { threw = true }
  if (!threw) fails.push('an unknown deficiency did not throw')

  if (fails.length) {
    process.stderr.write(`SELF-CHECK FAILED:\n  ${fails.join('\n  ')}\n`)
    return 1
  }
  process.stdout.write(
    'SELF-CHECK PASS — the metric is zero on identity, greys survive every deficiency, an unknown\n'
    + `  name throws, and the control fires: red vs green is ${redVsGreenNormal.toFixed(1)} for normal vision\n`
    + `  and ${redVsGreenProtan.toFixed(1)} under protanopia, so the simulation can actually see one.\n`,
  )
  return 0
}

function report() {
  const rows = ['normal', ...DEFICIENCIES].map(separation)
  process.stdout.write(
    `G3-16 (b) — Wire vs Journal, ΔE00 and WCAG ratio\n`
    + `  wire default ${TOKENS.wireDefault} · wire high-contrast ${TOKENS.wireHigh} · journal ${TOKENS.journal}\n\n`
    + `  ${'vision'.padEnd(14)} ${'default ΔE00'.padStart(12)} ${'high ΔE00'.padStart(10)} ${'default ratio'.padStart(14)} ${'high ratio'.padStart(11)}   verdict\n`,
  )
  for (const r of rows) {
    process.stdout.write(
      `  ${r.kind.padEnd(14)} ${r.defaultDe.toFixed(1).padStart(12)} ${r.highDe.toFixed(1).padStart(10)}`
      + ` ${r.defaultCt.toFixed(2).padStart(14)} ${r.highCt.toFixed(2).padStart(11)}   ${r.better ? 'BETTER' : 'NOT BETTER'}\n`,
    )
  }
  const allBetter = rows.every((r) => r.better)
  process.stdout.write(
    `\n  G3-16 (b) = ${allBetter ? 'BETTER' : 'NOT UNIFORMLY BETTER'}`
    + ` — high contrast ${allBetter ? 'increases' : 'does not increase'} the separation for every vision measured.\n`
    + `  ⛔ (a) is NOT answered here. These are token distances; the bubbles are composited over\n`
    + `     glass, and "confusable at a glance" is the owner's eye. See glass-acceptance.md G3-16.\n`,
  )
  return 0
}

process.exit(process.argv.includes('--self-check') ? selfCheck() : report())
