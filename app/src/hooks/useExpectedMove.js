// app/src/hooks/useExpectedMove.js
// GET /api/research/expected-move/{sym} -> { live, history, history_since, grade }
// One request serves the banner's Setup Grade chip AND the Setup hero — see the
// architecture note in api/routers/expected_move.py.
import useSWR from 'swr'
import { sectionFetcher } from '../components/research/sections/sectionFetch'

// TERM-033: a failed read THROWS (sectionFetcher), so SWR retries it. The old `null` was
// final for the modal's life (refreshInterval 0), so one cold-pod failure hid the grade chip
// and the Setup hero until the member closed and reopened the modal. 402 stays absent.
const fetcher = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))

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
