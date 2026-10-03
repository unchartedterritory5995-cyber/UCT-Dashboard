# Market Cap V1: production lifecycle (serving and refresh)

Status: built and proven in an isolated local namespace. It is **not deployed** and **not authoritative**. Every
number marked *measured* comes from the dark lifecycle runs in `C:/mcaplife` (see §10).

The methodology stays the accepted one, MCAP_V1-M1. This document covers how a build becomes something members can
read, how it is kept current, and how it is withdrawn.

```
SOURCE INPUTS ─► input snapshot (hashes + provenance) ─► builder (pinned methodology) ─► immutable candidate build
   ─► report suite + automated gates ─► private immutable publication + full verification ─► release manifest
   ─► AUTHORITY pointer (human cutover / policy-gated automated advance) ─► authenticated production reader ─► member
```

## 1. Reused architecture (Phase 0)

| Seam | Precedent reused | Where |
|---|---|---|
| Immutable publication | Fundamentals V5: content-addressed write-once objects, a write-once manifest, and a pointer written last by compare-and-set | `v5_publish.py` → `marketcap/publication.py` |
| Bucket + credentials | `data_sync` client, private bucket. Credentials live only in the service environment | `publication.R2Target`, `pit_serving._read` |
| Member entitlement | `require_bars_access`, the one chart-data gate: 401 when not signed in, 403 when not entitled, push-secret service bearer allowed | `api/routers/marketcap_pit.py` |
| Dark flag | `ECON_ENABLED`-style router dependency, which answers 404 before auth and before validation | `MCAP_PIT_ENABLED` |
| HTTP caching | private, strong ETag, 304 | `no-cache` and a build-scoped ETag (§5) |
| Scheduler owner | Fundamentals V5 worker scheduler: flag, OS lock on the volume, HOLD file, rollback by unsetting the flag | `marketcap/schedule.py` from `worker_main.py` |
| Currentness | Econ / V5: currentness computed at read time; HTTP 200 never means CURRENT | `marketcap/currentness.py` |

Not reused: Breadth V2 downloads a whole SQLite onto the web pod. A 0.53 GB database per pod per daily advance is the
wrong trade for a memory-tight web tier, so the web reads per-ticker documents instead.

## 2. Release contract (Phase 1): `release_contract.py`

Keys live under the private prefix `marketcap_pit/v1/`:

| Key | Mutability | Content |
|---|---|---|
| `obj/<sha256>.json.gz` | write-once, content-addressed | one serving document per ticker (`artifacts.py`, format 1) |
| `builds/<build_id>/manifest.json` | write-once | the release manifest |
| `builds/<build_id>/build.db.gz` | write-once | the exact build DB, for audit and forensics |
| `builds/<build_id>/validation.json` | write-once | the automated gate report |
| `AUTHORITY.json` | **the only mutable object** | which build members read |
| `status.json` | heartbeat | refresh progress and last result; never authority |

**Manifest fields.** Required fields are validated by `validate_manifest`, and only `validation.status == "PASS"` is
releasable.

- `format`, `dataset`, `build_id`.
- `methodology {version, commit, extreme_step_semantics, safety_bound_days, files_digest}`.
- `code {commit, tree, dirty}`. A build from a dirty tree is refused.
- `inputs {snapshot_id, files{name: sha256, bytes}, provenance{sources, sec_bulk{last_modified, sha256}, prosp_evidence_from, run_id}}`.
- `build {started_at, finished_at, db_sha256, db_bytes}`.
- `knowledge {latest_valued_session, filing_knowledge_cutoff, latest_price_session, latest_harvest_at, sec_bulk_last_modified}`.
- `artifacts {documents{TICKER: sha256}, census, db{key, sha256, bytes, gz_sha256, gz_bytes}}`.
- `validation {key, sha256, status, gates}`.
- `schema {document_format, compatible_readers}`, `published_at`.

**Pointer fields.** `{format, build_id, manifest_key, manifest_sha256, previous{build_id, manifest_sha256}, advanced_at,
by, reason, acceptance: HUMAN_CUTOVER | AUTOMATED_REFRESH | ROLLBACK, human_rooted}`.

- The pointer names one exact manifest by key and hash. It never says "latest" and never relies on listing a directory.
- `human_rooted` is set when a person put this authority in place, or when it descends through automated refreshes
  from such a move. An automated advance is refused unless the current authority is human-rooted.

