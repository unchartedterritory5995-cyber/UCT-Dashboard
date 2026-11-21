# Universe minute frames: every symbol current to the minute on every device

Branch `feat/universe-minute-frames`. Part of the "any stock, any timeframe, under 20 ms" program:
the first-frame seed (`feat/first-frame-seed`) carries everything up to the last close, the
on-device store (`feat/device-bar-store`) draws from the device, and THIS keeps that device copy
current during the session for every symbol, not only the ones on screen.

## What it is

```
Massive AM.* --> stream-ingest (bar_stream -> bars_live_ingest.universe_am_handler)
                   |-- bars_live_ingest.on_am   (unchanged: 5m/1m to bars-api)
                   '-- minute_frame_publisher   (MINUTE_FRAMES_ENABLED=1 only)
                         one frame a minute -> R2 live1m/<date>/<HHMM>.bin, today.bin, head.json
bars-edge-router Worker  /api/hist/live1m/v1/<date>/...  (entitled members only; edge-cached)
browser  app/src/lib/minuteFrames  (lazy)  poll -> decode -> rollup 1m->5/15/30/60/60e/D -> sink
```

| Piece | File |
| --- | --- |
| Format (pure codec) | `api/services/minute_frames.py` |
| Publisher (flag, default OFF) | `api/services/minute_frame_publisher.py` |
| Hook (identity when off) | `bars_live_ingest.universe_am_handler / start_minute_frames / note_gap_connect`, called from `bar_stream._connection_loop` |
| Edge route | `edge/bars-edge-router/live1m.js` (dispatched first in `worker.js`) |
| Browser | `app/src/lib/minuteFrames/{codec,rollup,consumer,memorySink,index}.js` |
| Size tool | `tools/minute_frames_measure.py <flat-file day>` |

## The format (v1)

A frame (`UMF1`): 28-byte header (day, seq = minutes since 04:00 ET, prev_seq, epoch, unix minute,
flags), a front-coded symbol table, then blocks: the minute's own bars (ONTIME), plus any LATE
bars (a minute already published, symbol never seen) and REPLACE bars (vendor correction). Each
record: symbol-index gap, one scale byte, O and C-O, H-max(O,C), min(O,C)-L as zigzag varints of
integers at the smallest exact decimal scale (0-8), volume likewise; anything not exact at any
scale travels as float64. Exact by construction: the reader's `n / 10**k` is the IEEE division the
writer verified. CRC-32 at the end. Stored gzip; the edge sends it with `Content-Encoding: gzip`
(no Brotli anywhere). `today.bin` (`UMT1`) is every frame of the day as published, trailer last,
so the publisher keeps ONE running gzip stream and a roll costs ~10 ms, not a re-compress.

Gaps are explicit: the publisher writes an EMPTY frame for a quiet minute (so a missing one is
detectable), flags a minute INCOMPLETE when the vendor socket was not live in its delivery window,
and links frames by `prev_seq` (a restart resumes `today.bin` from R2 and links past the hole).

## Measured: 2026-11-18, the whole market's minute aggregates (1,919,652 bars, 11,965 symbols)

`python tools/minute_frames_measure.py <day>.csv.gz` (every frame decoded back, value for value):

| | records/min RTH (median / max) | frame gzip RTH median | frame max | session total | today.bin at 16:00 |
| --- | --- | --- | --- | --- | --- |
| cap universe (3,639) | 2,527 / 3,454 | 26.8 KB | 46.2 KB | 11.6 MB | 11.0 MB |
| full market | 4,379 / 8,503 | 43.6 KB | 100.8 KB | 19.3 MB | 18.3 MB |
| full market + `av` | | 76.9 KB | 138.5 KB | 33.7 MB | 32.1 MB |

About 10 bytes per bar after gzip. Encode + gzip: median 4.5 ms, max 112 ms (on a worker thread).
`av` (the vendor's day volume) costs +75% for one D-volume detail, so `MINUTE_FRAMES_WITH_AV`
stays 0 and the D bar sums the minutes. Levers measured, not taken: a columnar record layout
-7.7%; integer volume -9% (the flat files carry fractional volume on 29% of rows; the socket may not).

## The day's daily bar after the close (FLAG_DAILY, `MINUTE_FRAMES_WITH_DAILY`, default off)

Minutes cannot give two parts of today's D bar: the OFFICIAL close (the closing auction; equal to the
15:59 close for 9 of 57 symbols on 2026-11-20) and the consolidated day volume (a median 16% above the
regular-minute sum). The server has both: bars-api writes today's D row from the whole-market snapshot
`day` object, and /api/bars?tf=D serves it. With the flag on, every frame from the regular close
(16:00 ET, 13:00 on a half day) to 20:00 carries a DAILY section (flag bit 2, after the blocks, before
the CRC): varint count, then records in the block layout without `av`, one per symbol, for `day`.

