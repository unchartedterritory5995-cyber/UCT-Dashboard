# Stream-ingest cutover: the Massive stocks socket leaves `web` (PR6)

Written 2026-11-16. Owner of record for the code: the ingest PRs (PR4b/PR4c on master, PR5a/PR5b = #1434).

## Why

The stocks WebSocket is read inside `web`, sharing one interpreter lock with every request and job.
Measured on production 2026-11-16, 15:30-15:42 ET (`uct-desktop/scripts/proofs/ingest-lag-read.mjs`, which
reads `/api/admin/bars-stream-status` as the synthetic admin): 32% of frames were read while the socket was
PAUSED (receive queue full, 650-870 frames deep), exchange -> pod p90 was 1-15 s in 5 of 13 minutes, and the
reader got the CPU 41-81% of the time it was working. The median was at most 100 ms, so the tail is the
in-web reader. `stream-ingest` (`api/stream_ingest_main.py`, `api/services/ingest_runtime.py`) runs the reader
on its own loop; `web` mirrors its feed (`api/services/feed_client.py`, `STREAM_FEED_SOURCE=remote`, #1434).

## The one rule

**Massive allows ONE stocks connection per key. Never two.** A second connect evicts the first (the June
`max_connections` incident). So the cutover is break-before-make, in both directions:

- `web` in remote mode refuses to open the socket (`bar_stream.start_stream`, "invariant 11").
- `stream-ingest` connects only with `STREAM_INGEST_CONNECT=1`, after `INGEST_CONNECT_GRACE_S` (45 s) from
  boot, and closes the socket first on SIGTERM.
- A `web` redeploy keeps the OLD pod serving until the new one is healthy. The old pod holds the socket
  until it exits. Do not turn ingest on until the old `web` deployment is gone.

(A second connection, $75 a month from Massive, would allow make-before-break. Not bought as of this writing.)

## Preconditions

1. #1434 is merged AND live on `web` (`git merge-base --is-ancestor <its merge> origin/production`).
2. `stream-ingest` runs the same master, `STREAM_INGEST_CONNECT=0`, deployment SUCCESS.
3. **The universe feed moves too.** `web`'s own reader subscribes `AM.*` and forwards every ticker's minutes to
   `bars-api` (`bars_live_ingest`, which keeps the 5m series current). In remote mode `web` has no reader, so
   `stream-ingest` must do it: it runs the same `bar_stream._run_websocket`, which wires `bars_live_ingest` when
   `BARS_UNIVERSE_STREAM_ENABLED=1` and posts to `BARS_ORIGIN_URL` with `PUSH_SECRET`. Set on `stream-ingest`
   (done 2026-11-16, inert until it connects): `BARS_UNIVERSE_STREAM_ENABLED=1`,
   `BARS_ORIGIN_URL=http://bars-api.railway.internal:8080`; `PUSH_SECRET` is the same value on web,
   stream-ingest and bars-api (compared by hash). Without this, 5m charts fall back to waiting on the vendor.
4. A window where trades print, so the result can be seen: premarket (03:00-08:30 CT) or after hours
   (15:00-19:00 CT). The owner has said there are no active members yet, so a short feed gap is acceptable.
5. Baseline recorded: `node scripts/proofs/ingest-lag-read.mjs <out.json> --samples=3 --every=60` (uct-desktop,
   `PROOF_EMAIL`/`PROOF_PASSWORD` = the synthetic admin from `SMOKE_EMAIL`/`SMOKE_PASSWORD`).

## Steps

1. `railway variables --service web --set STREAM_FEED_SOURCE=remote` (this redeploys `web`).
2. Wait until the new `web` deployment is SUCCESS **and the previous one has stopped** (Railway deployments
   list; the old pod's shutdown closes its socket). `/api/admin/bars-stream-status` on the new pod shows
   `"feed_source": "remote"` and a `feed_client` block (`connected` true once ingest's feed server answers;
   it carries nothing yet because ingest has no vendor socket).
3. `railway variables --service stream-ingest --set STREAM_INGEST_CONNECT=1` (redeploys `stream-ingest`).
   It connects to Massive 45 s after boot.
4. Verify, in this order:
   - `stream-ingest` status: `railway ssh --service stream-ingest -- python -m api.stream_ingest_main --status`
     (or `GET /status` with `Authorization: Bearer $PUSH_SECRET` on the private network): connected, frames rising.
   - `web` `/api/admin/bars-stream-status`: `feed_client.connected` true, its counters rising, `resyncs` and
     `protocol_errors` not climbing.
   - The universe feed: `stream-ingest` status `universe` block (events and flushes rising, `flush_errors` flat)
     and `bars-api` still answering 5m tails without a provider wait.
   - A browser: a 1m chart's candle moves (`tick-latency-proof.mjs --syms=SPY --tf=1 --seconds=60 --ext=1`).
   - The timing that motivated this: exchange -> pod at the ingest (its own status), and exchange -> browser
     from the proof. Expect the p90 to drop from seconds to the low hundreds of milliseconds.

## Rollback (also break-before-make)

1. `railway variables --service stream-ingest --set STREAM_INGEST_CONNECT=0`, wait for its new deployment and
   for the old ingest pod to stop (its socket closes on SIGTERM).
2. `railway variables --service web --set STREAM_FEED_SOURCE=local`.

⛔ Use `--set` to a value, not `railway variable delete`: a delete does NOT redeploy, so the running process
keeps the old value (CLAUDE.md, "`--set` REDEPLOYS, `delete` DOES NOT").
