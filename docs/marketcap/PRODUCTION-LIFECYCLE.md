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

**Schedule.** Tue–Sat 06:15 ET (`MCAP_PIT_REFRESH_CRON_ET`; owner approval 2026-10-06 -- after the D+1 06:00 ET due boundary, which is unchanged), after SEC's bulk files and after the last session's
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

1. **Refresh-induced identity loss: RESOLVED by methodology M2 (owner decision 2026-10-05), see section 13.** Issuer
   tickers came from SEC's CURRENT submissions list, so a deregistered or delisted issuer lost its whole history on the
   next refresh (WBS 1,124 days, RITR 240 days). The same defect removed NXAT's former symbol KWM, which dropped NXAT's
   accepted multi-class hold and produced the 30x Gate C block.
2. **The accepted candidate is not at its own evidence fixed point.** Its build requested annual reports (econ) and
   split evidence that had never been harvested. Of the 186 issuers whose values differ between the refreshed dark build and the accepted candidate:
   - 20 had econ evidence the accepted build had itself requested but never harvested;
   - 10 had new split evidence for their own held transitions (TCBK, URBN, ...);
   - 1 had a lineage change;
   - 6 had previously unparsed IPO or offering documents;
   - 149 filed after the freeze (WBS and RITR among them).
   Adjacent to the evidence-window edge, previously unparsed offering documents in late 2004 add small (< 1%) changes
   (LNG, PRAA).
3. **Gate C refuses the refreshed build.** NXAT (42 sessions) was caused by finding 1 and is gone under M2. DCTH
   (3 sessions, 2020-05-01..05) remains and needs an owner decision (section 13). Originally both 2 new ≥10× historical
   blocks needed human adjudication. This is correct fail-closed behaviour, and it shows that while the frozen adjudications cover only
   the reviewed cohort, automated advances will sometimes need a person.

## 13. Durable issuer identity (methodology MCAP_V1-M2, owner decision 2026-10-05)

ISSUER IDENTITY (the SEC CIK) is not the same thing as the CURRENT TICKER MAPPING, and neither is the CURRENT LISTING
STATUS. Current discovery may add or update mappings; it may never erase proven historical identity.

- **Ledger (`identity_ledger.py`, `identity.db`).** Evidence carried forward from run to run, only ever added to. It
  holds every CIK -> ticker attribution SEC made, with the first and last snapshot dates. The seed is the accepted
  candidate's own inputs (SEC snapshot as-of 2026-09-30).
- **Refresh.** The `identity` stage copies the previous ledger and records this run's snapshot. With no ledger it
  refuses to build. The universe is durable: prices, reference data and SEC inputs keep every retained issuer and ticker.
- **Build.** An issuer is valued over its current tickers plus its RETAINED tickers. A retained ticker:
  - is never current, and is served with `listing.current = false` and `last_attributed`;
  - is valued only on bars up to its last attribution;
  - is WITHHELD_REASSIGNED when Massive names another CIK for the symbol;
  - counts as a second class only while it trades beside another listing.
- **Gate R (`identity_delta.py`).** Every valued day of the accepted reference that a build no longer values must be one
  of: a reason-coded EVIDENCE_HOLD, or ATTESTED. Gate R FAILS on:
  - UNEXPLAINED days (neither valued nor reason-coded);
  - an identity reason (not yet listed / ticker reuse / delisted);
  - any hold on an issuer whose ticker mapping changed;
  - a reassignment withhold;
  - a missing reference.
- **Proof (`C:/mcapid`, run-20261005-identity1, the same SEC bulk files as run-20261003-dark1).** Build
  MCAP_V1-20261005T135436Z (sha 8db5e51e...):
  - Reference vs build: 0 unexplained issuer or day losses.
  - WBS 1,124/1,124 and RITR 240/240 days value-identical to the reference.
  - NXAT back to the accepted hold.
  - 361 removed days, all reason-coded new-evidence holds: NVA 347 (a post-freeze 10-K breaks the lineage
    own-history exemption) plus 14 single days.
  - Gate R PASS. Every gate except C PASS.
  - Bite: gate R on the unfixed dark1 build FAILS exactly WBS 1,124 + RITR 240 UNEXPLAINED.
  - Evidence: `C:/mcapid/reports_identity`.
- **Known limitation (fails closed, not in the observed corpus).** Only the primary symbol's bars are valued. A renamed
  issuer whose OLD and NEW symbols carry separate, non-stitched price series therefore loses the OLD-era days, and gate R
  fails. Valuing a symbol chain needs a per-period primary and a per-symbol corporate-action ledger. That is a V2
  identity decision.
