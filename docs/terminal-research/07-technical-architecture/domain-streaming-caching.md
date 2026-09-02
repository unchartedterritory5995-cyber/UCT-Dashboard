---
id: C7-01
title: Streaming, caching and load architectures for terminals
role: Domain pod — streaming, caching and load architectures
wave: 1b
group: C
category: domain
scope: How financial terminals and trading UIs move market data to a browser — transports, multiplexing, fan-out, backpressure/conflation, cache layers by data class, aggregation endpoints, market-open spikes, browser limits, graceful degradation
confidence: 🟡
evidence_ceiling: WebSearch quota was exhausted before this role began, so discovery was limited to URLs nameable in advance plus one browser tab. Bloomberg, Lightstreamer, Interactive Brokers and TradingView's own docs returned 403/404 to WebFetch. No engineering material from a *terminal vendor* (as opposed to a data vendor or an infrastructure vendor) was reachable, so every claim about how a named commercial terminal moves data internally is ABSENT, not weak. The patterns below come from standards bodies, infrastructure vendors and market-data vendors, generalised.
sources: 18 primary (4 standards + 14 official vendor/product documentation); 3 secondary (2 vendor engineering/education pages, 1 professional pattern reference)
uct_relevance: high
status: draft
date: 2026-09-02
---

# Streaming, caching and load architectures for terminals

**What this document is.** A survey of *publicly documented* mechanisms for moving
market data into a long-lived, multi-panel browser client, and of the cache layers
behind them — assembled so ARCH-07 can make transport and caching decisions for
TERMINAL-NEXT against evidence rather than folklore. Benchmarks are sources of
learning: "vendor X does Y" never means "UCT should do Y".

**The two internal reports this contract names were read first** and are the baseline
every RELEVANCE section is written against:

- `07-technical-architecture/current-performance-and-realtime.md` (D-05) — five live
  transports, of which the browser sees SSE and polling only; client-side pooling into
  ~2 connections per browser; `STREAM_MAX_SUBSCRIBERS=300` per stream family; six cache
  layers; five shed-capable semaphores; a single-replica uvicorn pod.
- `01-existing-system/backend-archaeology.md` (D-02 §1–2, §6–7) — one FastAPI process,
  1,187 routes, 143 scheduled jobs, ~34 boot threads, 54 SQLite databases, seven cache
  layers with no single policy over them, and **no server WebSocket endpoint anywhere**.

Two internal facts govern everything below and are stated once rather than repeated:
the web pod is **one uvicorn process on one event loop** (multi-worker is unsafe because
SSE and live-price state are in-process), and its **SQLite databases live on one
volume**, which is why jobs cannot move off it wholesale.

---

## 1. TRANSPORT — the browser-side ceiling is HTTP version, not transport choice

### OBSERVATION
The most-cited reason to prefer WebSocket over SSE — the six-connections-per-origin
limit — is an **HTTP/1.1** property that HTTP/2 removes. Under HTTP/2 the ceiling
becomes the negotiated concurrent-stream limit, conventionally 100.

### EVIDENCE
- MDN, *Using server-sent events* (official documentation; fetched 2026-09-02): SSE
  "suffers from a limitation to the maximum number of open connections … the limit is
  _per browser_ and is set to a very low number (6)"; and "When using HTTP/2, the maximum
  number of simultaneous _HTTP streams_ is negotiated … (defaults to 100)." [S1] —
  VERIFIED.
- WHATWG HTML Standard, *Server-sent events* (official standard; fetched 2026-09-02):
  the spec names the mitigations for the per-server limit — "using unique domain names
  per connection", per-page enable/disable, "or by sharing a single EventSource object
  using a shared worker." It specifies the `retry` field (reconnection time in ms) and
  that the client sets `Last-Event-ID` on reconnect. [S2] — VERIFIED.
- RFC 9113 (HTTP/2; official standard; fetched 2026-09-02): for
  `SETTINGS_MAX_CONCURRENT_STREAMS`, "Initially, there is no limit to this value", and
  "It is recommended that this value be no smaller than 100, so as to not unnecessarily
  limit parallelism." Exceeding it is a stream error (`PROTOCOL_ERROR`/`REFUSED_STREAM`).
  The initial flow-control window is 65,535 octets. [S3] — VERIFIED.
- Ably, *Server-Sent Events* topic page (official vendor education page, updated
  2023-06-28; fetched 2026-09-02): HTTP/1 "limited the number of concurrent HTTP
  connections per domain to six"; HTTP/2 "eliminates this connection limit and is
  available in more than ninety-six percent of browsers". Recommends SSE where "you
  mostly need to send updates one-way from the server to the client only" — tickers,
  notifications, progress — and explicitly *not* for chat, because typing indicators and
  presence need simultaneous bidirectional flow. [S4] — CLAIMED (vendor).

### INTERPRETATION
For a one-way market-data feed, SSE and WebSocket are not separated by capability; they
are separated by what the *server* pays per connection and by whether the client needs
to talk back on the same channel. The client-side argument for WebSocket evaporates
under HTTP/2 — the server-side cost does not, and it is the server side that binds a
single-process pod.

One asymmetry survives: SSE's resume story is *in the standard* (`retry`,
`Last-Event-ID`), whereas WebSocket resume is whatever the application invents.

### RELEVANCE TO UCT
D-02 §5 records **zero server WebSocket endpoints**; every client-facing stream is SSE,
and the one file describing a client WebSocket (`app/src/useFlowWebSocket.js`) is dead
code pointing at a route that does not exist. TERMINAL-NEXT inherits SSE by default, and
on this evidence the inheritance is defensible rather than merely historical. The binding
constraint named in D-05 is **not** the browser's six connections — the client pools
already collapse N panels to ~2 connections — it is `STREAM_MAX_SUBSCRIBERS=300` **per
stream family across all users**, i.e. roughly 300 concurrent browsers.

### CONFIDENCE
🟢 for the standards facts. 🟡 for "therefore SSE is right for TERMINAL-NEXT" — an
inference, and ARCH-07's to make.
**CEILING:** no evidence was reachable on what any *named commercial terminal* uses
between its server and its browser client.

### RECOMMENDATION (hypothesis)
Treat transport as settled unless a panel needs high-rate client→server messaging (order
entry, collaborative cursors). Spend the design budget instead on *what one connection
costs the server*, which is where this architecture actually runs out.

### OPEN QUESTION
Do UCT's SSE streams emit an `id:` field and honour `Last-Event-ID` on reconnect? D-05
documents named heartbeats and transition-only `stale`/`fresh` events but no event ids.
Without them every reconnect is a cold resubscribe and the gap is invisible.

---

## 2. SUBSCRIPTION MULTIPLEXING — the industry shape is "one connection, a mutable symbol set"

### OBSERVATION
Market-data vendors converge on one wire pattern: a single authenticated connection,
then explicit `subscribe`/`unsubscribe` messages carrying per-channel symbol lists, with
`*` as the whole-market wildcard. Entitlement is enforced at *authentication*, not per
message.

### EVIDENCE
- Alpaca, *Real-time stock pricing data* (official API documentation; fetched
  2026-09-02): subscription is one JSON message naming several channels at once —
  `{"action":"subscribe","trades":["AAPL"],"quotes":["AMD","CLDR"],"bars":["*"]}` — and
  message types are trades (`t`), quotes (`q`), bars (`b`/`d`/`u`), corrections, cancels,
  LULDs, trading status and imbalances. Feeds are separate endpoints: "v2/sip is the SIP
  … feed", "v2/iex is the IEX … feed", "v2/delayed_sip is a 15-minute delayed SIP feed",
  and "Any attempt to access a data feed not available for your subscription will result
  in an error during authentication." [S5] — VERIFIED.
  ⚠️ That page does **not** document per-account connection counts or symbol caps — a gap
  in the source, not a finding.