**Proof chain the reader runs before serving any value:** pointer → manifest bytes hash to `manifest_sha256` →
manifest validates (format, PASS, schema, build id) → the ticker's document bytes hash to the manifest's sha → the
document decodes and passes its invariants (ordered days, no value ≤ 0, every gap has a reason, no gap overlaps a
valued day).

## 3. Publication (Phase 2): `publication.py`

`publish_build` writes the documents, then the build DB (gzip), then the validation report, then the manifest. Every
write is write-once: an existing key holding different bytes is an error and is never overwritten. Every write is
read back and hashed, and the run ends with `verify_build`, which re-reads every document.

**Publishing never moves the pointer.** `advance` and `rollback` re-verify the whole build first and then
compare-and-set the pointer against `expect_current`.

The R2 target tells *absent* apart from *error*. `data_sync.get_bytes` returns `None` for both, so with it a transient
read failure would look like "no pointer yet" to a compare-and-set.

Nothing is public, and nothing is deleted. No secrets are written: the manifest holds hashes, dates, file names and
source kinds, never credentials or URLs with keys.

## 4. Production reader (Phase 3): `api/routers/marketcap_pit.py` and `pit_serving.py`

- **Mounting.** Mounted in `api/main.py` beside econ. `dark_app.py` is not used.
- **Routes.**
  - `GET /api/marketcap/pit/{ticker}?start&end`: the dark reader's contract (`serve.py`) plus `authority` and
    `currentness` blocks.
  - `GET /api/marketcap/pit/{ticker}/latest`
  - `GET /api/marketcap/pit-status`: values-free observability, same gate.
- **Dark flag.** Everything is dark until `MCAP_PIT_ENABLED=1`.
- **Auth order.**
  1. The flag check runs first and answers 404.
  2. `require_bars_access` answers 401 or 403.
  3. Parameter validation and lookup come last.

  An unauthorized caller therefore gets byte-identical answers for a ticker that exists, one that doesn't, and a
  malformed one. This is tested.
- **No zero-filling.** Missing days stay reason-coded gaps; `latest` with no value returns `company_market_cap: null`
  plus a `reason`.
- **Read-only.** The reader never opens a database and never writes, which is tested on the file tree.
- **Fail-safe.**
  - A pointer or manifest that fails to verify is never bound. The reader keeps the last verified authority and
    reports `reader_error`, or returns 503 if it has never verified one.
  - A document that fails verification is a 503 for that ticker only.
  - Emergency pin: `MCAP_PIT_PIN=<build_id>:<manifest_sha256>`. The pinned manifest must still verify.

## 5. Cache identity (Phase 4)

| Layer | Key / policy | Advance A → B |
|---|---|---|
| Bound authority (server memory) | re-read every `MCAP_PIT_CONTROL_TTL` seconds (default 30) | each pod binds B within 30 s of the pointer write; this is authority propagation, not a cache |
| Documents (server memory) | content sha, which is immutable | B's tickers have B's shas, so A's documents are never selected |
| HTTP | `private, no-cache`; ETag = sha(build, manifest sha, document sha, query, currentness state); `X-MCAP-Build` header | a revalidation with A's ETag gets a 200 with B (tested) |
| CDN / edge | none: `private`, and the bars edge router only covers `/api/bars/*` | — |
| Client | `marketCapAuthorityClient.js` (unwired): entries keyed by `(build_id, ticker)`; a response from a new build evicts every other build's entries; errors are never cached | tested in vitest |

## 6. Currentness (Phase 5): `currentness.py`

There are two clocks, and the state is computed at read time against the NYSE calendar (`session_calendar`):

- **Market clock:** `latest_valued_session` against the expected session. Session D becomes *due* at D+1 06:00 ET.
- **Filing clock:** `filing_knowledge_cutoff` against the expected session's close.

| State | Condition |
|---|---|
| CURRENT | both clocks are at the expected session |
| DEGRADED_UPSTREAM_LATE | one session behind, and either within 6 h of due or the heartbeat says a run is in progress or waiting on upstream |
| BUILD_FAILED | behind, and the refresh run for the expected session FAILED or failed its gates; the previous authority is still served |
| STALE | anything else behind: past grace, more than one session behind, or the filing clock lagging |

**Prolonged staleness contract.** The authority keeps being served, because its history is still true point-in-time.
Every response carries `currentness.state` and a growing `lag_sessions`. Nothing is back-filled, and no value ever
becomes 0.

Prolonged STALE ends only through a new build, or through an operator pin or rollback. There is no silent switch.

