// app/src/hooks/useExpectedMove.js
// GET /api/research/expected-move/{sym} -> { live, history, history_since, grade }
// One request serves the banner's Setup Grade chip AND the Setup hero — see the
// architecture note in api/routers/expected_move.py.
import useSWR from 'swr'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)

export default function useExpectedMove(sym, reportDate) {
  const s = (sym || '').toUpperCase().trim()
  const qs = reportDate ? `?report_date=${encodeURIComponent(reportDate)}` : ''
  const { data, isLoading } = useSWR(
    s ? `/api/research/expected-move/${encodeURIComponent(s)}${qs}` : null,
    fetcher,
    // The payload is 15-min cached server-side behind serve-stale; a modal is
    // not a ticker tape and re-polling it would re-run the grade fan-out.
    { refreshInterval: 0, revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  return { data: data || null, isLoading: isLoading && !data }
}