- Massive (the vendor formerly reachable at polygon.io — `polygon.io/docs/...`
  **301-redirects to `massive.com/docs/...`**, observed 2026-09-02): the per-minute
  aggregate WebSocket channel's `ticker` parameter accepts "a single ticker, multiple
  comma-separated tickers, or `*` for all stocks", emitting `ev`, `sym`, OHLC, `v`/`av`
  volumes and window start/end timestamps. [S6] — VERIFIED. Connection and symbol limits
  are **not** documented on that page.
- FINOS FDC3 2.2, *API specification* (official standard; fetched 2026-09-02): "User
  channels facilitate the creation of user-controlled context links between applications
  (often via the selection of a color channel)", with eight recommended coloured
  channels; an app joins **one** user channel at a time; App Channels are created
  programmatically and are non-discoverable; a broadcast context is not delivered back to
  the broadcasting app. [S7] — VERIFIED.

### INTERPRETATION
Two different multiplexing layers are in play and must not be conflated. The *transport*
layer multiplexes symbols onto one socket (Alpaca, Massive). The *workspace* layer
multiplexes **intent** — which panels are looking at the same instrument (FDC3 user
channels). UCT already has both: `priceStreamManager` unions tickers into 50-ticker
buckets, and `/charts` has four colour link groups. FDC3 is the standard vocabulary for
the second, and its "eight coloured channels, join exactly one" rule is a more
disciplined form of what UCT built independently.

### RELEVANCE TO UCT
The union-then-chunk client pool is the single most valuable property D-05 identifies:
"any Terminal-Next panel that opens its own stream instead of joining the pool converts a
300-connection budget into a 300/N-user budget." The vendor pattern says the same thing
one layer up — the subscription set is a *derived* quantity, the union of what panels
want, never a per-panel connection.

### CONFIDENCE
🟢 for the wire patterns quoted. 🔴 for per-vendor connection/symbol caps, which none of
the reachable pages documented.

### RECOMMENDATION (hypothesis)
Make the panel API declarative — a panel *declares* `{symbols, channels, cadence}` and
never opens a transport — so pooling is structural rather than a convention a future
panel author can forget. Adopt FDC3's channel vocabulary for link groups even if no FDC3
desktop agent is ever used: it is free, it is the language finance front-end engineers
already speak, and it leaves the interop door open.

### OPEN QUESTION
Massive's per-key concurrent-connection limit is load-bearing for UCT (project memory
records ~1 connection per key, and D-05 records that a deploy-swap tape gap "needs
Massive's 2nd concurrent connection"), yet it is undocumented on the public pages
reachable here. Is it contractual, and has a second connection ever been requested?

---

## 3. FAN-OUT — every documented broker converges on "bound the queue, drop, and count"

### OBSERVATION
The three fan-out substrates a terminal would plausibly reach for — an in-process hub,
Redis Pub/Sub, NATS — differ in topology but give the *same* answer to the slow-consumer
problem: never block the producer, bound the pending buffer, make the loss observable.

### EVIDENCE
- Redis, *Pub/sub* (official documentation; fetched 2026-09-02): "Redis' Pub/Sub exhibits
  _at-most-once_ message delivery semantics", and "If the subscriber is unable to handle
  the message (for example, due to an error or a network disconnect) the message is
  forever lost." Subscribers "receive the messages in the order that the messages are
  published." Sharded Pub/Sub (Redis 7.0+) "restricts the propagation of messages to be
  within the shard of a cluster", which is how it scales horizontally; Redis Streams is
  named as the stronger-guarantee alternative. [S8] — VERIFIED.
- NATS, *Slow consumers* (official documentation; fetched 2026-09-02): a slow consumer is
  "a subscriber whose pending buffer fills faster than the handler drains it". On
  overflow, "most clients drop that message and fire the async error callback with a
  slow-consumer error rather than blocking the read loop"; on the server side, if a
  client reads too slowly, "the server gives up on that client and closes the whole
  connection." Go-client defaults are "500,000 messages and 64 MB", called generous
  enough to hide silent loss. Guidance: always set pending limits, always wire the async
  error callback because "a quiet drop is worse than a crash", and prefer queue groups
  over bigger buffers. [S9] — VERIFIED.

### INTERPRETATION
The doctrine is unanimous, and it is not about throughput — it is about *where the
failure surfaces*. An unbounded queue turns a slow consumer into a memory leak; a
blocking queue turns one slow consumer into a global stall; a bounded, counted, dropping
queue turns it into a number somebody can alert on. Substrate choice is then a scaling
question (one process → in-process hub; many processes → Redis/NATS), not a correctness
one.

The corollary matters more than the doctrine: **at-most-once fan-out cannot be the sole
delivery path for anything that must be complete.** A tape of options prints is exactly
that kind of data.

### RELEVANCE TO UCT
D-05 shows UCT already implements the doctrine three times without a broker:
`bar_broadcaster.subscribe()` returns `asyncio.Queue(maxsize=64)` and `_safe_put` drops
the **oldest** while incrementing `_bars_dropped_total`; `massive_stream` uses
`maxsize=500` drop-oldest with `MAX_SUBSCRIBERS=300`; `chat_stream` drops *ephemeral*
events (presence/typing) once a queue is half full but never real messages. The
completeness corollary is already answered too: the options tape is not a pure fan-out —
a single tailer reads `flow.db` for `id > last_seen` ("one cheap query/sec total,
independent of client count") and the client runs a 20 s reconcile poll underneath the
stream. That is the durable-log-plus-catch-up shape Redis Streams exists to provide,
built out of SQLite.

The genuinely new question is multi-instance: every one of these hubs is in-process, and
D-02 records the same constraint in a second place — the Finnhub 60/min budget is
"explicitly documented as process-local — a multi-process deployment would need a DB- or
Redis-backed budget".

### CONFIDENCE
🟢 for the documented semantics of Redis and NATS, and for UCT's current shape (read from
D-05/D-02). 🔴 for any claim about how a commercial terminal fans out internally.

### RECOMMENDATION (hypothesis)
Do **not** introduce a message broker for TERMINAL-NEXT on the current topology — it adds
an operational dependency to solve a problem (cross-process fan-out) the architecture
does not yet have. Instead write down the *trigger condition* — "is this hub reachable
from more than one process?" — next to the in-process hubs now, so the migration is a
decision rather than a discovery. The counters that already exist
(`bars_dropped_total`, `fh_budget_denied_total`) are the right tripwires.

### OPEN QUESTION
Are the drop counters actually *watched*? D-05 records that
`/api/admin/bars-stream-status` publishes them and that a flat `bars_emitted_total` with
non-zero subscribers during RTH means "push is silently dead" — but no artifact records
anyone reading it on a schedule.

---

## 4. BACKPRESSURE AND CONFLATION — the two levers are rate and payload

### OBSERVATION
Two independent techniques reduce what a slow client must absorb, and they compose:
**conflation** (fewer messages, each carrying the latest state) and **delta encoding**
(same number of messages, each smaller). Conflation is only sound for last-value-wins
data.

### EVIDENCE
- Ably, *Delta compression* (official product documentation; fetched 2026-09-02): "Delta
  mode is a way for a client to subscribe to a channel so that message payloads sent
  contain only the difference between the present message and the previous message sent
  on the channel", claimed to "reduce bandwidth costs and transit latencies". Three
  constraints are stated plainly: "Deltas rely on consistent message ordering"; a delta
  is not sent if it "is not appreciably smaller than the original"; and after a channel
  discontinuity "a non-delta message will be delivered … as the first message".
  Encrypted payloads gain nothing. [S10] — CLAIMED (vendor documentation; no measured
  figures given).
