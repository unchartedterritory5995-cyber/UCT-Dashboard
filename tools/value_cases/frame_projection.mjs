// A HIGHER-TIMEFRAME CALCULATION PLACED ON THE CHART'S BARS, by the product's own function.
//
// An indicator "calculated on daily bars" on a 5 minute chart is computed on the daily bars and then placed on the
// 5 minute bars by `mtfProjection.projectFrameColumns` (every bar of day D shows day D-1's value: the last period
// that had closed before the bar's own began). The value cases must not restate that rule, so they call it.
//
// job.json: { jobs: [{ id, frameBars, columns: {key: [...]}, frame, chartBars, chartTf, newestFinal }] }
// out.json: { jobs: { id: { columns: {key: [number | null]}, stale } } }
import { readFileSync, writeFileSync } from 'node:fs'
import { projectFrameColumns } from '../../app/src/components/chart/engine/mtfProjection.js'

const [jobPath, outPath] = process.argv.slice(2)
const { jobs } = JSON.parse(readFileSync(jobPath, 'utf8'))
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const out = {}
for (const job of jobs) {
  const columns = Object.fromEntries(Object.entries(job.columns || {}).map(([k, col]) => [k, col.map((v) => (v === null || v === undefined ? NaN : Number(v)))]))
  const got = projectFrameColumns(job.frameBars, columns, job.frame, job.chartBars, job.chartTf, { newestFinal: job.newestFinal === true })
  out[job.id] = { stale: got.stale === true, columns: Object.fromEntries(Object.entries(got.columns).map(([k, col]) => [k, Array.from(col).map(num)])) }
}
writeFileSync(outPath, JSON.stringify({ jobs: out }))