- **Open owner decision: DCTH (Gate C).** On an uplisting with a concurrent offering, the IPO rule values the listing
  date (2020-05-01, before pricing) at a preliminary S-1/A post-offering projection (1,765,080 shares). Meanwhile the
  issuer's own count in force (72,773) and the final 424B4 (2,272,773) say otherwise. Holding those 3 sessions needs a
  new rule. The accepted candidate carries 922 preliminary-over-final IPO pairs; they are ordinary offering-size deltas.

## 14. DCTH release disposition and the V2 offering boundary (owner decisions 2026-10-05)

**Decision: keep the V1 IPO methodology.** The uplisting rule was researched and rejected. Its classifier is clean:
18/18 uplistings and 0 false positives on traditional IPOs. But V1 rejects every pre-listing count
(`REJECTED_PRE_LISTING`), so the rule turns every affected value into a hold. That is 828 sessions across 18 issuers.
Only 25 of those sessions (at 5 issuers) are evidence-backed premature projections, and 14 of the 18 projections were
within ±16% of the first later actual count.

**TRI (research correction).** TRI's F-10 (2002) states that its common shares were already listed on the Toronto Stock
Exchange. It therefore belongs to the same already-public / cross-listing family, and the rejected rule's true scope was
19 issuers and 1,027 sessions. V1 behaviour does not change, and TRI gets no special case.

**DCTH: a known V1 limit, release BLOCKED.**
- In a fresh build, the IPO rule values 2020-05-01, 05-04 and 05-05 at the preliminary S-1/A projection (1,765,080
  shares).
- Primary evidence shows that projection is not the actual capitalization:
  - 72,773 shares in force before the offering;
  - the offering was consummated on 2020-05-05;
  - the 8-K (public 2020-05-08 21:11Z) reports 1,895,773 shares after the offering and 2,623,446 on 05-08;
  - the 10-Q reports 2,760,401.
- The accepted reference passes Gate C only because its inputs never harvested that S-1/A, so it held those days as
  IPO_CAPITALIZATION_UNRESOLVED.

**Why there is no release path in V1.** Gate C detects blocks: contiguous ≥10x V1-vs-production sessions. Its consequence
is artifact-global by design:
1. Any failed gate makes validation FAIL.
2. The refresh then ends GATES_FAILED, publishes nothing and keeps the previous authority.
3. The release contract accepts only `validation.status == PASS`.

A block resolves only through a human disposition (PROVEN_CORRECT / FIXED / HELD_WITH_EXPLICIT_REASON). Each disposition
is verified against the build, and HELD requires the build itself to withhold the sessions. V1 has:
- no publication-side quarantine;
- no issuer or session exclusion input;
- no other hold mechanism outside its evidence-derived rules.

Gate R's ATTESTED class accepts only identity-boundary *removals*; it never validates a value and does not apply to
Gate C. DCTH is not PROVEN_CORRECT, so it cannot be dispositioned. No general semantic trigger isolates it (sections 12
and 13, and the research in `C:/mcapid/research_closing`). V1 is therefore release-blocked by DCTH until V2.

**Market Cap V2 backlog (recorded, not implemented):**
1. an offering / corporate-action event model;
2. event_date vs known_at for that model;
3. offering closing;
4. explicit reported-actual shares outside periodic covers (8-K Item 3.02, press releases);
5. primary vs secondary offering shares;
6. greenshoe / over-allotment;
7. pre-funded warrants;
8. preferred and convertible conversions;
9. reverse splits concurrent with a listing;
10. uplisting semantics for an existing public security;
11. ticker-history / corporate-action lineage, including renames with separate price series;
12. foreign cross-listings.

## 15. Production lifecycle / authority gate (2026-10-05)

### 15.1 Master integration
Merged origin/master `575031c2f` (316 commits) as `97e49d9da`. File overlap: `api/main.py` (router mount) and
`docs/feature_flags.json` only; master changed none of the pinned methodology files, `bars_auth`, `data_sync`, the
fundamentals scheduler or the chart's fundamental seam. Methodology drift `{}` after the merge. The one red test on the
merged tree (`test_auth_surface_reads`: `GET /api/ltr/call-request`) is master's own `f47607ca1`.

