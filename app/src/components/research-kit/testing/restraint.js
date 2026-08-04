// app/src/components/research-kit/testing/restraint.js
//
// TEST HELPER — never import this from runtime code.
//
// §3.1's restraint rules are normative but were only prose: "gold borders
// appear only on the banner, the ONE hero widget per canvas, and the active
// rail item; maximum one gold data-highlight per canvas". This turns the
// per-canvas half into something a composition test can assert, so decoration
// creep fails a test instead of shipping.
//
// HOW IT WORKS: this suite's vitest config scopes CSS-module classes at
// render time — GlassCard's accent surface carries a class like
// `_accent_382b62` (`_<localName>_<hash>`), NOT the literal string "accent"
// (confirmed by probing GlassCard's rendered output; css:false is NOT in
// effect here, unlike what an earlier draft of this file assumed). A bare
// `.split(/\s+/).includes('accent')` would therefore never match and the
// helper would silently count zero forever — the exact
// "helper that can only pass" failure mode this file exists to prevent. The
// match is instead anchored on the scoped-class SHAPE so it still can't be
// satisfied by a token that merely CONTAINS "accent" (`accentuate`,
// `accented`) the way a raw substring test would.

export const ACCENT_CLASS = 'accent'

const ACCENT_TOKEN_RE = /^_accent_[0-9a-zA-Z]+$|^accent$/

const hasAccent = (el) => {
  const cls = String(el.getAttribute?.('class') || '')
  return cls.split(/\s+/).some((tok) => ACCENT_TOKEN_RE.test(tok))
}

/** How many accented surfaces are inside (or are) `container`. */
export function countAccentSurfaces(container) {
  if (!container) return 0
  let n = hasAccent(container) ? 1 : 0
  for (const el of container.querySelectorAll?.('[class]') ?? []) {
    if (hasAccent(el)) n += 1
  }
  return n
}

/**
 * Throws when a rendered canvas carries more than one accented surface.
 *
 * If you are about to accent a second card in the same canvas, one of them is
 * not the hero (§3.1).
 */
export function expectOneAccentPerCanvas(container) {
  const n = countAccentSurfaces(container)
  if (n > 1) {
    throw new Error(
      `Restraint violation (spec §3.1): ${n} accent surfaces in one canvas; at most 1 is permitted (the hero).`,
    )
  }
  return n
}
