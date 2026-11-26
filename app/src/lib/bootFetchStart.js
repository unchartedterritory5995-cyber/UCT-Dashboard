// Imported FIRST by main.jsx, so these requests leave before the rest of the app's modules evaluate
// (ES modules run in import order; a call written in main.jsx itself would run only after App.jsx).
import { startBootFetches } from './bootFetch'
// ⭐⭐ (2026-11-26, Fred RS load time) and the other-symbol bars windows this page's charts needed last time
import { startBootSecondaryBars } from './bootSecondaryBars'

startBootFetches()
startBootSecondaryBars()