### 15.2 Lifecycle components (A current · B small port · C right idea, obsolete implementation · D retire)
| Component | Class | Note |
|---|---|---|
| release_contract (manifest + AUTHORITY pointer, human_rooted) | A | + REVOKED_BUILDS rail (§15.4) |
| publication (write-once, read-back, CAS pointer, rollback; Local/R2 targets) | A | same private bucket + data_sync client as V5; `marketcap_pit/` is empty in production (read-only listing) |
| pit_serving + /api/marketcap/pit* (require_bars_access, MCAP_PIT_ENABLED) | A | + a revoked build is never kept as "last verified" |
| currentness | B | a dead run's `in_progress` heartbeat no longer holds DEGRADED forever |
| refresh (ledger, run lock, checkpoints, HOLD) | B | + crash resume, unique run ids, parity switches |
| schedule (worker-only, scheduler.lock, child process) | B | + restart catch-up; docstring corrected (universe = V5 published) |
| acquire.universe_from_v5 (V5 live.db) | C | V5 runs on fundamentals-v5-runner; replaced by `universe_from_v5_published` (R2 CURRENT -> sha-verified manifest) |
| acquire.reference_from_massive (serial) | B | 2-6 h serial; bounded workers + deterministic sorted output |
| marketCapAuthority / Client (chart) | B | now WIRED behind the server switch via marketCapAuthorityStore + useMarketCapAuthority |
| none | D | nothing retired |

### 15.3 Production facts measured read-only (2026-10-05 after the close)
- Universe: V5 CURRENT `v5-20261005T152000Z` (manifest `43d8d527…`): 7,082 CIKs / 9,248 tickers, a strict subset of
  M3's frozen 7,088; the 6 missing issuers are retained by the identity ledger (durable universe 7,088 / 9,260 tickers).
- SEC bulk Last-Modified is still 2026-10-03 04:27Z / 04:35Z (no weekend publication); byte-identical to M3's inputs.
- Prices: worker `/data/bars.db` daily export, 7,064 tickers / 25,467,144 bars, latest session 2026-10-05.
  ⛔ M3's frozen prices.db (exported 2026-09-30) differs from today's bars.db on 1,061,475 closes (3,552 tickers):
  ~2,586 tickers on 1-3 September days (partial bars since repaired: e.g. AA 2026-09-21 close 44.56 vs final 44.64,
  ~1,186 tickers' 09-29 bar was partial), and ~900 tickers re-based histories (constant ratios such as CTSO x20,
  PII x0.5; drifting ratios such as HPQ / JCI spin-off style adjustment). The next refresh re-derives from current
  prices by design (full export, full rebuild); attribution in §15.7.
  ⇒ RULE: the price export must run after the session's daily bars are final (post-close repair), never intraday.
- Worker container `/tmp` is replaced on every deploy (three worker deploys between 22:09 and 22:52 ET). Long jobs must
  live on the volume root with ledger checkpoints (they do: MCAP_PIT_ROOT) and resume (§15.5).
- Massive reference pull: ~0.7-2.5 tickers/s at 4 workers on a loaded worker host (load avg 22-40) => 1-3.5 h.

### 15.4 Rejected-M3 rail
`release_contract.REVOKED_BUILDS` names `MCAP_V1-20261005T205248Z` / db `fae1dbb5…`. Enforced in `validate_manifest`,
`validate_pointer`, `publish_build` (by id AND by the bytes of the DB being published) and the reader (pointer, PIN,
cache). Selection never uses newest / mtime / lexical order / directory scans: only the pointer (tests:
test_revoked_build_rail.py, failure-matrix case 24).

### 15.5 Restart / crash behaviour (found by the failure matrix + the deploys above)
- An interrupted run (RUNNING in the ledger while the lock is free = dead) younger than MCAP_PIT_RESUME_HOURS (20) is
  RESUMED under its own run id from its checkpoints; older ones are closed CRASHED.
