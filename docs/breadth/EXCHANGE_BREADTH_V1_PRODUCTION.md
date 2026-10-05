# NYSE + NASDAQ Breadth V1 — production architecture, cutover and rollback

Status: **dark**. Every switch below defaults OFF; with none set, web, worker and runner are byte-identical
to master except the US V2 producer's prune guard (§3), which is unconditional by design.

## 1. One authority

Members' `nyse` / `nasdaq` breadth = ONE pointer, `breadth_exch/v1/AUTHORITY.json` (R2), naming exactly:

| artifact | identity | pinned where |
|---|---|---|
| historical (2008-01-02 NASDAQ / 2009-06-11 NYSE … 2026-09-24) | sha `e65b2af0…` | `breadth_exchange_authority.HIST_SHA256` |
| derived AD/MCO/MCS over the same span | sha `f9ed6966…` | `DER_SHA256` |
| live store snapshot (2026-09-25 … latest) | sha + logical sha in the pointer | content-addressed object |

The pointer also carries lineage (store creating commit, publisher commit, pins `cc3107f9…`, exceptions
`3ddf3ac7…`, identity parent `0acbe59f…`, ledger `4ccf140f…`), methodology, `publication_version`,
`previous` (version + pointer sha) and `rollback_of`.

`verify_set` (the reader's definition of authority) refuses unless: every object hash/size matches; the
frozen identities equal the pinned constants; the live lineage is an `append` store with exactly the pinned
parents/pins/exceptions/boundaries; live sessions are exactly the pinned calendar's trading days from
2026-09-25 to the latest (no duplicate, missing or extra session); every per-session row hash recomputes;
no orphan rows; the logical hash matches; and ONE forward AD/MCO/MCS pass over frozen + live advancing /
declining reproduces the frozen derived AND the live derived bit-exact (no reset, no second burn-in,
no second seed).

Readers: `breadth_daily_ohlc.history/dates_since` (→ `/api/bars/NYSE:*`), `market_indicators` NYSE/NASDAQ
`AD/MCO/MCS` (values read verbatim — never recomputed), the library availability/floor, and the authority
token that keys every breadth cache and ETag. `BREADTH_AUTHORITY_EXCH=v1` and no verified authority →
**empty** (fail closed), never the V1 store and never US V2's today-venue `nyse`/`nasdaq` rows.
`published_universe_ids()` cannot publish `nyse`/`nasdaq` unless the authority serves them.

## 2. Publication, switch, rollback

`breadth_exchange_publish.publish()`: SQLite-backup snapshot (logical hash proven equal to the store) →
content-addressed gz objects (read back) → the candidate pointer is **installed into a throwaway replica
with the reader's own `install()`** (download + every proof above) → `history/<version>.json` → ONE PUT of
`AUTHORITY.json` (read back). A crash or refusal before that PUT leaves the previous authority in force.

Web replicas (`BREADTH_EXCH_SYNC_ENABLED=1`) poll the pointer, download, prove, then switch `CURRENT.json`
by rename; a refused pointer leaves the installed authority serving.

`rollback(to_version)`: a new version whose artifacts are the target's exact objects (no rebuild), proven the
same way. **A rollback holds**: scheduled publication refuses (`ROLLBACK_IN_FORCE`) until an operator
re-forwards (`publish(..., re_forward=True)`).

## 3. Archive-before-prune (US V2 producer)

`breadth_v2_producer._prune_vintages` is the ONE prune path (normal build, retry build, any caller). A vintage
beyond `KEEP_VINTAGES` is deleted only if `breadth_vintage_archive.verify` re-proves now:
`<archive>/<tag>.ARCHIVED.json` present and well-formed (protocol `exch-vintage-archive-ack/1`); SUMS file
hash = ack; required listing (`inputs_<tag>/**`, `grouped_<tag>/**`) digest = ack; every archived file
re-hashes to SUMS; every required producer file is listed and byte-identical; input identity = ack; and
every session the vintage published has the archived input-manifest / reference identity. Otherwise: no
prune, a `prune_guard` row, an event, and `chart_health_alerts.emit` (critical on integrity failures).
Publication is not coupled to it.

Ack format: `{protocol, tag, complete, archive{dir, sums_sha256, files, bytes, verified}, required{files,
bytes, listing_sha256, rule}, source{dir, verified}, inputs{input_manifest_sha256, reference_sha256,
grouped_vintage_manifest_sha256}, verified_at, archiver{tool, code_commit}}` — 0444, written last after
`os.sync()`, atomically.

## 4. Scheduling (inside `breadth-v2-runner`)

`api.breadth_v2_producer_main` runs a second thread (`BREADTH_EXCH_RUNNER_ENABLED=1`) kicked after every
producer tick (and at least every `BREADTH_EXCH_TICK_SECS`): archive+ack (`BREADTH_EXCH_ARCHIVER_ENABLED`)
→ compute (`BREADTH_EXCH_COMPUTE_ENABLED`; `exch_live_leg --mode append` through the in-repo pinned engine
`tools/breadth_exch/run_overlay.py`, child process, timeout, nice) → independent `validate_live_store.py`
→ publish (`BREADTH_EXCH_PUBLISH_ENABLED`). flock singleton (`SKIPPED_DUPLICATE`); `HOLD` parks it.
Compute starts only for sessions US V2 has published (`v2_session`) whose required archive is acked; the
leg re-proves every owner, refuses gaps, and holds its own store flock.

Status: `RUNNER_STATUS.json` / runner `/exchange` — state (`CURRENT`, `CURRENT_WITH_PRUNE_BLOCKED`,
`WAITING_FOR_ARCHIVE`, `BEHIND (n)`, `STALE (reason)`, `ROLLBACK_IN_FORCE`, `CURRENT_UNPUBLISHED`,
`PARKED`), members_should_have / members_have, owner + archived, evidence/identity/compute/validation,
authority, archive guard (level, blocked, disk), retention classes. Producer `/` gains `archive_guard`;
`/api/health` reports its level (stays 200).

## 5. Retention (classified, NOT enforced)

| class | meaning | required? |
|---|---|---|
| A pinned exception | `p202609302026` — the approved substitute for 2026-09-25 / 09-28 (true owner irrecoverable) | keep (its SUMS hash is pinned in the exception file) |
| B owner, not yet authoritative | computes a pending session | keep, never deletable |
| C owner, authoritative | its sessions are in a published pointer | bytes needed only for exact re-computation; identity survives in hashes |
| D recent non-owner | READY at the producer, owns nothing | not needed once the producer prunes it |
| E superseded non-owner | owns nothing, producer pruned it | not needed |

Findings: (1) exact re-computation of a session needs the FULL owner vintage (the worker re-verifies every
grouped file in the vintage manifest; inputs are full-history tables); (2) only until the session is
authoritative plus an incident window; (3) after that the hashes in the store, ack and pointer preserve
identity (as US V2 itself keeps only 3 vintages); (4) rollback needs only prior pointers + objects, never
vintages; (5) one vintage can own several sessions (`p202609292209` owned two); (6) `p202609302026` is pinned;
(7) proposal: keep C hot for 5 authoritative sessions, then reduce to an evidence tombstone (SUMS, ack,
INPUT_MANIFEST, grouped_vintage_manifest, pit_reference); (8–10) see §6.

## 6. Disk

Measured 2026-10-05: vintage 1.99 GB; consecutive vintages share only ~1/3 of bytes; gzip ≈ 2.7×; /data
92 GB, 38 GB free. One vintage per trading day; a retry storm can build 6/day.
* archive broken → producer keeps every vintage: +2 GB/trading day (≈19 trading days to exhaustion), up to
  12 GB/day in a storm. WARNING on the FIRST blocked prune (day 1), long before disk.
* archive healthy, no retention → archive +2 GB/trading day.
* proposal steady state: A (2 GB) + B (≈0–2 GB) + C-hot (5 × 2 GB) ≈ 14 GB.

Thresholds (`breadth_vintage_archive.disk_level`): WARNING — any prune-blocked vintage, or free < 20 GiB;
CRITICAL — any verification/integrity failure, ≥ 3 blocked, oldest blocked ≥ 72 h, or free < 10 GiB.

## 7. Production deployment + cutover (each step needs its approval; none performed)

1. **Merge `breadth/exchange-v1` → master** (normal merge, no force). Deploys web/worker/runner. Effective:
   the prune guard (runner). Everything else dark.
2. **Runner env** `BREADTH_EXCH_RUNNER_ENABLED=1`, `BREADTH_EXCH_ARCHIVER_ENABLED=1` → acks for the four
   archived vintages are backfilled on the first cycle (before the next build_vintage can prune).
   Verify runner `/`: `archive_guard.level` OK, `ack_state` all `acked`.
3. **Runner env** `BREADTH_EXCH_COMPUTE_ENABLED=1` → the accepted store
   (`/data/_audit/exch_v1/live_v1/candidate`) appends each session US V2 publishes.
4. **Runner env** `BREADTH_EXCH_PUBLISH_ENABLED=1` → first pointer to R2 `breadth_exch/v1/` (frozen objects
   uploaded once). Members unaffected.
5. **Web env** `BREADTH_EXCH_SYNC_ENABLED=1` → verified replica installed; check
   `/api/breadth-monitor/authority` (PUSH_SECRET) `exchange.available=true`, `latest_session`.
6. **MEMBER AUTHORITY SWITCH** — web env `BREADTH_AUTHORITY_EXCH=v1` and
   `BREADTH_LIBRARY_UNIVERSES=us,nyse,nasdaq`. Verify `/api/breadth-symbols` lists `NYSE:*`/`NASDAQ:*`,
   `/api/market-indicators` lists `NYSE:MCO` etc., `/api/bars/NYSE:MCO?tf=D` returns the authority values.

Rollback: members — unset `BREADTH_AUTHORITY_EXCH` (or drop nyse,nasdaq from the library flag): exchange
series unpublished at the next process start; data — on the runner
`python -c "from api.services import breadth_exchange_publish as ep, breadth_exchange_authority as ea; print(ep.rollback(ea.object_store(), N))"`;
web replicas follow within `BREADTH_EXCH_SYNC_SECS`. Runner — `touch <runner root>/HOLD`.
