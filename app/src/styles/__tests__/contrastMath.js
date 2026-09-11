// app/src/styles/contrastMath.js
//
// ONE implementation of "how far apart are these two colours", shared by every
// rail that asks. Nothing in the app imports this — it is test support that
// lives beside `tokens.css` because tokens.css is the thing it measures.
//
// ⛔ WHY IT IS A MODULE AND NOT A COPY IN EACH TEST. `tokens.test.js` already
// carried a private `srgbToLin`/`relLum`/`contrast`/`composite`, and the D-27
// accent-separation rail needs the same four. Two copies of a formula are two
// authorities over one value the moment one of them is touched
// (`lesson_a_second_authority_over_one_value`, `lesson_a_guard_repeated_is_a_
// guard_unproved`). So the copy moved here and both callers import it.
//
// ⭐ THE METRICS ARE NOT INTERCHANGEABLE, and the D-27 row is why:
//   · `contrast()` is WCAG relative luminance. It is the ONLY channel a
//     hue-blind viewer has, which is what makes a low ratio between two
//     hue-adjacent siblings the finding D-27 records.
//   · `de00()` is CIEDE2000 — lightness, chroma AND hue in one perceptual
//     number. It is what a normally-sighted viewer uses, and it is the one
//     that catches a "fix" which separates a pair by walking into a third
//     bubble. (tokens.css already speaks dE00: see the `--ind-warn` comment.)
// A change that improves one and worsens the other has not been verified by
// checking only the one it improves.

/** '#rrggbb' -> [r,g,b] (0-255). Throws rather than returning null: a rail that
 *  silently skips an unparseable token is a rail that passes vacuously. */
export function hexRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim())
  if (!m) throw new Error(`not a hex color: ${hex}`)
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

/** 'rgba(r, g, b, a)' -> { rgb: [r,g,b], alpha }. Alpha defaults to 1 for rgb(). */
export function parseRgba(value) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(value)
  if (!m) throw new Error(`not an rgba() color: ${value}`)
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] != null ? Number(m[4]) : 1 }
}

/** sRGB channel (0-255) -> linear light (0-1). */
export function srgbToLin(c) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of [r,g,b]. */
export function relLum([r, g, b]) {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b)
}

/** WCAG contrast ratio between two opaque [r,g,b], 1..21. Order-independent. */
export function contrast(a, b) {
  const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** Composite `fg` at `alpha` over opaque `bg` — what a translucent surface
 *  actually looks like, which is not what the flat token says. */
export function composite(fg, alpha, bg) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))
}

/** sRGB [r,g,b] -> CIE L*a*b* (D65, the same white point sRGB is defined against). */
export function srgbToLab([r, g, b]) {
  const R = srgbToLin(r)
  const G = srgbToLin(g)
  const B = srgbToLin(b)
  // sRGB -> XYZ (D65), then normalised by the D65 reference white.
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const [fx, fy, fz] = [f(X), f(Y), f(Z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIEDE2000 colour difference between two CIE L*a*b* triples.
 *
 *  Sharma, Wu & Dalal (2005), the formulation with the documented hue-mean and
 *  atan2 discontinuity handling — the two places a naive transcription goes
 *  wrong silently, in the right ballpark, on colours that look fine. Their
 *  published test data is the control in `hub/modeAccentSeparation.test.js`;
 *  ⛔ do not edit this function without running it. */
export function de00Lab([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))))
  const ap1 = (1 + G) * a1
  const ap2 = (1 + G) * a2
  const Cp1 = Math.hypot(ap1, b1)
  const Cp2 = Math.hypot(ap2, b2)
  const hp = (a, b) => {
    if (a === 0 && b === 0) return 0
    const d = Math.atan2(b, a) / rad
    return d < 0 ? d + 360 : d
  }
  const h1 = hp(ap1, b1)
  const h2 = hp(ap2, b2)

  const dL = L2 - L1
  const dC = Cp2 - Cp1
  let dh = 0
  if (Cp1 * Cp2 !== 0) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad)

  const Lbar = (L1 + L2) / 2
  const Cpbar = (Cp1 + Cp2) / 2
  let hbar
  if (Cp1 * Cp2 === 0) hbar = h1 + h2
  else {
    hbar = (h1 + h2) / 2
    if (Math.abs(h1 - h2) > 180) hbar += h1 + h2 < 360 ? 180 : -180
  }

  const T = 1
    - 0.17 * Math.cos((hbar - 30) * rad)
    + 0.24 * Math.cos(2 * hbar * rad)
    + 0.32 * Math.cos((3 * hbar + 6) * rad)
    - 0.20 * Math.cos((4 * hbar - 63) * rad)

  const Sl = 1 + (0.015 * Math.pow(Lbar - 50, 2)) / Math.sqrt(20 + Math.pow(Lbar - 50, 2))
  const Sc = 1 + 0.045 * Cpbar
  const Sh = 1 + 0.015 * Cpbar * T

  const dTheta = 30 * Math.exp(-Math.pow((hbar - 275) / 25, 2))
  const Rc = 2 * Math.sqrt(Math.pow(Cpbar, 7) / (Math.pow(Cpbar, 7) + Math.pow(25, 7)))
  const Rt = -Rc * Math.sin(2 * dTheta * rad)

  return Math.sqrt(
    Math.pow(dL / Sl, 2)
    + Math.pow(dC / Sc, 2)
    + Math.pow(dH / Sh, 2)
    + Rt * (dC / Sc) * (dH / Sh),
  )
}

/** CIEDE2000 between two sRGB [r,g,b]. */
export function de00(a, b) {
  return de00Lab(srgbToLab(a), srgbToLab(b))
}