**Measured upstream timing.** SEC published the 2026-10-03 nightly bulk files at 04:27Z (companyfacts) and 04:35Z
(submissions), about 00:30 ET. The due and grace thresholds are environment knobs (`MCAP_PIT_DUE_ET`,
`MCAP_PIT_GRACE_HOURS`) so they can be tuned to measured production run times.

## 7. Refresh (Phases 6 and 8): `acquire.py`, `refresh.py`, `schedule.py`

**Approach.** A scheduled **full rebuild**, with evidence that accumulates rather than being re-fetched.

- Every build reruns the whole pinned build from a fresh input snapshot.
- The evidence DBs are facts about immutable SEC documents. Each run copies the previous run's evidence and
  *resumes* every harvest, so only new filings are fetched.
- Every fetch goes through the content-addressed cache (about 324k objects, ≈6.3 GB), so re-deriving all evidence
  from scratch is the same computation with no network.

No incremental build logic was introduced.

**Owner: the worker.** Its volume and environment hold every production source:

- the Fundamentals V5 live store (universe);
- `bars.db` (daily closes);
- the Massive key (reference data);
- the bucket credentials (publication).

Single ownership is enforced three ways:

- an OS lock on `ROOT/scheduler.lock` for the scheduler process;
- `max_instances=1` and `coalesce` on the job;
- an OS lock on `ROOT/refresh.lock` for each run.

Runs happen in a child process. A HOLD file parks runs without a deploy. The run identity, every stage's checkpoint
(with timings, CPU and peak memory) and the final state are kept in `ROOT/ledger.db`. Restarting a run with the same
id resumes at its first incomplete stage.

**Schedule.** Tue–Sat 01:15 ET (`MCAP_PIT_REFRESH_CRON_ET`), after SEC's bulk files and after the last session's
close.

**Codified acquisition.** The candidate's inputs had been assembled by hand. These steps are now code:

- the universe export from the V5 `security` table;
- the `bars.db` daily-close export;
- the Massive reference pull (same endpoints and fields);
- the SEC bulk download;
- the harvests;
- split-evidence candidates: `split_gap HELD_NO_EVIDENCE` plus the adjacent state accessions, as the candidate's
  rounds 2 and 3 did;
- predecessors: lineage `PURE_REORGANIZATION/OK`. This reproduces the hand-picked list
  `[1288776, 92416, 6769, 34088]` exactly.

**Pinned evidence window.** The candidate's offering-document evidence covers filings from 2004-10-22 onward. Its
original newest-first harvest stopped there, leaving 10,522 older filings (1994–2004) unparsed. A refresh keeps that
window. **Owner decision:** whether to widen it, which would change pre-2005 history.

## 8. Automated gates (Phase 7): `gates.py`

Gates A–N, plus METHODOLOGY (no drift from the pinned files), BACKING (every state run is backed by an ACCEPTED
observation), INTEGRITY (structure, and the suite describes this build) and SEALED (the build DB is byte-identical
before and after the suite).

- Every gate is a fixed mechanical predicate and is never reinterpreted.
- Re-evaluated on the accepted candidate, all of them PASS (`gates_accepted.json`).
- Each gate is tested to fail on its own predicate alone.

**Automated acceptance vs human acceptance.**

- *Automated build acceptance* (all gates PASS) is required before publication and before any automated advance.
- *Human cutover acceptance* is required for the first authority and for any methodology change.

The automated advance policy (`policy.auto_advance`, default **off**) requires all of these:

- an existing human-rooted authority;
- an identical methodology digest;
- a new build that is not behind on either clock.

## 9. Failure atomicity (Phase 9) and rollback

| Case | Result (tested) |
|---|---|
| A build fails | run FAILED at `build_1`; the pointer is unchanged; `status.json` shows the failure; currentness shows BUILD_FAILED |
| B validation fails | GATES_FAILED; nothing is published (no manifest), so the build is not even a candidate |
| C/D upload fails | FAILED at `publish`; no manifest exists, so nothing is servable; the pointer is unchanged |
| E hash fails | `verify_build` raises; `advance` refuses; the reader refuses to bind or serve |
| F pointer write fails | the previous pointer stands (read back) |
| G success | PUBLISHED_NOT_ADVANCED (default), or ADVANCED by policy from a human-rooted authority |
| Rollback | `publication.rollback`: pointer N+1 → N after re-verifying N; deletes nothing; the reader serves N on its next control read (tested) |

## 10. Deployment still required (not performed)

