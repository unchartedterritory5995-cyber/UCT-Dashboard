// Imported FIRST by main.jsx, so these requests leave before the rest of the app's modules evaluate
// (ES modules run in import order; a call written in main.jsx itself would run only after App.jsx).
import { startBootFetches } from './bootFetch'

startBootFetches()
