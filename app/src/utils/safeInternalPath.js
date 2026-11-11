/**
 * Resolve `raw` against `origin` and return `pathname + search + hash` only when
 * it stays on that origin; otherwise null. Handles relative values such as
 * `/research/SYM` (which `new URL(x)` alone would throw on) and rejects
 * `//evil.example/x`, `/\evil`, `javascript:` and other origins.
 */
export function safeInternalPath(raw, origin) {
  if (typeof raw !== 'string' || !raw || typeof origin !== 'string' || !origin) return null
  // Browsers treat `\` as `/` in special-scheme URLs, so `/\evil` can mean `//evil`.
  if (raw.includes('\\') || /^\s*\/\//.test(raw)) return null
  try {
    const base = new URL(origin)
    const u = new URL(raw, base)
    if (u.origin !== base.origin) return null
    const out = u.pathname + u.search + u.hash
    // Normalisation can yield a protocol-relative path (`/.//evil.com`); refuse it.
    return /^\/(?!\/)/.test(out) ? out : null
  } catch {
    return null
  }
}
