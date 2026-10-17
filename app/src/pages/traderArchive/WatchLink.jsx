// app/src/pages/traderArchive/WatchLink.jsx — "Watch at m:ss" on an archive call row: the second of
// a Desk Live Trading Session where the team discussed that call's ticker.
//
// The server adds `watch` [{url, at, session_date, confidence_label, ...}] to call rows only on the
// paid member archive routes and only with WISDOM_CALL_MOMENTS_ENABLED on
// (api/services/wisdom/archive/call_moments.py, the one authority for the match). No field means
// nothing renders, so every surface looks exactly as it did with the gate off.
//
// Only a YouTube watch URL is ever rendered as a link (the server builds it from a video id; this
// refuses anything else rather than trusting a string into an href).

const YOUTUBE_WATCH = 'https://www.youtube.com/watch?'

export function watchOf(call) {
  const w = Array.isArray(call?.watch) ? call.watch[0] : null
  return w && typeof w.url === 'string' && w.url.startsWith(YOUTUBE_WATCH) && w.at ? w : null
}

export default function WatchLink({ call, className }) {
  const w = watchOf(call)
  if (!w) return null
  const when = w.session_date ? `Desk session ${w.session_date}` : 'Desk session'
  return (
    <a className={className} href={w.url} target="_blank" rel="noopener noreferrer"
      title={`${when}: watch the explanation (${w.confidence_label || 'matched'} confidence)`}
      data-testid="archive-watch">
      Watch at {w.at}
    </a>
  )
}
