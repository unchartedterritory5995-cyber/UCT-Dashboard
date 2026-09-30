// app/src/components/chart/economic/econSearch.jsx
//
// ─── THE ECONOMIC HALF OF THE SYMBOL SEARCH — LOADED ONLY WHEN IT CAN APPLY ──
//
// ⛔⛔ LAZY, AND THAT IS A BYTE BUDGET, NOT A STYLE. `SymbolSearch` sits in the
// app's entry chunk, which the Notebook first-open budget measures
// (docs/notebook/perf-budgets.json). Everything economic — the chip, the probe,
// the browse list, the row — lives HERE, behind a dynamic `import()` that
// `SymbolSearch` issues only on a chart surface that opted in (`economic`) and
// only once the modal is open. A member who never opens a chart's search pays
// nothing, and a surface that did not opt in (journal, TickerPopup, Watchlists)
// never even asks.
//
// ⛔ DARK BY CONSTRUCTION: `probeEconomic()` resolves true ONLY when
// `/api/econ/catalog` answered 200 with rows for this member. Dark (404),
// unauthenticated (401), unentitled (403) and offline all resolve false, and the
// search then behaves byte-for-byte as it did before economics existed.
/* eslint-disable react-refresh/only-export-components -- a lazily imported module:
   its constants and helpers ride the same dynamic chunk as its two components. */
import { economicCatalog, subscribeEconomic, SOURCE_STATUS } from '../engine/economicSeries'
import { econFacts, economicSubtitle } from './econUi'
import css from './econSearch.module.css'

export const ECONOMIC_CHIP = Object.freeze({ key: 'economic', label: 'Economic', type: 'economic' })

/** The chip row with Economic appended (never inserted: Tab order stays the same). */
export function withEconomicChip(chips) {
  const list = Array.isArray(chips) ? chips : []
  return list.some((c) => c && c.key === ECONOMIC_CHIP.key) ? list : [...list, ECONOMIC_CHIP]
}

/**
 * Resolves true once the catalogue is AVAILABLE for this member; false once it is
 * settled as anything else. A transient failure keeps waiting (the catalogue
 * retries itself) — it never resolves true without a 200.
 */
export function probeEconomic() {
  return new Promise((resolve) => {
    let done = false
    let unsub = null
    const check = () => {
      if (done) return
      const c = economicCatalog()
      if (c.status === SOURCE_STATUS.LOADING) return
      done = true
      if (unsub) unsub()
      resolve(c.status === SOURCE_STATUS.AVAILABLE)
    }
    unsub = subscribeEconomic(check)
    check()
  })
}

/** A catalogue row -> the search-row shape `/api/ticker-search` answers with. */
export function economicSearchRow(row) {
  const f = econFacts(row)
  if (!f) return null
  return {
    ticker: f.id,
    symbol: f.symbol,
    name: row.name || f.name,
    short_name: row.short_name || null,
    type: 'economic',
    exchange: null,
    economic: true,
    agency: (row.source && row.source.agency) || row.agency || null,
    frequency: row.frequency || null,
    units: row.units && typeof row.units === 'object' ? row.units.display : (row.units || null),
    category: row.category || null,
    presentation: f.style,
  }
}

/** The Economic chip's EMPTY-query list: the whole member catalogue, by category. */
export function browseEconomicRows() {
  const c = economicCatalog()
  if (c.status !== SOURCE_STATUS.AVAILABLE) return []
  const rows = c.list.map(economicSearchRow).filter(Boolean)
  const order = []
  for (const r of rows) if (!order.includes(r.category)) order.push(r.category)
  return order.flatMap((cat) => rows.filter((r) => r.category === cat))
}

/** The economic mark — a small bar-chart glyph; never a company logo (no logo.dev). */
export function EconGlyph({ size = 26 }) {
  return (
    <span className={css.glyph} style={{ width: size, height: size }} aria-hidden="true" data-testid="econ-glyph">
      <svg viewBox="0 0 16 16" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="2" y1="14" x2="14" y2="14" />
        <line x1="4" y1="11" x2="4" y2="8" />
        <line x1="8" y1="11" x2="8" y2="4" />
        <line x1="12" y1="11" x2="12" y2="6" />
      </svg>
    </span>
  )
}

/**
 * The inside of an economic result row: the CLEAN NAME is the headline, the
 * display symbol (USCPI) the secondary, `agency · frequency · units` beneath.
 * ⛔ Never a raw provider id, never `ECON:` in the headline.
 */
export function EconRowBody({ r, query, styles, highlighted }) {
  const f = econFacts(r)
  if (!f) return null
  const hl = typeof highlighted === 'function' ? highlighted : (t) => t
  return (
    <>
      <span className={styles.resultLogo}><EconGlyph /></span>
      <span className={`${styles.resultMain} ${css.main}`}>
        <span className={css.head}>
          <span className={css.name}>{hl(r.name || f.name, query, styles)}</span>
          <span className={css.sym}>{hl(f.symbol, query, styles)}</span>
        </span>
        <span className={css.sub}>{economicSubtitle(r)}</span>
      </span>
      <span className={styles.resultRight}>
        <span className={`${styles.typeBadge} ${css.badge}`} title="Economic data series">Economic</span>
      </span>
    </>
  )
}
