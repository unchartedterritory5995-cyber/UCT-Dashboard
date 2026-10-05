import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'

// D-5 (Lane R) — tape + transcript replay of the latest earnings call.
// DARK behind CALL_REPLAY_ENABLED (api/services/call_replay.py).
//
// ⛔ Alignment is never faked. Only an 'aligned' payload places turns on the
//    tape, and it prints its basis (the call's listed start + each turn's
//    offset into the recording). 'unaligned' shows turns by recording time with
//    NO tape; 'no_timed_transcript' says there is nothing to replay.
// ⛔ An empty tape is "could not be read or held none", never a flat line.

const SPEEDS = [30, 60, 120]          // call-seconds per real second
const TICK_MS = 250
const W = 600
const H = 140

const fmtEt = (sec) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
}).format(new Date(sec * 1000))

const fmtOffset = (s) => {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** Index of the last item whose key <= t, or -1. Items sorted by key. */
export function lastAtOrBefore(items, t, key) {
  let lo = 0
  let hi = items.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid][key] <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

function Tape({ bars, cursor, from, to }) {
  const closes = bars.map(b => b.c).filter(Number.isFinite)
  const lo = Math.min(...closes)
  const hi = Math.max(...closes)
  const span = hi - lo || 1
  const x = t => ((t - from) / (to - from || 1)) * W
  const y = c => H - ((c - lo) / span) * (H - 10) - 5
  const pts = bars.filter(b => Number.isFinite(b.c)).map(b => `${x(b.t).toFixed(1)},${y(b.c).toFixed(1)}`)
  const played = bars.filter(b => Number.isFinite(b.c) && b.t <= cursor)
    .map(b => `${x(b.t).toFixed(1)},${y(b.c).toFixed(1)}`)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
         aria-label="Price during the call, one-minute closes" data-testid="replay-tape">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
      {played.length > 1 && <polyline points={played.join(' ')} fill="none" stroke="var(--accent, var(--gain))" strokeWidth="2" />}
      <line x1={x(cursor)} x2={x(cursor)} y1="0" y2={H} stroke="var(--text)" strokeOpacity="0.6" strokeDasharray="3 3" />
    </svg>
  )
}

export default function CallReplayPanel({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useSWR(s ? `/api/research/call-replay/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })
  const aligned = data?.state === 'aligned'
  const win = data?.window
  const [cursor, setCursor] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(60)

  useEffect(() => { setCursor(win ? win.from : null); setPlaying(false) }, [win?.from, win?.to])

  useEffect(() => {
    if (!playing || !win) return undefined
    const id = setInterval(() => {
      setCursor(c => {
        const next = (c ?? win.from) + speed * (TICK_MS / 1000)
        if (next >= win.to) { setPlaying(false); return win.to }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [playing, speed, win])

  const turns = useMemo(() => data?.turns || [], [data])
  const bars = useMemo(() => data?.bars || [], [data])
  const cur = cursor ?? win?.from ?? 0
  const activeTurn = aligned ? lastAtOrBefore(turns, cur, 'at') : -1
  const barIdx = aligned ? lastAtOrBefore(bars, cur, 't') : -1
  const startTs = data?.alignment?.call_start ? Date.parse(data.alignment.call_start) / 1000 : null
  const baseIdx = startTs != null ? Math.max(0, lastAtOrBefore(bars, startTs, 't')) : 0
  const base = bars[baseIdx]?.c
  const now = barIdx >= 0 ? bars[barIdx].c : null
  const chg = Number.isFinite(base) && Number.isFinite(now) && base ? ((now - base) / base) * 100 : null

  let body
  if (error) body = <div className={styles.error} data-testid="replay-unavailable">Call replay is unavailable right now. That is a gap in what we could read, not a finding about {s}.</div>
  else if (!data) body = <div className={styles.note}>Loading the call…</div>
  else if (data.paywalled) body = <div className={styles.note}>Call replay requires a paid plan.</div>
  else if (data.state === 'no_timed_transcript') body = <p className={styles.note} data-testid="replay-none">{data.reason}</p>
  else {
    body = (
      <div data-testid="replay">
        <p className={styles.muted}>
          {data.year && data.quarter ? `FY${data.year} Q${data.quarter} call. ` : ''}
          Transcript: {data.transcript_source}.{aligned ? ` Tape: ${data.tape_source}.` : ''}
        </p>
        {!aligned && <p className={styles.note} data-testid="replay-unaligned">{data.reason}</p>}
        {aligned && (
          <>
            <p className={styles.muted} data-testid="replay-basis">
              Aligned at the listed start, {fmtEt(startTs)} ET. {data.alignment.note}
            </p>
            {data.tape_state === 'ok' && bars.length > 0
              ? <Tape bars={bars} cursor={cur} from={win.from} to={win.to} />
              : <p className={styles.error} data-testid="replay-tape-empty">The tape for this call window could not be read or held no bars, so only the transcript plays.</p>}
            <div className={styles.form}>
              <button type="button" className={styles.button} onClick={() => {
                if (cur >= win.to) setCursor(win.from)
                setPlaying(p => !p)
              }} data-testid="replay-play">{playing ? 'Pause' : 'Play'}</button>
              <select className={styles.select} value={speed} onChange={e => setSpeed(Number(e.target.value))}
                      aria-label="Replay speed">
                {SPEEDS.map(v => <option key={v} value={v}>{v}x</option>)}
              </select>
              <input type="range" min={win.from} max={win.to} step={60} value={Math.round(cur)}
                     onChange={e => { setPlaying(false); setCursor(Number(e.target.value)) }}
                     aria-label="Replay position" style={{ flex: '1 1 160px' }} />
              <span className={styles.muted} data-testid="replay-clock">
                {fmtEt(cur)} ET
                {Number.isFinite(now) ? ` · ${now.toFixed(2)}` : ''}
                {chg != null ? ` (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% vs the call start)` : ''}
              </span>
            </div>
          </>
        )}
        <ol className={styles.hits} style={{ maxHeight: 320, overflowY: 'auto' }}>
          {turns.map((t, i) => (
            <li key={`${t.start_s}-${i}`} className={styles.hit} data-testid="replay-turn"
                data-active={i === activeTurn ? 'true' : undefined}
                style={i === activeTurn ? { borderLeft: '3px solid var(--accent, var(--gain))', paddingLeft: 6 } : undefined}>
              {aligned
                ? <button type="button" className={styles.button} style={{ minHeight: 0, padding: '0 6px', marginRight: 6 }}
                          onClick={() => { setPlaying(false); setCursor(t.at) }}>{fmtEt(t.at)}</button>
                : <span className={styles.muted} style={{ marginRight: 6 }}>{fmtOffset(t.start_s)} into the recording</span>}
              <strong>{t.speaker}</strong>{t.title ? ` (${t.title})` : ''}: {t.text.length > 400 ? `${t.text.slice(0, 400)}…` : t.text}
            </li>
          ))}
        </ol>
      </div>
    )
  }
  return (
    <section className={styles.panel} data-testid="call-replay-panel">
      <h3 className={styles.panelTitle}>Call replay: tape and transcript</h3>
      {body}
    </section>
  )
}
