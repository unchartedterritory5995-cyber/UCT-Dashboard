// Is `sym` something the BARS lane (/api/bars, the packs, the warmers) can serve?
//
// A pseudo-ticker is not. The app's synthetic symbols start with `$` (`$IDX:<theme>` is a theme
// index: its bars come from the theme-index route, drawn by hooks/useThemeIndexBars). Sent down
// the bars lane they can never be answered: on 2026-11-15 one click-through of the nav produced
// 123 such requests (about one per theme), each answered `503 warming` + Retry-After, which the
// client took as "ask again". The server now answers them `not_a_bars_symbol` (PR #1397); this is
// the client half, so the request is never made. One rule for every warmer: a shape test, like
// the server's `is_theme_index_symbol`, case-insensitive on the prefix.
export function isBarsSymbol(sym) {
  if (typeof sym !== 'string') return false
  const s = sym.trim()
  return s.length > 0 && s[0] !== '$'
}
