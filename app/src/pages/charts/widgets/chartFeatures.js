/**
 * Host features — the chart-attached research surfaces a ChartWidget can show
 * (the Earnings Strip under the chart, the Company Info side panel), described
 * so the Indicators "Add to Chart" surface can discover, add, remove and manage
 * them next to ordinary indicators.
 *
 * ⛔ NOT INDICATORS. Nothing here touches chart settings, `displayTarget`, pane
 * order or the legend. State stays exactly where it always lived — the widget's
 * `opts.dock` (see chartDock.normalizeDock) — and every function below is a
 * pure dock → dock transform. The Indicators UI only ever sees the descriptors
 * a HOST passes it, so a surface that renders no dock (mobile, popups, the
 * own-chart surfaces) simply has no Research rows.
 */
import { DEFAULT_RIGHT_W } from './chartDock'

export const EARNINGS_STRIP = 'earningsStrip'
export const COMPANY_INFO = 'companyInfo'

// `destination` is where the surface renders; `place` is how a destination is
// WRITTEN — the left-list heading uses the short form, the inspector the long.
const DESCRIPTORS = [
  {
    id: EARNINGS_STRIP,
    name: 'Earnings Strip',
    description: 'Quarterly EPS and revenue, with growth and estimates, in a strip below the chart.',
    tags: ['earnings', 'eps', 'revenue', 'quarterly', 'estimates'],
    destination: 'bottom',
    place: 'Below the chart',
    group: 'Below chart',
    glyph: 'scale',
    singleton: true,
    collapsible: false,
  },
  {
    id: COMPANY_INFO,
    name: 'Company Info',
    description: "Overview, financials, earnings, ownership and news for the company you're charting.",
    tags: ['company', 'profile', 'financials', 'ownership', 'news', 'valuation'],
    destination: 'right',
    place: 'Side panel',
    group: 'Side panel',
    glyph: 'columns',
    singleton: true,
    collapsible: true,
  },
]

export const FEATURE_IDS = DESCRIPTORS.map(f => f.id)

// The descriptors with this dock's live state stamped on. `open` is only
// meaningful for a collapsible feature, and only while it is enabled.
export function chartFeaturesOf(dock) {
  const d = dock || {}
  return DESCRIPTORS.map(f => {
    if (f.id === EARNINGS_STRIP) return { ...f, enabled: !!d.strip }
    return { ...f, enabled: !!d.company, open: !!d.company && !!d.open }
  })
}

// Every transform returns the SAME object when nothing changes, so a refused
// duplicate add (a singleton that is already there) writes nothing.
export function addFeature(dock, id) {
  const d = dock || {}
  if (id === EARNINGS_STRIP) return d.strip ? d : { ...d, strip: true }
  if (id === COMPANY_INFO) {
    if (d.company) return d
    // A NEW add always lands at the designed default width; collapse/expand
    // (setFeatureOpen) never touches the width.
    return { ...d, company: true, open: true, rightW: DEFAULT_RIGHT_W }
  }
  return d
}

export function removeFeature(dock, id) {
  const d = dock || {}
  // stripH survives: re-adding the strip restores the height the member chose.
  if (id === EARNINGS_STRIP) return d.strip ? { ...d, strip: false } : d
  // `open` is cleared too, so a client that predates `company` (a rollback)
  // reads a removed panel as closed rather than resurrecting it.
  if (id === COMPANY_INFO) return (d.company || d.open) ? { ...d, company: false, open: false } : d
  return d
}

export function setFeatureOpen(dock, id, open) {
  const d = dock || {}
  if (id !== COMPANY_INFO || !d.company) return d
  return !!d.open === !!open ? d : { ...d, open: !!open }
}