- At worker start the scheduler adds ONE catch-up run (120 s later) for an interrupted run, or for a cron fire under 6 h
  old with no run after it (APScheduler's memory job store forgets fires missed while the worker was down).
- A heartbeat that has not moved for 6.5 h (or has no time) no longer excuses lateness: STALE, not DEGRADED.
- Two runs in the same second no longer share a run id.

### 15.6 Chart / formula path
binder.js -> `fundamentalColumnWithAuthority`; StockChart -> `useMarketCapAuthority` -> `marketCapAuthorityStore`.
ONE server switch (MCAP_PIT_ENABLED on web): `/api/marketcap/pit-status` 404 / 401 / 403 => the unchanged legacy
composer; 200 => the authority ONLY (loading, unknown ticker, intraday = not computable, never close x shares); 503 =>
not computable, retried after 5 min. A response from another build drops every series of the old build. Market Cap is
`formula_eligible: false` in the catalogue, so the supported sourced path is an indicator (e.g. Moving Average) whose
Source is the Market Cap instance -- proven in the browser. P/S, P/B, FCF yield keep composing close x V5 shares
(out of scope).

### 15.7 ⛔ STOP: the price input is not a stable historical authority (2026-10-05)
Counterfactual refresh `run-20261005-cfpx` (C:/mcapcf): M3b's EXACT frozen inputs, prices replaced ONLY by today's
production `/data/bars.db` export -> build `MCAP_V1-20261006T032631Z` -> **GATES_FAILED B, C, G, K, R** (nothing
published, nothing advanced: the lifecycle failed closed). Root cause = production bars.db history moved since M3's
2026-09-30 export:
- 37 tickers LOST 39,987 daily rows (MEI / UTMD / QMCO / TZOO / HRTX / AVNW pre-2006; XOM / KO 1962-77), and 13 have
  HOLES in Jul-Sep 2026 (ASTC, CHPT, EQ, AREC, AVEX, DFNS, FJET, SHMD, PLNH, FNMA ...) -- a live bars defect;
- 660 tickers GAINED 1,985,937 rows (pre-2006 deep history), ~900 re-based (VRME x10, CTSO x20, PII x0.5, HPQ/JCI),
  ~2,586 repaired partial September bars.
Gate R: 5,709 historical valued days removed UNEXPLAINED (no withheld reason) + 8,013 evidence holds; C: new
unadjudicated >=10x blocks VRME / STKH / BRNX / VWAV; G/K: RNST / MRTN / GBCI split cases unverified; B: FXHO.
Consequence: a scheduled refresh would publish NOTHING and the authority would age to STALE (served, labelled).
Not a methodology defect and not dispositioned here. OWNER DECISION REQUIRED on the price-input contract, e.g.
(1) a versioned / sealed price snapshot owned by Market Cap (historical closes frozen; new sessions appended; a
re-basing upstream change is an explicit reviewed event), or (2) gate the refresh on an upstream bars integrity
attestation and re-adjudicate on accepted bars changes. Separately: the Jul-Sep 2026 holes are a bars-integrity
defect for the bars owner.

## 16. Price Input Authority V1 (owner decision 2026-10-05: Option 1)

Market Cap = PRICE x PIT SHARE STATE. Production bars.db is a mutable historical source (§15.7), so Market Cap owns a
SEALED, VERSIONED, APPEND-ONLY-BY-DEFAULT price lineage (`price_authority.py`). An ordinary refresh appends newly
completed sessions; it never inherits an upstream historical rewrite. History changes only through an explicit,
human-approved HISTORICAL_CORRECTION.

### 16.1 Root
`PRICE-ROOT-07b851631ec08ea8` = the accepted M3 price evidence, sealed byte-for-byte: `C:/mcapdata/prices.db`, sha256
`07b85163…`, 693,006,336 bytes, `bar(ticker, d, c, v)` + `input_file` (24 export parts), 23,478,488 rows, 7,051
tickers, sessions 1962-01-02 … 2026-09-29, content sha256 `0de77958…`. Identity proven four independent ways: the
accepted build DB's `input_sha256:prices.db`, the published M3 manifest `inputs.files.prices.db`, the M3b ledger's
`sources` and `seal` stages, and the file bytes. Kept as-is (not repaired): its 2026-09-29 bars include ~1,186 partial
closes and 244 rows have a non-positive close -- candidates for a future reviewed correction, never a silent one.

### 16.2 Versions
`<root>/prices/versions/<id>/` -- every file write-once and 0444; `manifest.json` is written LAST (a crash leaves no
version). ROOT/CORRECTION carry `base.db`; APPEND carries `delta.db` (rows on the ROOT's split basis, basis events,
per-ticker holds). The manifest records parent, file sha256s, content sha256 (ordered row hash) of the materialized
build input, rows / symbols / session range, appended sessions, finality evidence, holds, provenance, code.
Materialization = base + deltas (INSERT, never replace) + basis events, re-verified against the sealed content hash on
every use. An APPEND id is content-derived, so a retry after a failed Market Cap build reuses the orphan exactly.

### 16.3 APPEND contract
- due sessions only: NYSE sessions after the parent's last session that are due (currentness `expected_session`, D+1
  `MCAP_PIT_DUE_ET`) -- no lookahead;
- session-level: the official daily aggregate (Massive grouped daily) must exist; population >= 90% of the parent's
  last session; invalid closes <= 1% -- else PRICE_HOLD (nothing sealed, nothing built, previous authority served);
- row-level finality: OFFICIAL (close within aggregate rounding), OFFICIAL_SPLIT_BASIS (ratio == a reference split
  executed after the session), NO_TRADE_CARRY (absent from the aggregate, volume 0, previous close carried -- the root's
  own no-trade representation); otherwise NOT_FINAL (held);
- per-ticker basis anchor on its last 5 stored rows: SAME_BASIS (>= 4/5 ratios == 1; a repaired partial bar tolerated,
  not inherited) / BASIS_EVENT (constant ratio == a reference split in the window: recorded, applied at
  materialization, stored rows never change) / HOLD (PRICE_BASIS_DIVERGENCE);
