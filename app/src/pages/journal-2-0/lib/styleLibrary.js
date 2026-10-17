/**
 * P3a: the community STYLE library's client lists. LAZY-ONLY: import this file only from
 * the lazy TemplateGallery chunk or the lazy styles chunk, never from an eager Notebook
 * file (the first-open byte budget, R-P3-5).
 *
 * ⛔ ITEM_TYPES, TRADING_STYLES and LIBRARY_SORTS are ONE FACT IN TWO FILES with
 * api/services/journal_two/template_gallery.py; tests/test_style_library.py PARSES this
 * file and holds the keys equal, in order.
 */
export const ITEM_TYPES = Object.freeze([
  { key: 'outline', label: 'Outlines' },
  { key: 'style', label: 'Styles' },
])

export const TRADING_STYLES = Object.freeze([
  { key: 'swing', label: 'Swing' },
  { key: 'day', label: 'Day' },
  { key: 'prop', label: 'Prop' },
  { key: 'options', label: 'Options' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'long_term', label: 'Long-term' },
])

export const LIBRARY_SORTS = Object.freeze([
  { key: 'newest', label: 'Newest' },
  { key: 'most_used', label: 'Most adopted' },
  { key: 'trending', label: 'Trending this week' },
])

export function tradingStyleLabel(key) {
  return TRADING_STYLES.find((t) => t.key === key)?.label || null
}
