# Fundamentals V5 cutover: design

Status: DESIGN, 2026-09-29. Starting master is `4e891b22b` (== production).
Frozen artifact: `v5-20260925T124921Z`, `v5.db` sha256 `a8148113…c6e1`, freeze.json `1b3da4ee…9430`.

## 0. Production as found (audited on current master + the live services)

| Question | Answer (code / runtime) |
|---|---|
| What serves fundamentals | Web `api/routers/fundamentals_pit.py` (`/api/fundamentals/pit/{catalog,series}`), `require_bars_access`, 404 unless `FUNDAMENTALS_PIT_ENABLED=1` (set on web only). |
| Where V4 lives | Worker volume `/data/fundamentals_pit.db` (4,721,795 v4 points, digest `60a3b115…`, unchanged since 2026-09-23 19:45Z). R2 `fundamentals_pit/v4/cik/<cik>.json` + `fundamentals_pit/v4/tickers.json` (index `5df30d12…`). |
| How the index is consumed | `serving.cik_for` reads `index_key(version)`; `artifact_for` reads `key_for(cik, version)`; 300 s in-process TTL cache; ETag = hash of input_hash + series + last points. |
| DERIVATION_VERSION | A module CONSTANT (`derive.py`, = 4) imported as the default `version` by serving and publish. It is the ONLY version selector today: switching requires a code change + deploy. |
| FUNDAMENTALS_PIT_ENABLED | Web router on/off (404 when off). Nothing else. |
| Who ingests new filings | Nobody. `schedule.register_fundamentals_pit_jobs` is called only from `api/main.py` (the WEB pod's APScheduler), gated by `FUNDAMENTALS_PIT_INCREMENTAL_ENABLED` (unset everywhere) and by the store file existing (it does not exist on web). The worker (`api.worker_main`) never registers them. No Railway cron touches fundamentals. |
| Is a scheduler active | No. Nothing has been ingested since 2026-09-23. V4 is serving but NOT current. |
| Discovery / amendments / restatements (V4 design) | EDGAR getcurrent Atom (last 100 per form) → `pending_refresh` → `refresh_company` (companyfacts + submissions ingest, instance evidence, derive, publish). Amendments are ordinary filings in that path. Restatement evidence in V4 came from the FS data sets (weekly); V5 replaces it with each filing's own instance. |
| Changed-company selection | Per discovered accession's CIK; derive skips by input hash. |
| Publication | `publish_company` OVERWRITES `fundamentals_pit/v{N}/cik/<cik>.json` in place (etag-skip), then overwrites the index. No version, no pointer, no validation. A failed run leaves some companies new and some old: partial output IS member-facing. |
| Validation before publish | None. |
| Currentness | Not defined. `jobs_status.json` records last run only. |
| Multiple writers | Worker is single-replica (volume); but the web hook + a worker hook would be two schedulers on two pods if both flags were set. |
| Restart survival | Store + `pending_refresh` + `publish_log` on the volume. |
| Rollback today | None for data (in-place overwrite); only "unset the flag" (web 404). |
| Replicas | Every service with a volume is single-replica (worker, web, runner). |

## 1. Storage model: frozen base + versioned live state

```
worker:/data/fundamentals_pit_v5_prod/
  base/v5_frozen.db          byte copy of the frozen artifact (sha a8148113…), 0444, only ever opened mode=ro
  base/artifacts/…           the frozen publication-format files (manifest 42794d92…)
  live/live.db               THE V5 production store (single writer). Initialised as a byte copy of base;
                             lineage table records base sha + run id. Never the frozen file.
  snapshots/<version>.db     sqlite backup of live.db at each published version (last 3 kept + base)
  batches/<batch>.json       one record per pipeline batch (also in live.db table v5_batch)
  pipeline.lock              flock: the ONE scheduler/writer
  HOLD                       present = the pipeline parks (no discovery, no writes, no publish)
```

The frozen artifact is never written. Future evidence changes the *served interpretation* by producing a new
**version** from `live.db`. The first V5 version (`v5-base`) is the frozen artifacts byte-for-byte.

## 2. R2 namespace (member-facing V5)

```
fundamentals_pit/v5/obj/<sha256>.json         immutable per-company artifact (content-addressed, write-once)
fundamentals_pit/v5/versions/<version>.json   immutable version manifest (companies {cik: sha}, tickers index,
                                              parent, evidence horizon, code identity, census, validation)
fundamentals_pit/v5/CURRENT.json              pointer {version, manifest_sha256, previous, published_at} -- the
                                              ONLY mutable V5 object, written last, one PUT
fundamentals_pit/v5/status.json               currentness (informational)
fundamentals_pit/serving.json                 member selection {"serve": "v4"|"v5", "v5_pin": null|<version>}
                                              written ONLY by the ops CLI; absent => V4 (today's behaviour)
fundamentals_pit/v4/…                         untouched
_runs/fundamentals_pit_v5/…/frozen/           archival, untouched
```

A member request resolves `serving.json` → (v4) or (v5 → `CURRENT.json` or the pin → manifest → object).
Manifests and objects are immutable, so a request sees one complete version. Controls are cached 30 s.

## 3. Serving seam

`serving.selection()` is the ONE place that decides the version: env `FUNDAMENTALS_PIT_SERVE` (emergency override:
`v4`) > R2 `serving.json` > default V4. It returns a `Source` (v4: the existing keys; v5: a manifest-bound reader).
`series_response` and the router take the source; no `if version == 5` elsewhere. The payload keeps its shape;
`derivation_version` becomes 5 and a `version` field names the V5 version. The ETag includes the version + object sha.

**Rollback** = `v5_ops serve v4` (one R2 PUT; web picks it up ≤ 30 s + member HTTP cache ≤ 300 s).
Pinning a previous V5 version = `v5_ops pin <version>`. Neither needs a rebuild, deploy or data change.

## 4. Scheduler and writer ownership

Exactly one owner: the **worker** (`api.worker_main` → `v5_pipeline.start_scheduler()`), because it is single-replica
with a volume, holds the R2 credentials, and is the process that holds the stores. The web hook
(`api/main.py` → `register_fundamentals_pit_jobs`) is **removed**, and the legacy V4 jobs (which would write the V4
store and V4 keys) are no longer schedulable. Guards: `FUNDAMENTALS_PIT_V5_PIPELINE=1` (worker only) + an OS `flock`
on the volume held for the process lifetime + an in-process run lock (one batch at a time) + a durable lease row
(owner, boot, heartbeat) + `HOLD` file. A restart re-acquires the lock; every step is idempotent
(accession / cik keyed), so a killed batch resumes and never double-publishes (the manifest key is write-once; the
pointer is compare-and-set against the recorded parent).

## 5. Pipeline (one batch)

```
DISCOVERING  feed (EDGAR getcurrent, periodic + amendment + FPI forms), daily form index (complete days),
             submissions sweep (catch-up / weekly)          -> v5_queue(cik, accn, form, source)
ACQUIRING    per company: companyfacts + submissions -> ingest (append-only) ; instance evidence for every
             new filing ; splits (Massive) for the universe
             accession outcome: ARRIVED | NO_FINANCIAL_FACTS (terminal) | PENDING (SEC lag, retried) | FAILED
DERIVING     build_company(version=5) for every company whose inputs changed (input-hash skip)
VALIDATING   §6 ; failure => WITHHELD (company-level quarantine where possible, batch-level otherwise)
READY        candidate = parent manifest with changed companies replaced
PUBLISHED    objects PUT (write-once) -> manifest PUT (write-once) -> re-read + verify -> CURRENT.json PUT
             -> snapshot live.db -> currentness advances
```
Nothing is member-visible before the single pointer write.

## 6. Validation before publish (bounded, per batch)

Per changed company:
1. **Determinism** — a fresh in-memory `build_series` equals the rows just stored.
2. **Invariants** — no source filing public after the point; sources are the company's filings; no period
   regression; gap rules; finite values; no redundant repeats.
3. **PIT guard** — let `B` = the earliest `public_at` among filings whose facts / evidence / rows are NEW in this
   batch. Every point with `t_eff < B` must equal the parent version's point, except split-sensitive metrics when
   the company's split rows changed in this batch or its split-verification status flipped. Anything else is
   an unexplained retroactive change → the company is quarantined (its parent object is kept) and the batch
   records it.
4. **Scope** — only companies with new inputs may change.
5. **Withholding flips** — allowed (it is the V4/V5 rule) but recorded; > 3 in one batch withholds the batch.
6. **Impossible dates** — a NEW point with `period_end` after its day is a WARNING (recorded), not a block: the rule
   is the frozen methodology and the value was public at `t_eff`.

Per batch: object/manifest sha re-verified after upload; census (companies never disappear; tickers index ≥ 99% of
the parent); pointer compare-and-set.

## 7. Currentness contract

Recorded per batch and in `status.json`: `sec_checked_at`, feed entries seen, `daily_index_verified_through`
(the last business day whose EDGAR daily form index was fully processed), discovered / acquired /
no-financial-facts / pending accessions, companies changed / re-derived / quarantined, validation result,
version published, `latest_filing` (public_at + accession), active member pointer.

`CURRENT` iff: a V5 version is published; the last cycle succeeded ≤ 30 min ago in filing hours (≤ 26 h otherwise);
`daily_index_verified_through` ≥ the previous business day once its index is posted; no discovered filing older
than 2 h is still pending (SEC-lag retries excepted); no WITHHELD batch outstanding. Otherwise `CATCHING_UP`,
`STALE`, `WITHHELD` or `FAILED`.

## 8. Methodology dispositions (frozen artifact unchanged in every case)

The methodology code (`knowledge`, `metrics`, `series`, `derive`, `concepts`, `split_ledger`, `splits`,
`quarters`, `facts`, `filings`, `restatement_signals`) stays **byte-identical to `7dfda83de`**, enforced by a test,
because every future version must extend the frozen base with the SAME rules: a rule change would mix methodologies
across time inside one served series. Candidate rule changes are listed for an owner decision (a future V6).

- **explain()** — root cause found: `build_book` breaks ties by the insertion order of the state dict; the series
  path builds state in order of first appearance over time, `explain()` used `state_at()` (history order). The stored
  values are the deterministic series-path result. Fixed in TOOLING (`provenance.explain`, which walks the same
  state), never used for member serving or publish gating.
- **Impossible dates** (1,254 points / 492 cos): malformed filer context dates (10-Q 883, 10-K 390 source uses;
  211 are 1 day ahead, 52 > 1 year). Values were public at `t_eff` (0 source-after-t). Continue to serve (identical to
  V4); new occurrences warn. Candidate V6 rule: reject facts whose period ends after acceptance.
- **Sign-flip quarantine** — 5,007 flips / 1,060 cos; in 1,099 the later filings side with the flip (first-seen is
  the outlier); 17 are negative revenue first-seen. Kept. Candidate V6: majority/latest-consistent sign.
- **Coarser rounding** — 61,890 drops / 1,820 cos; 41,392 are true 1e3/1e6 rounding, 20,498 only look coarse by
  trailing zeros (p50 0.012%, p99 5.4% difference). Kept. Candidate V6: equivalence only at 1e3/1e6.
- **FCF provenance** — FCF is `OCF - CapEx` per identical quarter (`metrics.fcf_quarters`); its composite label has
  no accession, so `sources` is empty. Reconstructible: `provenance.explain` expands FCF into its OCF and CapEx facts
  and filings. Stored data unchanged.
- **Split-sensitive withholding** — 361 cos; the first failing window is usually a routine 10-Q (median 26 filings
  in); 24-58 companies a year newly fail, each removing its whole EPS / share / dividend history from the served
  version. Kept (same as V4 today); every flip is recorded and > 3 per batch holds the batch.

## 9. Rollback

`v5_ops serve v4` restores member-facing V4 (V4 objects are never touched). V5 versions, live.db, snapshots and
evidence are untouched by rollback. Proven before the member switch on the dark path.