1. Merge this branch to master and deploy web and worker. This is inert: `MCAP_PIT_ENABLED` and `MCAP_PIT_REFRESH`
   stay unset.
2. Provision the worker volume `MCAP_PIT_ROOT=/data/marketcap_v1`:
   - `refresh.json` with production sources;
   - `seed/` holding the candidate's evidence DBs (hash-identical to the accepted inputs);
   - `cache/`, the SEC content cache;
   - frozen review inputs: baseline, V5 shares, first build, blockers, adjudication bundle, V5 acceptance export,
     EDGAR acceptance records.
3. Run one refresh by hand on the worker (`refresh run`), publishing to the private bucket. The result is
   non-authoritative.
4. Hold a human cutover review of that build, then `advance(..., acceptance="HUMAN_CUTOVER")`.
5. Set `MCAP_PIT_ENABLED=1` on web.
6. Optionally enable `MCAP_PIT_REFRESH=1` and `policy.auto_advance`.

## 11. Measured (dark lifecycle, 2026-10-03, local 24-core machine)

| Stage | Wall | Notes |
|---|---|---|
| SEC bulk download (companyfacts 1.41 GB + submissions 1.57 GB) | 146 s | 2 requests; the files appeared 04:27Z / 04:35Z |
| inputs.db | 116 s | 6.9M filings, 1.6M share facts |
| lineage (index + 8-K12B reclassification) | 57 s | from the cache |
| plan + harvests (covers, text, ipo, adr, prosp) | 406 s | 3 days of new filings: 28+205+4+48+7+119 documents fetched; 0 missing |
| build (each; ran twice because build-dependent evidence changed) | 513–667 s | 403 s CPU, 210 MB peak (job-object accounting) |
| build-dependent evidence (econ + split evidence) | 491 s | 386 econ documents, 58 split documents |
| report suite (3 parallel) | 172–175 s | **universe_audit peaks at 2.56 GB**; everything else < 140 MB |
| gates | 6 s | |
| publish (5,636 documents 125 MB + build.db.gz 162 MB) + full verification | 62–70 s | |
| **full refresh, end to end** | **≈ 45 min** | measured with a concurrent test suite on the same machine |

Daily data volume: about 3 GB SEC download, a few hundred SEC archive requests (≤ 4 req/s), 290 MB written to the bucket
(content addressing re-uses unchanged documents), and about 3.5 GB of local workspace per run. Massive reference
(3 requests per ticker × 9,235) and the bars.db export were NOT measured: those are production reads, which were denied
from this machine. A full rebuild is the right choice at this cost. An incremental design would save minutes and add a
second code path.

**Determinism (measured).** A rebuild from the accepted candidate's exact hashed inputs produced 5,636 of 5,636
byte-identical serving documents. The DB hashes differ only by the embedded build id and timestamp.

**Served = built (measured).** For all 5,636 tickers and 13,362,304 daily points, the production read path returned
exactly what the dark reader computes from the build DB: 0 differences.

## 12. Findings that block a fresh candidate

1. **Refresh-induced identity loss (semantic defect, stop condition).** Issuer tickers come from SEC's CURRENT
   submissions ticker list. When an issuer deregisters, SEC empties that list, and its whole Market Cap history
   disappears from the next build. In 3 days of filings: WBS (15-12G, 2026-09-30; 1,124 valued days) and RITR
   (240 days) vanished, and 22 issuers' SEC ticker lists changed. Every scheduled refresh would keep eroding the
   history of acquired and deregistered companies. Fixing this changes the identity methodology and is an owner
   decision.
2. **The accepted candidate is not at its own evidence fixed point.** Its build requested annual reports (econ) and
   split evidence that had never been harvested. Of the 186 issuers whose values differ between the refreshed dark build and the accepted candidate:
   - 20 had econ evidence the accepted build had itself requested but never harvested;
   - 10 had new split evidence for their own held transitions (TCBK, URBN, ...);
   - 1 had a lineage change;
   - 6 had previously unparsed IPO or offering documents;
   - 149 filed after the freeze (WBS and RITR among them).
   Adjacent to the evidence-window edge, previously unparsed offering documents in late 2004 add small (< 1%) changes
   (LNG, PRAA).
3. **Gate C refuses the refreshed build** for 2 new ≥10× historical blocks (DCTH 3 sessions, NXAT 42) that need human
   adjudication. This is correct fail-closed behaviour, and it shows that while the frozen adjudications cover only
   the reviewed cohort, automated advances will sometimes need a person.
