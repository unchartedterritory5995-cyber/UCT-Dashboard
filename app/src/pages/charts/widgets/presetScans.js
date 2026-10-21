// app/src/pages/charts/widgets/presetScans.js
//
// The curated preset scans: plain data, so the Notebook's lazily loaded /scanner capture can name the
// member's default scan (the first one, as ScannerPicker lists them) without importing the picker's UI.
// ScannerPicker re-exports PRESET_SCANS, so every existing importer is unchanged.
//
// Preset scans. Each entry { key, name, description }; `key` maps to a scan
// endpoint in ScannerResults. Picking one loads its live results.
//
// ⚠️ EXPORTED SO A TEST CAN READ A LABEL RATHER THAN RETYPE ONE. `6e974ef7`
// renamed two of these and left `ScannerWidget.test.jsx` asserting the old
// string, which went red on master. `name` is display copy and will be renamed
// again; `key` is the wire contract with `/api/scans/<key>` and must NOT move
// silently, so tests derive the name from here and keep the key typed.
export const PRESET_SCANS = [
  {
    key: 'highest-volume-1y',
    name: 'Highest Volume In 1-Year',
    description: 'Trading their highest volume in a year',
    category: 'volume',
  },
  {
    key: 'highest-volume-ever',
    name: 'Highest Volume Ever',
    description: 'Trading their highest volume ever',
    category: 'volume',
  },
  {
    key: 'ipo-1y',
    name: 'IPO in Last 1-Year',
    description: 'First traded within the last year',
    category: 'listings',
  },
  {
    key: 'top-gainers-30d',
    name: 'Top Gainers (30-Day)',
    description: 'Top 5% by 30-day gain',
    category: 'gainers',
  },
  {
    key: 'top-gainers-60d',
    name: 'Top Gainers (60-Day)',
    description: 'Top 5% by 60-day gain',
    category: 'gainers',
  },
  {
    key: 'top-gainers-90d',
    name: 'Top Gainers (90-Day)',
    description: 'Top 5% by 90-day gain',
    category: 'gainers',
  },
]
