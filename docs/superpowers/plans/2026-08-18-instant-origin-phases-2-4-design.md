# Instant Origin — Phases 2–4 Detailed Design

Companion to `2026-08-18-instant-origin-bars.md` (the overview). That doc's Phase 0
+ Phase 1-increment-1 are shipped; this doc is the deep design for the harder
remaining work (always-warm hardening, edge caching, intraday parity) so we can
execute cleanly tomorrow.

---

## Where we actually are (end of 2026-08-18)

**Shipped & live:**
- **Phase 0** — prewarmer supervised + guarded + heartbeat; daily-freshness watchdog
  → Discord; critical bars alerts → Discord; web-side daily freshness check. A
  parallel session hardened the heartbeat further: it now beats DURING the boot pass
  (was only in the steady loop → false "prewarmer never started" for hours), added a
  `phase` field (boot / steady / disabled), and `_boot_can_skip` (skips ~12k
  redundant D/W/M fetches per boot outside the active window → boot is fast now).
- **Phase 1, increment 1** — `/api/bars` daily first-paint de-block behind
  `BARS_DAILY_ASYNC_HEAL` (serve last-closed-session instantly + async heal, only
  when the daily is missing solely today's forming bar). Dark (flag off).
- **Pack refinements** — coverage-aware same-session rebuild (the pack refills to
  full coverage as the long tail warms, not just the first partial build) + prewarmer
  **default-ON for the worker** (a missing `BARS_PREWARM_ENABLED` was the actual
  cause of the week-long freeze).

**The freeze, root-caused:** `BARS_PREWARM_ENABLED` was simply not set on the worker —
warming was off. Re-enabled 2026-08-18 ~20:00 ET; store caught up; pack rebuilt fresh
for the liquid universe; long tail fills overnight + via the coverage-aware rebuild.

**Key realization about Phase 1:** intraday serve-path de-block is the WRONG move —
serving stale intraday would show a misleading yesterday's-session chart for up to
30s. For daily, the last-closed-session IS the correct display (+ live candle), so
daily de-block is right. **The way to make intraday instant is client-side pre-seed
(Phase 4), not serve-path de-block.**

**Guiding invariant (unchanged):** the request path performs only local reads; it
never awaits a provider. Freshness is the ingestion layer's job, and that layer is
supervised + alarmed.

---

## Phase 2 — Always-warm store (hardening)

*Mostly delivered by the Phase 0 + refinement work. What remains is closing the
freshness-lag and self-heal gaps so "cache miss" is structurally rare.*

### 2.1 Web daily freshness shouldn't wait on the ~40-min R2 lag
Today's live bars reach the web pod directly (Massive WS + on-demand), but
snapshot-borne history rides the worker→R2→web merge (~20–40 min). For **daily**
specifically, the web pod should never be a *closed session* behind the worker.
- **Task:** on the web pod, when a served daily is cold-stale (`_is_cold_stale_daily`),
  the existing synchronous heal already fixes THAT ticker; add a lightweight
  web-side "last closed session present?" self-check (reuse `daily_freshness_report`,
  already imported) that, if the whole store is a session behind, pulls the R2
  delta immediately instead of waiting for the next 1200s poll. Low risk.

### 2.2 Reconciliation for FROZEN / MISSING (not just wrong)
`bars_reconciliation` heals *drift* (wrong bars), not *frozen/missing* ones.
- **Task:** add a "missing recent session" detector to the reconciliation cycle: if a
  sampled (ticker, D) is ≥1 completed session behind, delete-and-refetch so it
  self-heals even without a human seeing the Discord alert. Bounded sample; web pod.

### 2.3 Watchdog phase-awareness (small polish)
My `_bars_freshness_decision` alerts on `!alive || stale`. During a healthy boot
pass the store is legitimately still stale, so it will fire "daily behind" until the
boot finishes. The parallel session's `phase` field lets us suppress that.
- **Task:** in the watchdog, treat `phase === 'boot'` as "warming, don't alarm on
  staleness yet" (still alarm on `phase === 'disabled'` or a dead heartbeat). Keeps
  the alert meaningful (dead vs booting vs genuinely stale-in-steady-state).

### 2.4 Coverage floor on the pack (optional tightening)
The coverage-aware rebuild publishes as soon as liquid names are fresh (max-based
guard) and refills as the tail warms. Consider a *minimum* coverage floor
(`_COMPREHENSIVE_RATIO` is the stop, not the start) so the FIRST published pack of a
session isn't < ~50% covered — avoids the "megacaps instant, everything else
refetch" window we saw tonight. Trade-off: delays the first fresh pack slightly.

**Phase 2 risk:** low. All incremental hardening of existing, tested components.

---

## Phase 3 — Edge caching the serve path (immutable closed bars)

*The "serve from a CDN like TradingView" piece. High value for cold browsers /
off-pack tickers / origin load, but the developing-bar boundary is a correctness
minefield — the design below makes it safe by construction.*

### The core idea
A **closed** daily/weekly/monthly bar is immutable. Serve the CLOSED history under a
**versioned, immutable, long-max-age URL** so Cloudflare answers from the edge
(~20 ms), and serve TODAY's developing bar separately (no-cache), stitched client-side.

### The safe design — version the URL by last-closed-session
```
GET /api/barsedge/{sym}/{tf}/{lastClosedSessionYmd}?bars=N
    → returns ONLY closed bars up to lastClosedSessionYmd
    → Cache-Control: public, max-age=31536000, immutable
    → Cloudflare caches it at the edge forever (it can never change)
```
- The client computes the current `lastClosedSessionYmd` (the `marketSession`
  close-threshold helper we already have) and requests THAT url.
- When the session rolls (a new close), the client requests a NEW url (new ymd) →
  cache miss → fresh closed history including the newly-closed session.
- **This is why it's safe:** a cached pre-open response can never bleed into RTH,
  because RTH requests a *different* URL. No `max-age` guessing, no stale-into-open.
- Today's developing bar comes from the existing live path (WS + `since=` poll),
  which the client already stitches onto the loaded series.

### Relationship to the Bars Pack
The Pack ALREADY edge-caches versioned immutable D/W/M shards for the universe — so a
browser WITH the pack never needs this. Phase 3 is the **per-ticker, on-demand**
equivalent for: (a) browsers before the pack ingests (~8s window on first load),
(b) off-universe tickers not in the pack, (c) origin-load reduction. **Marginal value
given the pack — schedule it AFTER Phase 4** unless origin load becomes a problem.

### Tasks
1. `api/routers/bars_edge.py` — the versioned immutable endpoint (reads the same
   `bars_fetch._fmt_sqlite_bars` sanitized closed bars; refuses to include a
   developing/today bar).
2. Client: `useBars` requests closed history from `/api/barsedge/...` + live tail
   from the existing path; stitch (the pack's `mergeDelta` shape already models this).
3. Cache headers + a `Vary: Accept-Encoding`; mind the `_GZipSkipSSE` double-gzip.
4. A cache-hit metric (CF `cf-cache-status` header) to confirm edge hits in prod.

**Phase 3 risk:** medium. The versioned-URL design removes the correctness risk; the
remaining risk is client stitching complexity. Flag-gate (`BARS_EDGE_ENABLED`).

---

## Phase 4 — Intraday parity (the last "waiting for a chart")

*Make intraday (5m / 1h / 15m) first-open instant the RIGHT way: pre-seed the
IMMUTABLE prior sessions client-side; today's session rides the live feed.*

### The key insight
Intraday bars of a **prior, closed** session are immutable — they can be packed and
edge-cached exactly like daily. Only **today's** session is live. So:
- **Intraday pack = prior closed sessions** (yesterday + N days back) of 5m/1h/(15m),
  versioned by session date, immutable, edge-cached — the SAME mechanism as the D/W/M
  pack, just keyed per closed session.
- **Today's intraday** = the live feed (already instant) + the prewarmer keeping the
  active/near-universe warm + on-demand for the long tail.
- **Result:** opening a 5m chart paints the prior sessions INSTANTLY from the pack,
  and today's session fills from the live feed — no synchronous provider fetch to
  block on. Scroll-back is instant (prior sessions are all pre-seeded).

### Why this beats "just de-block the intraday serve path"
De-blocking would serve *stale* intraday (misleading). Pre-seeding serves the
*correct* prior sessions instantly and lets the live feed own today — accurate AND
instant.

### Design
1. **Builder (`barspack.py` extension):** a second artifact — `intradaypack/{date}/…`
   — holding the last K closed sessions (start K=2–3) of 5m + 60m for the universe,
   versioned by build date, immutable. Size-budget carefully: intraday is ~78 bars/
   session (5m RTH) so K=3 × 2 TFs ≈ 468 bars/ticker — comparable to the daily pack's
   300. Same gzip/shard/floor machinery.
2. **Prewarmer:** extend proactive 5m/1m warm beyond the active top-1500 toward the
   full universe as memory allows (watch the RSS ceiling — this is where the OOM risk
   lives). Tiered: 60/30/15 already full-universe; push 5m wider incrementally.
3. **Client (`barsPackClient.js` extension):** ingest the intraday pack into IDB
   (prior sessions) so `idbStaleIntraday` is satisfied for history; today's session
   comes from the live path. The `provisionalStaleRef` freeze already prevents a live
   spike from fusing onto a prior-session tail — so this is client-safe.
4. **Freshness model:** the intraday pack rebuilds each post-close (the closed
   session set grew by one) — reuse the coverage-aware post-close trigger.

**Phase 4 risk:** medium–high — memory (extending intraday warm) + pack size. Start
with 5m + 60m, K=2 sessions, active-set-first, and measure before widening.

---

## Game plan — tomorrow (priority order)

**Morning — verify tonight landed (30 min, no code):**
1. Confirm the pack reached full coverage (manifest `newest_session` = today,
   `published_coverage` high via `/api/barspack/manifest` + the worker health
   `bars_daily.stale=false`). Confirm the Discord watchdog went 🟢.
2. Confirm the worker memory settled (no OOM sawtooth after the prewarmer boot).

**Then, in leverage order:**
3. **Flip `BARS_DAILY_ASYNC_HEAL=1` on the web pod** (Phase 1 go-live) and watch the
   `Server-Timing: bars;desc=` cold-serve ratio during RTH. *Highest leverage, zero
   new code — just turns on what's already shipped and measures it.*
4. **Phase 2 hardening** (2.1 web freshness self-check, 2.3 watchdog phase-awareness,
   2.2 reconciliation missing-session) — small, low-risk, ship as one batch.
5. **Phase 4 intraday pack** — the real remaining "instant everywhere" work. Start
   with the builder (5m + 60m, K=2) DARK behind `INTRADAYPACK_ENABLED`, then the
   client ingest, then measure. Biggest effort; do it supervised.
6. **Phase 3 edge caching** — only if origin load warrants it (the pack already covers
   most cases). Otherwise defer.

**Definition of done (unchanged):** ≥99% of `/api/bars` served from `mem`/`sqlite`
(never a full provider fetch), p99 origin < 100 ms, intraday first-open instant from
the pack, and a synthetic freeze pages Discord within 5 min.

## Open decisions for the owner
- **Phase 4 memory budget:** how wide to push proactive 5m warm (worker RSS ceiling)?
  Confirm the worker's memory LIMIT from Railway Settings — it decides how far the
  intraday warm can extend before OOM.
- **Phase 3 priority:** worth doing given the pack already edge-caches D/W/M? Lean
  defer unless origin CPU/load climbs.
- **Coverage floor (2.4):** accept a slightly slower first pack for higher first-pack
  coverage, or keep max-based + refill?
