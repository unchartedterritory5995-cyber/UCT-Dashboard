// app/src/components/CompareSymbolSearch.jsx -- THE "+ Compare" door.
//
// Every surface that offers "compare this ticker with another" renders this, never a bare
// `<SymbolSearch displayLabel="+ Compare">`. SymbolSearch's default accessible name
// ("QQQ -- click to search a different ticker") describes retargeting the chart and omits the
// visible word, so a screen reader announced the wrong action and a voice-control user could
// not say "Compare" (WCAG 2.5.3). The visible label and the name live here ONCE.
//
// Rail: `CompareSymbolSearch.test.jsx` scans app/src and goes red on a "+ Compare"
// SymbolSearch rendered anywhere else.
import SymbolSearch from './chart/SymbolSearch'

export const COMPARE_LABEL = '+ Compare'

/** The accessible name of the compare door for `sym`. */
export function compareAriaLabel(sym) {
  const s = sym == null ? '' : String(sym).trim()
  return s ? `Compare ${s} with another ticker` : 'Compare with another ticker'
}

export default function CompareSymbolSearch({ sym, onSymbolChange }) {
  return (
    <SymbolSearch
      sym={sym}
      displayLabel={COMPARE_LABEL}
      ariaLabel={compareAriaLabel(sym)}
      onSymbolChange={onSymbolChange}
    />
  )
}
