// Built widget views (wave 8, Task 8.14): the few numbers every inline-SVG view shares. Each view draws in a
// viewBox `W` wide and scales to its container (width 100%), so its text stays in proportion on a phone.
export const W = 600

/** A label short enough for its column, with an ellipsis; the full label stays in the mark's accessible name. */
export function clipText(text, max) {
  const t = String(text ?? '')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** `n` evenly spaced positions across [a, b] (one in the middle when there is one). */
export function spread(n, a, b) {
  if (n <= 1) return [(a + b) / 2]
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

/** A scale from [lo, hi] onto [a, b]; a flat range maps to the middle. */
export function scale(lo, hi, a, b) {
  const span = hi - lo
  return (v) => (span ? a + ((v - lo) / span) * (b - a) : (a + b) / 2)
}

/** An id safe inside `url(#...)` (React's useId carries colons). */
export const svgId = (raw) => String(raw).replace(/[^A-Za-z0-9_-]/g, '')