- **Same source, same parse.** stream-ingest reads the same snapshot (in a CHILD process, every
  `MINUTE_FRAMES_DAILY_POLL_S`, default 30 s, only inside that window: parsing ~13k tickers holds the
  GIL 150-230 ms) and parses it with bars-api's own `bars_live_store.daily_rows_from_snapshot`: the
  same symbols (`BCpC` is not `BCPC`), unrounded prices, whole-share volume. No row unless
  `massive._regular_session_has_opened_today()` (a holiday's `day` is the prior session). The row
  equals the STORED D row; the served one differs only if `bars_sanitize` changes today's bar (a
  lone bad-print wick clamp), which the Monday check would show.
- **Every symbol once, then changes.** The first post-close frame of a publisher epoch carries every
  symbol; later frames only the rows that changed. A reader keeps the newest row per symbol, so
  replaying `today.bin` in order (or the minute files after it) gives the current row.
- **Size, today's real frames (2026-11-20, 15,300 symbols with a regular-session row):** the 16:00
  frame 29.5 KB -> 194 KB gzip; after-hours frames +3-6 KB each (rows = the symbols that printed that
  minute); 16:00-19:07 +1.06 MB on a 20 MB today.bin. Every row in every frame would be ~190 KB a
  frame, ~46 MB a day: why only changes ride.
- **Arm only after the device reads it.** A decoder that does not know bit 2 refuses the frame
  (`trailing bytes`, in Python and in `codec.js`), never misreads it, so today's device would lose
  the post-close frames until its decoder reads the section. Arm (after hours: a `--set` restarts
  stream-ingest): `railway variables --service stream-ingest --set MINUTE_FRAMES_WITH_DAILY=1`.
  Check after the close: `python tools/forming_daily_check.py` prints
  `frames' DAILY row == the server's D bar` per symbol. Rollback: `--set MINUTE_FRAMES_WITH_DAILY=0`.

## Channel: R2 + the edge, not a broadcast on stream-edge

| | R2 + edge (chosen) | one broadcast channel on stream-edge |
| --- | --- | --- |
| Fan-out | CDN; a minute file is read from R2 once per data center, then from the Worker's Cache API | one process writes every byte to every open device |
| Connection caps | none (a GET a minute) | `STREAM_MAX_SUBSCRIBERS` 300 per stream per process; stream-edge is single-process by design |
| Load where latency matters | none on the chart stream | ~44 KB x every device in a burst each minute, on the loop that is meant to deliver chart bars without pauses (the reason stream-edge exists) |
| Catch-up after a gap / cold open | free: every minute is addressable, `today.bin` replays the day | a replay ring of the day (~19 MB) + Last-Event-ID + still a snapshot path for a cold open |
| Egress | $0 (R2 and Workers bill no egress) | Railway egress, ~17 MB per device per session |
| Writes | 960 frames + 960 heads + 192 rolls a day, ~44k Class A a month (~$0.20) | none |
| Requests | ~1 per device per minute: 300 devices all session is ~2.5-6 M a month (inside Workers Paid's 10 M; the FREE plan's 100k/day would not hold it) | none |
| Latency | the minute's frame lands ~7-10 s after it closes (5 s grace + poll jitter) | ~1-2 s |

The latency difference does not matter for this job: charts on screen keep the sub-second push
stream; this keeps everything else current to the minute.

## Client API