- NATS [S9] supplies the rate-side lever in its negative form: queue groups — "more
  subscribers sharing the load" — rather than larger buffers.
- Databento, *Beyond 40 Gbps: Processing OPRA in real-time* (vendor engineering blog,
  2025-09-05; fetched 2026-09-02): OPRA carries "over 200 billion regional quotes and
  NBBO updates per day" across "96 separate channels", and "peak bursts can exceed
  50 Gbps". Their mitigations are all forms of *doing less, earlier*: drop ~80 % of
  exchange updates that do not affect the NBBO before processing; shard 96 channels into
  eight groups of twelve with a 4 GB NIC buffer each; and move subsampled-schema
  computation **out of band**, because doing it in-band introduces "stalls that can last
  a few milliseconds, and that's just enough time to start dropping packets". [S11] —
  REPORTED (vendor describing its own infrastructure; not independently verifiable).

### INTERPRETATION
Databento's "a few milliseconds is enough to start dropping packets" is the same lesson
as UCT's `_bg_delta_sem = 6`, whose comment records that unbounded background delta
fetches "starved the single async loop for seconds (all live streams froze at once)" —
five orders of magnitude apart in scale, identical in shape: *any synchronous work
admitted into the hot path is measured in dropped data.*

Conflation deserves a sharper statement than the vendors give it. It is sound for a quote
or a developing bar (last value wins) and unsound for a trade tape (every print is a
distinct fact). One system therefore needs **both** policies, chosen per data class —
which is exactly what UCT's broadcaster does without naming it: `_emit` throttles to
10 Hz per `(sym,tf)` for tick/aggregate events but is **unthrottled for AM**, the
authoritative minute bar.

### RELEVANCE TO UCT
Delta encoding is unclaimed and cheap in one specific place: the options tape. D-05
records `/api/flow/data?days=1` at **12.4 MB gzipped**, a cold Options Flow shell at
**9,505 ms** to data-ready, and a `/recent` handler that built ~34 K-row responses in
memory — the mechanism named in the 5 s→20 s poll reversion. That is a payload-size
problem, and payload size is what deltas attack.

### CONFIDENCE
🟡 overall. 🟢 that these mechanisms exist and are documented. 🔴 on quantified benefit —
Ably publishes no percentages, and Lightstreamer's conflation documentation (the
canonical primary source for `setRequestedMaxFrequency` and filtered vs unfiltered
dispatching) returned **403** to every URL tried.
**CEILING:** one reachable Lightstreamer or LSEG Real-Time SDK page would let this
section state conflation semantics normatively instead of by inference.

### RECOMMENDATION (hypothesis)
Classify every TERMINAL-NEXT stream as **last-value-wins** or **every-message-matters**
in the panel contract itself, and let the transport layer conflate the first class and
never the second. Today that distinction lives in one comment inside `bar_broadcaster`.

### OPEN QUESTION
Is the 10 Hz `_emit` throttle a *measured* setting or an assumed-safe one? Twelve panels
on distinct `(sym,tf)` pairs is a 120 Hz aggregate into one event loop.

---

## 5. TIERING — entitlement belongs at the connection, and delay is a product tier

### OBSERVATION
Real-time, delayed and end-of-day are distinct **endpoints** at the vendor boundary, and
the entitlement check happens once, at authentication.

### EVIDENCE
Alpaca [S5] exposes `v2/sip`, `v2/iex` and `v2/delayed_sip` (15-minute delayed) as
separate feed endpoints, and refuses an unentitled feed "during authentication" rather
than per message. — VERIFIED.

### INTERPRETATION
This is a load-architecture decision disguised as a licensing one. If entitlement is
checked per message or per panel, every panel becomes an authorization site; if it is
checked at the connection, the fan-out layer stays dumb and fast, and a downgrade
(real-time → delayed) is a *reconnect*, not a re-render.

### RELEVANCE TO UCT
D-02 §1.1 records that only paths matching `/api/j2/**/coach**` inherit a paywall from
middleware; "anything else inherits nothing and must gate itself", with ~40 duplicated
`Depends` gates today. A terminal that will eventually serve members at more than one
tier should settle this **before** it has N panels — retrofitting per-panel gates is
exactly the 40-copies shape the repo already regrets.

### CONFIDENCE
🟡 — one vendor's documented practice, generalised. Whether commercial terminals tier
delayed data at the connection is NOT DETERMINED here.

### RECOMMENDATION (hypothesis)
If TERMINAL-NEXT will ever have a free or delayed tier, put the tier in the stream
handshake and let panels render whatever the connection gives them, with a visible delay
badge. Never let a panel decide its own entitlement.

### OPEN QUESTION
Does UCT's Massive licence permit redistribution of real-time data to members, and at
what tier? A licensing input ARCH-07 cannot infer from code.

---

## 6. CACHING BY DATA CLASS — and a Cloudflare rule that contradicts a shipped header

### OBSERVATION
Cache policy must be chosen per data class (quotes: seconds; bars: minutes; fundamentals:
days; sealed history: forever), and the CDN layer has two documented behaviours that
decide whether any of it reaches the edge at all: **JSON is not cached by default**, and
**`s-maxage` disables `stale-while-revalidate`**.

### EVIDENCE
- RFC 5861 (official standard; fetched 2026-09-02): with `stale-while-revalidate`, "If a
  cached response is served stale … the cache SHOULD attempt to revalidate it while still
  serving stale responses (i.e., without blocking)." `stale-if-error` permits serving
  stale on 500/502/503/504 within its window. [S12] — VERIFIED.
- Cloudflare, *Default cache behavior* (official documentation; fetched 2026-09-02): "The
  Cloudflare CDN does not cache HTML or JSON by default." Caching is keyed on file
  extension, not MIME type. [S13] — VERIFIED.
- Cloudflare, *Cache keys* (official documentation; fetched 2026-09-02): the default cache
  key includes the full URI **with query string** — "for example,
  `/logo.jpg?utm_source=newsletter`". Ignoring query strings makes `?something=123` and
  `?something=789` "have the same cache key". [S14] — VERIFIED.
- Cloudflare, *Origin Cache Control* (official documentation; fetched 2026-09-02): edge
  and browser TTLs are set separately via `s-maxage` and `max-age`; the first request
  after expiry "triggers revalidation in the background and immediately receives stale
  content with an UPDATING status"; **but** "`s-maxage` disables `stale-while-revalidate`"
  because `s-maxage` carries `proxy-revalidate` semantics. [S15] — VERIFIED.
- Cloudflare, *cf-cache-status* values (official documentation; fetched 2026-09-02):
  `DYNAMIC` = "Cloudflare determined at request time that the asset is not eligible for
  cache, so the request went to the origin web server **without a cache lookup**"; `MISS`
  = eligible but absent at request time; plus `HIT`, `EXPIRED`, `STALE`, `UPDATING`,
  `REVALIDATED`, `BYPASS`, `NONE/UNKNOWN`. [S16] — VERIFIED.

### INTERPRETATION
Three things fall out of those pages together, and they are the most directly actionable
findings in this report.

1. **`DYNAMIC` on a JSON API route is the documented default, not a misconfiguration.**
   D-05 records `/api/flow/data?days=1` measured at `cf-cache-status: DYNAMIC`,
   `age: null`, 12.4 MB gzipped, origin 386 ms warm / 3,643 ms cold, with the runbook
   status line reading "rule NOT yet applied". Cloudflare's own doc explains *why* a rule
   is required at all: JSON is not cached by default, so no header the origin sends will
   make the edge look.