- a held ticker gets no rows after its first hold in that version (no hole-then-resume). ⚠ A held key can never be
  appended later (that would be a historical insert): it stays a gap until a reviewed correction;
- invariant: every parent key identical, appended keys all after the parent's last session; refused otherwise.
- new listings enter on new sessions; inactive symbols simply stop.
- the parent of an ordinary refresh = the price version of the CURRENT Market Cap authority (pre-price-authority
  authority: its prices.db must be the root, else "price lineage is ambiguous"), so a Market Cap rollback carries the
  price lineage with it.
- a refresh targeting the production bucket refuses any price source other than the price authority.

### 16.4 HISTORICAL_CORRECTION
`propose-correction` seals a complete corrected snapshot + its exact diff (lost / gained / changed, re-based, repaired,
recent-window, large factors, affected tickers) as a CANDIDATE. It is never a build input or a parent until `approve`,
which requires a human approver (never `refresh:*` / `scheduler`) and a Market Cap release-gate result of PASS from a
dark refresh pinned to it (`sources.prices.pin_version`). The scheduler has no correction path at all.

### 16.5 Divergence monitor
Report-only: every refresh compares the accepted lineage with the upstream source over the recent 60 sessions
(`runs/<id>/price_divergence.json`, summary in the run's sources result); Saturday runs compare the full history.

### 16.6 Proof (2026-10-06, dark/local; production read-only)
- M3 reproduced through the sealed root (`C:/mcaprepro`, run-20261006-m3repro): all 15 result tables + every evidence
  table logically identical to accepted M3b; gates PASS (19/19). Only differences: evidence-DB file bytes and a gzip
  mtime in pred_universe (fixed: byte-deterministic).
- Next-session append (`PRICE-APPEND-20261002-2dedc7c156aa`, parent = root): sessions 2026-09-30, 10-01, 10-02;
  20,196 rows / 6,862 symbols; 0 historical rows changed / removed / inserted (structural + content-hash verified);
  8 basis events (KUST, BGM, MYPS, RETO, DHY, SHFS, ZCMD, ZCSH); finality OFFICIAL 19,187 / NO_TRADE_CARRY 1,029 /
  OFFICIAL_SPLIT_BASIS 18; 60 rows held NOT_FINAL (permanent gaps unless a reviewed correction).
- Incremental vs full (owner definition: identical price version / universe / identity / SEC evidence / reference /
  code): the lifecycle build vs an independent full derivation over the same inputs with prices re-materialized
  (byte-identical) -> ALL 16 tables EXACT over the whole universe (7,088 issuers).
- Stronger test (evidence RE-HARVESTED from scratch, 53 issuers): values / gaps / states exact; provenance differs --
  81 observation tags (an older cover parser's "[entity]" suffix, ignored by `state._chan`) and the JCI 1999 split
  evidence (applied 1999-09-30 from accumulated evidence vs 1999-08-23 re-derived): evidence accumulation is
  path-dependent (harvests skip issuers already done).
- Mutable-bars counterfactual: `PRICE-CORRECTION-be4fd50f9aa9a01a` (today's full bars.db) = CANDIDATE with the exact
  diff (lost 39,987 rows / 37 tickers; gained 2,001,577 / 688; changed 1,061,464 / 3,552), unusable and unapprovable
  (its Market Cap run failed B,C,G,K,R).
- Real rollback / forward on the drill bucket: exact manifest + DB sha each way, price lineage follows the authority.

### 16.7 ⛔ Open review items (the next-session build is GATES_FAILED B, R -- correctly, not a price issue)
1. IDENTITY: V5's universe moved CBAT 1117171->2086841, GORO 1160791->1515964, DTSS 1631282->2110423,
   UROY 1711570->2143673, CLBK 1723596->2115119 (successor / redomicile reorganizations). M2's locked rule withholds
   each predecessor's whole history (WITHHELD_REASSIGNED: 5,019 / 4,006 / 2,011 / 1,256 / 1,976 days); NTRB, GFAI, COLA
   become MULTI_CLASS_UNRESOLVED after mapping changes; DRK 33 days UNEXPLAINED. Owner decision (identity methodology).
2. GATE B: FXHO, NVA, ITOC newly >= 10x current vs production (new evidence after Monday's SEC files).
3. REFERENCE is also a mutable historical input: Massive changed ECL's 2003-06-09 split 1:3 -> 1:2 (correct; M3's
   pre-2003 ECL was 1.5x high). A reference/split-ledger contract like the price authority is the next decision.
4. Evidence path-dependence (16.6): accumulated vs re-harvested split evidence can differ.
5. Held keys are permanent gaps (60 here) unless corrected; and the HISTORICAL_CORRECTION path has no automated
   dark-refresh driver yet (a refresh pinned with `sources.prices.pin_version` is the impact run).
6. Bars owner: recent holes AREC, ASTC, AVEX, BRUN, CHPT, DFNS, EQ, FJET, FNMA, PLNH, SHMD, SKHY, SKYQ; extreme
   rewrites (PRE up to x5.3M, AMC x1.8M); 2,586 tickers' repaired partial bars.

### 16.8 Storage and schedule
Root 693 MB once; an APPEND delta ~218 KB/session (655 KB for 3) -> ~55 MB/year; versions are immutable base + deltas.
Materialization cache: 2 x ~700 MB (pruned). Runs: ~3.4 GB data + ~2.9 GB SEC bulk each -> retention keeps the last 2
successful runs + the authority's run (without it a daily refresh fills the 77 GB free volume in < 2 weeks).
Measured: SEC companyfacts 04:23Z, submissions 04:31Z (2026-10-06); official grouped daily for D available by D+1
03:53Z at the latest; reference pull 1-3.5 h; build + harvests 30-75 min. A session is appendable only once due
(MCAP_PIT_DUE_ET, 06:00 ET), so the former 01:15 ET cron could never append the session that just closed (now 06:15 ET; `test_schedule_due.py`).
Recommendation: cron 06:15 ET Tue-Sat (after the 06:00 ET due time and SEC's ~00:30 ET bulk), CURRENT by ~09:00-10:00
ET; or set MCAP_PIT_DUE_ET=02:00 with the cron at 02:15 ET (finality is now proven by the official aggregate, not by
the clock) for CURRENT by ~05:00-07:00 ET.

## 17. Identity + reference evidence closure (owner decisions 2026-10-06) -- methodology MCAP_V1-M3.1

### 17.1 Temporal ticker attribution (build.py, M3.1)
A RETAINED symbol (SEC no longer lists it for this CIK) whose Massive record now names ANOTHER CIK keeps the
predecessor's proven history up to the SUCCESSION BOUNDARY, from SEC filings only (one PIT clock, known_from):
- CERTAIN: the successor's succession notice (8-K12B / 8-K12G3 / 8-K12G), or the predecessor's termination (Form 15 /
  25 / 25-NSE) when the successor shows no Exchange Act activity before it;
- UNCERTAIN: the successor is active before the predecessor terminates, or the predecessor never terminates: the window
  [successor first active, termination or last attribution] is withheld from BOTH issuers;
- SUCCESSOR_AFTER_LAST_ATTRIBUTION (true ticker reuse): nothing withheld.
The successor's own listing / lineage semantics are untouched; its valued days before the boundary are withheld
(SUCCESSOR_ISSUER_RELATIONSHIP_UNRESOLVED). Distinct CIKs are never stitched; no share history moves across CIKs.
Related fixes: a succession-cut symbol keeps its FULL price basis for split selection (CLBK's 2.2 exchange on
2026-07-21); a reassigned symbol's current Massive record is not multi-class evidence about its predecessor (GORO).
Rename stitch: a retained and a current symbol of the SAME CIK joined by the provider's ticker_change event with
non-overlapping bars are one security (ANY -> DRK on 2026-09-17). Gate R classes SUCCESSION_BOUNDARY /
SUCCESSION_UNCERTAIN (filing evidence listed). Every rule triggers only on a retained symbol: an M3.1 build from M3's
own inputs is the M3 build.

| issuer | predecessor -> successor | evidence | kind | predecessor keeps | successor from |
|---|---|---|---|---|---|
| CBAT | 1117171 -> 2086841 | 8-K12B 0001213900-26-071131 filed 2026-06-23 (after the close) | CERTAIN | 2006-10-16 .. 2026-06-23 (4,951 = M3) | 2026-06-24 |
| GORO | 1160791 -> 1515964 | 8-K12B 0001104659-26-085075 + 25-NSE, 2026-07-20 | CERTAIN | 2010-10-25 .. 2026-07-20 (3,956 = M3) | 2026-07-21 |
| DTSS | 1631282 -> 2110423 | no notice, no termination; successor 6-K 0001213900-26-043958 2026-04-15 | UNCERTAIN | 2018-09-14 .. 2026-04-15 (1,896 = M3) | window 04-16 .. 10-02 withheld |
| UROY | 1711570 -> 2143673 | 8-K12B 0001493152-26-034947 filed 2026-07-28 | CERTAIN | 2021-07-29 .. 2026-07-28 (1,254 = M3) | 2026-07-29 (44 = M3) |
| CLBK | 1723596 -> 2115119 | 8-K12B 0001193125-26-309602 + 15-12G, 2026-07-21 | CERTAIN | 2018-11-15 .. 2026-07-20 (1,926 = M3) | 2026-07-21 (36 = M3) |

### 17.2 Reference / split evidence authority (reference_authority.py)
Root `REF-ROOT-3aa16777fcb59302` = M3's reference (pull of 2026-09-30, 9,227 tickers). An ordinary refresh MERGES a
fresh pull: accepted historical split / event / type / list-date evidence is immutable (a disagreement is a divergence,
kept accepted); a vanished record keeps the accepted one; current-state fields follow upstream; new tickers and splits /
events after the accepted pull date are appended. First merge (pull completed 2026-10-06T04:17:17Z):
`REF-APPEND-20261006-0559ff7094ba` -- 33 tickers added, 20 records vanished upstream and kept (incl. NTRBW, GFAIW, COLA,
COLAR, COLAU -> those issuers SINGLE again, = M3), 13 new splits, 17 divergences (ECL and SLM 2003 1:3 -> 1:2, ...).
REFERENCE_HISTORICAL_CORRECTION: candidate + exact diff; approval = human + its Market Cap gates PASS; the scheduler
has no path. Every build manifest records `inputs.reference_authority` (version, parent, sha256).

### 17.3 Correction impact driver (correction_impact.py)
accepted run + one candidate -> the accepted inputs with only that input replaced, a full derivation, the refresh's
own suite + gates + HISTORY vs the accepted build, the exact impact; never publishes, never moves authority.
ECL (`REF-CORRECTION-fb4af5f1edaeb091`): exactly ECL changes, 2,080 days 1995-03-14 .. 2004-03-04, every day x 0.666667,
nothing added / removed elsewhere; all gates PASS -- approvable, NOT approved (human act).

### 17.4 Deterministic evidence (build.py + refresh.py, M3.1)
- Every evidence read the build iterates is in a TOTAL order (filing date / accession, then document order = rowid
  within one filing); every max / min / sort has a total tie-break (same-day share counts, same-time class regimes).
  `split_evidence_rows` is the explicit ranking `confirm` uses: XBRL before TEXT, then the statement's dates as
  stated, accession, ratio, snippet.
- Evidence IDENTITY is the row set, not the file: `evidence_set_sha256:<store>` in every build manifest (a per-table
  multiset hash). A store harvested in another order (another rowid / page layout) has the same identity; the file
  hash `input_sha256:` is kept beside it.
- Proof: every evidence table re-inserted in reverse filing order (document order kept) -> the same evidence
  identity, and the build is identical (all tables).
- JCI 1999 (Tyco, CIK 833444) is pinned (`tests/marketcap/test_evidence_determinism.py`). The two harvest paths hold
  DIFFERENT evidence sets: the accumulated store has the 2003 10-K (0001047469-03-041163, applied 1999-09-30); a fresh
  harvest of today's candidates fetches the 1999 10-K (0000912057-99-009052, applied 1999-08-23); values identical.
  Each set cites deterministically. If an ordinary refresh ever adds the 1999 10-K, the ranking would re-cite JCI --
  so HISTORY now also fails on any replaced ACCEPTED historical split interpretation
  (`refresh.split_reinterpretations`: status / date / ratio / source / accession of APPLIED rows; status of held rows;
  new historical APPLIED rows). Such a change is a reviewed correction, never a silent refresh. M3.1 from M3's inputs
  vs the accepted M3 build: 0 reinterpretations.


## 18. Final mutable-input closure (owner decisions 2026-10-06)

Three mutable inputs could still rewrite accepted history through an ordinary refresh; HISTORY did not fail on a
disappearing accepted value. All four are closed. The rule throughout: ACCEPTED evidence keeps its ACCEPTED reading;
new evidence speaks from its own PIT boundary forward; anything else is an explicit, human-approved correction whose
exact impact rows are sealed with the approval.

### 18.1 ADR ratios (adr.py, harvest_text.py, build.py) + the SOGP correction
- Parser: "N hundred" number words (two .. nine hundred), the parenthetical numeral captured; word and numeral must
  agree, else the document is CONFLICT (fails closed). New: the 12(b) registration table of the cover
  (`parse_cover_ratio`), read from a 4 MB head only when the 150 KB head found nothing -- an inline-XBRL 20-F's hidden
  header can fill the 150 KB (SOGP 2023..2026), and a whole-document read sees superseded narrated ratios.
- Boundary: the M3 reading is kept EXACTLY (`parse_ratio(legacy=True)`, identical regex text; equal on all 63,342 12(b)
  titles of M3's covers) for every accession of the sealed SEC root, at harvest and at build. The current reading
  applies to accessions new to the root, and to accepted ones only when an approved correction lists them
  (`correction_evidence.reread_accessions`).
- SOGP `REF-CORRECTION-7e2bc6d9d9367464` (APPROVED 2026-10-06T16:37:30Z under the gate's owner decision 1): the ADS
  ratio change 1:20 -> 1:200 dated 2023-09-20 (F-6 POS 0000950127-23-000050 filed 2023-09-20 06:15 ET; 6-K
  0001104659-23-097402 announced it 2023-09-01; 20-F 0001410578-24-001728 and 0001493152-26-019716 state it) instead of
  Massive's 2005-06-30, and the 12(b) titles of 0001410578-24-001728 / -25-000976 / 0001493152-26-019716 re-read (200).
  Impact (C:/mcapimpact/sogp2): SOGP only, 713 sessions 2020-04-21 .. 2026-09-29, every value x 0.1000000 (2026-09-29
  $494.6M -> $49.5M), 0 removed, 0 added, all gates PASS. Impact rows sha 37364241679987444e03ad7f51e4370085db61731a9a49ffa2b26f2580747886.
- Population census (13,461 ADR-form documents of 1,232 filers, re-fetched read-only and re-read by the current
  harvester): A parser defect now resolves 1,037 / 234; B ADR with no ratio statement 2,409 / 242; C conflicting 34 / 11
  (+154 / 42 already accepted CONFLICT); D no document 84 / 28; E not an ADR 7,185 / 854; accepted OK unchanged
  2,558 / 319 (0 values changed). Dark class-A impact (all A re-read, never applied): SOGP the only move (>= 10x);
  NOAH (1,646) and RDHL (2,301) accepted days would be withheld; 17 issuers would gain valued days (TM 3,262 ...). None
  applied: each would be its own reviewed correction.

### 18.2 Current-state reference evidence (reference_authority.py, build.py)
Massive's `share_class_shares_outstanding` / `weighted_shares_outstanding` describe the security AT THE PULL. A value
first carried by a later reference version speaks only from that version's boundary session (pull public before
16:00 ET -> that day's close, else the next; a version without `pulled_at` -> the day after its date) FORWARD.
`current_history(store, vid)` derives the history from the sealed lineage (`ref_current_history.json` beside
ref.jsonl; absent for the ROOT = accepted M3). In the build, a multi-class suspicion that differs across the boundary
opens a regime on the boundary session. Census (next6 inputs, 15 issuers whose accepted days went MULTI_CLASS:
MODD MYSZ SGMT VIVK ENLV SDOT UPXI EPOW SPWR TVGN WLDS AKAN FLD MI QETA): 10,403 accepted days, next6 kept 305, the rule
keeps 10,403 (0 missing, 0 changed); the only remaining multi-class holds are M3's own (SGMT 631 -> 635 with new
sessions, TVGN 50, FLD 27). Pinned: TVGN 6,511,540 -> 15,736,540 from REF-APPEND-20261006 cannot touch 2024-04 .. 2026-09.

### 18.3 SEC filing metadata (sec_authority.py)
ROOT `SEC-ROOT-aee3813128fc48b9` = M3's own inputs.db / pred_inputs.db / acceptance.db (6,909,117 + 18,035 filing rows,
366,333 acceptance rows). Root cause of ALP / SDEV (and ATHE / PPBT / SLXN): an UPSTREAM SEC change, not our parser.
EDGAR's record for 0001171843-26-000276 says ACCEPTANCE-DATETIME 20260115090341 (Eastern) = 14:03:41Z = M3's value; the
2026-10-06 bulk and data.sec.gov now serve 19:03:41Z (true UTC + the Eastern offset, uniformly: 006194 20:37:06Z ->
00:37:06Z, 006419 23:13:39Z -> 03:13:39Z). Read through the CONSERVATIVE rule that moved the evidence one session late.
APPLY: accepted (cik, accn) keep their sealed rows (differences recorded as SEC_METADATA_DIVERGENCE); new accessions are
appended with their EDGAR record's acceptance (cached in <root>/sec/edgar_headers), else CONSERVATIVE (late, never
early). Every build manifest carries `inputs.sec_authority` (version, lineage, sha); the build reads the post-root
accessions (the ADR parser boundary). No correction candidate: the accepted values ARE the EDGAR records.

### 18.4 HISTORY (history.py)
Candidate vs the current authority, per (cik, session) up to the authority's latest valued session:
VALUE_REMOVED (any -> FAIL), VALUE_MOVED (>= 2x -> FAIL), SPLIT_INTERPRETATION_CHANGED (FAIL), VALUE_ADDED,
GAP_REASON_CHANGED, EVIDENCE_CITATION_CHANGED (listed). The ONLY authorization: the sealed impact rows of an approved
correction attached to the candidate (a reference correction in its lineage the authority lacks; an
IDENTITY_HISTORICAL_CORRECTION named by id in review.history_corrections). A correction's own impact run fails if
anything outside its issuers changes. Reason codes authorize nothing.