```js
const { createMinuteFrameConsumer } = await loadMinuteFrames()      // lib/minuteFrames/index.js, lazy
const c = createMinuteFrameConsumer({ sink })                         // base, fetchImpl, isVisible, rollup opts
c.start()            // polls once a minute (respects isAppVisible), catches up on start/visible
await c.syncNow()    // catch up now
c.status()           // { day, lastSeq, frames, gaps: [{fromSeq, toSeq, reason}], rollup: {...} }

sink = {
  upsert(sym, tf, bar, final),   // tf '1' | '5' | '15' | '30' | '60' (session grid) | '60e' (clock grid) | 'D'
                                 // bar { t (unix s; D = UTC midnight of the ET date), o, h, l, c, v, partial? }
  stale(sym, tf, t),             // a bucket the rollup can no longer vouch for (an inexact correction)
  gap({ day, fromSeq, toSeq, reason, fromMinute, toMinute }),  // not-published | not-received | incomplete | link-mismatch
  reset({ day }),                // a new trading day
  frameDone({ day, seq, minute }),
}
```

Buckets are the chart's own helpers (`barTime.bucketStartUnix`, `liveBuckets.bucketEndUnix`);
`rollup.test.js` holds them to the SERVER's buckets (`bar_rollup.tv_bucket_bounds`) for a whole
regular day and a 13:00 half-day, bar for bar. D = regular-session O/H/L/C (the TradingView daily
candle the charts draw), volume = every 04:00-20:00 minute.

## Turning it on (owner)

1. **Merge outside market hours.** `bar_stream.py` and `bars_live_ingest.py` are on stream-ingest's
   watch list, so the merge redeploys it (a Massive reconnect). With the flag unset it behaves
   exactly as before. Then `python tools/railway_stored_settings.py --apply --service stream-ingest`
   (this branch adds the two new modules to `railway.ingest.json`'s watch paths).
2. **R2.** Frames go to `DATA_SYNC_BUCKET` unless `MINUTE_FRAMES_BUCKET` names another. Add a
   lifecycle rule on prefix `live1m/`: delete after 7 days (~40 MB a session day).
3. **stream-ingest variables**, outside market hours (a `--set` redeploys): confirm by name that
   `DATA_SYNC_ENDPOINT_URL`, `DATA_SYNC_ACCESS_KEY`, `DATA_SYNC_SECRET_KEY`, `DATA_SYNC_BUCKET` exist on
   stream-ingest (`railway variables --service stream-ingest --kv`, names only), then
   `railway variables --service stream-ingest --set MINUTE_FRAMES_ENABLED=1`.
4. **Cloudflare.** Workers & Pages -> `bars-edge-router` -> Settings -> Bindings: R2 bucket `LIVE1M`
   = the same bucket. Deploy `worker.js` with `live1m.js` (and the files it already ships). No new
   route and no cookie change: the path is under `/api/hist/`, which the member's edge cookie and
   the existing Worker Route already cover. Check the account is on Workers Paid (see the table).
5. **Verify on the next session.** stream-ingest `/status` (PUSH_SECRET) shows
   `runtime.upstream.universe.minute_frames` with `frames` rising once a minute and `upload_errors` 0.
   Signed in: `https://uctintelligence.com/api/hist/live1m/v1/<YYYY-MM-DD>/head.json` answers JSON;
   `<HHMM>.bin` answers `x-bars-edge: live1m`, then `live1m-edge` on a second read.
6. **Browser.** Nothing to flip: the device store wires `loadMinuteFrames()` with its own sink.

Rollback: `railway variables --service stream-ingest --set MINUTE_FRAMES_ENABLED=0` (a delete does
not restart the process). Removing the `LIVE1M` binding makes the route answer 503 and clients
back off.

## Tests (each proven able to fail: 25 mutants, all red; the unmutated runs green)

- `tests/test_minute_frames.py`: exact round trip (3,000 random decimal bars bit for bit; raw
  float64 fallback; av), damaged frames refused, the publisher (one frame a minute, empty minutes,
  frame-before-head ordering through a failed upload, late/replace/repeat, INCOMPLETE, restart
  resume and linking, session bounds), flag OFF hands bar_stream the same `on_am`, the fixtures.
- `app/src/lib/minuteFrames/*.test.js`: the Python encoder's bytes decoded in JS; rollup equality
  with the server for a regular day and a half-day; catch-up (cold open, after a sleep, short
  absence) ends in the same state as a device that was live all day; gaps by reason; visibility.
- `edge/bars-edge-router/live1m.test.mjs`: publisher bytes -> R2 -> Worker -> real HTTP gzip ->
  the browser decoder; entitlement; edge cache only for minute files; path bounds.