2. **The shipped flow header may be self-defeating even once a rule exists.** D-02 §7
   records `/api/flow/data`'s header as `public, max-age=0, s-maxage=60,
   stale-while-revalidate=600`. Per [S15] the `s-maxage=60` **disables** the
   `stale-while-revalidate=600`, so the design intent — one member pays the rebuild, the
   rest get stale-but-instant for ten minutes — does not survive contact with the edge as
   written. This is a header-level defect that no dashboard configuration fixes.
   ⚠️ NOT VERIFIED against production: the header is quoted from D-02, not read off a
   response.
3. **The `?d=`-keyed immutable sealed-history URL is correct by the documented cache-key
   rule.** D-05 calls it "the best idea in this codebase's perf work": when the client's
   `?d=` matches the sealed boundary the response is `max-age=31536000, immutable`, and a
   new trading day produces a new URL, so "the cache self-refreshes with NO purge". [S14]
   confirms the query string is in the default key — which is what makes the trick work,
   and also exactly what the runbook's first named damage case ("never enable Ignore Query
   String") would destroy.

The general principle worth carrying: **the cheapest cache is a URL that can never go
stale.** Naming the sealed day in the URL converts a mutable resource into an immutable
one. Anything a terminal shows that is *finished* — a closed session's bars, a completed
earnings quarter, yesterday's tape — can be given that treatment.

### RELEVANCE TO UCT
D-05's inventory shows the layers are already principled: per-TF memory TTLs
(`1m:5s … D:300s`), disk TTLs (`5m:2h … D:48h`), a `ServeStale` last-good wrapper measured
to turn two 4.51 s / 7.97 s TTL-expiry requests into 0.12 s for the other 38, and a cache
snapshot restored at boot and saved at drain. What is missing is not a layer — it is the
edge, where a documented, reversible, **zero-deploy** rule has sat unapplied since
2026-07-25.

### CONFIDENCE
🟢 for every Cloudflare and RFC statement (read from the vendor's own docs). 🟡 for
finding (2), which depends on a header quoted in D-02 rather than observed.
**CEILING:** three `curl -I` requests (two spaced, plus a `?days=20` control) would settle
findings 1 and 2 outright, and D-05 §8 Protocol D already specifies them.

### RECOMMENDATION (hypothesis)
Before adding any cache layer for TERMINAL-NEXT: (a) verify the edge's real behaviour on
one JSON route, and (b) if edge-side `stale-while-revalidate` is wanted, express the edge
TTL some way other than `s-maxage` — Cloudflare's own doc says the two cannot coexist.
Then apply the sealed-URL idiom to every finished-and-frozen series the terminal renders.

### OPEN QUESTION
Was the `s-maxage`/`stale-while-revalidate` interaction known when that header was
written? If the intent was edge-side SWR, the header has been quietly delivering something
else for as long as it has shipped.

---

## 7. BROWSER LIMITS — a long-lived terminal tab is a *throttled* tab most of the day

### OBSERVATION
A terminal is left open for hours and hidden for most of them. Chrome's documented
behaviour for hidden pages is progressive: timer throttling, then intensive throttling,
then freezing — at which point network callbacks stop and several connection types must
be closed.

### EVIDENCE
- Chrome, *Timer throttling in Chrome 88* (official vendor documentation; fetched
  2026-09-02): **intensive throttling** applies when the page has been hidden **more than
  5 minutes**, chain count ≥ 5, the page has been "silent for at least 30 seconds", and
  WebRTC is not in use — then "the browser will check timers in this group once per
  minute." Otherwise standard throttling checks "once per second". Named exemptions: the
  page is visible; it "has made noises in the past 30 seconds"; WebRTC is in use (an open
  `RTCDataChannel` or live `MediaStreamTrack`); or it has been hidden less than 5 minutes.
  [S17] — VERIFIED.
- Chrome, *Page Lifecycle API* (official vendor documentation; fetched 2026-09-02): six
  states — active, passive, hidden, **frozen**, terminated, discarded. In the frozen state
  "the browser suspends execution of freezable tasks … This means things like JavaScript
  timers and fetch callbacks don't run", and IndexedDB, BroadcastChannel, WebRTC,
  **WebSocket** connections and Web Locks should be closed on `freeze` and reopened on
  `resume`. [S18] — VERIFIED.

### INTERPRETATION
Two consequences a terminal design must absorb.

First, **a hidden tab's polls do not merely slow down — after five minutes they run at
one per minute**, and once frozen they do not run at all. Any freshness indicator computed
from "ticks since last update" will therefore lie in exactly the situation where it
matters most: the user tabs back after lunch. Freshness must be computed from
**timestamps against a clock**, and re-evaluated on `visibilitychange` / `resume`.

Second, **freeze is a resync event, not a reconnect event.** The tab wakes holding a
consistent-looking but arbitrarily old view. SSE's `Last-Event-ID` [S2] is the standard
mechanism for closing that gap; without it the only correct move is a full refetch of
every panel's window on resume.

Note also that the exemption list for intensive throttling [S17] includes WebRTC but
**not** an open SSE or WebSocket connection — so "we hold a stream, therefore we are not
throttled" is not supported by the documentation.

### RELEVANCE TO UCT
D-05 shows UCT has the visibility half of this: `livePriceStore` pauses on
`visibilitychange`, `useMobileSWR` sets `refreshInterval: 0` while hidden, and both SSE
pools carry watchdogs because "a proxy can kill a stream without firing `onerror`"
(`SSE_STALL_MS = 40000`). It also shows the trap: those dampers are **opt-in**, and "a
bare `useSWR(..., {refreshInterval})` gets none of them" — across 186 polling sites. For a
panel board that is the wrong default, and D-05's own recommendation (a `usePanelData`
wrapper that *cannot be constructed* without a visibility gate and a market-hours policy)
is the right shape; this evidence strengthens it.

Project memory records the same class biting the *measurement* tooling, not just the
product: `lesson_hidden_chrome_tab_defers_paint_and_throttles_timers`, and the
`?gridspike` harness's validity guard requiring a **visible** tab.

### CONFIDENCE
🟢 — both pages are Chrome's own documentation, read directly.
**CEILING:** Safari and Firefox throttling/freezing policies were not fetched; the numbers
above are Chrome's and must not be quoted as cross-browser.

### RECOMMENDATION (hypothesis)
Make TERMINAL-NEXT's freshness model time-based and its resume path explicit: on
`visibilitychange → visible` and on `resume`, every panel revalidates its own window and
the shell shows a single "resyncing" state rather than N stale panels that look live.

### OPEN QUESTION
How long does a hidden TERMINAL-NEXT tab take to become *correct* again after an hour
frozen — and is that bounded by the slowest panel or by the shell? Nothing in the repo
measures it, and D-05 lists the equivalent unknown for deploy swaps.

---

## 8. SPIKES AND DEGRADATION — absorb at the edge of the system, degrade visibly at the edge of the screen

### OBSERVATION
Public material on spike handling says the same thing at every scale: absorb the burst in
a **bounded buffer as early as possible**, do the expensive work **out of band**, and make
the shed **counted and visible**. What differs by scale is only the buffer's units.

### EVIDENCE
- Databento [S11] on OPRA: shard 96 channels into eight groups, give each shard a 4 GB NIC
  buffer, filter ~80 % of updates before processing, keep subsampling out of the packet
  loop, capture to NVMe first and ship to bulk storage later, and continuously rebalance
  channels "to prevent correlated bursts in single shards". — REPORTED.
- NATS [S9]: bound the pending buffer, surface the drop through the async error callback
  ("a quiet drop is worse than a crash"), and add consumers rather than buffer.
- Redis [S8]: at-most-once — a disconnected subscriber's messages are "forever lost", so a
  spike that disconnects a subscriber is also a data-loss event unless something else
  catches up.
- RFC 5861 [S12] with Cloudflare [S15][S16]: `stale-while-revalidate` and the `UPDATING`
  status are the HTTP-layer expression of the same rule — serve the last good thing
  immediately, refresh behind it.

### INTERPRETATION
There is a clean division of labour a terminal should make explicit: **absorb** (bounded
buffers, spool-to-disk, sharding) at ingest; **shed** (semaphores, fast 503 +
`Retry-After`, admission caps) at the request boundary; **degrade** (last-good payload,
stale badge, transport downgrade) in the UI. A system that does only the first two has
excellent metrics and a frozen-looking screen.

### RELEVANCE TO UCT
D-05 shows UCT's absorb-and-shed layers are genuinely strong and incident-forged: an OPRA
tape spool whose hot loop "only ever does an append to a deque"
(`deque(maxlen=50_000)`, ~1–2 min of extreme-volume frames) with autonomous gap replay
through the same pipeline as the T+1 heal; a freeze watchdog that deliberately
distinguishes **freeze from lag** because "a restart makes lag WORSE"; five bars semaphores
that shed a fast 503 rather than hold a thread ~20 s; a `Semaphore(6)` upstream valve
sized for "200 browsers resuming their 2s polls" after a deploy; and per-subscriber
drop-oldest queues throughout.

The degrade layer is thinner and less uniform: the price stream emits transition-only
`stale`/`fresh` events, the options page names its transport in the header and keeps
rendered data on disconnect, but on charts the indicator is *behavioural* —
`delivering = false` silently hands the developing bar back to the REST writer. That is
good engineering and invisible to the user: the right default for one chart, the wrong
default for a board of twelve.

The spike UCT does **not** absorb is its own deploy. D-05 records a measured **~3-minute
cold window** on every web deploy (`bars.db integrity check passed (179.1 s)` at boot plus
a cold memory cache), with the market-hours push freeze and both its guards removed by
owner decision on 2026-08-24.

### CONFIDENCE
🟢 for the documented mechanisms. 🟡 for the generalisation, which is mine.
**CEILING:** no public write-up of a *terminal's* market-open behaviour was reachable —
the closest evidence is a data vendor's ingest path, which is a different problem.

### RECOMMENDATION (hypothesis)
Give TERMINAL-NEXT one shell-level freshness authority (per-panel age + transport +
last-good timestamp) instead of N per-panel conventions, and make "survives a deploy swap
without user-visible loss" an acceptance criterion — D-05 already specifies the zero-load
experiment (its Protocol E).

### OPEN QUESTION
What does a twelve-panel board look like during the three minutes after a deploy swap?
Today's answer is inferred from pooled reconnect behaviour, not observed.

---

## 9. THE CONFLATION CONTRACT — a mature streaming server puts the data class *in the subscription*

### OBSERVATION
Lightstreamer — a streaming server used in finance for two decades — does not treat
conflation as a server-side tuning knob. It makes the data class an argument of the
subscription (`MERGE` / `DISTINCT` / `RAW` / `COMMAND`), pairs it with a per-item
frequency ceiling the client may **change while subscribed**, and delivers a snapshot on
subscribe so a newly opened panel is correct before the first update arrives.

### EVIDENCE
Lightstreamer Web Client 9.2.0 API reference, `Subscription` (official vendor
documentation; read in-browser 2026-09-02):
- **Modes.** The constructor's `subscriptionMode` permits exactly "MERGE, DISTINCT, RAW,
  COMMAND". [S19] — VERIFIED.
- **Frequency ceiling, per item.** `setRequestedMaxFrequency(freq)` takes "A decimal
  number, representing the maximum update frequency (expressed in updates per second)
  for each item", or `"unlimited"`, or `"unfiltered"`. Its worked example: "with a
  setting of 0.5, for each single item, no more than one update every 2 seconds will be
  received." — VERIFIED.
- **Renegotiable while live.** It is the *only* subscription property that may be changed
  in the "active" state: "If the Subscription instance is in its 'active' state and the
  connection to the server is currently open, then a request to change the frequency of
  the Subscription on the fly is sent to the server." (Barring transitions to or from
  `"unfiltered"`.) — VERIFIED.
- **Buffer semantics encode the data class.** `setRequestedBufferSize` documents that "A
  Queueing buffer is used by the Server to accumulate a burst of updates for an item, so
  that they can all be sent to the client, despite of bandwidth or frequency limits",
  usable "only when the subscription mode is MERGE or DISTINCT and unfiltered dispatching
  has not been requested" — and the **defaults differ by mode**: "the buffer size will be
  1 for MERGE subscriptions and 'unlimited' for DISTINCT subscriptions." — VERIFIED.
- **Snapshot on subscribe.** `setRequestedSnapshot` requests snapshot delivery for MERGE,
  DISTINCT and COMMAND, defaulting to `"yes"` for every non-RAW mode. — VERIFIED.
- Server-side ceilings exist above the client's request: frequency limits "can also be set
  on the server side and this request can only be issued in order to furtherly reduce the
  frequency, not to rise it beyond these limits", with a further global limit by licence
  edition. — VERIFIED.

### INTERPRETATION
This is the sharpest formulation of §4's hypothesis, and it comes from a primary source
rather than from me. **A buffer size of 1 *is* conflation**: MERGE keeps only the latest
value per item, so a burst collapses to one update — correct for a quote or a developing
bar. DISTINCT's unlimited buffer preserves every event — correct for a trade tape. The
same server does both, and which one you get is a property of the *subscription*, not of
the deployment.

Three further design ideas fall out, each of which a panel board wants:
1. **Frequency is a per-item, client-negotiated number** — not a global emit throttle. A
   maximised chart can ask for 10/s while eleven background panels ask for 0.5/s, on one
   connection.
2. **Frequency is renegotiable without resubscribing.** A panel that is minimised,
   scrolled off, or on a hidden tab can *lower* its own rate and raise it on resume — the
   direct answer to §7's throttling problem, and much cheaper than tearing down and
   rebuilding a subscription.
3. **Snapshot-on-subscribe removes the panel's cold-start REST call.** Today a UCT panel
   fetches state over REST and then attaches a stream; the two paths can disagree, and
   D-05 records exactly that hazard elsewhere (the single-writer invariant, six
   developing-bar writer sites, and a Heikin-Ashi bug that shipped when one writer skipped
   the guard).

### RELEVANCE TO UCT
UCT's `bar_broadcaster` already implements a fixed version of (1): 10 Hz per `(sym,tf)`
for tick/aggregate events, unthrottled for the authoritative AM minute bar. What it does
not have is client negotiation — the rate is a server constant, identical for a
maximised chart and a 120-pixel sparkline. D-05 records the multi-chart grid solving the
same problem in an ad-hoc way (`deepWarm` passed **maximised-cell-only**, staggered mount
queue ≤3, `backgroundWarm={false}` on grid cells). That is the same idea — *spend the
budget where the user is looking* — expressed as four separate props instead of one
number.

### CONFIDENCE
🟢 for every quoted behaviour (read directly from the vendor's API reference).
🟡 that adopting it is right for UCT — that is a design call.
**CEILING:** the "General Concepts" document these pages refer to for the underlying
semantics is a scanned/image PDF and returned no extractable text; the mode semantics
above are therefore quoted from the API reference only.

### RECOMMENDATION (hypothesis)
Give TERMINAL-NEXT's panel contract three fields that this API reference justifies:
`mode` (last-value-wins vs every-message), `maxFrequency` (per panel, renegotiable), and
`snapshot` (deliver current state on subscribe). Even implemented crudely over the
existing SSE pool, those three cover the throttling, cold-start and fan-out-cost problems
that §§3–7 raise separately.

### OPEN QUESTION
Could UCT's existing pools carry a per-subscriber frequency without a server change — by
having the client-side pool *downsample* for panels that asked for less? That trades
server CPU for browser CPU, which may be the wrong trade on the one machine that is
single-process.

---

## 10. AGGREGATION / BFF — the documented cure for a chatty board, and its documented cost

### OBSERVATION
The board-of-panels problem — one screen needing data from many services — is the
textbook motivation for the API Gateway / Backends-for-Frontends pattern, and the
pattern's stated drawbacks are exactly the ones a small team feels.

### EVIDENCE
microservices.io, *API Gateway / Backends for Frontends* (credible professional pattern
reference; fetched 2026-09-02): "The granularity of APIs provided by microservices is
often different than what a client needs", so "clients need to interact with multiple
services". A gateway "handles other requests by fanning out to multiple services", and
the BFF variant "defines a separate API gateway for each kind of client". Benefit:
"Reduces the number of requests/roundtrips." Drawbacks named: "Increased complexity - the
API gateway is yet another moving part that must be developed, deployed and managed" and
"Increased response time due to the additional network hop". [S20] — VERIFIED (secondary:
a pattern catalogue, not a standard).

### INTERPRETATION
For TERMINAL-NEXT the pattern applies with one inversion. The classic gateway's cost is
"an additional network hop"; on a **single-process** backend there is no extra hop — an
aggregation endpoint is a function call. The cost that remains is the real one: a
composed endpoint is only as fast as its slowest constituent, and it turns N independent
failures into one composite response that must decide what "partial" means.

### RELEVANCE TO UCT
UCT has already run this experiment twice and the results point in opposite directions,
which is the useful part.
- **It worked** for calendar enrichment: `GET /api/calendar/enrichment-batch?dates=`
  replaced one request per day with one request per week (D-05 §5.3), and D-02's launch
  hardening records the same move.
- **It exposed the composite-latency trap** in the same feature: D-05 records enrichment
  **cold 17.9 s / warm 0.14 s** for a day and **cold 24.8 s / warm 0.22 s** for the week
  batch — a 130× cliff that had to be papered over with a 240 s warmer running under a
  300 s TTL, sized so "the margin has to exceed the compute itself (~25 s) or the entry
  expires while the warm that would have refreshed it is still running".
- And `cache_policy.set_by_completeness` already exists as the answer to "what does
  partial mean" — a partial result gets the short/failure TTL and never reaches a
  persistent store.

So the transferable rule is not "aggregate" or "don't aggregate". It is: **an aggregation
endpoint needs a partial-result contract and a warm path before it needs a route.**

### CONFIDENCE
🟡 — the pattern is well-documented; the inversion (no extra hop on a monolith) and the
composite-latency rule are my inference from D-05's measurements.

### RECOMMENDATION (hypothesis)
If TERMINAL-NEXT gets a board-level endpoint, make it return per-panel envelopes
(`{panel_id, status, data, as_of}`) rather than a merged object, so one slow or failed
constituent degrades one panel instead of the board — and so the shell's freshness
authority (§8) has something to render.

### OPEN QUESTION
Is the right seam a board endpoint at all, or the separate process D-02 §2 already
proposes — `bars_api_main.py` (292 lines, sharing the serve core with the monolith so the
two cannot diverge) fronted by a `flow_proxy`-shaped forwarder?

---

## 11. PER-USER SUBSCRIPTION BUDGETS — a terminal's real currency is streaming lines

### OBSERVATION
At least one major broker/terminal exposes the streaming budget to the user as an
explicit, countable resource shared across *every* surface — the desktop watchlist and
the API alike — rather than hiding it inside the transport.

### EVIDENCE
Interactive Brokers, *Market Data Lines — Introduction* (official documentation; read
in-browser 2026-09-02): "All users at Interactive Brokers are given a set amount of market
data lines. Market data lines dictate how much market data can be retrieved simultaneously
from a given user. This Includes all data pulled through Trader Workstation watchlist and
the API." Over the cap, "any future requests would return an error message that additional
market data lines are required." The worked example is the important part: a username
"provisioned for 100 market data lines" with 50 symbols in the TWS watchlist and 25 on one
API connection leaves "a maximum of 25 additional market data lines" for a second
connection. TWS exposes a keyboard shortcut to display current usage. [S21] — VERIFIED.
(Secondary corroboration seen in search results only, NOT fetched and therefore NOT relied
on: the TWS API guide's "maxTicker Limit of 100 market data lines", and quote-booster packs
of 100 lines each.)

### INTERPRETATION
Three properties are worth stealing regardless of whether UCT ever meters anything.
1. **The budget is per *user*, not per connection** — so opening a second connection does
   not buy more data. That is the precise inverse of the failure mode D-05 warns about
   (a panel that opens its own stream).
2. **The budget spans surfaces.** A watchlist and an API client draw on one pool. For
   TERMINAL-NEXT that means the board, the mobile app and any Discord/automation consumer
   are one budget, and the shell is the only thing that can see the total.
3. **The user can see the number.** A cap the user can count is a cap they can plan
   around; a cap that silently drops data is a bug report.

### RELEVANCE TO UCT
UCT's caps are real but invisible and expressed in server units: `MAX_SSE_TICKERS = 50`
per connection, `MAX_BARS_PAIRS = 50`, `STREAM_MAX_SUBSCRIBERS = 300` per stream family
with **separate registries** for prices and bars specifically so "a wall of chart tabs on
`/api/stream/bars` can never crowd out the price quotes every page depends on", and a
503 `at_capacity` refusal that drops the client back to polling. A panel board is the
first UCT surface where a *single user* can plausibly approach those numbers, and it is
the first surface for which "you are using 62 of your streaming slots" would be a
meaningful thing to show.

Note the direction of the constraint differs from IBKR's: theirs is a licensing budget
per user; UCT's is an event-loop budget shared across all users. That makes the case for
surfacing it *stronger*, not weaker — one user's board can degrade everyone's quotes.

### CONFIDENCE
🟢 for the IBKR documentation quoted. 🟡 for the transfer, which is mine.
**CEILING:** how *Bloomberg*, *LSEG Workspace*, *Koyfin* or *TradingView* budget
simultaneous streaming instruments per user is NOT DETERMINED — none of those vendors'
material was reachable in this budget.

### RECOMMENDATION (hypothesis)
Define a TERMINAL-NEXT "live slot" as the unit a panel consumes, make the shell the only
allocator, and render the count somewhere a user can find it. Then the 300-subscriber
server cap becomes a number the product can reason about rather than a cliff it discovers.

### OPEN QUESTION
What is a realistic panel count for the desk's own boards — 6, 12, 24? Every capacity
statement in D-05 is reasoned from "~200 users" and none from "N panels per user", and
the two multiply.

---

## 12. DECISION MATRIX — the choices ARCH-07 faces, keyed to UCT's actual constraints

**The constraints every row is scored against** (from D-05 and D-02, not from me):
single uvicorn process on one event loop · multi-worker unsafe (in-process SSE and
live-price state) · ~54 SQLite DBs on one volume · 64 anyio threads · `STREAM_MAX_SUBSCRIBERS
= 300` per stream family · client pools already collapse N panels to ~2 connections ·
~3-minute cold window on every web deploy · Cloudflare in front, currently `DYNAMIC` on
the one JSON route that was measured.

**Legend.** ✅ fits the constraint · ⚠️ fits with a named cost · ⛔ conflicts with a
constraint. Nothing here is a decision; each row is an option set with the evidence and
the measurement that would settle it.

| # | Decision | Options | Fit against UCT's constraints | What would settle it |
|---|---|---|---|---|
| D1 | **Browser transport** | (a) keep pooled SSE ✅ (b) add a WebSocket ⚠️ (c) polling only ⚠️ | (a) inherits a working pool, standard reconnect + `Last-Event-ID` [S1][S2]; server cost already bounded. (b) buys nothing for one-way data under HTTP/2 [S1][S3][S4] and adds a second hub to the process that cannot be multi-workered. (c) is the fallback the 503 `at_capacity` path already implements | Whether any panel needs high-rate client→server messaging. If no: D1 is not a real decision |
| D2 | **Where multiplexing happens** | (a) client-side pool, union + chunk (today) ✅ (b) server-side session multiplex: one connection, typed channels ⚠️ | (a) is proven and is the property D-05 names as most valuable. (b) reduces browsers×2 connections to browsers×1 and would let the server see a *board* rather than two anonymous streams — but it is a new protocol on the single process | Measure connections per browser during a real board session; if (a) already yields ~2, (b) is optimisation, not architecture |
| D3 | **Fan-out substrate** | (a) in-process hubs (today) ✅ (b) Redis Pub/Sub ⛔ (c) NATS ⛔ (d) durable log + tailer (today, for the tape) ✅ | (b)/(c) solve *cross-process* fan-out, which this topology does not have; both are at-most-once for late joiners [S8][S9] and would add an operational dependency. (d) is what the options tape already does and is the only shape that survives a reconnect without loss | The trigger is binary and should be written down now: *does more than one process need to fan out the same stream?* Today, no |
| D4 | **Conflation policy** | (a) fixed global throttle (today: 10 Hz/(sym,tf), AM unthrottled) ⚠️ (b) per-subscription mode + renegotiable per-item max frequency ✅ | (b) is Lightstreamer's documented contract [S19] and directly answers §7's throttling and §11's budget: background panels ask for less. (a) spends the same rate on a maximised chart and a sparkline | Whether the 10 Hz constant was ever measured (it is not recorded as measured), and what a 12-panel board's aggregate emit rate is |
| D5 | **Panel data access** | (a) per-panel REST + stream (today) ✅ (b) board-level aggregation endpoint ⚠️ | (b) reduces round trips [S20] and there is **no extra network hop** on a monolith — but UCT has already measured the composite-latency cliff (enrichment cold 17.9 s / batch 24.8 s) and had to add a 240 s warmer to hide it | Whether a board's panels share expensive constituents. If they mostly do not, (b) buys round trips and inherits the slowest panel |
| D6 | **Edge caching** | (a) status quo (`DYNAMIC`, origin every time) ⛔ (b) apply the documented Cache Rule ✅ (c) sealed-URL immutability for finished series ✅ | JSON is not edge-cached by default [S13], so (a) is not a configuration accident — it is the default. (b) is documented, reversible and needs **no deploy**. (c) already ships for bars and is validated by the default cache key including the query string [S14]. ⚠️ `s-maxage` disables `stale-while-revalidate` [S15], so the flow route's current header cannot do what it appears to | Three `curl -I` requests (D-05 §8 Protocol D). This is the cheapest high-value measurement in the whole program |
| D7 | **Tier / entitlement** | (a) per-panel gates (today's ~40 duplicated `Depends`) ⚠️ (b) tier in the stream handshake ✅ | (b) matches how vendors do it [S5] and keeps the fan-out layer dumb; (a) is the shape D-02 §1.1 already records as a maintenance burden | Whether TERMINAL-NEXT will ever serve more than one data tier. If yes, decide before N panels exist |
| D8 | **Degradation UI** | (a) per-panel conventions (today: transition events on prices, header text on flow, behavioural fallback on charts) ⚠️ (b) one shell-level freshness authority ✅ | (b) is required by §7: after a freeze, tick-based freshness lies. Charts' silent `delivering=false` fallback is right for one chart and wrong for twelve | Observe a board through a deploy swap and an hour-long hidden tab (D-05 Protocol E, extended) |
| D9 | **Deploy resilience** | (a) accept the ~3-minute cold window ⚠️ (b) put TERMINAL-NEXT on its own process (`bars_api_main.py` template) ✅ (c) shrink the window (boot integrity check, cache snapshot) ⚠️ | The window is measured (`bars.db integrity check passed (179.1 s)` + cold caches) and the market-hours guard was removed 2026-08-24. (b) is D-02's recommended seam and decouples terminal deploys from monolith deploys | Time `/api/*` unavailability across one real swap; compare against a terminal session's tolerance |
| D10 | **Per-user live budget** | (a) implicit server caps only (today) ⚠️ (b) an explicit, visible "live slot" budget ✅ | IBKR's model [S21] shows a user-visible, cross-surface budget is workable and legible. UCT's caps are real (50 tickers/conn, 50 pairs/conn, 300 subscribers/family) but invisible, and one board can crowd the shared 300 | Decide the target panel count first (§11's open question); the budget is meaningless without it |

**The three rows that are not close.** D3 (do not add a broker), D6 (verify the edge, then
apply the rule) and D8 (one freshness authority) are supported by direct documentation and
by measurements UCT already owns. The genuinely open ones are D2, D5 and D9 — and all
three turn on a single unmeasured quantity: **how many panels, holding how much, for how
long.**

---

## 13. QUESTIONS ARCH-07 MUST ANSWER

Ordered by how much else depends on them.

1. **How many panels, and what does each hold?** Every capacity statement inherited from
   D-05 is reasoned from "~200 users"; none from "N panels per user". `STREAM_MAX_SUBSCRIBERS
   = 300`, `_cold_fetch_sem = 3`, the 64-thread pool and the RSS curve all multiply against
   a number nobody has chosen. D-05 names the closest existing measurement — the admin-only
   `?gridspike=N` harness, recorded at 16 cells framed in ~900 ms, +63 MB heap.
2. **Does a panel own a transport, or declare a need?** If panels may open their own
   streams, the 300-subscriber budget becomes 300/N users. This is a one-line API decision
   with a whole-system consequence, and it must be structural rather than a code-review
   convention.
3. **What is the freshness contract, in time units?** After Chrome's intensive throttling
   (once per minute past 5 minutes hidden) and freezing (timers and fetch callbacks do not
   run) [S17][S18], any tick-derived freshness indicator is wrong exactly when it matters.
   What is the maximum age a panel may show without saying so?
4. **What happens on resume and on deploy?** These are the same event to a panel — the
   view is arbitrarily old and the connection is gone. Is the answer full refetch, or
   `Last-Event-ID` resume (which requires the streams to emit `id:` at all — see §1's open
   question)?
5. **Is the edge actually caching anything?** Three requests answer it. If not, D6 is the
   largest already-designed win available and costs a dashboard change, not a deploy.
6. **Which streams are last-value-wins and which are every-message-matters?** Today the
   distinction exists in one comment inside `bar_broadcaster`. It should be a field in the
   panel contract [S19].
7. **Does TERMINAL-NEXT run in the monolith or in its own process?** D-02 gives the
   template (`bars_api_main.py`, 292 lines, sharing the serve core so the two cannot
   diverge) and the two traps it survived. The deciding factor is not code — it is whether
   terminal deploys may be coupled to monolith deploys given the ~3-minute cold window.
8. **What is the multi-instance trigger?** Every hub and every budget in this system is
   per-process (SSE state, the Finnhub 60/min budget, `sync._locks`, the price cache). The
   trigger condition should be written next to them now.
9. **Is there a second Massive connection?** D-05 names it twice as the only fix for
   deploy-swap tape gaps, and no artifact records it being requested.
10. **Who watches the drop counters?** `bars_dropped_total`, `fh_budget_denied_total` and
    `/api/admin/bars-stream-status` exist; nothing records them being read on a schedule.
    A drop counter nobody reads is the "quiet drop" NATS warns is "worse than a crash" [S9].

---

## GAPS — what this budget did not reach

- **No terminal vendor's engineering material.** The single largest gap. Bloomberg
  (`techatbloomberg.com/blog`) returned **403**; Interactive Brokers' TWS API guide
  returned **403** to WebFetch (its *docs* site was reachable in-browser and is [S21]);
  TradingView's Charting Library streaming page returned **404** on two path forms; the
  LSEG developer portal returned **404**. So every claim about how a *named commercial
  terminal* moves data server→browser is ABSENT from this report rather than weakly
  supported. Raising this needs either a working search channel or vendor documentation
  the owner can supply.
- **WebSearch was exhausted (200/200) before this role began.** Channels actually used:
  **WebFetch on pre-named URLs** (~24 attempts, 16 successful) and **one browser tab**
  (DuckDuckGo HTML endpoint → 2 target pages → closed). Queries I could not run: anything
  requiring discovery of an unknown URL, in particular "Bloomberg terminal data
  distribution architecture", "Koyfin/Benzinga Pro realtime architecture", "trading
  terminal SSE at scale", and any conference talk (FINOS/QCon) on terminal streaming.
- **Lightstreamer's "General Concepts" document** — the primary source the API reference
  defers to for MERGE/DISTINCT semantics and bandwidth control — is a scanned/image PDF
  with no extractable text (1.2 MB, fetched and unusable). §9 is therefore quoted from the
  API reference alone.
- **No conflation or delta figures.** Ably documents delta compression qualitatively and
  publishes no percentages [S10]; no vendor benchmark of conflation's bandwidth saving was
  reachable.
- **Vendor connection/symbol caps.** Neither Alpaca's nor Massive's reachable pages
  document simultaneous-connection limits or per-plan symbol caps, which is the number UCT
  most needs for its own provider.
- **Nothing was measured.** Consistent with the DO-NOT list, no production endpoint was
  probed, no local backend started, no build run, no git command. Every internal number is
  quoted from D-05/D-02, which themselves label most runtime figures as CLAIM.
- **Kafka-to-WebSocket gateways** (named in the contract) were not researched: no
  first-party page was reachable without search, and the pattern is not a live option for a
  single-process topology (D3).
- **Cross-browser throttling.** §7's numbers are Chrome's only; Safari and Firefox
  freeze/throttle policies were not fetched and must not be assumed identical.
- **HTTP/3 / QUIC** behaviour for long-lived SSE was not researched at all.
- **Cloudflare's own configuration** cannot be read from a document; whether the flow cache
  rule, Cache Reserve or any Cache Rule is live remains the same open question D-05 records.

## SOURCE-HANDLING OBSERVATIONS

No page fetched for this report contained text addressed to an AI agent or attempting to
redirect this task. Two observations worth recording as data rather than instruction:

- `polygon.io/docs/...` **301-redirects to `massive.com/docs/...`** (observed 2026-09-02).
  UCT's provider and the widely-cited "Polygon.io" documentation are therefore the same
  vendor under a new domain — relevant because internal code and comments still say
  "Polygon-compatible", and a future reader may treat them as two providers.
- The IBKR documentation page rendered UI controls labelled "View as Markdown" and "Open in
  Claude". These are the vendor's own page affordances, not instructions to me; nothing was
  clicked and no such flow was followed.

## SOURCES

All fetched **2026-09-02**. Tier per the evidence standard: **T1** official standard ·
**T2** official product/API documentation · **T3** official vendor education/engineering
content · **T4** credible professional reference.

| # | Source | Tier | URL | Status |
|---|---|---|---|---|
| S1 | MDN — *Using server-sent events* | T2 | https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events | verified |
| S2 | WHATWG HTML Standard — *Server-sent events* | T1 | https://html.spec.whatwg.org/multipage/server-sent-events.html | verified |
| S3 | RFC 9113 — *HTTP/2* | T1 | https://www.rfc-editor.org/rfc/rfc9113.html | verified |
| S4 | Ably — *Server-Sent Events* topic page (upd. 2023-06-28) | T3 | https://ably.com/topic/server-sent-events | claimed (vendor) |
| S5 | Alpaca — *Real-time stock pricing data* | T2 | https://docs.alpaca.markets/docs/real-time-stock-pricing-data | verified |
| S6 | Massive (ex-Polygon.io) — *WebSocket · stocks · aggregates per minute* | T2 | https://massive.com/docs/websocket/stocks/aggregates-per-minute | verified |
| S7 | FINOS FDC3 2.2 — *API specification* | T1 | https://fdc3.finos.org/docs/api/spec | verified |
| S8 | Redis — *Pub/sub* | T2 | https://redis.io/docs/latest/develop/pubsub/ | verified |
| S9 | NATS — *Slow consumers* | T2 | https://docs.nats.io/learn/resilient-clients/slow-consumers | verified |
| S10 | Ably — *Delta compression* | T2 | https://ably.com/docs/channels/options/deltas | claimed (vendor) |
| S11 | Databento — *Beyond 40 Gbps: Processing OPRA in real-time* (2025-09-05) | T3 | https://databento.com/blog/beyond-40-gbps-processing-opra-in-real-time | reported |
| S12 | RFC 5861 — *stale-while-revalidate / stale-if-error* | T1 | https://www.rfc-editor.org/rfc/rfc5861.html | verified |
| S13 | Cloudflare — *Default cache behavior* | T2 | https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ | verified |
| S14 | Cloudflare — *Cache keys* | T2 | https://developers.cloudflare.com/cache/how-to/cache-keys/ | verified |
| S15 | Cloudflare — *Origin Cache Control* | T2 | https://developers.cloudflare.com/cache/concepts/cache-control/ | verified |
| S16 | Cloudflare — *cf-cache-status values* | T2 | https://developers.cloudflare.com/cache/concepts/cache-responses/ | verified |
| S17 | Chrome — *Timer throttling in Chrome 88* | T2 | https://developer.chrome.com/blog/timer-throttling-in-chrome-88 | verified |
| S18 | Chrome — *Page Lifecycle API* | T2 | https://developer.chrome.com/docs/web-platform/page-lifecycle-api | verified |
| S19 | Lightstreamer Web Client 9.2.0 — `Subscription` API reference | T2 | https://lightstreamer.com/sdks/ls-web-client/9.2.0/api/Subscription.html | verified (browser) |
| S20 | microservices.io — *API Gateway / Backends for Frontends* | T4 | https://microservices.io/patterns/apigateway.html | verified |
| S21 | Interactive Brokers — *Market Data Lines: Introduction* | T2 | https://www.interactivebrokers.com/docs/general/market-data-subscriptions/market-data-lines/introduction | verified (browser) |

**Internal sources (read in full as instructed, not counted above):**
`docs/terminal-research/07-technical-architecture/current-performance-and-realtime.md`
(D-05) · `docs/terminal-research/01-existing-system/backend-archaeology.md` (D-02, §1–2
and §6–7 closely; §5 also read for the SSE inventory). Every internal figure quoted here
carries D-05's or D-02's own confidence label, which for runtime numbers is usually CLAIM.

**Attempted and unreachable** (recorded so the next role does not repeat them):
`techatbloomberg.com/blog` (403) · `interactivebrokers.com/campus/ibkr-api-page/twsapi-doc/`
(403) · `lightstreamer.com/api/ls-javascript-client/latest/Subscription.html` and
`sdk.lightstreamer.com/ls-javascript-client/9.1.0/...` (403; the working path is S19) ·
`lightstreamer.com/docs/ls-server/latest/General Concepts.pdf` (image-only PDF) ·
`tradingview.com/charting-library-docs/latest/connecting_data/Streaming-Implementation`
(404, both with and without trailing slash) · `developers.lseg.com/…/refinitiv-real-time-sdk-java/documentation`
(404) · `docs.nats.io/using-nats/developer/events/slow` (navigation stub; the content page
is S9).

