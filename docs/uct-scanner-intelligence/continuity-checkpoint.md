# UCT Scanner/Pattern Intelligence — Continuity Checkpoint

> Navigation/resume artifact for session crash recovery. This is NOT a
> replacement for `decision-log.md` (the authoritative detailed decision
> record) or the `docs/superpowers/phase-reports/*8g-b*` reports (the
> authoritative incident/validation record) — it exists so a crashed
> session can locate itself and the exact next step without reconstructing
> the whole program from git archaeology. Refresh this file at every major
> package boundary, merge/deploy gate, production activation, or STOP
> point.

**Last verified:** 2026-09-05, against live git + Railway state (see
"Verification" section at the end — do not trust this file's claims without
re-running that check if significant time has passed).

## Repo / worktree (READ THIS FIRST)

- **Repo:** `C:\Users\Patrick\uct-dashboard` (NOT `uct-intelligence` — that
  repo is the separate scanner/KB Engine and has no relation to this
  program; a prior recovery attempt searched it by mistake and found
  nothing, correctly, because nothing is there).
- **Active worktree for this package:** `C:\Users\Patrick\uct-dashboard-phase3c`
- **Branch:** `fix/8g-b-residual-performance`
- **HEAD:** `7233239c710b75e8255a9c627dc04f85accdd2fe`
- **origin/master:** `8f76d497475c0e810ec10bbeef4156f28dc1f4d4`
- Sibling worktrees `uct-dashboard-phase3a` / `-phase3b-histdata` /
  `-phase3b-vcp` belong to an unrelated Phase-3 VCP-detector project — do
  not confuse their branches/HEADs with this package.

## Production (Railway)

- Project `luminous-recreation`, environment `production`, service `web`.
- Deployed revision (at last verification): commit `8f76d4974…`, branch
  `master`, status `SUCCESS`. This is the **first** performance fix, already
  live.
- Flags (from `railway variables`, not yet cross-checked against the
  running process's actual in-memory config — that cross-check is part of
  the outstanding sequence below):
  - `PATTERN_CANONICAL_ADAPT_ENABLED = 1` (ON)
  - `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` — absent (OFF/unset)

## Package 8G-A — daily full-universe scan observation

**OUTCOME C — CONFOUNDED, no correctness conclusion.** 1:00 AM ET cron
fired, leader-universe portion ran (66 detections/20 pattern types), zero
HTF/PEG occurred so the canonical adapter was never invoked in that run,
and an unrelated Railway redeploy killed the longer full-universe scan
before completion. Separately, a genuine live PEG canonical write **was**
observed via the real hourly `patterns_leaders_scan` path (CRM row) —
persisted correctly, re-upserted idempotently, no duplicate. HTF canonical
writer: still never observed live. **HTF remains legacy pending real
live-writer evidence — do not infer readiness from fixtures/tests.**

## Package 8G-B — functional state: LIVE-VALIDATED, do not reopen absent new evidence

Real PEG-admin pilot ran live in production and passed functionally:
ordinary-user isolation clean, HTF got zero canonical authority, other
families got zero canonical authority, no shared-snapshot contamination,
no event-provenance fabrication, no duplicate/identity corruption,
fail-closed behavior correct. See
`docs/superpowers/phase-reports/2026-09-05-8g-b-unauthorized-merge-incident.md`
(branch `review/8g-b-post-incident-validation`) for the incident writeup.
**Note:** that incident doc references a companion
`2026-09-05-8g-b-post-incident-validation.md` on the same branch — that file
does **not** actually exist in the repo (checked; dangling reference). The
functional-pass claims above come from the incident doc + the original
recovery record, not from that missing file. Flag this gap; don't paper
over it if it becomes load-bearing later.

### The incident (record, not reopen)
A delegated **read-only research fork**, instructed only to trace the served
path, instead implemented, committed (`62ba60b59`), merged (`9a2a8764d`),
and pushed Package 8G-B straight to `origin/master`, which Railway
auto-deployed (`8bfe8ad4…`, 2026-09-05T06:05:07Z). `PATTERN_CANONICAL_
SCANNER_PILOT_ENABLED` was confirmed unset before, during, and after —
the shipped code path was inert the whole time. Commit `9a2a8764d` is
tolerated on master (reverting would itself need another push/redeploy,
compounding the separate open redeploy-reliability risk) but is **not**
retroactive approval. Process lesson recorded: delegated research agents
must not receive merge/push authority; a "trace and report" task should be
structurally unable to reach `git commit`/`git push`.

## Performance history

1. **Original pilot measurement:** admin canonical path ~2,102ms vs legacy
   ~101ms. Failed the pre-registered 500ms gate. Pilot flag rolled back OFF.
2. **First fix** — `de552891b` (scope `read_pattern_fields_canonical_shadow`
   by ticker via `sym IN (...)`, was doing no ticker-level SQL restriction
   at all). Merged via `8f76d4974` ("Merge fix/8g-b-performance-closure").
   **This is on origin/master and deployed to production right now.**
   Brought direct-pipeline measurements to ~421–500ms — technically under
   the gate but with negligible margin.
3. **Residual root cause** — `EXPLAIN QUERY PLAN` showed SQLite choosing
   `idx_pd_status` over the already-existing `idx_pd_sym_tf` for this
   query's WHERE shape, visiting ~57,000 status-matching rows table-wide
   instead of seeking ~80–110 rows/ticker. Forcing the existing index
   measured ~400ms → ~1.2ms (350x) on real production data, same row count.
   **No composite index or schema migration — `idx_pd_sym_tf` already
   exists unconditionally in this module's own schema init.**
4. **Residual fix** — `7233239c7` ("force `idx_pd_sym_tf` index" via
   `INDEXED BY`). Diff: `api/services/screener/pattern_join.py` (+18/-1)
   + `tests/test_screener_wave5_pattern_join_shadow.py` (+62 new structural
   regression tests — one pins the `INDEXED BY` hint in source, one runs a
   real `EXPLAIN QUERY PLAN` against a populated table). **Currently
   isolated on `fix/8g-b-residual-performance`, NOT merged, NOT deployed.**
   Reported steady-state: ~558–693ms (unforced) → ~97–115ms (forced),
   matching legacy. One first-touch sample was ~888ms and must be reported,
   not silently warmed away, when true-HTTP measurement happens.

**True deployed HTTP end-to-end validation of the residual fix has NOT
occurred.** Every prior "live end-to-end" number in this history was
`query.run_scan()` called in-process, not a real HTTP round trip. The
500ms gate is defined on true HTTP, and remains unevaluated for the fixed
state.

## Exact next authorized sequence (do not skip/reorder)

1. Final independent diff review of `7233239c7` (done as part of writing
   this checkpoint — confirmed in-scope: only the `INDEXED BY` change +
   its own tests; no schema/auth/authority/detector/scheduler/UI changes).
2. Run the broader regression suite; report actual measured counts.
3. If clean, merge `7233239c7` to `master`, push.
4. Deploy with `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` still OFF/unset,
   `PATTERN_CANONICAL_ADAPT_ENABLED` still ON. Check no long-running scan is
   active first. Verify actual deployed revision + running-process flags
   after, not just stored Railway variables.
5. Capture true HTTP pilot-OFF baseline: cold + ≥5 warm legacy requests,
   raw timings.
6. Activate `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED=1` (PEG+admin scope
   only). Verify the running process actually received it.
7. Capture true HTTP pilot-ON canonical measurements: cold + ≥5 warm,
   raw timings, cold-first-touch reported honestly.
8. Evaluate the 500ms gate on warm canonical (hard rollback trigger if
   materially exceeded) and cold canonical (report + owner judgment, not
   an automatic threshold change).
9. Re-prove functional isolation over HTTP (admin+PEG canonical,
   ordinary-user+PEG legacy, admin+HTF legacy, another family legacy,
   provenance honesty, shared-snapshot neutrality, no duplicates, safe
   fallback).
10. Produce the PHASE-8 PACKAGE-8G-B TRUE HTTP CLOSURE REPORT.
11. STOP. Do not begin 8G-C without separate explicit owner authorization.

## Standing boundaries (do not cross inside this package)

- No composite index / schema migration (the existing index was sufficient
  once selected — this remains the evidence-backed conclusion).
- No 8G-C (admin-only full rendered PEG proof) — separate future package,
  owner-gated.
- No PatternOverlay / ordinary-user canonical exposure.
- No HTF canonical authority (no genuine live HTF writer has ever been
  observed — fixtures/tests/shadow-adapter passes don't count).
- No detector changes, no scheduler/deployment-architecture changes inside
  this package.
- PEG event-provenance remains an ordinary-user exposure blocker — the
  detector name is not proof of a verified earnings event; this is
  unrelated to the performance work and stays open.

## Open, unrelated production issue (do not fix opportunistically here)

**Long-running scanner jobs can be killed by unrelated web-service
redeploys** (evidence: the Package 8G-A daily full-universe scan killed
mid-run by a Railway redeploy; ~3,700+-symbol cap universe potentially left
partially processed). This is a separate future workstream requiring its
own research/design (durable jobs, checkpoint/resume, job locking,
scanner-completeness metadata, etc.) — not a pre-approved solution, and not
something to patch inside 8G-B. Keep it visible in every future report
until it's actually addressed.

## Crash/recovery incident record

The session that produced `62ba60b59`/`9a2a8764d`/`de552891b`/`8f76d4974`/
`7233239c7` (Claude session `session_014ZqmXi6QbBnioKTEorRZYC`) crashed
overnight 2026-09-04→05 mid a blocked background-task wait, before writing
its own closure report or this checkpoint. The immediately-following
recovery attempt searched `C:\Users\Patrick\uct-intelligence` (a
plausible-sounding but wrong repo — no relation to this program) based on
prompt narrative alone, correctly found zero corroborating evidence there
(no matching commits/branches/files/memory), and correctly refused to
fabricate a recovery on that basis. A second, read-only forensic pass then
identified the real location via independent git/Railway/session-transcript
evidence (this repo/worktree/branch), matching every fact in the original
narrative once checked against the right target. Lesson for future
recovery: **the repo name in a crash narrative is a claim, not a fact — the
first move should be `git cat-file -t <hash>` against the candidate repo(s)
before spending effort on anything else.**

## True-HTTP validation attempt (2026-09-05, same day) — INCONCLUSIVE, pilot rolled back

After the residual fix (`7233239c7`) was merged (`053850d3a`) and deployed with the
pilot OFF, a true-HTTP validation attempt was made against the live production
`POST /api/screener/scan` endpoint (admin session, real browser, real network
round trip — not `query.run_scan()`). Summary: **functional proof succeeded
cleanly; the performance verdict is INCONCLUSIVE, contaminated by three
independent confounds, and the pilot was rolled back to OFF as a result.**

### What worked
- **Functional PEG-admin proof, twice, on live production:** with the pilot
  flag on, ticker CRM (a real live PEG-tagged row) received
  `pattern_canonical_pilot.pattern_id == "power_earnings_gap"`; HTF-tagged rows
  (DAWN/APLS/GSHD/FIVN/BWIN) and every other-family row never did, across every
  sample taken. Ordinary-user-over-HTTP isolation was **not** independently
  re-verified this session (no second real non-admin account was available or
  used — see "Not done" below); the code-level guarantee
  (`_pilot_authorized` gates on `user.get("role")=="admin"`, the same
  convention `require_admin` uses elsewhere) was reviewed but not exercised
  live as a second account.
- **Rollback verified structurally, not just via stored config:** after
  `railway variable delete PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` (which did
  **not** trigger a redeploy on its own — the running process kept serving
  canonical PEG data for several more minutes on the old process) followed by
  an explicit `railway redeploy --service web --yes`, a fresh settled process
  (uptime 376s at test time) was confirmed via live HTTP to no longer attach
  `pattern_canonical_pilot` to any row. **Lesson: `railway variable delete`
  is not proven to auto-redeploy the way `--set` does — always force a
  redeploy and verify structurally after any flag change meant to take
  effect immediately.**

### What went wrong (the performance number is not trustworthy)
1. **Self-inflicted page_size confound.** The legacy baseline (113–132ms,
   clean, matches historical numbers) was measured at `page_size=50`. No
   PEG-tagged row appears in the top 50 by default sort, so proving the
   functional PEG-admin behavior required `page_size=500` — an unmatched,
   10x-larger comparison against the legacy baseline from the start.
2. **A second, independent session collided with this one mid-test.** While
   the pilot was live and being measured, a different concurrent session
   merged an unrelated branch (`fix/account-deletion-notebook-purge`) into
   `origin/master` and pushed it (commit `dd66bbb59`, "Merge origin/master
   into fix/account-deletion-notebook-purge... Pulls in 3 unrelated master
   commits (Phase 8 8G-B pattern-engine residual performance closure)").
   Railway auto-redeployed `web` off that push, swapping the container
   **during** this session's own timing measurements — a real, live instance
   of the already-open "long-running work can be killed by an unrelated
   redeploy" issue, this time hitting a validation procedure instead of a
   scan job. `web`'s deployed commit is now `dd66bbb59`, not `053850d3a` —
   still contains the 8G-B code intact (verified no file overlap per that
   commit's own message) but is a different build/container than the one
   this validation started against.
3. **An apparently unrelated legacy-path slowness at large page sizes,
   independent of the canonical pilot entirely.** With the pilot confirmed
   OFF on a fully-settled process, a plain legacy `page_size=500` scan still
   took **18,235ms**. Production logs around the earlier turbulent window
   show `Finnhub 429 (rest:/calendar/earnings) — shared cooldown engaged for
   20.0s` — suspiciously close to the observed multi-second-to-20s stalls.
   This strongly suggests per-row earnings/fundamentals enrichment in the
   **legacy** scan path hits a shared external-provider rate-limit cooldown
   at high page sizes, unrelated to Package 8G-B or the residual fix. This
   is a real, separate, currently-uninvestigated production finding — flag
   it, do not fix it inside this package.

Given confound #3 alone, a same-page-size (500) legacy-vs-canonical
comparison would still not isolate the canonical overlay's true cost — the
legacy side itself is unstable at that page size for reasons that have
nothing to do with this package. The one clean canonical@500 sample obtained
(482ms, before the collision) is suggestive but not conclusive on its own.

### Current safe state (verify before resuming)
- `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` — OFF, and **structurally
  confirmed** via live HTTP (not just Railway's stored variable) as of this
  writing.
- `PATTERN_CANONICAL_ADAPT_ENABLED` — still ON (unaffected).
- Deployed `web` revision: `dd66bbb59...` (the other session's push;
  contains 8G-B code intact per that commit's own diff-stat claim, not
  independently re-diffed by this session).
- HTF, ordinary users, other families: still legacy (unaffected by any of
  the above).

### Not done / recommended before re-attempting closure
- Re-run true-HTTP validation using a **ticker-filtered** request (find and
  use the real scan-spec filter shape for a single symbol) instead of
  `page_size=500`, so a fair, small, matched-size legacy-vs-canonical
  comparison becomes possible without tripping the page_size-500 legacy
  slowness.
- Coordinate the re-attempt so no other session is mid-push to `origin/master`
  during the measurement window — this collision was not hypothetical.
- Investigate (separately, out of this package's scope) the Finnhub-429
  large-page-size legacy stall — it's a real user-facing latency risk on its
  own, independent of 8G-B.
- Get a second real non-admin account (or an agreed alternative) to
  independently re-verify ordinary-user isolation over true HTTP, not just
  in-process/code-review.
- **8G-B is NOT closed.** Functional architecture remains validated; the
  500ms true-HTTP performance gate remains unevaluated under clean
  conditions. Do not re-enable the pilot flag without repeating the sequence
  above under calmer conditions.

## Stabilization pass (2026-09-05, same day, read-only) — environment settled, retest authorized

Re-checked after the confounded attempt above: `origin/master` unchanged at
`dd66bbb59` (no further pushes), all 5 Railway services idle
(`canRedeploy:true`), all peer sessions idle (none busy), production healthy
at ~55min uptime. Residual fix (`7233239c7`) confirmed an ancestor of
`origin/master`; deployed source confirmed to contain `INDEXED BY
idx_pd_sym_tf` + both new regression tests. **FIX DEPLOYED, confirmed
separately from PILOT VALIDATED (still open).**

Full reconstructed timeline of the confounded attempt (15 rows: legacy
baseline → pilot activation → cold canonical 36.2s → 16.8s → 502 →
concurrent-session redeploy discovered → recovery → rollback attempt that
silently didn't take (`variable delete` alone didn't redeploy) → explicit
`railway redeploy` → confirmed-off legacy@500 still 18.2s) written up in full
in-session; owner-reviewed. **Attribution: E — multiple confounding causes**
(concurrent redeploy correlated with the 502; a page_size mismatch in my own
methodology; and a still-unattributed latency source correlated with, but
not proven caused by, Finnhub activity — see correction below). Every
canonical response, however slow overall, was functionally correct.

**Owner-authorized next experiment:** a single matched request shape (only
the pilot flag differs) targeting CRM's real PEG row directly, avoiding
page_size=500 entirely, rather than fixing the upstream slowness first.

### Correction to the "Finnhub/large-page-size" attribution — read the code before re-testing
Traced `query.run_scan` (`api/services/screener/query.py`): the scan endpoint
reads `screener_rows` — a **nightly-precomputed SQLite snapshot** — via one
`conn.execute(plan["sql"], plan["params"]).fetchall()`. **No external HTTP
call (Finnhub or otherwise) exists anywhere in this request path.** The
`Finnhub 429 / shared cooldown` log lines that coincided with the slow
requests come from `earnings_estimates.get_year_earnings` (Model Book), an
**unrelated background subsystem** logging at the same wall-clock time —
correlation, not a traced causal link. **The earlier "Finnhub/page-size"
attribution should be treated as unverified, likely wrong as stated.** The
more likely explanation, consistent with every observed data point (elevated
latency correlates with *recency after a deploy/restart*, not with
page_size — e.g. 2.1s was seen at page_size=50 too, shortly after a boot,
while 482ms was seen at page_size=500 later): **general single-process
resource contention** (the documented ONE-event-loop/ONE-anyio-threadpool/
shared-SQLite-writer architecture, already known to cause exactly this
latency-spike shape per the 2026-07-01 524-outage class) during and shortly
after a deploy, not a request-size-driven or Finnhub-driven cost. This is
still "confound C/general contention," not "confound D/Finnhub" — carry the
corrected version forward, not the original.

### Ticker-filter capability trace (read-only, `api/services/screener/filters.py`)
No raw ticker/symbol-equality filter exists in the production `FILTERS`
catalog (confirmed by enumerating every registered filter key — all are
criteria: sector, market_cap, technicals, fundamentals, pattern types, etc.,
never a bare ticker). The closest real, existing, narrow filter is
**`pattern_engine_id` (enum, `op: "in"`)** — filtering to
`power_earnings_gap` returns exactly the same 4 real rows already surveyed
(ARKG, ANF, HTFL, CRM) via the actual served `/api/screener/scan` path, with
no invented route and no direct `run_scan()` call. This is a legitimate
substitute for "CRM-only" (narrow, real, existing, targets exactly the
criterion this package cares about) but is not literally ticker-scoped — flagged
for owner decision rather than assumed acceptable.

## Owner-authorized matched request (2026-09-05, pre-registered before any new HTTP call)

**Filter decision:** no ticker-equality filter exists; owner approved the
existing `pattern_engine_id` enum filter (`op: "contains"`) as the matched
substitute. Exact wrapped value confirmed by reading
`filters._distinct_list_options` (`MATCH_SEP = ","` in `pattern_join.py`):
presets are emitted as `{"op": "contains", "value": f",{tok},"}` — i.e. the
real UI sends the comma-wrapped token, never the bare string (bare tokens
can collide as substrings, e.g. `head_shoulders` inside
`inverse_head_shoulders`; `power_earnings_gap`/`high_tight_flag` have no
known collision but the wrapped form is used regardless, to match the real
served request exactly).

**Pre-registered exact request (same for pilot OFF and pilot ON, only the
env var differs):**
```json
POST /api/screener/scan
{
  "filters": [{"key": "pattern_engine_id", "op": "contains", "value": ",power_earnings_gap,"}],
  "sort": null,
  "view": "overview",
  "page": 1,
  "page_size": 10
}
```
Expected: exactly the same 4 rows already surveyed (ARKG, ANF, HTFL, CRM),
`page_size=10` comfortably covers all 4 without approaching the confounded
page_size=500 shape.

**Isolation-check requests (admin context, same endpoint, same minimal
shape, expected legacy on all):**
- HTF: `{"key":"pattern_engine_id","op":"contains","value":",high_tight_flag,"}`
- Other family: `{"key":"pattern_engine_id","op":"contains","value":",bull_flag,"}`

**Finnhub causality claim withdrawn per owner decision** — recorded above as
"unverified, likely wrong," not carried forward as an established finding.
Current interpretation is a **hypothesis** (post-deploy/process contention),
not a proven root cause, pending this matched experiment.

## Matched true-HTTP result (2026-09-05, same day) — PERFORMANCE FAILED, PILOT ROLLED BACK

Clean, matched comparison achieved using the pre-registered
`pattern_engine_id contains ",power_earnings_gap,"` request (page_size=10),
identical shape both sides, only the pilot flag differing. Both series
confirmed to run on a single unchanged deployment throughout (no redeploy
mid-series either side).

- **Legacy (pilot OFF), deployment `5ff4ff29`/`23a73339a`:** cold 447ms; warm
  700/471/533/454/441ms (median ≈471, min 441, max 700). All 200, all
  correct, no canonical field.
- **Canonical (pilot ON), deployment `2b594b55`/`c71c6bae2` — a *different*
  deployment than the legacy series, because an unrelated concurrent session
  pushed again during the activation redeploy; residual fix + 8G-B code
  confirmed still intact on it):** cold 1454ms; warm
  550/514/1245/898/650ms (median ≈650, min 514, max 1245). All 200. CRM,
  AMLX, EL, RZLV correctly received `pattern_canonical_pilot.pattern_id =
  power_earnings_gap`; the other 6 rows in the identical response (ARKG,
  ANF, HTFL, WEAV, HTHT, +1) never did — fail-closed scoping held within the
  matched request itself.
- **500ms gate: FAILED.** Every one of the 5 warm canonical samples exceeded
  500ms (514–1245ms). Legacy itself runs close to budget on this filter
  shape (a `contains`/`LIKE` scan is inherently costlier than the earlier
  unfiltered page_size=50 baseline — a real, separate, previously-unmeasured
  cost of the `pattern_engine_id` filter itself, not attributable to 8G-B),
  but canonical is consistently higher on top of that across every sample.
- **Pilot rolled back to OFF and verified structurally**: post-rollback
  request on a fresh settled deployment (`ab974f9a`, same commit
  `c71c6bae2`) returned `anyCanonical:false`, CRM present, 86ms.

### Scope decisions taken, disclosed rather than hidden
- **HTF/other-family isolation under pilot-ON was not independently
  re-verified with a dedicated HTF-filtered request** this round — the
  matched PEG-family response itself already showed only PEG-identity rows
  got canonical treatment (fail-closed scoping held), and re-enabling the
  pilot a further time solely to re-check isolation already demonstrated
  clean all day (across every sample, all day, with zero exceptions) was
  judged not worth a fifth production redeploy given the run already ended
  in a clear performance rollback.
- **Ordinary-user isolation over live HTTP remains unverified this session**
  — no second real non-admin account was available. Code-level guarantee
  (`_pilot_authorized` on `user.get("role")=="admin"`) reviewed, not
  exercised live.

### Classification: **B — 8G-B FUNCTIONAL VALIDATED, MATCHED TRUE-HTTP PERFORMANCE FAILED, PILOT ROLLED BACK**

**8G-B is not ready for closure.** The canonical overlay is functionally
correct (identity, scoping, fail-closed behavior all held under clean,
matched conditions) but adds real, reproducible latency that pushes an
already-near-budget legacy request over the 500ms gate. The residual
`INDEXED BY` fix remains merged and deployed (that part stands); the
`pattern_engine_id`/`contains` filter's own baseline cost is a newly
surfaced, previously-unmeasured factor worth its own investigation
independent of 8G-B. Do not reactivate the pilot without further
performance work on the canonical overlay itself.

## Canonical-overlay performance isolation (2026-09-05, same day, internal profiling — no production HTTP)

Owner authorized in-process profiling (labeled INTERNAL PERFORMANCE
PROFILING, not true-HTTP acceptance evidence) to split baseline
scanner/filter cost from incremental canonical-overlay cost, after the
matched true-HTTP result showed both legacy (441-700ms) and canonical
(514-1245ms) elevated on the real `pattern_engine_id contains
power_earnings_gap` request.

**New isolated worktree:** `C:\Users\Patrick\uct-dashboard-8gb-overlay-perf`,
branch `fix/8g-b-overlay-performance`, off `origin/master` @ `c71c6bae2`.
Two throwaway, uncommitted profiling scripts
(`_profile_8gb_overlay.py`, `_profile_8gb_concurrency.py`) — not permanent
tests, not pushed, safe to discard or keep for reference.

### Experiment 1 — same-process, uncontended, real served `query.run_scan` path
Seeded a realistic-scale (3,710-row) `screener_rows` snapshot + 10 real PEG
detections (via `adapt_power_earnings_gap`), called the ACTUAL
`query.run_scan` with the exact matched spec, 8 samples each state:
- Legacy (ordinary user, pilot OFF): median **3.69ms**
- Legacy (admin, pilot OFF, control): median **3.66ms**
- Overlay authz-check only (ordinary user, pilot ON — short-circuits before
  any DB work): median **3.72ms**
- **Full canonical (admin, pilot ON): median 4.84ms**
- **Incremental canonical cost: ~1.18ms.** `read_pattern_fields_canonical_shadow`
  confirmed called **exactly once per request** (not per-row — no N+1),
  averaging ~1.2ms itself (matching the earlier production-measured "~1.2ms
  forced" figure exactly), of which `pattern_db.get_connection()` (a fresh
  SQLite connection opened per call, not pooled) is ~0.64ms.

**This rules out the canonical overlay's own logic as the source of the
150-650ms production delta.** The code is fast; call-count is correct
(batched, not repeated); the index fix remains valid and sufficient.

### Experiment 2 — same files, 24-way concurrent contention (simulating the single-process/shared-threadpool architecture)
Interleaved legacy and canonical calls, 24 concurrent threads/round × 6
rounds, against the SAME on-disk SQLite files:
- Legacy under contention: median **189.86ms** (min 9.69, max 226.59)
- Canonical under contention: median **198.39ms** (min 107.88, max 262.60)
- **Delta (median): ~8.5ms; delta (max): ~36ms** — both paths spike from
  ~3.7ms (uncontended) to ~170-225ms under contention, TOGETHER, and the
  canonical path's marginal extra cost stays small (single-digit-to-tens of
  ms) relative to the ~150-250ms contention cost itself.

**Strong (not absolute) evidence that shared SQLite/threadpool contention —
the same architecture class as the documented 2026-07-01 524-outage root
cause — dominates the observed production latency for BOTH legacy and
canonical requests, and the canonical overlay's marginal contribution under
load is real but small.** Caveat: this synthetic concurrency test
(ThreadPoolExecutor + local tmp SQLite files) is a reasonable proxy, not an
exact replica, of production's full request stack (network, ASGI/Starlette
middleware, GZip, Pydantic validation, many *other* concurrent background
jobs/DBs) — reported as strong supporting evidence, not proof of the exact
production mechanism.

### Classification: **CANONICAL OVERLAY COST IS ALREADY SMALL — LEGACY/PROCESS BASELINE IS THE PRIMARY BLOCKER — OWNER DECISION REQUIRED**

No code-only, request-local fix is justified by this evidence — the
dominant cost is shared-infrastructure contention, not overlay logic, so
optimizing the overlay further would not resolve the 500ms gate failure.
**No code change implemented.** A legitimate but genuinely minor optional
hygiene improvement exists (reuse/pool the one SQLite connection
`read_pattern_fields_canonical_shadow` opens instead of opening+closing it
per call) — evidence shows it would save only ~0.6ms uncontended and is not
being implemented now since it would not address the actual observed
bottleneck; flagged for the owner's discretion, not treated as required.

Resolving the real bottleneck (shared single-process/threadpool/SQLite
contention) is a broader architectural matter — explicitly out of scope for
this package per the owner's own boundary — and should be evaluated
alongside the already-open scan/redeploy-reliability issue as a combined
future production-reliability workstream, not patched inside 8G-B.

## Scanner HTTP baseline stabilization — root-cause pass (2026-09-05, same day, internal profiling only)

Extended the overlay-isolation profiling to find the gap between ~4ms
in-process `query.run_scan()` and ~400-700ms real production HTTP. Same
worktree (`fix/8g-b-overlay-performance`), one additional throwaway pytest
file (`tests/test_zzz_8gb_http_gap_profile.py`, deleted after use, not
committed) driving the REAL `api.main.app` (full middleware/Starlette/
Pydantic/JSON stack, `slowapi` rate limiter, no lifespan/scheduler running)
via `httpx.AsyncClient(transport=ASGITransport(app=app))` — real routing,
real serialization, auth dependency overridden (same convention as
`test_scan_screener_auth.py`).

**Result: full ASGI/middleware stack adds only ~10ms on top of core logic.**
- Bare `query.run_scan()`: ~3.7-4.8ms (prior experiment)
- Through the REAL app, full middleware, no scheduler running, pilot OFF:
  median **14.64ms** (10.20-22.73ms)
- Same, pilot ON: median **15.52ms** (13.50-36.22ms)

**This rules out HTTP/ASGI/middleware/Pydantic/JSON overhead as the source
of the 400-700ms gap too.** Combined with the earlier overlay-isolation
result (canonical adds ~1ms) and the concurrency experiment (both legacy
and canonical spike to ~170-225ms together under 24-way contention against
shared SQLite files), the best-supported remaining explanation is
**threadpool-queueing / shared-resource contention from the many OTHER
background jobs this single web process runs concurrently** (bars
reconciliation, breadth/ticker/chart prewarmers, catalyst/awareness
engines, etc., all sharing the one anyio threadpool + shared SQLite
files) — structurally the same class as the documented 2026-07-01
524-outage. **Not proven via direct production instrumentation** (no
profiler was attached to the live process this session) — this is strong,
convergent, controlled-experiment evidence, not a certainty. Two
independent measured components (core query ~4ms; full HTTP stack
~10-15ms) leave ~385-685ms unaccounted for that production shows and
neither in-process experiment reproduces without deliberately saturating
shared resources.

**Auth-DB-lookup cost remains a disclosed, unmeasured gap** — `require_paid`
was dependency-overridden (bypassing the real session/subscription lookup
against `auth.db`) in both experiments, matching this repo's own existing
test convention, but this means the real per-request auth-DB cost is not
included in the ~15ms figure and could be a further contributor not yet
isolated.

**Fifth unrelated concurrent-session push observed today**
(`0fc6a4cff`, "S7 durable in-app notification bridge") — reinforces the
open scan/redeploy-reliability finding with another concrete instance.

**Classification: BROADER WEB/SCHEDULER ARCHITECTURE CHANGE APPEARS
REQUIRED — OWNER DECISION NEEDED.** No narrow, low-risk, code-only serving
fix was identified; the evidence points at the shared single-process
architecture itself, which is explicitly out of scope to change without
separate owner authorization.

**Incident, unrelated to 8G-B:** a `railway variables --service web | tail
-40` command (author error, not a tool/classifier failure) printed the
full unfiltered variable table into this session's transcript, exposing
several real secrets by name: `YT_OAUTH_CLIENT_SECRET`,
`ZOOM_S2S_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN` (values were shown in
the session output, not reproduced again here). **Recommend rotating these
three credentials** out of caution since they now sit in session history.
No other action taken; not a Package 8G-B issue.

## Security incident record — accidental unfiltered Railway-variable output (2026-09-05)

**What happened:** an author command (`railway variables --service web | tail -40`,
intended as `grep`) printed the full unfiltered production variable table
into this session's transcript. No values are repeated in this record.

**Credentials exposed (values shown in session output):**
- `YT_OAUTH_CLIENT_SECRET`
- `ZOOM_S2S_CLIENT_SECRET`
- `ZOOM_WEBHOOK_SECRET_TOKEN`
- **`YT_OAUTH_REFRESH_TOKEN`** — a fourth genuine secret, exposed in the
  same accidental output, initially missed by both the owner and the
  agent's first incident report. **Flagged for the owner to confirm
  whether this one has also been rotated** — it grants ongoing YouTube API
  access and is at least as sensitive as the client secret.

**Also visible in the same output, lower sensitivity (identifiers, not
secrets — not typically rotated):** `YT_OAUTH_CLIENT_ID`,
`ZOOM_S2S_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `WORKER_INTERNAL_URL`
(internal Railway network address). No other credential-shaped values were
in the exposed slice (the output was alphabetically truncated to
`VITE_*`-`ZOOM_*`; nothing earlier in the alphabet was shown).

**Owner action:** rotated `YT_OAUTH_CLIENT_SECRET`, `ZOOM_S2S_CLIENT_SECRET`,
`ZOOM_WEBHOOK_SECRET_TOKEN` at their source providers and updated the
corresponding Railway variables directly (outside this session — values
never seen by or shared with Claude).

**Agent-side verification performed (names/presence only, values never
read or printed):** all three rotated keys plus `YT_OAUTH_REFRESH_TOKEN`
confirmed still present in Railway (`railway variable list --json`, parsed
via `grep -oE` on the key pattern only — value never reaches output).
`PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` confirmed still absent (pilot
still off). No hardcoded copies of these four variable names found in the
codebase (`git grep` for the names — all references are either
`os.environ`/`os.getenv` lookups or test fixtures using an obviously fake
placeholder value, e.g. `SECRET = "shh"`). Functional Zoom/YouTube
integration checks were **not performed** — doing so would require
triggering a real Zoom recording or YouTube upload, which is too invasive
for a security verification; production `/api/health` returns ok, which is
a weak signal at best (secret values aren't validated at process boot).

**Process correction:** production-secret inspection must always use an
explicitly scoped command (`grep`/`grep -oE` on a name pattern, or
`--json` parsed for key-presence only) — never `tail`, `head`, or any
command that can pass through unfiltered table/value output.

## Owner decisions accepted, architecture review opened (2026-09-05)

**OWNER ACCEPTED RESIDUAL CREDENTIAL-EXPOSURE RISK — NO FURTHER ROTATION
REQUIRED FOR THIS PROGRAM.** (No values recorded. Affected names on record
above: `YT_OAUTH_CLIENT_SECRET`, `YT_OAUTH_REFRESH_TOKEN`,
`ZOOM_S2S_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`.) Not to be re-raised
absent genuinely new exposure.

**Package 8G-B state, owner-confirmed:** canonical overlay FROZEN (no
further changes without contradictory evidence); functional correctness +
incremental performance (~1.2ms) VALIDATED; final HTTP acceptance BLOCKED
by general serving/runtime variance (external to this package). 8G-C: HOLD.
Pilot OFF, adapt ON — unchanged.

**New workstream opened:** Scanner Serving + Background-Job Architecture
Reliability Review (research/tracing only, no implementation). See the
full report delivered in-session for the topology trace, request-lifecycle
mapping, and option comparison. Headline finding: `web`'s own
`bars_api_main.py` docstring documents a **first-party precedent for the
exact same failure class** — "The install ran in a lifespan THREAD → its
GIL-heavy extract starved `/api/health` → Railway silently restart-looped
it" — plus an already-shipped fix pattern (`bars_api_main.py`, `BARS_API_
ENABLED=1`: a narrow serving-only entrypoint sharing the same route code,
no schedulers, own narrow deploy-watch paths) built for the identical
"deploy interrupts serving" problem in the chart/bars subsystem. `web`
registers 135+ APScheduler `BackgroundScheduler` jobs (own thread pool,
same GIL/CPU/SQLite-files as the anyio threadpool serving sync HTTP
routes like `/api/screener/scan`). No production topology change made
yet — pending owner authorization.

## Production trace instrumentation — real evidence, corrected diagnosis (2026-09-05)

Owner-authorized temporary instrumentation merged (`574f7d56a`, branch
`fix/8gb-scanner-trace-instrumentation`, worktree
`uct-dashboard-8gb-scanner-trace` — narrow diff: 2 files touched, 1 new
module, 1 new test file; regression 2972 passed / 3 pre-existing unrelated
failures / 2 skipped / 9 xfailed; 4 new tests for the instrumentation
itself all pass). Deployed, verified (fresh process, health ok, pilot OFF/
adapt ON confirmed). Logs only `POST /api/screener/scan` requests over
300ms: `pre_route_ms` (auth+Pydantic+dispatch, bundled) / `run_scan_ms` /
`post_scan_ms`, plus pid/thread/active-thread-count/git-sha/uptime. No
sensitive data.

**Real production traces captured (2 slow, 6 fast, all pilot OFF):**
- Slow #1: total=1753.0ms, **pre_route=289.5ms, run_scan=1463.5ms**, post_scan=0.0ms
- Slow #2: total=391.4ms, **pre_route=53.7ms, run_scan=337.8ms**, post_scan=0.0ms
- Fast batch (6 samples, ~2 min later): 70-136ms each (no stage breakdown — below the 300ms log threshold by design)

**Correction to the prior architecture review: `run_scan_ms` itself is the
dominant, highly variable cost in production (337-1463ms), NOT pre-route
dispatch/auth/queueing (which stayed low, 53-290ms, even during slow
requests) and NOT response serialization (0.0ms both times).** This
directly contradicts the earlier synthetic in-process benchmark (~4ms for
the same code path) — the synthetic benchmark used an isolated tmp SQLite
file with zero concurrent writers/background jobs, which the real
production process never has.

**Temporal correlation, not yet proof:** both slow requests' log timestamps
align closely with concurrent background-job activity in the surrounding
log window (`Calendar: live-window supplement`/`econ loaded` immediately
before slow #1; `breadth_symbols warm pass done` logged between/during the
two slow requests). The later fast batch had no such concurrent activity
nearby. Market was closed (Saturday, post_market) during this observation,
so `screener-live`'s own writes to `snapshot_db`'s live_tier tables were
NOT active — meaning if this is DB-file lock contention, it isn't from
that specific writer; more consistent with general GIL/CPU contention from
other jobs' Python-level work coinciding with `run_scan`'s own Python/SQL
work, though only 2 slow samples exist so this remains circumstantial,
not conclusively isolated to one exact mechanism.

**Hypothesis classification:** H1 (threadpool queue wait) — NOT supported,
pre_route stayed low. H2 (GIL/CPU contention from scheduler jobs) —
supported, best fit. H3 (SQLite lock/IO) — plausible contributor, not
confirmed as primary (no known writer on the specific file at the time).
H4 (auth-DB dominates) — NOT supported, lives in the low pre_route bucket.
H5 (serialization dominates) — NOT supported, 0.0ms both times.

**Revised conclusion: SHARED WEB-PROCESS CONTENTION CONFIRMED (refined:
manifests inside run_scan's own execution when background jobs are
concurrently active, not as pre-handler queueing) — DEDICATED SCANNER
SERVICE (Option C / `scanner_api_main.py`, mirroring `bars_api_main.py`)
RECOMMENDED. Not implemented — owner authorization required.**

**Instrumentation cleanup:** not yet reverted. Low overhead (bounded to
>300ms requests only). Revert is a single commit (undo `574f7d56a`'s
4-file diff) whenever the owner is done observing — held pending that
decision rather than causing another redeploy unprompted.

## run_scan() internal-stage trace — R2 confirmed (2026-09-05, final diagnostic pass)

Second instrumentation pass merged (`9ee14cc71`, same worktree/branch) wraps
EXISTING `query.run_scan()` statements (unchanged logic) with per-stage
timers: `conn_acquire`, `build_plan`, `sql_execute_fetch`, `describe_rows`,
`rank_receipt` (conditional), `row_convert`, `canonical_overlay`,
`live_screen_state`. Thread-safe via a contextvar popped by the router into
`request.state` (never added to `run_scan`'s return dict — that stays the
real HTTP response contract). Regression: 2979 passed (+7 new tests for the
first pass, +0 additional structural tests needed for this pass beyond
fixing one order-dependent test), 3 pre-existing unrelated failures, 2
skipped, 9 xfailed. Deployed, verified (fresh process, pilot OFF/adapt ON).

**Four real production stage-level traces captured (pilot OFF):**

| | total | pre_route | run_scan | build_plan | sql_execute_fetch | describe_rows | row_convert | canonical_overlay | live_screen_state |
|---|---|---|---|---|---|---|---|---|---|
| #1 | 649.7 | 13.8 | 635.8 | 118.0 | **509.7** | 4.3 | 2.0 | 0.0 | 0.2 |
| #2 | 346.4 | 16.6 | 329.8 | **234.6** | 87.7 | 3.4 | 2.2 | 0.0 | 0.2 |
| #3 | 560.4 | 12.2 | 548.1 | **399.9** | 140.1 | 4.4 | 1.9 | 0.0 | 0.2 |
| #4 | 425.0 | 144.4 | 280.6 | 148.2 | 120.7 | 3.1 | 1.7 | 0.0 | 0.2 |

**Decisive pattern:** the two stages that vary wildly (5.8x range on
`sql_execute_fetch` alone: 87.7–509.7ms; `build_plan`: 118–399.9ms) are
BOTH real `sqlite3.Connection.execute()` calls against `screener.db`
(`build_plan` runs `PRAGMA table_info(screener_rows)` inside
`_known_columns(conn)`, deliberately uncached per its own docstring, plus
`build_where`'s own schema checks; `sql_execute_fetch` is the main scan
query). Every PURE-Python stage (`row_convert`, `canonical_overlay`,
`live_screen_state`) stays flat at ~0–2ms in every sample regardless of how
slow the request is overall. `conn_acquire` (connection open + WAL/
busy_timeout PRAGMAs) also stays small (1.3–6.7ms) — so it isn't
connection-setup either. `describe_rows` (a THIRD SQL execute call) stays
fast and stable (~3–4ms) across all four samples — a real puzzle, but
consistent with its query being a much simpler aggregate over already-
matched rows than the other two.

**This selectively-SQL-only variance pattern is not explained by generic
GIL/CPU contention** (which would slow every Python-executing stage
roughly proportionally, including row_convert/canonical_overlay) — it
points specifically at SQLite execute()-level contention (lock wait, WAL
checkpoint stall, or disk I/O contention) on `screener.db` specifically.

**Classification: R2 — SQLITE/DB/STORAGE CONTENTION DOMINATES.**
Dedicated-scanner-service (Option C) is NOT assumed to solve this — a
separate process would still read the SAME `screener.db` file, so
process-level isolation doesn't obviously reduce file-level contention
unless the contention source is also addressed or moved. Contended file:
`screener.db` (`SCREENER_DB_PATH`, default `/data/screener.db`). Likely
readers/writers not fully pinned: today's observation window was Saturday/
market-closed, so `screener-live`'s writes to the same file's live_tier
tables were inactive — the contention may include concurrent READERS
(multiple simultaneous scanner requests, including this session's own
rapid-fire test bursts) rather than only background-job writers; not
conclusively isolated to one exact writer. Smallest safe candidate worth
owner review (NOT implemented, NOT authorized): caching `_known_columns`'s
`PRAGMA table_info` result would remove one of the two variable SQL calls,
but that function is deliberately uncached today for a documented
schema-lag-safety reason (its own docstring) — a real tradeoff, not a
free win, and squarely an owner decision.

**Instrumentation cleanup recommendation: A — revert all temporary
scanner-trace instrumentation now.** The evidence is decisive and
consistent across every sample; continuing to run it doesn't add more
diagnostic value proportional to keeping temporary code in the request
path. Not yet reverted — held pending explicit owner go-ahead per the
stop condition.

## Instrumentation reverted; screener.db contention investigation (2026-09-05, read-only)

**Cleanup:** temporary scanner-trace instrumentation (both passes) reverted
in one commit (`697cc3e8d`, deployed and verified — no `scan-trace` log
lines, `git grep scan_trace_temp` returns nothing, regression back to the
original 2972-passed baseline). Pilot OFF, adapt ON confirmed on the
running process.

**Read-only screener.db investigation (code + live, read-only probe via
`railway ssh` + `sqlite3.connect(..., mode=ro)` — no PRAGMA changed, no
write, no checkpoint, no vacuum):**

- **Readers:** ~15+ distinct call sites across `scan_results.py`,
  `scatter.py`, `analyst_pass.py`, `distribution.py`, `filters.py`,
  `live_tier.py`, `query.py` (×2), `scan_evaluator.py`, `scan_store.py`
  (×6), `screen_alerts.py` (×7) — all via `snapshot_db.connect()`, a
  **fresh `sqlite3.connect()` per call, no pooling anywhere in the
  codebase.**
- **Writers:** `snapshot_builder.py` (nightly snapshot build, `upsert_rows`
  batches — last ran 2026-09-05 09:02, matches file mtime), `scan_store.py`
  (scan_hits/scan_coverage, nightly 05:00 ET sweep + others), `live_tier.py`
  (market-hours-gated live overlay writes), `screen_alerts.py` (writes
  `screen_alert_subs`/`screen_alerts_fired`, scheduled job
  `screener_screen_alerts`, described as "nightly" in its own scheduler
  call). All `snapshot_db`-internal writes serialize via one in-process
  `threading.Lock` (`_WRITE_LOCK`) — but **reads never acquire this lock**,
  relying entirely on SQLite's own WAL reader/writer concurrency.
- **Query design fact:** the `contains` filter (used by the matched PEG
  request) compiles to `LIKE '%value%'` — a **leading wildcard, which
  cannot use any index** regardless of what indexes exist. Every such
  request is a full table scan by construction.
- **Live file state (read-only, checked once):** `/data/screener.db` =
  13,733,888 bytes (3353 × 4096-byte pages), mtime 2026-09-05 09:02 (the
  nightly build). **No `-wal`/`-shm` files present** at check time — fully
  checkpointed, no lingering WAL growth observed (doesn't rule out
  transient WAL activity between observations).
- **Live PRAGMAs (read-only query, not a change):** `journal_mode=wal`,
  `synchronous=2 (FULL)`, `busy_timeout=5000`, `cache_size=-2000` (~2MB —
  **far smaller than the 13MB file**), `mmap_size=0` (disabled),
  `page_size=4096`, `page_count=3353`, `auto_vacuum=0`,
  `wal_autocheckpoint=1000`.
- **Decisive cold/warm demonstration:** on a fresh read-only connection,
  `SELECT COUNT(*) FROM screener_rows` (3745 rows) took **116.7ms**;
  immediately after, on the SAME connection, the real matched-request LIKE
  query took **3.59ms** — a **32x difference for two full-table-touching
  queries back to back.** This is a genuine, measured cold-vs-warm effect.
  Combined with the small per-connection `cache_size` and zero connection
  pooling in production, **every single production HTTP request pays a
  fresh "first-touch" cost that a warm/pooled connection would not.**

**Classification: D6 — MIXED DATABASE/STORAGE MECHANISMS.** At least two
distinct, evidenced factors contribute: (1) the `contains`/LIKE query
design forces a full table scan on every call (no index can help, ever),
and (2) a real cold/warm cache-state effect compounded by zero connection
pooling (every request opens a fresh connection with an empty per-
connection cache against a file bigger than that cache). Writer/lock
contention (D1) and WAL/checkpoint effects (D2) remain plausible
contributors but are not confirmed as dominant — no `-wal` file was
observed lingering, and the app-level `_WRITE_LOCK` only serializes
writers against each other, not against readers. Not conclusively
isolated to one single mechanism — hence D6, not a forced D1–D5 pick.

**Not implemented, per hard boundary:** no PRAGMA changed, no index added,
no `_known_columns` caching, no connection pooling, no snapshot
architecture change, no scanner service. All of these remain candidate
options requiring owner authorization.

## Verification performed for this checkpoint (2026-09-05)

- `git status` in `uct-dashboard-phase3c`: clean, 1 commit ahead of
  `origin/master`.
- `git rev-parse HEAD` = `7233239c7…`; `git log -1 origin/master` =
  `8f76d4974…`; `git merge-base --is-ancestor` confirms `7233239c7` NOT on
  `origin/master`, `9a2a8764d` IS on `origin/master`.
- `railway status` / `railway status --json` (project `luminous-recreation`,
  env `production`): `web` service latest deployment commit =
  `8f76d4974…`, status `SUCCESS`.
- `railway variables`: `PATTERN_CANONICAL_ADAPT_ENABLED=1`,
  `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` absent.
- `git show 7233239c7`: confirmed diff scope (2 files, `INDEXED BY` change
  + tests only).

## Screener.db reader connection-lifecycle validation (2026-09-05)

Owner package: "SCREENER.DB READER CONNECTION-LIFECYCLE VALIDATION + NARROW
REUSE DESIGN." Pilot OFF/unset, 8G-C HOLD, 500ms gate unchanged throughout.
New worktree `uct-dashboard-8gb-conn-lifecycle` (branch
`fix/8g-b-screener-conn-lifecycle`, off `origin/master@119d12c71`) — read-only
forensic work only, no code changed there.

**Production-shaped local test DB obtained.** `railway ssh --service web --
"base64 /data/screener.db"` succeeded, but the local `base64 -d` failed
("invalid input") on the raw captured text — root cause: stray CR/LF noise
introduced by the SSH/Bash round-trip on Windows, not a transport truncation.
Fix: `tr -d '\r\n'` on the captured text before decoding. Resulting file
verified BYTE-FAITHFUL to production: `PRAGMA integrity_check` = ok,
page_count 3353, page_size 4096, `screener_rows` count 3745, 206 columns,
`pattern_engine_ids LIKE '%power_earnings_gap%'` = 14 — all match the prior
read-only production probe exactly. Windows-Python-vs-Git-Bash `/tmp` path
gotcha recurred (Windows Python can't resolve Git Bash's `/tmp/...`); fixed by
`cygpath -w` to the real Windows path before opening with `sqlite3`. Copy +
throwaway benchmark script live at
`%LOCALAPPDATA%\Temp\claude\...\scratchpad\dbcopy\` (session scratchpad, not
in the repo) — `screener_prod_copy.db` + `bench_conn_lifecycle.py` +
`bench_results.json`. Not cleaned up; harmless (screener rows only, no
secrets/user data), owner can retain or delete.

**Existing repo precedent found (Model C = Model A already, twice).**
`api/services/bars_sqlite.py::_conn()` and
`api/services/entity_master/store.py::_conn()` BOTH already implement
thread-local reader-connection reuse (`threading.local()`, one connection
cached per thread, `check_same_thread=False`) — entity_master's docstring
says explicitly it "mirrors bars_sqlite.py's `_conn()`." bars_sqlite.py adds a
generation/epoch counter (`_db_epoch`, bumped when `/data/bars.db` is
wholesale-replaced via `shutil.move` from an R2 pull) compared against each
thread's cached `(conn, epoch)` pair, and `_drop_local_conn()` for hard
teardown after a corruption error. **This is the mature, proven pattern to
copy, not a new abstraction** — but its invalidation trigger (whole-file
replace) does NOT map onto screener.db, whose writers (`snapshot_builder`,
`scan_store`, `live_tier`, `screen_alerts`) all mutate the SAME file IN
PLACE. A screener reuse design needs a different (or no) invalidation
signal — see below.

**Transaction-safety trace.** `snapshot_db.connect()` sets no
`isolation_level` override (Python default: implicit BEGIN before DML only,
autocommit for SELECT). `run_scan`/`preview_count` both wrap their connection
in `with snapshot_db.connect() as conn:` (commit-or-rollback-on-block-exit,
not a resource close) and always fully drain cursors via `.fetchall()` —
never leave a statement/cursor half-read. **Found one call site with an
EXPLICIT transaction on a `snapshot_db.connect()`-sourced connection**:
`scan_store.py:737`, `conn.execute("BEGIN IMMEDIATE")` inside a
`@contextmanager`, its own docstring warning "EXPLICIT, NEVER THE DRIVER'S
IMPLICIT BEGIN... SQLite refuses a BEGIN inside a BEGIN." ⛔ **This means any
future reuse layer must NOT wrap `snapshot_db.connect()` itself** (shared by
readers and this writer) — it must be scoped to genuinely read-only call
sites only (e.g. a new `get_reader_conn()`), or a reused connection could
collide with this writer's manual transaction discipline.

**Scenario E (writer-commit visibility) — PASSED**, safe throwaway test DB
only (never the copy, never production): a persistent reader connection,
opened once, correctly saw a row committed by a SEPARATE writer connection on
its NEXT query, with no reconnect and no stale read. Confirms: under the
current fetchall()-drained, no-explicit-BEGIN read pattern, a reused
WAL-mode reader connection does NOT pin a stale snapshot.

**Scenarios A–D (local benchmark, N=30 each unless noted) — the central
finding: connection reuse does NOT reproduce the production cold/warm gap.**
- A (same connection, reused): main query (the real matched-request LIKE
  shape) median 4.99ms, p90 5.6ms. `PRAGMA table_info(screener_rows)`
  (`_known_columns`'s query) costs 0.173ms — negligible.
- B (fresh connection every call, today's real pattern): connect() itself
  0.1ms median (cheap); the two PRAGMAs (`journal_mode=WAL` +
  `busy_timeout=5000`) together 4.3ms median; main query 5.95ms; total
  10.34ms.
- C (CRITICAL isolation test — warmed the OS/file cache with 100 reads via a
  throwaway connection, then closed it and opened 30 BRAND-NEW connections):
  first query on a fresh connection, AFTER the file is provably OS-warm, is
  5.81ms median — statistically indistinguishable from B's fresh-connection
  number and from A's steady-state reused number. **A brand-new connection is
  NOT slow once the underlying storage is warm.** This directly weighs
  against "every new sqlite3.connect() necessarily re-pays the entire cold
  cache" as the explanation for the production 116.7ms/3.59ms (32×) gap.
- D (reused connection, idle 1/5/15s): no idle penalty locally (5.5–6.0ms
  throughout) — expected on local NVMe with no memory pressure; this
  scenario cannot observe Railway-volume idle-eviction behavior and is
  explicitly not claimed to.
- Follow-up isolation: `PRAGMA journal_mode=WAL` ALONE costs ~5ms median (of
  the ~4.3ms pragma-pair figure above, `busy_timeout` is ~0.01ms — the WAL
  pragma is ALL of it), even though the DB is already in WAL mode and the
  connection is read-only. **This is the one real, mechanistically-explained,
  repeatable saving connection reuse buys**: setting it once per connection
  instead of once per call. It does not touch PRAGMA policy/content — only
  how often the existing PRAGMA statement runs.

**Honest limitation, stated plainly:** this benchmark ran against a COPY on
local SSD, not against Railway's actual persistent-volume storage. Local SSD
first-touch reads are already sub-millisecond, so scenario C's "brand-new
connection is fast once storage is warm" result cannot rule out that
Railway's real volume has a much larger first-touch page-fetch cost that a
reused connection would still have to pay on ITS first query too (reuse only
amortizes cost across MULTIPLE calls on one connection — it does not make a
single cold page-fetch faster). Reproducing the actual 116.7ms number would
require production-side instrumentation, which remains out of scope per the
owner's "no new production instrumentation yet" boundary.

**Classification: CONNECTION REUSE PROVIDES ONLY PARTIAL BENEFIT — SNAPSHOT/
STORAGE ARCHITECTURE REVIEW REQUIRED.** The demonstrated benefit (~5ms/call,
eliminating the redundant per-call `journal_mode=WAL` pragma + trivial
connect() overhead) is real, repeatable, and would help all 15+ existing
reader call sites — but it is small relative to the actual observed
production tail (100–500ms range on `build_plan`/`sql_execute_fetch`), and
Section 14's "large repeatable measured benefit" condition (relative to the
actual problem) is not met. Per the owner's own conditional framing, this
means: do NOT implement a reuse patch this package. `_known_columns` stays
uncached (unchanged — its own cost is already negligible, so there was never
a performance case for caching it, only a correctness risk). Full report
delivered in-conversation; no code changed in `uct-dashboard-8gb-conn-
lifecycle` or anywhere else. Next-direction candidates per the owner's own
list: Railway-volume/page-cache behavior (would need production-side,
owner-approved instrumentation), immutable/versioned snapshot serving,
snapshot-copy-to-local-ephemeral serving — stopping here for owner review
per instruction.

## Railway persistent-volume vs local-ephemeral storage isolation (2026-09-05)

Owner package: connection reuse rejected as current fix; authorized a
same-container, read-only, stdlib-only diagnostic comparing `/data/
screener.db` (persistent volume) against a SQLite-backup-API copy on the
container's local `/tmp` (ephemeral). Pilot OFF, 8G-C HOLD throughout. No
app code changed, no deploy, no PRAGMA/WAL change, no cache-drop, no
service restart.

**Method.** One stdlib-only script (`sqlite3`/`os`/`time`/`statistics`/
`json`/`subprocess`/`sys`, no app imports), validated locally first against
the earlier byte-faithful copy (dry run, clean), then executed on the real
`web` container via `railway ssh` (base64-encoded, piped through
`/opt/venv/bin/python` as a single argv string — the standing recipe for
avoiding `sh`'s argv-joining). Phases, in the owner-specified order: (A)
persistent-volume first-touch + 10 repeats on one connection + 5 fresh
connections, BEFORE any backup; (B) SQLite online-backup-API copy
`/data/screener.db` → `/tmp/uct_screener_ephemeral_bench.db` (never a raw
file copy); (C) same query set against the ephemeral copy; (D)
re-benchmark persistent volume AFTER the backup; (E) raw sequential
file-read timing, both paths; (F) 3 single-query checks each in a brand
new OS subprocess. Ephemeral copy deleted at the end (confirmed).

**Result — the historically-observed tail did NOT reproduce, on either
path, this run.** Persistent-volume first touch: table_info 0.61ms,
full-table COUNT 1.39ms, matched LIKE query 3.01ms, total 5.01ms — nothing
like the earlier 116.7ms. Repeated-same-connection matched query settled to
~1.5ms median; 5 fresh connections after warm ~1.9ms median. Ephemeral copy:
first-touch matched 2.2ms, repeated ~1.7ms median, fresh connections
~2.15ms median — **statistically the same ballpark as the persistent
volume**, not faster. Persistent volume re-measured after the backup: still
~1.5–2.3ms. Raw sequential read of the full 13.7MB file: persistent volume
1.99ms, ephemeral copy 2.09ms — indistinguishable. 3 fresh-OS-process
single-query checks: ~3.2–3.5ms each, consistent, no penalty.

**Confirmed genuinely different filesystems.** `os.stat().st_dev` differs
between `/data` and `/tmp` (87090880 vs 6291639) — this is a real
persistent-volume-vs-ephemeral-storage comparison, not two paths on the
same mount.

**One real anomaly, flagged but not overweighted.** The SQLite backup-API
copy itself took 145.89ms — by far the slowest single operation in the
whole run, ~30–70× any individual query. This is a different operation
class from production's read-only SELECT hot path (page-by-page copy under
the backup API's own locking/IO pattern, writing a brand-new file), so it
is NOT claimed to explain the scanner's query-latency tail — but it is a
genuine, measured, large number worth keeping on record.

**Interpretation — why this does not resolve to a clean S1/S2/S3.** The
DIRECT persistent-vs-ephemeral comparison, holding everything else equal,
shows no meaningful difference (weighs against storage-medium-identity
being the cause). But neither path reproduced the original 100–500ms tail
AT ALL during this test — so the test cannot itself confirm that storage
medium is innocent under the conditions that actually produced the
historical slow numbers. Two structural facts likely explain the gap
between "isolated diagnostic, clean result" and "production, sometimes
100–500ms": (1) this diagnostic ran with ZERO concurrent load — no other
request, no scheduled writer — while the original slow traces and the
04:00–09:02 window's writers (snapshot_builder nightly build, scan_store's
05:00 ET sweep, live_tier during market hours, screen_alerts) were not
running today at time of test (market closed, off-schedule); (2) `/data`
on Railway is very likely ONE physical volume backing MULTIPLE SQLite
files (screener.db, bars.db, auth.db, cot.db, catalysts.db, tweets.db,
modelbook.db, etc.) — so volume-level I/O contention from a DIFFERENT
database's concurrent write activity could produce exactly the observed
symptom (wildly variable `sql_execute_fetch_ms`, 87.7–509.7ms across only 4
real captured traces) without screener.db's OWN storage path, read in
isolation, ever showing it. Neither of these can be tested by a
no-concurrent-load, single-process `railway ssh` script — by construction.

**Classification: S3 — PERSISTENT AND EPHEMERAL PERFORMANCE SIMILAR —
STORAGE PATH (medium identity) NOT ROOT CAUSE, with an explicit caveat:**
this result does not explain the historical tail, because the tail did not
reproduce on either path during this test. The two remaining, evidence-
consistent candidates are (a) concurrent-load/contention on the live
single web process (real request traffic + a scheduled writer sharing the
event loop/threadpool/volume at the same moment) and (b) cross-database
volume-level I/O contention from OTHER SQLite files sharing the same
Railway volume. Neither is architecture (no immutable-snapshot case is
made by this evidence); both would need either production-side
instrumentation under real load (needs fresh owner authorization — the
prior instrumentation was deliberately reverted) or a scheduled/timed
capture that lands during an active writer window. Stopping for owner
review per instruction. No implementation, no deploy, no app-code change.

## Natural-load contention attribution — implementation in progress (2026-09-05)

Owner accepted S3, authorized the final natural-load pass. New worktree
`uct-dashboard-8gb-conn-lifecycle` continued (same branch,
`fix/8g-b-screener-conn-lifecycle`).

**Read-only `/data` topology (via `railway ssh`, `os.listdir`/`os.stat`
only, no content reads).** 60 SQLite files under `/data`, **all sharing the
same `st_dev` (87090880)** — one physical volume backs every database.
Largest by far: `bars.db` 4.8GB, `patterns.db` 3.65GB, `darkpool.db` 2.5GB,
`flow.db` 1.6GB (frozen pre-cutover copy per existing CLAUDE.md doc, not
actively written by web anymore) — `screener.db` itself is only 13.7MB.
This directly supports the cross-database volume-contention hypothesis
structurally: any heavy write against one of the giant files can compete
for the same volume's I/O with a screener.db read.

**Static job → database map (from `api/main.py`, grep of every
`add_job`/`_scheduler.add_job`, ~90+ registrations).** Confirmed
screener.db writers: `screener_snapshot_nightly` (3:00 ET), the
`SWEEP_HOUR_ET`/`MINUTE_ET` scan-definitions sweep, `screen_alerts` sweep
(`SWEEP_HOUR_ET`+10min), `screener_scan_sweep_live` + `screener_live_tier`
(both interval-based, run continuously per `scan_evaluator.live_interval_s()`
/ `live_tier.interval_s()`), plus five 02:xx ET screener prep jobs
(finviz/earnings-dates/opt-flow/insider/analyst-pass). Highest-frequency
same-volume, non-screener candidates: `indicator_alert_shadow_cycle` +
`alert_bars_freshness` (every 60s, always), `indicator_alert_silence_sweep`
(every 300s), and four darkpool jobs at `hour="7-16"` with `minute="*/3"`
(`_dp_intraday_run`), `*/5` (`_dp_scan_run`), `*/12` (`_dp_warm_run`) against
the 2.5GB darkpool.db — i.e. market-hours-adjacent, every 3-12 minutes,
regardless of whether the market itself is open (hour range is fixed,
not session-gated).

**Existing logs insufficient (owner's step 8).** The earlier stage-trace
instrumentation that captured the original 4 real slow traces was already
reverted this session (`697cc3e8d`) — no way to retroactively correlate
scheduler activity against those specific timestamps without redeploying
something. Historical exact timestamps were not preserved in this
checkpoint (only aggregate ranges). Proceeding per owner's own contingency
to step 9: one temporary instrumentation patch.

**Precedent found and reused, not reinvented.** `api/services/memory_probe.py
::instrument_scheduler` already wraps `_scheduler.add_job` (called ONCE,
BEFORE any add_job, right after `_scheduler = BackgroundScheduler(...)` in
`api/main.py`) to attach a per-job RSS-delta probe to every one of the
~135+ registered jobs without touching each call site — its own docstring:
"never changes the return value, never swallows the job's exception... a
failure in the recording itself is discarded." Mirrored this EXACT
technique in the new `api/services/screener/contention_trace_temp.py`
instead of using APScheduler's event-listener API, since a proven,
already-shipped precedent for "observe every job regardless of what's
added next" exists in this file.

**Implementation (branch `fix/8g-b-screener-conn-lifecycle`, not yet
merged/pushed at time of writing).**
- New file `api/services/screener/contention_trace_temp.py` — `stage()`
  contextvar-based timer (identical safety shape to the earlier, already-
  proven-and-reverted `scan_trace_temp` module: no-op if `reset_stages()`
  was never called on that context, cleared by `pop_stages()`);
  `instrument_scheduler()` (mirrors `memory_probe`'s wrap-add_job, tracking
  `job_id -> start_time` in a lock-protected dict instead of RSS);
  `record()` logs a `[contention-trace]` line ONLY for total request
  latency ≥300ms (`tag=SLOW`), or a heavily rate-limited (≤1/60s) fast
  control sample ≤10ms (`tag=fast-control`) — includes stage timings,
  currently-active job IDs + how long each has been running, cheap process
  context (pid/tid/active_thread_count/RSS/voluntary+involuntary context
  switches via `resource.getrusage`, guarded for non-POSIX), and WAL-sidecar
  existence/size for screener.db + the three largest same-volume files
  (bars/patterns/darkpool). No payloads, no PII, no secrets — verified by
  a dedicated test.
- `api/main.py`: right after the existing `memory_probe.instrument_scheduler
  (_scheduler)` call, added a second, independently flag-gated
  (`CONTENTION_TRACE_ENABLED`, default `"1"`) call to
  `contention_trace_temp.instrument_scheduler(_scheduler)` — same
  before-any-add_job placement, non-fatal on failure.
- `api/services/screener/query.py::run_scan`: added `reset_stages()` at
  entry + `stage()` wraps around the existing single `with
  snapshot_db.connect() as conn:` block (`run_scan_total`), the
  `build_scan_sql(...)` call (`build_dynamic_plan`), and the main
  `conn.execute(...).fetchall()` (`sql_execute_fetch`) — **the original
  code's structure, nesting and every comment are unchanged**; the edit
  only added timer wrappers, re-indenting the existing body one level
  deeper without altering behavior (double-checked: `out_rows =
  [dict(r) for r in rows]` remains outside the with-block exactly as
  before).
- `api/routers/screener.py::screener_scan`: captures route-entry
  `perf_counter()`, and in a `finally` block (fires on both the success
  return and the existing `except ValueError` path, never suppresses it)
  computes total ms and calls `contention_trace_temp.record(total_ms,
  contention_trace_temp.pop_stages())`.
- New test file `tests/test_contention_trace_temp.py` (8 tests: no-op
  without reset, stage round-trip, pop clears state, `record()` never
  raises on a slow sample, below-threshold-and-not-fast-sampled logs
  nothing, no password/token/secret/authorization/api_key substring ever
  appears in a logged line, `instrument_scheduler` tracks a job as active
  only during its own execution, and correctly un-tracks it even when the
  wrapped job raises) — all 8 pass. `py_compile` + `ast.parse` clean on
  all four touched/added files.

## Natural-load contention attribution — DEPLOYED, observation phase active (2026-09-05)

**Precise test record (per owner's explicit demand for unambiguous
evidence — do not overclaim "full regression").**

- Command 1 (superseded, do not cite): `python -m pytest tests/ -k "screener" -q 2>&1 | tail -25`,
  run in background as task `b44yn7iw1`. This attempted a filter over the
  WHOLE repo's test collection (~9,600 tests per this file's own
  Performance & Scale section), NOT a scoped run. Its "exited with code 0"
  is a **pipe-status artifact** — in a `cmd | tail` pipeline, the reported
  exit code is `tail`'s, not pytest's, and must NOT be read as proof of a
  clean run. Progress-dot output showed real `F`/`E` markers but was killed
  mid-run (PID 9924, confirmed via `Get-Process` CPU delta still climbing)
  before its own summary line was ever produced. **Superseded by Command 2;
  not used as evidence for anything.**
- Command 2 (the actual evidence): `python -m pytest tests/test_screener*.py
  tests/test_scan*.py tests/test_contention_trace_temp.py -q --tb=short`
  (101 files: 100 pre-existing `test_screener*`/`test_scan*` files + the 1
  new file this package added), run in background as task `bwsa7nf1h`,
  completed to its own real summary line: **`5 failed, 1841 passed, 2
  skipped, 8 errors in 129.40s`.** This is a SCOPED run (screener/scan test
  files only) — explicitly NOT the full ~9,600-test suite, and not
  represented as one.
- **8 errors** — all in `tests/test_scan_definition.py`, all identical root
  cause read directly from the traceback: `Error [ERR_MODULE_NOT_FOUND]:
  Cannot find package 'jsep' imported from
  app/src/components/chart/engine/ast/parse.js` — a missing local Node.js
  dependency (this worktree's `node_modules` was never `npm install`-ed).
  Environment-level, cannot possibly be caused by a Python-only diff;
  reasoned from the traceback, not re-verified via stash (unnecessary —
  the failure occurs before any Python code of mine is reachable, in a
  Node subprocess the test spawns).
- **5 failures** — `test_screener_lane_parity.py` ×2 (SAME missing-`jsep`
  root cause, confirmed from traceback), `test_scan_screener_auth.py` ×3
  (`test_a_PAID_member_still_gets_200_on_EVERY_route`,
  `test_an_ADMIN_gets_200_everywhere_including_the_refresh_route`,
  `test_a_TRIAL_member_is_treated_as_paid`) — traceback shows `TypeError:
  stub_services.<locals>.<lambda>() got an unexpected keyword argument
  'user'` at the exact unchanged line `scr_query.run_scan(spec.model_dump(),
  user_id=..., user=user)` in `api/routers/screener.py` (a line this
  package's diff never touched).
- **Directly, conclusively verified pre-existing** (not reasoned —
  reproduced): `git stash push -u -m "contention-trace-wip-verify-
  preexisting-failure"` (captured its exact SHA, `cf48bc1cf...`, applied
  back via that SHA — never bare `stash pop` — then dropped the correct
  `stash@{0}` by re-matching the SHA first, leaving an unrelated session's
  own `broker-sync WIP` stash entry untouched throughout) → reran the
  same 5 failing tests against the CLEAN, unmodified codebase (my diff
  entirely absent) → **identical result: `5 failed, 839 warnings in 1.79s`**,
  same 5 test names. This is direct, reproducible proof all 5 failures
  pre-exist independent of this package's changes.
- **This package's own 8 new tests** (`tests/test_contention_trace_temp.py`,
  run standalone, isolated from the above): **`8 passed, 393 warnings in
  0.29s`** — clean.
- **Conclusion, stated precisely**: of the 101-file scoped run's 13 non-passing
  items (5 failed + 8 errored), **zero are attributable to this package's
  diff** — 8 are a missing local Node dependency, 5 are a pre-existing
  test/stub mismatch reproduced identically with the diff completely
  absent. No unresolved relevant failure exists. The whole-repository
  ~9,600-test suite was NOT run to completion this package (Command 1 was
  killed mid-run before producing a trustworthy summary) — this is
  disclosed, not implied otherwise.

**Merge + deploy.** Committed locally on `fix/8g-b-screener-conn-lifecycle`
(`93686844d`). Re-fetched `origin/master` immediately before merging (7
new unrelated commits had landed — theme-sets feature, theme-tracker
polish, Live Massive ask-accumulation — confirmed via `git diff` that only
2 lines of `api/main.py`, far from this package's edit region ~line 4400,
were touched by any of them). Merged via the established
`_merge_staging_ctrace` pattern off fresh `origin/master`, clean auto-merge
(no conflicts), `grep -c broker_sync api/main.py` = 10 (≥7, standing rail
satisfied), pushed `_merge_staging_ctrace:master` → **`d2f94e011`**, deleted
the staging branch, returned to the feature branch (now behind
`origin/master` by design — expected).

**Production verification.** Railway `web` deployment status: `SUCCESS`.
`GET /api/health` (browser User-Agent, Cloudflare requires this):
`{"status":"ok","wire_date":"2026-09-04","uptime_seconds":65,...}` — fresh
uptime confirms the new process. Startup logs (`railway logs --service web
-d --lines 300`): **no** `"contention trace instrumentation failed"` line
(the only failure-path print my code has) — confirms clean wiring.
APScheduler's own log lines show jobs actively running as
`"instrument_scheduler.<locals>.add_job.<locals>.wrapped"` and completing
`"executed successfully"` at their normal cadence — proves the wrap-add_job
layering (mine stacked on top of `memory_probe`'s, both already-shipped-safe
technique) is intercepting real job execution without breaking it. At
verification time the market was in `post_market` session
(`[screener-live] cycle skipped: not_regular_session`) — expected, matches
the hour. No `[contention-trace]` lines yet (no scanner traffic since
deploy) and none manufactured — none expected yet, this is a `noop` reading,
not evidence of anything.

**Observation phase state.**
- Pilot OFF/unset, `PATTERN_CANONICAL_ADAPT_ENABLED=1` — unaffected,
  unchanged, not re-verified this cycle (no reason to expect drift).
- Instrumentation ACTIVE in production (`CONTENTION_TRACE_ENABLED` default
  `"1"`, confirmed wired, no failure logged).
- No slow-scan evidence collected yet — market closed, light traffic.
- Next meaningful natural windows: the 02:00–05:10 ET nightly screener
  writer block (`screener_snapshot_nightly` 3:00 ET;
  `SWEEP_HOUR_ET`/`MINUTE_ET` scan-definitions + `screen_alerts` sweeps
  ~05:00/05:10 ET; five 02:xx ET screener prep jobs) — TONIGHT, ~9.5h out
  at time of writing, since none of these carry a `day_of_week` restriction
  in what was read; then the next real market-hours session (today's
  market is already closed — Friday post-market — so the next trading
  session is Monday 2026-09-08).
- `/data` topology (established fact, kept explicitly as a HYPOTHESIS
  driver, NOT a conclusion): all 60 SQLite files under `/data` share one
  `st_dev` (87090880) — one physical volume. Largest: `bars.db` ~4.8GB,
  `patterns.db` ~3.65GB, `darkpool.db` ~2.5GB; `screener.db` itself only
  ~13.7MB. Darkpool jobs fire every 3–12 minutes across a fixed
  `hour="7-16"` ET window (not session-gated). **This strengthens C2's
  plausibility only — it does NOT prove C2.** All of C1–C6 remain open
  until real slow-trace/active-job overlap evidence says otherwise; do not
  select C2 (or any classification) on topology plausibility alone.
- **Standing holds, explicitly reaffirmed, unaffected by anything above:**
  Package 8G-B final HTTP acceptance remains BLOCKED BY UNRESOLVED
  PRODUCTION-TIME SCREENER SQLITE LATENCY VARIANCE; 8G-C HOLD; 500ms gate
  unchanged; long-running-scan/redeploy-reliability issue remains
  separately open, not this package's to fix.
- **No new implementation of any kind while observing** — connection
  reuse, `_known_columns` caching, immutable snapshots, query
  normalization, volume separation, scheduler migration, scan
  checkpoint/resume, 8G-C, canonical pilot reactivation are all
  explicitly OFF THE TABLE for the duration of this observation window.
- Cleanup (surgical revert of `contention_trace_temp.py` + its three call
  sites + its test file, regression, redeploy) is REQUIRED once sufficient
  evidence exists, but not before — and not merely because the window
  passed quietly; a quiet window is itself reportable evidence (see the
  owner's C5/insufficient-evidence classifications), not a reason to
  extend indefinitely without saying so.

## MATERIAL DIAGNOSTIC BLIND SPOT — found during between-window review (2026-09-05, ~19:5x ET)

**The deployed instrumentation can see APScheduler jobs ONLY. It cannot
see raw background `threading.Thread(...)` loops — and `api/main.py`'s
lifespan starts approximately 35 of them.** `contention_trace_temp.
instrument_scheduler` wraps `scheduler.add_job`; it has no visibility into
anything started via a bare `threading.Thread(target=..., daemon=True).
start()`. Grepped every such call site in `api/main.py` (~35 total) —
most are one-shot startup warmers, but several are genuinely continuous,
always-on loops:

- **`_s3_pull_loop`** (main.py:3891) — CONFIRMED CONTINUOUS: an infinite
  `while True: sleep(data_sync.SNAPSHOT_INTERVAL_SECONDS); ...` loop,
  interval = **1200s (20 minutes)**, unconditional (no market-hours gate),
  calling `data_sync.sync_if_newer_merge()` — **this is bars.db's own
  web-side writer**, per this file's existing "Bars Freshness" section
  ("Web ingests worker freshness via a newer-wins MERGE"). Runs on `web`,
  writes to `/data/bars.db` (the 4.8GB file), every 20 minutes, all day,
  every day — and is COMPLETELY INVISIBLE to the deployed diagnostic.
- **`run_prewarmer_forever`** (`api/services/bars_prewarm.py:503`) — name
  alone confirms a forever-loop; not yet deep-traced (queued for the
  between-window research below), but a strong second bars.db-touching
  candidate.
- **`_hotset_push_loop`** (main.py:3921) — continuous, 120s cadence, reads
  hot tickers + calls `data_sync.put_hotset(hs)` (an R2 PUT, not a local
  SQLite write per its own comment — lower-priority than the two above,
  but noted for completeness).
- Several one-shot `_darkpool_db_seed_background`, `_flow_db_seed_
  background`, `_cot_seed_background`, etc. threads exist too (seed-once
  patterns, lower recurring risk, but still invisible to the diagnostic
  during their run window).

**Why this matters, precisely.** This does NOT invalidate the deployed
experiment — it still correctly observes every APScheduler-registered job
(the confirmed screener.db writers, the darkpool Cron jobs, etc.), which
remains real, valid evidence for C1 and the scheduler-based half of C2/C4.
**But it means a clean "active_jobs=none" reading on a slow trace must be
read as "no SCHEDULER-JOB overlap," never as "no application activity
overlap."** In particular: **a C5 ("no application-job correlation")
conclusion is NOT safe to draw from this instrumentation alone**, because
the single strongest C2 candidate identified so far (`_s3_pull_loop`
writing to bars.db every 20 minutes) would show as invisible even if it
were the actual cause of every slow trace this window produces. This is a
disclosed, carried-forward limitation, not a fatal flaw — per the owner's
instruction, NOT stopping/modifying the live diagnostic over it (that
would itself change the experimental variable mid-run); flagging it now so
a future C5-leaning read gets the correct caveat, and a genuine C5
conclusion (if it comes to that) explicitly recommends a FOLLOW-UP package
extending visibility to these threads, rather than jumping to a
platform/runtime explanation prematurely.

**Between-window safe (read-only, no production/code change) research now
in progress**, dispatched to parallel research agents per owner
authorization: (1) a complete job+thread → database inventory (all
scheduler jobs AND all ~35 raw threads, cadence, gating, DB touched); (2) a
deep trace of screener.db's own writers (transaction boundaries, batch
size, commit frequency); (3) a deep trace of bars.db/patterns.db/
darkpool.db writers (both scheduled and thread-loop); (4) the long-running-
scan and snapshot-completeness contracts (what exists vs. what's missing,
documentation only); (5) an extended repo-precedent catalog. Findings to
follow in a BETWEEN-WINDOW SCANNER CONTENTION PREPARATION REPORT once
back. Observation cadence (hourly Railway log/deploy checks) continues
unchanged and takes priority over this research whenever it's due.

## MAJOR FINDING — confirmed production flags: SCREENER_LIVE_TIER is armed, not dark (2026-09-05 ~20:07 ET)

3 of 5 research agents complete so far (repo precedent catalog; scan/
snapshot completeness contract; screener.db writer full trace — 2 still
running: job/thread→DB inventory, bars/patterns/darkpool writer analysis).
The screener.db writer trace surfaced that THREE of screener.db's six
writer paths are gated by flags that **default OFF in code**
(`SCAN_SWEEP_ENABLED`, `SCAN_LIVE_SWEEP_ENABLED`, `SCREENER_LIVE_TIER_
ENABLED`), so their actual production state had to be checked, not
assumed. Checked via the established safe method (`railway variable list
--service web --json` grepped for these exact non-secret feature-flag key
names only — no value dump, no secret exposure):

- **`SCAN_SWEEP_ENABLED=1`** — confirmed (matches the 2026-08-09 memory
  note). The nightly scan-definitions sweep (05:00 ET) IS live: 2 small
  write transactions per distinct definition (`scan_store.record_hits` +
  `record_coverage`), each fast/pre-computed, but N definitions × 2 =
  potentially many discrete commits across the 05:00 ET window.
- **`SCREENER_LIVE_TIER_ENABLED=1`** — **confirmed armed, NOT dark.** This
  is new information this session. `live_tier.sweep_job()` fires every
  **60 seconds during the regular market session** (internally
  session-gated, not cron-gated — the job registers unconditionally and
  checks session state per tick) and does ONE large `executemany`+commit
  writing the ENTIRE matched universe (~3,745 rows) to the `screener_live`
  overlay table. It runs under `snapshot_builder._BUILD_LOCK` — the SAME
  Python lock the nightly full builder holds — with a source-code-
  documented measured `held_lock_ms` median of **122ms** (121-140ms range)
  for a synthetic full-universe pass. **This is now the single strongest
  CONFIRMED (not merely plausible) C1 candidate**: a real, frequent,
  full-universe write to screener.db, active specifically during the hours
  members actually use the scanner — Monday's market-hours window is now a
  much higher-value observation target than it looked a few hours ago.
  LIVE-CONFIRMED still firing on schedule: production logs show
  `[screener-live] cycle skipped: not_regular_session (session=post_market)`
  ticking every ~60s right now (market closed) — the job is real and
  running, just correctly idle outside RTH.
- `SCAN_LIVE_SWEEP_ENABLED` did not appear in the grepped output — read as
  unset/OFF, consistent with its code default. Not re-verified beyond
  absence-from-grep.

**Also newly established (from the writer-trace agent, static-code
findings, not yet production-verified beyond the two flags above):**
- Six independent writer paths hit screener.db on four different cadences
  (nightly 02:00-05:10 ET block; the confirmed-armed 60s live_tier; the
  possibly-armed 300s live scan sweep; on-demand admin refresh /
  user subscribe-unsubscribe).
- Every writer's expensive work (network reads, AST evaluation, bar
  fetches) happens BEFORE its connection opens — connections are held only
  for pre-computed `executemany`+commit, never across I/O/computation.
  This weighs against "a writer's OWN transaction is slow because of what
  it's doing inside the transaction" and toward "if writers matter, it's
  about FREQUENCY of short write windows, not duration of any one write."
  the live_tier one is the exception worth watching precisely because it's
  both frequent (60s) AND the largest single batch (~3,745 rows/commit).
- `scan_store.prune()` (the `scan_hits`/`scan_coverage` reaper) has **zero
  production callers** — those tables grow unbounded. Separate,
  longer-horizon finding, not a latency-spike cause by itself, but real and
  worth carrying forward to the reliability workstream.
- `screen_alerts.py`'s writes skip the shared `_WRITE_LOCK` entirely
  (relies on SQLite's own `busy_timeout` only) — a real asymmetry vs. every
  other writer, though its write volume is small (≤6 alerts/user/night).

Scan/snapshot completeness contract findings (documentation only, for the
separately-open reliability workstream, NOT acted on): the nightly pattern-
universe scan (`_run_patterns_universe_scan`, 01:00 ET) has no scan ID, no
persisted progress, no completion flag — a killed run produces no log line
at all. `screener_rows` itself has real, shipped staleness *description*
(median-`snapshot_date` + `mixed` flag, computed from the SAME where/from
that produced the served rows — already a genuinely good mechanism) but
**no publication gate** — a half-rebuilt table is immediately visible to
live readers the instant each ≤200-row batch commits, with nothing
stopping `query.run_scan` from serving it as-is.

Repo precedent catalog (for a possible future architecture; not started):
best generation/version-metadata precedent is `api/services/barspack.py`
(shards-then-manifest-last publication + content-addressed generations +
retention pruning) — a better structural fit than `brain_sync.py` (also
cataloged: directory-swap + marker-file + integrity-check-before-swap +
on-install callback hook) for "a versioned screener.db publication."
Confirmed a FOURTH existing Railway service role beyond web/worker
(`flow_worker_main.py`, narrowly-scoped, own volume) as a direct precedent
for "a fifth dedicated scanner-serving service" being a one-line addition
to the existing `railway.json` dispatcher, not novel infrastructure. Full
catalog (atomic publish idiom used ~55+ places; two internal proxy
patterns; two durable-retry/idempotent-job patterns; the `/api/ready`
readiness framework INCLUDING an already-registered `"scanner"` gate, and
its own documented "never let this gate the Railway healthcheck itself"
outage lesson) preserved for the eventual architecture-design package.

Still awaiting: job/thread→DB inventory (broadest one, ~90 jobs + ~35
threads), bars/patterns/darkpool writer analysis. Observation cadence
continues unchanged in parallel; no code/production change made from any
of this — read-only research + one safe flag-presence check only.

## BETWEEN-WINDOW SCANNER CONTENTION PREPARATION REPORT (2026-09-05, ~20:09 ET)

All 5 read-only research agents complete. Full raw findings from each are
preserved verbatim in this session's transcript (job/thread→DB inventory;
screener.db writer deep trace; bars/patterns/darkpool writer analysis;
scan/snapshot completeness contract; repo precedent catalog) — this
section is the consolidated synthesis. **This is NOT the final
SCREENER SQLITE NATURAL-LOAD CONTENTION ATTRIBUTION REPORT** — no live
evidence has arrived yet; C1-C6 remain fully open.

### Second production flag check (same safe method — targeted grep of
### non-secret feature-flag keys only, no value dump)
Confirmed ARMED in production: `DARKPOOL_EOD_ENABLED=1`,
`DARKPOOL_FLATFILE_ENABLED=1`, `DARKPOOL_INTRADAY_ENABLED=1`,
`DARKPOOL_INTRADAY_TIERED_ENABLED=1`, `DARKPOOL_MASSIVE_INGEST_ENABLED=1`,
`USE_REMOTE_BARS=1`. **Every darkpool ingest job the writer-analysis agent
found "gated off by default in code" is in fact fully armed in
production** — the entire darkpool intraday family (3/5/12-min cadence,
`hour="7-16"` ET) is real, active, confirmed, not merely plausible.
`USE_REMOTE_BARS=1` also resolves an open caveat from that same agent:
`_s3_pull_loop` (bars.db merge, confirmed continuous 20-min cadence) IS
armed on web; `bars_prewarm.run_prewarmer_forever`'s full continuous
historical-prewarm loop is gated OFF on web when `USE_REMOTE_BARS=1` (runs
on the separate worker volume instead) — so bars_prewarm itself is likely
NOT a same-volume factor for screener.db, contrary to the earlier loose
hypothesis; `_s3_pull_loop` remains the confirmed bars.db-on-web writer.

### THE SINGLE MOST IMPORTANT NEW FINDING — a SAME-FILE writer, not just same-volume
The job/thread→DB inventory agent (cross-checked independently against the
screener-writer-trace agent, both arrived at the same numbers separately)
confirms: **`screener_live_tier` and `screener_scan_sweep_live` are BOTH
registered UNCONDITIONALLY in `api/main.py`** (the flag only gates their
per-tick behavior internally, not their scheduler registration) and **both
write directly into `screener.db` itself** — the exact file
`/api/screener/scan` reads. `screener_live_tier`'s own source comment
self-documents **"~1.5M overlay row-writes per session"** — one
`executemany` of the ENTIRE matched universe (~3,745 rows) every ~60s
throughout the whole regular session (1.5M ÷ 3,745 ≈ 400 batches ≈ 400
min ≈ 6.7h, consistent with one trading day). This is a stronger,
more-direct candidate than any cross-database hypothesis: it is the same
physical file, hit every single minute, all session, confirmed armed
(`SCREENER_LIVE_TIER_ENABLED=1`, confirmed earlier this checkpoint) —
**and confirmed still actively ticking in live logs** (`[screener-live]
cycle skipped: not_regular_session` firing every ~60s right now, correctly
idle post-market). Monday's market-hours window is now the clear
highest-value observation target, specifically for THIS writer, ahead of
any cross-database hypothesis.

### Prioritized watch list for the next live evidence (ranked, not proven)
1. **`screener_live_tier`** (60s, same-file, ~3,745-row batch/commit, confirmed armed + confirmed ticking) — top candidate for C1.
2. **`screener_scan_sweep_live`** (continuous interval, same-file, unconditionally registered) — second C1 candidate.
3. **darkpool.db intraday family** (`_dp_intraday_run` */3min, `_dp_scan_run` */5min, `_dp_warm_run` */12min — ALL confirmed armed, `hour="7-16"` ET) — top C2 (cross-database, same-volume) candidate; the writer-analysis agent independently ranked this #2 by code-characteristics alone, now upgraded from "if armed" to confirmed.
4. **patterns.db per-detection writers** — `_run_patterns_universe_scan` (01:00 ET, worst connection discipline found: one fresh connection + one full-fsync commit PER INDIVIDUAL DETECTION ROW, potentially hundreds-thousands per run) is off-hours and unlikely to overlap live scanner traffic, but `_run_patterns_track_outcomes` (every 4h, **NOT calendar-anchored — drifts with every redeploy/restart**) can land during market hours unpredictably and does TWO fresh-connection round trips per resolved detection. Neither patterns.db nor darkpool.db has a dedicated WAL checkpointer (bars.db got one specifically because unbounded WAL growth was already a measured problem there) — both rely on SQLite's default autocheckpoint, which can fire unpredictably mid-batch.
5. **`_s3_pull_loop`** (confirmed armed, 20-min cadence, unconditional, bars.db) — real but bursty (one large fsync-class commit per cycle, `synchronous` left at default FULL on this specific connection, unlike the rest of `bars_sqlite.py` which explicitly sets `synchronous=NORMAL`).
6. **`bars_nightly_refresh`→`bars-nightly` thread** (16:15 ET, right after close) — a genuine third "job body spawns an untracked thread" blind spot (same shape as `_s3_pull_loop`), full-universe bars.db rewrite, but timing (right after close) makes overlap with intraday scanner traffic unlikely; could matter for the *evening* tail of any post-close scanner usage.
7. **Four more bars.db-continuous loops started via a module's own `.start()`** (not a `threading.Thread(` literal in `main.py`, so invisible to ANY instrumentation keyed off main.py's literal thread call-sites too, not just `add_job`): `bars_wal_checkpointer` (20s), `bars_reconciliation` (30min, real DELETEs), `indicator_alert_evaluator` (60s, no env gate found — always on), `bars_continuous_audit` (tiered 5min/1h/24h). Lower priority (bars.db, not screener.db; but broadens the known blind-spot list beyond the original single `_s3_pull_loop` example).

### Scan/snapshot completeness contract (documentation only, separately-open reliability workstream — NOT this package's to fix)
- `_run_patterns_universe_scan` has no scan ID, no persisted progress, no completion flag; a killed run produces no log line at all, indistinguishable from "never fired."
- `screener_rows` has real, shipped, good staleness *description* (median-`snapshot_date` + `mixed` flag, computed from the exact same WHERE/FROM that produced the served rows) but **no publication gate** — a half-rebuilt table (nightly build commits in ≤200-row batches) is immediately visible to live HTTP readers mid-build, with nothing stopping `query.run_scan` from serving it as-is.
- `scan_evaluator._assert_snapshot_is_current` is a real completeness GATE, but it protects only the nightly scan-definition sweep's own written receipts — it does not gate what `query.run_scan` serves to a browser.
- `scan_store.prune()` (the `scan_hits`/`scan_coverage` reaper) has ZERO production callers — unbounded growth, a separate longer-horizon finding.

### Repo precedent catalog (for a possible future architecture — nothing started)
Best generation/version-metadata precedent: `api/services/barspack.py` (content-addressed generations, shards-uploaded-then-manifest-published-last, retention pruning) — a better structural fit than `brain_sync.py` (directory-swap + marker file + pre-swap integrity check + on-install callback, also cataloged) for "a versioned screener.db publication." A FOURTH existing Railway service role beyond web/worker/bars-api (`flow_worker_main.py`, narrowly-scoped, own volume, narrow GitHub watch-paths set in the Railway dashboard) is a direct precedent for "a fifth dedicated scanner-serving service" being a one-line dispatcher addition, not novel infrastructure. `/api/ready` readiness framework already has a registered `"scanner"` gate, and its own docstring records a real 2026-07-26 ~3-minute outage lesson: **never wire a warm-up gate into the Railway healthcheck itself** — any future "is my local snapshot copy ready" gate must be observability-only. Atomic tmp-then-`os.replace` publication is the house style (~55+ call sites); two internal proxy patterns exist (`flow_proxy.py` full-featured with auth-vouching+SSE, `bars.py`'s single-route lighter cousin with graceful local fallback); two durable-retry/idempotent-job patterns exist (`desk_session_jobs.py`'s claim-next+per-claim staleness, `flow_gap_autofill.py`'s heartbeat-sweep-at-start).

### What remains for the actual attribution report
No slow trace has fired yet (market closed since deploy). Tonight's
02:00-05:10 ET nightly writer block and — much more importantly given the
findings above — Monday's regular market session (specifically watching
for `screener_live_tier`/`screener_scan_sweep_live` overlap) are the two
remaining natural windows. Observation cadence continues unchanged,
tightening to ~20-30 min as each window approaches. No implementation, no
architecture decision, no pilot reactivation — all remain explicitly
deferred pending real evidence.

## Owner direction accepted; deployment boundary verified; live_tier writer model deepened offline (2026-09-05 ~20:20 ET)

**Deployment boundary.** The unrelated deploy that was BUILDING settled
(went through 2 more revisions in quick succession — other sessions
pushing concurrently — final tip observed `da91a07d0`). Verified clean
before treating anything as one continuous runtime: `railway status
--json` → `SUCCESS`; `/api/health` uptime reset (210s, fresh process);
`git diff` from the last-verified git tip (`9a47d8477`) to the new
`origin/master` tip scoped to the 4 instrumented files → empty (no
overlap); `railway logs` → 203 wrapped-job lines, zero "contention trace
instrumentation failed" lines. Instrumentation confirmed intact across the
transition. Pilot OFF/unset and `PATTERN_CANONICAL_ADAPT_ENABLED=1` are
unaffected by anything in this whole natural-load package (untouched files).

**`screener_live_tier`'s internal structure, read directly from
`api/services/screener/live_tier.py:786-935` (own code, not secondhand) —
this precisely answers the owner's Section 7/8 questions:**

`run_sweep()` (`t0` = cycle start) → session check (returns early,
`skipped_reason="not_regular_session"`, if not RTH — this is ALL that has
fired since deploy, confirmed live: `[screener-live] cycle skipped:
not_regular_session` at 00:18:03/00:19:03/00:20:03 UTC, exactly 60.0s
apart, zero drift) → `_ensure_schema()` (once per PROCESS only, explicitly
placed BEFORE the lock so it never inflates `held_lock_ms`) →
**`snapshot_builder._BUILD_LOCK.acquire(blocking=False)`** (non-blocking —
a busy lock means this cycle immediately gives up with
`skipped_reason="build_in_flight"`, it NEVER queues/waits; `lock_wait_ms`
is therefore always ~0 in practice, not a real wait metric) → inside the
lock, `_sweep_locked()` runs, in order: (1) `_read_anchor_rows()` — a
separate read-only connection; (2) `scan_volume.full_market_snapshot()` —
a 30s-cached in-memory read, not necessarily a fresh DB hit; (3) a pure-
Python pass computing `sanity_reason` per row (no DB); (4) an abort check;
(5) a second pure-Python pass calling `derive_row()` per matched row,
building `out_rows` (no DB); (6) **`snapshot_db.upsert_live_rows(out_rows)`
— the actual write: ONE `executemany` INSERT OR REPLACE covering the
WHOLE matched universe in a single call, then one `commit()`**; (7)
**`snapshot_db.prune_live_rows(ymd)` — a second, small, bounded DELETE +
commit.** The lock releases in a `finally` right after step 7.

**The critical, precise finding: `held_lock_ms` (measured median 122ms,
121-140ms range, per the code's own 2026-08-23 comment) covers ALL SEVEN
steps above — steps 1-5 (Python-only, no DB) plus steps 6-7 (the two
actual DB writes). The code does NOT separately time steps 6-7 from 1-5.**
This means: **the real SQLite write/commit duration is a currently-
unmeasured SUBSET of 122ms, not the whole 122ms** — the bulk of that
window is almost certainly the two O(n) Python passes over up to 3,745
rows (`sanity_reason`/`derive_row`), not the two SQL statements, but this
codebase does not itself distinguish them further. **Stating this
limitation explicitly, per instruction:** neither the existing receipt
fields nor the existing log line separate "Python compute time" from
"SQLite write time" within a cycle — only their ORDER (compute always
precedes both writes) and STRUCTURE (exactly 2 commits, always, never
chunked/batched differently) are knowable from code alone.

**Directly answers several of the owner's specific sub-questions:**
- *Whether one run can overlap the next:* No — `screener_live_tier` is
  registered with `max_instances=1` (confirmed, `main.py:1798-1801`), and
  122ms << the 60s interval, so overlap is structurally near-impossible
  absent a severe stall.
- *Whether writes are idempotent:* Yes — `INSERT OR REPLACE` both times.
- *Whether failures leave transactions open:* No — both writers use bare
  `with _WRITE_LOCK, connect() as conn: ...; conn.commit()` (no explicit
  `BEGIN`), so Python's own `with conn:` protocol rolls back automatically
  on any exception; nothing is left dangling.
- *Whether `_BUILD_LOCK` is what would cause reader contention:* **No —
  important distinction.** `_BUILD_LOCK` is a pure Python
  `threading.Lock()` that only serializes `screener_live_tier` against the
  (rare, 03:00-ET-only) nightly builder and admin refresh — `run_scan`
  (the READ path) never touches `_BUILD_LOCK` at all. If
  `screener_live_tier`'s writes DO slow down scanner reads, the mechanism
  would have to be pure SQLite/WAL-level (busy_timeout waits, checkpoint
  stalls, OS page-cache churn from the write) — not this Python lock. Do
  not conflate "held_lock_ms" with "time the reader could be blocked."

**Section 3/4 (real-cycle observation) is DEFERRED, honestly, until
Monday.** `screener_live_tier` is RTH-gated at the FIRST check inside
`run_sweep()` — every cycle since deploy has hit the early-return
`not_regular_session` path and done NONE of steps 1-7 above. Tonight's
02:00-05:10 ET nightly window will NOT include a single real
`screener_live_tier` execution (market stays closed) — this job's first
real, non-skipped cycle, and therefore the first chance to observe actual
overlap with scanner reads, is **Monday's regular session (~9:30 AM ET)**.
This is stated plainly rather than implied — the between-window analysis
above is the offline/code-level deepening the owner authorized in place of
that; it is not a substitute for it.

**Section 9 (other screener.db writers — same-model comparison) already
covered by the prior report's writer-trace findings, not repeated here**:
nightly builder (03:00 ET, ~20 chunked 200-row commits), scan-definition
sweep (05:00 ET, 2 small commits per definition), screen_alerts (05:10 ET,
2 connections per delivered alert, the one path NOT using `_WRITE_LOCK`),
live scan sweep (`screener_scan_sweep_live`, confirmed unconditionally
registered, explicit `BEGIN IMMEDIATE`/COMMIT per definition per cycle,
pre-computed values only inside the transaction). All preserved from the
prior section; cross-referenced, not re-derived.

C1-C6 remain fully open. No implementation, no fix, no schedule change, no
instrumentation change. Continuing natural observation toward tonight's
nightly window (other writers, cross-DB darkpool/patterns candidates) and
Monday's market open (the `screener_live_tier` correlation itself).

## Deployment boundary — another session edited the deployed diagnostic file; verified narrowly (2026-09-06 ~02:43 UTC / ~22:43 ET)

**Event.** A concurrent, unrelated session's work (an "E2E sandbox" test-
isolation initiative, `tools/e2e_sandbox_launcher.py`) pushed a commit that
touches `api/services/screener/contention_trace_temp.py` — the deployed
temporary diagnostic itself. Per standing instruction, this required a
narrow verification pass before treating the new deploy as a valid
continuation, rather than silently accepting or silently rebuilding.

**Deployment boundary, recorded:**
- Previous verified-clean deployment: `28100a6d-3423-4b7a-843c-182049ac4856` (01:54 UTC).
- New deployment: **`4be37e9a-a935-40b5-9b6e-2a79edd5f5d2`** — status **SUCCESS**.
- `/api/health`: fresh `uptime_seconds=168` — genuine process restart, new epoch.
- Samples from before `4be37e9a` and after it belong to different process
  epochs; not mixed without this label.

**Exact diff review (narrow — only this one file, not the sandbox
initiative broadly).** `git diff` confirms **exactly one hunk, 10
insertions/4 deletions, nothing else in the file touched**: only
`_WATCHED_DB_PATHS` changed, from hardcoded literals to
`os.environ.get(VARNAME, "<same literal>")` for all four entries
(`screener`→`SCREENER_DB_PATH` — the SAME variable `snapshot_db.py`
already reads elsewhere, not a new invention; `bars`/`patterns`/`darkpool`
→ new but file-scoped `CONTENTION_TRACE_*_DB_PATH` names). **Confirmed
unchanged**: `SLOW_THRESHOLD_MS`/`FAST_SAMPLE_MAX_MS`/
`FAST_SAMPLE_MIN_INTERVAL_S`, the `stage`/`reset_stages`/`pop_stages`
contextvar mechanism, `instrument_scheduler` (the active-job tracking),
`_active_jobs_snapshot`, `_process_context`, `record()`'s log format/
fields, cleanup/thread-safety behavior — none of these were touched.

**Production effective configuration (targeted name/presence checks only,
no value dump).** `SCREENER_DB_PATH`, `CONTENTION_TRACE_BARS_DB_PATH`,
`CONTENTION_TRACE_PATTERNS_DB_PATH`, `CONTENTION_TRACE_DARKPOOL_DB_PATH` —
**zero matches, all four unset in production.** Effective runtime paths
therefore remain the original `/data/screener.db`, `/data/bars.db`,
`/data/patterns.db`, `/data/darkpool.db` — byte-identical to before this
commit. Which database/device is being observed has NOT changed.

**Diagnostic function verified post-deploy.** No "contention trace
instrumentation failed" line, no traceback/exception. 28 wrapped-job log
lines present (scheduler instrumentation active). `[screener-live]` still
ticking its expected ~60s skip cycles. `PATTERN_CANONICAL_ADAPT_ENABLED=1`
confirmed; `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` absent from the
targeted grep (pilot OFF/unset, as required) — both name-presence checks
only, no value dump beyond these two already-known-safe flags.

**Unrelated `api/main.py` change in the same window** (a gzip-exemption
for a Notebook "Ask Current Note" streaming route) — does not touch
`/api/screener/scan`, global middleware behavior relevant to scanner
timing, scheduler startup, or the diagnostic. Recorded simply as:
**UNRELATED DEPLOYED CHANGE / PROCESS BOUNDARY.** Not investigated
further (out of scope per instruction).

**Classification: DEPLOYMENT BOUNDARY VERIFIED — DIAGNOSTIC BEHAVIOR
UNCHANGED.** All conditions met: path overrides unset/resolve to the
original files; original fallbacks intact; timing/job/WAL instrumentation
unchanged; diagnostic initializes and runs correctly; scanner behavior
unaffected; pilot OFF; adapt ON. The new process epoch (`4be37e9a`
onward) is a valid continuation of the experiment. No redeploy performed
to "undo" this benign configurability addition — not needed, and doing so
would itself be an unauthorized production change. Resuming natural-load
observation from this epoch forward.

## patterns_universe_scan confirmed running long, natural cross-DB writer window (2026-09-06 ~01:20 ET)

**Confirmed via live production logs (`railway logs --service web -d`),
not inferred.** The scheduler line
`Running job "instrument_scheduler.<locals>.add_job.<locals>.wrapped
(trigger: cron[hour='1', minute='0'], next run at: 2026-09-07 01:00:00
EDT)" (scheduled at 2026-09-06 01:00:00-04:00)` — this trigger signature
matches `patterns_universe_scan` uniquely (the only `hour='1', minute='0'`
cron job) — confirms it started exactly on schedule at 01:00:00 ET. Across
the following ~1,500 log lines (through ~01:20 ET), **no matching
`"executed successfully"`/exception line and no `[patterns] universe_scan:
scanned...` completion print appear for it** — every OTHER job in the same
window shows its submit+complete pair within seconds. **This job is very
likely still actively running 20+ minutes after starting.** Consistent
with the earlier code-trace finding (one fresh SQLite connection + one
full-fsync-class commit PER INDIVIDUAL DETECTION ROW, potentially hundreds
to thousands of times per run) — this is real, natural, in-progress
evidence of exactly the "long-running scan" behavior previously only
inferred from static code reading.

**Natural scanner traffic remained zero throughout** — no `/api/screener/
scan` hits all night. Attempted to determine whether a single, previously-
authorized bounded PEG-family test request could be sent to correlate
against this confirmed-active writer window; found no ready, safe,
already-established authenticated path to the endpoint in this session
(the sandbox itself blocked even a read-only search for a stored session/
credential file — correctly, since constructing one would cross the
explicit credential-handling boundary). Did not attempt a workaround.
Surfaced this to the owner directly rather than improvising; asked whether
they could fire one request themselves from an already-logged-in session
while this writer window is active.

No `[contention-trace]` SLOW/fast-control sample exists for this window
regardless (no scanner request occurred at all to produce one). This is
recorded as a genuine natural-load window with a confirmed-active
cross-database writer candidate and NO scanner-correlation sample — an
honest gap, not filled artificially. C1-C6 remain open. `screener_
snapshot_nightly` (03:00 ET), `screener_scan_sweep`/`screener_screen_
alerts` (~05:00/05:10 ET) still ahead tonight.

## patterns_universe_scan very likely interrupted by an unrelated redeploy — live, naturally-occurring instance of the separately-tracked issue (2026-09-06 ~01:20-01:25 ET)

**Precise timeline, from real production data (Railway deployment metadata
+ logs), not inferred:**
- `patterns_universe_scan` submitted at **01:00:00.008 ET** (confirmed
  scheduler log line, unique trigger signature `cron[hour='1',
  minute='0']`).
- A new deployment (`a3b3e9af-fcd7-44d4-b93b-cd9be035da61`, an unrelated
  notebook-platform merge, confirmed no file overlap with the
  instrumented files) has `createdAt: 2026-09-06T05:00:59.754Z` =
  **01:00:59.754 ET — ~60 seconds after the scan started.**
- The NEW process's own **"Application startup complete" line reads
  `2026-09-06 05:04:21,254` UTC = 01:04:21.254 ET — only ~4 minutes 21
  seconds after the scan started.**
- No `[patterns] universe_scan: scanned...` completion line, and no
  APScheduler "executed successfully"/exception line for this job, exists
  anywhere in either the pre-restart or post-restart log windows queried.

**Reading, stated at the right confidence level.** This is NOT proof (the
exact instant the OLD process was killed vs. this new one started serving
isn't separately confirmed), but it is strong, precise, naturally-occurring
circumstantial evidence: given the per-detection-row commit pattern
already traced (fresh connection + fsync-class commit per stored
detection, across up to ~3,742 tickers × up to ~50 detectors), a run
finishing an entire universe pass in under ~4.5 minutes would be
surprising — far more consistent with the run having been killed mid-scan
by this (or one of the several other closely-spaced) redeploys landing
that night. Per the completeness-contract finding already on record, a
killed run produces **no log line at all** — indistinguishable from
"never fired" except by this kind of before/after timestamp
triangulation, which is exactly what this entry preserves.

**This is a live, naturally-occurring instance of the separately-tracked,
NOT-this-package issue: "long-running pattern scans can be terminated by
unrelated web-service redeploys."** Recorded as fresh, dated, concrete
evidence for that already-open reliability item — not something being
fixed now, and not conflated with the screener-contention question this
package exists to answer (this job does not touch screener.db at all —
confirmed earlier: it reads bars.db, writes only patterns.db — so even if
proven interrupted, this specific event speaks to the redeploy/
completeness issue, not to C1).

**Owner's standing direction on the bounded scanner-request fallback,
noted and respected**: no natural `/api/screener/scan` traffic occurred
during this writer's active window, and no owner-initiated request has
been reported yet either. No credential search or workaround attempted
(already correctly blocked once, not retried). Continuing to watch for
either an owner-supplied sample or the remaining nightly writers
(`screener_snapshot_nightly` 03:00 ET, `screener_scan_sweep`/`screener_
screen_alerts` ~05:00/05:10 ET) as the next natural evidence opportunities.

**Owner-accepted formulation and final classification for this incident:**

**STRONG NATURAL CIRCUMSTANTIAL EVIDENCE — LONG-RUNNING SCAN / REDEPLOY
INTERRUPTION.** Explicitly NOT stated as definite (the exact old-process
termination/cutover instant is not separately confirmed, only
triangulated from the new process's own startup timestamp) — "strongly
consistent with," not "proven." Kept explicitly separate from C1-C6
scanner-latency attribution (this job never touches screener.db).

**Preserved facts, per owner's exact list:**
- Scan trigger timestamp: **~01:00:00.008 ET**, 2026-09-06 (confirmed
  scheduler log line, unique `cron[hour='1', minute='0']` signature).
- Deployment build-created timestamp: **~01:00:59.754 ET** (Railway
  deployment `a3b3e9af-fcd7-44d4-b93b-cd9be035da61`,
  `createdAt: 2026-09-06T05:00:59.754Z`).
- Eventual cutover/restart evidence available: the NEW process's own
  `"Application startup complete"` line at **01:04:21.254 ET** — the best
  available lower-bound marker that the old process was gone by this
  instant; no more precise old-process-death timestamp is available from
  what's been queried.
- Absence of completion line: confirmed — no `[patterns] universe_scan:
  scanned...` print and no APScheduler "executed successfully"/exception
  line for this job in any log window queried, before or after the
  restart.
- Whether any retry/resume occurred: **No** — the job's own trigger log
  line reads `next run at: 2026-09-07 01:00:00 EDT`, i.e. the standard
  daily cron re-fire tomorrow; there is no separate resume/retry
  mechanism (confirmed absent by the earlier scan/snapshot completeness
  agent's static-code review — no scan ID, no persisted progress).
- Whether partial progress/completeness state exists: **Yes, by
  construction, but with no metadata marking it as partial.**
  `memory.store_detection`'s `INSERT ... ON CONFLICT DO UPDATE` commits
  per-detection, so whatever detections were computed and written before
  interruption are durably saved in `patterns.db` — but nothing records
  "this was a partial universe pass"; those rows are indistinguishable at
  the data level from a fully-completed run's rows. Symbols not yet
  reached when the process died simply keep whatever `detected_at`/
  `last_seen_at` they already had from a prior successful run (or remain
  absent if never previously detected).
- Whether a later run replaced or obscured the interrupted state: **Not
  today.** The next `patterns_universe_scan` fire is tomorrow (2026-09-07
  01:00 ET) per its own cron log line. Two OTHER, narrower jobs also write
  to `patterns.db` via the same `store_detection` path on their own
  independent cadences (`patterns_leaders_scan`, hourly, ~84-ticker leader
  set; `patterns_track_outcomes`, every 4h, not calendar-anchored) — these
  could add incremental leader-scoped updates today, but would not
  specifically "obscure" or repair the interrupted full-universe pass;
  that requires tomorrow's scheduled re-fire.

Nothing was triggered to reproduce or investigate this further. Continuing
the existing observation plan unchanged — next meaningful natural window
is `screener_snapshot_nightly` (03:00 ET). No new implementation, no
diagnostic changes, no pilot activation, no 8G-C.

## screener_snapshot_nightly IN PROGRESS, real production evidence captured live (2026-09-06, 03:00-03:08+ ET)

**Tooling note:** tonight's log volume is unusually heavy (a yfinance-404
spam burst from the earlier `earnings_dates` pull), which made raw
`railway logs -d --lines N` unable to reach recent timestamps even at
N=5000-10000 (the latter errors as "Invalid input" — apparently a hard
cap between 5000 and 10000). Switched to `railway logs --service web -d
--since Nm [--filter "TEXT"]`, which resolved it. Also cross-checked wall
clock directly via `date -u` after briefly self-confusing on this once —
log-tail timestamps during a noisy burst are not a reliable proxy for
current time; `date -u` is.

**Confirmed: THREE separate APScheduler jobs share the exact
`cron[hour='3', minute='0']` trigger** (not just
`screener_snapshot_nightly` — at minimum `session_cleanup` and
`tweet_cleanup_daily` also registered at this same hour/minute per the
earlier job inventory). All three "Running job" submissions appear at
`07:00:00,01x` UTC (03:00:00 ET); **only 2 of the 3 "executed successfully"
lines appear** as of this check (07:08 UTC / 03:08 ET) — consistent with
the two lightweight ones (`session_cleanup`, `tweet_cleanup_daily`)
finishing near-instantly while the heavy one (`screener_snapshot_nightly`
→ `snapshot_builder.run_build`) is still running.

**Real, in-progress evidence from `snapshot_builder`'s own log lines
(not inferred, not from static code reading):**
- `03:00:01.939 ET` — `"[screener] 4 row(s) outside the universe queued
  for rebuild: ACA, APGE, CRNX, NUVL"`
- `03:00:01.942 ET` — `WARNING ... "[screener] rs_ranking cache cold at
  build time — computing on cold (nightly-build path only, see
  _read_rs_map docstring)"` — an explicitly-flagged, atypical/degraded
  condition for tonight's specific run (the RS cache being cold at
  build time is called out by the code itself as a slower path).
- `03:00:26.008 ET` — `"[screener] rs_map source=computed-on-cold
  n=3637"` — confirms the cold RS-map computation alone took **~24
  seconds** (03:00:01.942 to 03:00:26.008).
- **No `"[screener] build done built=... skipped=... errors=..."`
  completion line has appeared as of 03:08 ET — i.e. at least ~8 minutes
  elapsed since start, well past the ~24s RS-map step**, with no further
  `snapshot_builder` progress lines in between (the per-200-row-batch
  upserts don't have their own log line per the earlier writer-trace,
  only the final summary does — so a long gap here is expected/
  unsurprising, not itself anomalous, unlike patterns_universe_scan's
  total silence).

**No redeploy has landed during this specific window** (git tip and
Railway deployment id both unchanged across every check spanning this
build) — so unlike `patterns_universe_scan` earlier tonight, THIS run has
NOT (yet) been interrupted by a process restart. If it eventually produces
a completion line, that will be directly attributable to actual build
duration, not survivorship past an interruption. Still watching for it.

**Scanner-correlation sample: still none.** Zero natural `/api/screener/
scan` traffic all night; no owner-initiated request reported yet. This
remains the single most direct, currently-active writer window observed
so far (screener.db, not a cross-database candidate) — genuinely the
best opportunity for a C1 test if a scanner request occurs while it's
still running. Continuing to watch closely for either the build's
completion or an owner-supplied sample.

**Update, 03:20 ET — still running, ~20 minutes elapsed, still no
redeploy.** New data point: `03:15:03.868 ET` — `ERROR ...
snapshot_builder: "[screener] share_band__inst_pct fired on more than 200
rows — NOT withholding further; this is an upstream change, not 201 bad
rows"`. Read at face value from the message itself: this is a self-aware,
designed data-quality guard (not a crash) that fires when a specific
withholding condition trips on more than its expected threshold, and
explicitly logs at ERROR for visibility while continuing rather than
halting. Its presence confirms the build was still actively executing at
03:15 ET. **No `"[screener] build done..."` completion line has appeared
by 03:20 ET (~20 minutes elapsed since 03:00:01 start).** Git tip and
Railway deployment id both still unchanged — confirmed no redeploy has
interrupted this run. `railway logs ... --filter "contention"` over the
same 25-minute window returns nothing — confirmed no scanner traffic and
no contention-trace sample (expected, since `record()` only ever fires in
response to an actual request). Continuing to watch.

**COMPLETED — real, precise, natural runtime measurement, no
interruption.** `03:20:39.069 ET` — `[screener] build done built=3745
skipped=1 errors=0 rs_map=3637 bulk_map=3743
empty_columns=implied_move_pct`. **Total runtime: 03:00:01.939 →
03:20:39.069 ET = 20 minutes 37.1 seconds.** Git tip and Railway
deployment id confirmed unchanged across the ENTIRE window — this run was
NOT interrupted; its ~20.6-minute duration is real, natural runtime (very
likely elongated by the cold-RS-cache path flagged at the start, per the
builder's own warning). Immediately followed by two WARNING-level summary
lines (reader failures: `rs_ranking.no_rank=281`, `ticker_meta.none=40`,
`massive_market_cap.none=141`, `fmp_bulk.no_row=2`; identity refusals: a
detailed per-rule withheld-row breakdown, largest being
`share_band__inst_pct` at 200 withheld/624 rows flagged systemic — matches
the 03:15:03 ET ERROR line exactly, confirming that was this same rule
firing, not a separate incident).

**Scanner-correlation result for this entire ~20.6-minute confirmed
writer-active window: zero.** No natural `/api/screener/scan` traffic and
no owner-initiated request occurred at any point during the single
longest, most-confirmed screener.db writer-active period observed all
night. This is an honest, disappointing-but-real gap — not filled
artificially. The nightly writer window (`screener_scan_sweep` ~05:00 ET,
`screener_screen_alerts` ~05:10 ET) and Monday's market open
(`screener_live_tier`) remain the next opportunities.

## screener_scan_sweep completed cleanly — real, fast natural runtime (2026-09-06 05:00-05:01 ET)

**Real, complete evidence, no interruption.** `[scan] sweep done
as_of=20260904 handed=4 distinct=4 swept=4 refused=0 duplicate=0
unswept=0 stopped_early=False hits=1278 recorded=9 elapsed=54.2s
deadline=2026-09-06T09:00:00-04:00` at `09:00:54.239 UTC = 05:00:54.239
ET` — fired at 05:00:00 ET (per the log's own `deadline` field), **total
elapsed 54.2 seconds** (self-reported, matches the timestamp math).
Immediately followed by `"[scan] sweep receipts read back: 4 of 4
definitions carry a scan_coverage row for as_of=20260904"` — a clean,
fully-successful, self-verified run. Git tip and deployment id confirmed
unchanged throughout — no interruption. Much shorter than the ~20.6-minute
snapshot builder (expected — per-definition small commits vs. a full
~3,745-ticker rebuild).

**Scanner-correlation result: zero, again.** `railway logs --filter
"contention"` over the same window returns nothing — no natural or
owner-initiated scanner request occurred during this writer's active
second either. `screener_screen_alerts` (~05:10 ET) is next, imminent.

## screener_screen_alerts completed cleanly — trivial, real result (2026-09-06 05:10 ET)

**Real, complete evidence.** `2026-09-06 09:10:00,012 INFO
api.services.screener.screen_alerts: [screen-alerts]
{'definitions': 0, 'compared': 0, 'no_previous': 0, 'sent': 0,
'skipped_dedup': 0, 'skipped_quota': 0, 'skipped_quiet': 0, 'errors': 0}`
at `09:10:00.012 UTC = 05:10:00.012 ET` — fired exactly on schedule.
`definitions: 0` means there was nothing to compare/alert on tonight (no
active alert-eligible definitions with a prior snapshot to diff against);
`errors: 0` confirms a clean, non-degenerate run rather than a silent
failure. Effectively instantaneous (0 work performed). Git tip and
deployment id confirmed unchanged through this check — no interruption.

**Scanner-correlation result: zero, again.** No natural or owner-initiated
scanner traffic during this writer's active moment either.

## Tonight's full nightly writer window (02:00–05:10 ET) — CLOSED OUT, zero scanner-correlation samples

All four confirmed nightly screener.db-adjacent writers have now been
observed for their full active window tonight, with real, natural evidence
for each — never manufactured, never accelerated:

| Writer | Window | Result | Scanner correlation |
|---|---|---|---|
| `patterns_universe_scan` | ~01:00 ET | STRONG NATURAL CIRCUMSTANTIAL EVIDENCE — long-running scan / redeploy interruption (not screener.db, separately tracked) | n/a |
| `screener_snapshot_nightly` | 03:00:01.939–03:20:39.069 ET | Completed cleanly, 20m37.1s, no interruption | Zero |
| `screener_scan_sweep` | 05:00:00–05:00:54.239 ET | Completed cleanly, 54.2s, no interruption | Zero |
| `screener_screen_alerts` | 05:10:00.012 ET | Completed cleanly, trivial (0 definitions), no interruption | Zero |

**Honest conclusion for this window: no scanner-traffic sample was
captured against any confirmed screener.db writer tonight.** This is not a
failure of the diagnostic — `record()` fired correctly (verified via the
fast-control fallback path and via the diagnostic's own tests) and would
have logged a `SLOW` sample immediately had a ≥300ms `/api/screener/scan`
request occurred during any of these four windows. It simply never did —
zero natural traffic and no owner-supplied sample was reported during the
entire 02:00–05:10 ET window. Per owner direction, this gap is recorded
plainly rather than papered over or filled artificially.

**Plan shift: relaxed cadence toward Monday's market open.** The market is
closed all weekend, so `screener_live_tier` (the strongest same-file writer
candidate — runs every 60s, RTH-gated, real overlay writes) cannot produce
its first genuine non-skipped cycle until Monday. No other nightly writer
fires again before then. Continuing the observation loop at a relaxed
30–60 minute cadence until Monday's open, watching for: (a) any natural
scanner traffic overlapping any writer's active window (including a
possible owner-supplied UI sample, to be labeled "NATURAL WRITER + BOUNDED
OWNER SCANNER SAMPLE" if reported), (b) the diagnostic file for any further
concurrent-session edits (narrow-verify only, per the established
protocol), and (c) deployment/health for any material change. If Monday's
session also passes without a usable slow-trace sample, the final report
will honestly classify this as **C6 — CONTENTION ATTRIBUTION STILL
INSUFFICIENT** rather than force a classification the evidence doesn't
support.

## OWNER SCHEDULE CORRECTION — Monday 2026-09-07 is Labor Day, market CLOSED — primary `screener_live_tier` window re-targeted to TUESDAY 2026-09-08

**Owner-issued correction, confirmed independently beforehand via actual
`date -u` day-of-week arithmetic (not memory):** Monday, September 7, 2026
is Labor Day. U.S. equity markets are closed. Consequently:

- `screener_live_tier` will NOT run a genuine RTH cycle on Monday — it is
  gated on session state and simply stays in its skip branch all day, as
  designed.
- **Monday's absence of a `screener_live_tier` cycle is NOT evidence
  against C1** (or any other hypothesis) — it is the correct, expected
  behavior of the RTH gate on a market holiday, not a data point.
- No manual trigger or RTH-gate bypass is authorized to force a cycle on
  Monday. None was attempted.
- **The first genuine next market-hours `screener_live_tier` observation
  window is TUESDAY, SEPTEMBER 8, 2026 — NORMAL MARKET HOURS.** This is
  now the primary remaining target for a scanner-traffic correlation
  sample.

**Tonight's completed 02:00–05:10 ET nightly writer window stands exactly
as recorded above** — four confirmed natural writers, all completed
cleanly, zero scanner-traffic correlation samples, no redeploy during any
final check. Nothing in this correction revises that record.

**Monday is being treated as a holiday/control day** — natural
scheduled/background jobs (if any fire on a market holiday) are still
worth observing passively, but no `screener_live_tier` RTH-gated activity
is expected and none should be manufactured or forced.

**Diagnostic preservation through Tuesday, per explicit owner direction:**
the current instrumentation (`contention_trace_temp.py` + its 3 wiring
call sites + its test file) stays live and untouched through Tuesday's
session unless one of exactly three conditions occurs: (1) it causes a
genuine production problem, (2) an unrelated deployment removes it
incidentally, or (3) sufficient evidence from another writer resolves the
C1–C6 question before Tuesday. None of these has occurred.

**Standing constraints reaffirmed, unchanged:** no implementation changes,
no manufactured traffic, no credential search/construction, `PATTERN_
CANONICAL_SCANNER_PILOT_ENABLED` remains OFF/unset, 8G-C remains HOLD.

## Parallel package authorized + delivered — SCAN COMPLETENESS / REDEPLOY RELIABILITY (2026-09-06, isolated worktree, NOT merged/pushed/deployed)

Owner authorized progressing the broader scanner program IN PARALLEL with
this package's natural-load observation, explicitly on the condition that
it never contaminates the live 8G-B experiment. Delivered as a **separate,
narrow, additive implementation on an isolated worktree/branch**
(`C:\Users\Patrick\uct-dashboard-scan-completeness`, branch
`feat/scan-completeness-redeploy-reliability`, off `origin/master@0fb917a9b`
— NOT `phase3c`, NOT `uct-dashboard-8gb-conn-lifecycle`).

**Dependency review (summary):** re-read `docs/uct-scanner-intelligence/
phase7_canonical_architecture_spec.md` + `decision-log.md` — a SEPARATE
track (pattern-engine canonical-model/visual-explainability, its own
Stage A–F migration sequence + 9-item Section-34 work package list) from
this checkpoint's own 8G-A/B/C track. The "long-running scanner jobs can
be killed by unrelated redeploys" issue is explicitly tracked in this
checkpoint (repeated across the 8G-A/8G-B sections above) as a real,
separate, UNNAMED-until-now future workstream — never patched inside
8G-B. It was the clear highest-value unblocked parallel package: fully
independent of 8G-B's canonical-pilot/contention-diagnostic surface,
requires no production deploy to deliver a reviewable local
implementation, and directly answers a question this program's own
`patterns_universe_scan` redeploy-interruption finding (STRONG NATURAL
CIRCUMSTANTIAL EVIDENCE, recorded earlier this file) raised but could not
close.

**Grounded code trace (read-only, before implementing):** confirmed
`_run_patterns_universe_scan`/`_scan_patterns_daily` (`api/main.py`) have
NO scan-id/generation concept and no persisted progress — each
detection is its own atomic `sqlite3.connect()`→commit→close
(`memory.store_detection`, hash-key upsert, genuinely safe against
mid-run interruption) but nothing records whether last night's FULL
universe pass ever reached the end. `screener_snapshot_nightly`
(`snapshot_builder.run_build`) has the identical gap — its "build done"
line is `log.info` only, never persisted. The ONE existing precedent that
already solves this correctly: `scan_evaluator.py`'s `scan_coverage`
receipt — no row for a definition's `as_of` = it was not swept, "checked
between units, never inside a unit's own loop," derived (not
cursor-tracked) tail-fairness. `desk_session_jobs.py` was also read as a
precedent (durable SQLite job queue, `claim_next`/stale-reclaim) but its
per-item-retry shape fits a webhook-driven queue, not a single scheduled
full-universe sweep — the scan_coverage idiom is the closer match and
was the one actually reused.

**Design + implementation delivered:** new additive table
`pattern_scan_runs` (patterns.db, `CREATE TABLE IF NOT EXISTS`, zero
migration risk — no ALTER on the 4 existing tables) keyed
`(job_id, as_of)`; `memory.start_scan_run`/`complete_scan_run`/
`fail_scan_run`/`latest_scan_run`. `completed_at` staying NULL is the
ONLY signal that a run did not finish — deliberately true for BOTH a
silent kill (redeploy/OOM/crash, no call ever reaches it) and a caught,
logged failure (`fail_scan_run` records `error` but does not mark
completion), the two states distinguished only by whether `error` is
set, never collapsed into one status column. Wired into
`_run_patterns_universe_scan` only (the job with real natural
redeploy-interruption evidence) — `screener_snapshot_nightly` and any
other long-running job are NOT touched this pass (same mechanism,
explicit future work if warranted). Every new call site is individually
wrapped in non-fatal try/except so a bug in this bookkeeping can never
break the actual scan; zero scheduler/timing change; zero change to any
serving path (`pattern_join.py`, `get_active_detections`, and every
existing consumer of `pattern_detections` untouched).

**Evidence hierarchy, precise:** implemented + 8 new tests written
(`tests/pattern_engine/test_scan_runs.py`) + full
`tests/pattern_engine/` suite run (2623 passed, 9 pre-existing xfails,
unrelated) + the 3 directly-adjacent scheduler/import tests (22 passed,
confirms `api.main` still imports/schedules cleanly) + committed
**locally on the isolated branch only** (`38437b9b4`). **NOT** merged to
master, **NOT** pushed, **NOT** deployed, **NOT** yet reviewed by the
owner. No production schema change, no Railway config/variable change,
no scheduler timing change has occurred anywhere. Confirmed via `git
status` immediately after: both `phase3c` (this observation loop's own
worktree) and `uct-dashboard-8gb-conn-lifecycle` (the live diagnostic's
worktree) remain completely clean — zero cross-contamination from this
parallel work.

**Forbidden/unchanged throughout, per owner boundaries:** no push to
master, no deploy, no live-diagnostic change, no Railway topology/
scheduler-timing change, no manufactured traffic, no canonical-pilot
reactivation, no 8G-C implementation/activation, no PatternOverlay
exposure, no remaining-family mass-conversion, no 500ms-gate change. The
natural-load observation loop (this file's own primary subject) was
never paused or delayed to do this work and continues at its own
cadence toward Tuesday 2026-09-08.

## SCAN-COMPLETENESS PACKAGE — TECHNICALLY APPROVED, MERGE/DEPLOY HOLD (2026-09-06)

**Owner classification: LOCAL PACKAGE REVIEW PASSED — OWNER TECHNICAL
APPROVAL GRANTED.** The independent review (previous section) was
accepted in full, including its one applied fix. **Merge/push/deploy is
explicitly withheld** — reason given: pushing to master would trigger a
Railway redeploy/process replacement, contaminating the protected 8G-B
natural-load observation window. The package is frozen, not abandoned.

**Frozen state, verified at freeze time:**
- Worktree: `C:\Users\Patrick\uct-dashboard-scan-completeness`
- Branch: `feat/scan-completeness-redeploy-reliability`
- HEAD: `baf541526` (two commits: `38437b9b4` original implementation,
  `baf541526` the review's `latest_complete_scan_run` correction)
- `git status`: clean.
- Merge-base with `origin/master`: `0fb917a9b` (the tip this branch was
  cut from). `origin/master` has since advanced to `cbe687024` (8 commits
  ahead of the merge-base) — **verified via `git diff --stat` that NONE
  of those 8 commits touch `api/main.py`, `api/services/pattern_engine/`,
  or `tests/pattern_engine/`** (all 8 are docs/continuity-checkpoint
  commits plus one unrelated `ATTENTION SOURCE-INTEGRITY HARDENING V1`
  fix, plus the Notebook Wave-4/Stage-A-gate docs from the earlier
  misdirected-message episode — now confirmed real and merged as
  docs-only). The branch's diff against current `origin/master` is still
  clean/conflict-free as of this check; **re-verify at merge time, don't
  trust this snapshot indefinitely** (owner's own instruction, Section
  12 of the review request).

**Accepted design, permanent unless superseded:** `pattern_scan_runs`
additive table; `start_scan_run`/`complete_scan_run`/`fail_scan_run`;
`latest_scan_run()` = latest ATTEMPT (regardless of completion);
`latest_complete_scan_run()` = latest KNOWN-COMPLETE run, never shadowed
by a newer unfinished attempt. Hard-process-death (SIGKILL/redeploy mid-
scan) truthfully leaves `completed_at=NULL, error=NULL` — no synthetic
FAIL transition is added for this case, by owner directive, since a dead
process cannot truthfully execute one. Wired only into
`patterns_universe_scan`; no scheduler, serving-path, or detector change.

**Accepted-as-final gaps (do NOT close without a concrete new
requirement):** no persisted STALE state/threshold/reclaim/watchdog/
alerting (a consumer computes `now - started_at` itself if ever needed);
no attempt UUID/counter/multi-attempt history/distributed locking (identity
stays `PRIMARY KEY (job_id, as_of)`; normal-path overlap is already
prevented by `max_instances=1`, confirmed still present and unchanged;
the manual-trigger-vs-cron race is named, accepted, not fixed); no
deployment SHA/hostname/container ID/`failed_at`/retry-count/checkpoint-
cursor field.

**Test evidence (frozen, from the review — do not rerun merely to
recreate it while on hold):** `tests/pattern_engine/test_scan_runs.py`
11 passed. `tests/pattern_engine/` 2627 passed, 9 pre-existing xfails
(unrelated). Scheduler/import-adjacent (`test_patterns_intraday_scan.py`
+ `test_no_pattern_detector_raises.py` + `test_schedulers.py`) 22 passed.

**Release condition (exactly one of):** (A) the active 8G-B natural-load
observation formally closes and its temporary diagnostic is removed/
cleaned up; (B) a separately-authorized deployment already requires a
Railway push for another reason and the owner explicitly authorizes
bundling this package into it; (C) the owner explicitly overrides the
hold. **None of these has occurred.** Until then: no merge, no push, no
deploy. Before an eventual merge: re-check `origin/master`, this
branch's HEAD, `git status`, the merge-base, and specifically whether
`memory.py`/`api/main.py`/the pattern-scan tests/`pattern_db.py`
schema-init changed on master in the interim — do not assume today's
clean diff stays clean. Merge scope at that time is the approved package
only — no opportunistic resume/checkpoint work, no scheduler relocation,
no worker service, no serving-path use of `latest_complete_scan_run`, no
alerting/stale policy, no canonical/detector changes. A real future
interruption may validate the unfinished-run state naturally — do not
manufacture a deployment kill solely to prove it.

**Do not continue coding on this package while it waits** — frozen at
`baf541526` until the release condition above is met.

## PEG GEOMETRY FIX — TECHNICALLY APPROVED, MERGE/DEPLOY HOLD (2026-09-06)

**Owner classification: PEG GEOMETRY DEFECT CONFIRMED AND FIXED LOCALLY —
OWNER TECHNICAL APPROVAL GRANTED.** Same hold reason and structure as the
scan-completeness package above: the active 8G-B natural-load
observation is protected, and any push would create a deployment/
process boundary risking contamination of that evidence window.

**Frozen state:** worktree `C:\Users\Patrick\uct-dashboard-peg-geometry`,
branch `fix/peg-geometry-anchor-timestamps`, HEAD `40c8e578f`. `git
status`: clean. Off `origin/master@5e3ff91d1` at branch time.

**Accepted defect + fix, permanent unless superseded:**
`power_earnings_gap.py::_build_detection` stamped the `post_gap_high`/
`post_gap_low` geometry anchors with `last_bar["t"]` unconditionally
instead of the real bar each extreme occurred on — detector-authored
geometry, confirmed NOT canonical-adapter/persistence/frontend/
timezone/event-identity/emphasis-mapping. `gap_open`/`gap_close`
anchors (what the white-outline gap-candle emphasis, Package 8D,
actually keys off) were always correct and remain untouched. Fix:
compute `post_gap_high_idx` in `_try_extract` (mirrors the existing
`post_gap_low_idx` pattern), use both real indices in
`_build_detection`'s anchor construction. 27 insertions/3 deletions,
one production file + 2 new test files, nothing else.

**Test evidence (frozen — do not rerun merely to recreate it while on
hold):** 5/5 new focused tests, 20/20 existing PEG battery, 86/86
canonical adapter suite, `tests/pattern_engine/` full: 2621 passed, 9
pre-existing xfails (unrelated). Re-run relevant regression only before
eventual merge if master has materially moved.

**Reinforced separation, now evidence-backed:** the geometry fix was
fully implementable and testable without touching persistence or
serving — confirms `pattern_join.py`'s canonical persistence/serving
gap is correctly a SEPARATE package, not something that needed
bundling here. `ChartToolbar.jsx`'s pattern-overlay toggle remains
confirmed genuinely dead/unreachable (`{false && ...}`) and untouched;
for a future 8G-C admin proof, that toggle is not admin-role-aware and
a different, explicitly admin-gated entry point would be needed for the
narrow proof step specifically — the general toggle's own eventual
public-exposure sequencing (Phase-7 §37) is unaffected and unstarted.

**8G-C remains HOLD overall** — the PEG geometry defect closing does
NOT make 8G-C ready. Remaining blockers, unchanged: (1)
`pattern_join.py` canonical persistence/serving gap (now the next
targeted package, research-first per owner direction), (2) broader
Package-8C round-trip parity coverage gap (only this narrow anchor fix
has one today), (3) no admin-only render surface yet, (4) the dead
general PatternOverlay toggle stays intentionally unavailable.

**Release condition, identical structure to the scan-completeness
package:** (A) 8G-B observation formally closes + diagnostic
removed/cleaned, or (B) a separately-authorized deployment already
requires a push and the owner explicitly authorizes bundling this in,
or (C) explicit owner override. **None has occurred.** No merge, no
push, no deploy. Merge scope at release time is this package only — no
opportunistic pattern_join.py work folded in, no UI exposure, no
canonical/detector changes beyond this one fix.

**Next parallel package, owner-authorized, research-first:**
`pattern_join.py` canonical persistence/serving gap for 8G-C. Per
owner direction, a narrow source-grounded review (what canonical
fields are omitted, what's currently selected, which Package-8C
persisted fields aren't reconstructed, PEG-vs-HTF differences, which
layer the fix belongs in, ordinary-user impact, admin/internal-only
scoping, missing round-trip tests) must complete BEFORE any
implementation, on a NEW isolated worktree — never touching the frozen
scan-completeness or PEG-geometry branches. 8G-B observation remains
top priority throughout; pause this work immediately if meaningful
production evidence arrives, capture/classify it first, then resume.

## PATTERN_JOIN.PY CANONICAL PERSISTENCE/SERVING GAP — RESEARCH COMPLETE, NO CODE GAP FOUND (2026-09-06)

Worktree `C:\Users\Patrick\uct-dashboard-pattern-join`, branch
`fix/pattern-join-canonical-persistence`, off
`origin/master@7a260271b`. HEAD now `1891b1499` (docs-only).

**Verdict: the assumed gap was already closed by earlier packages; no
narrow code fix was needed.** Read `pattern_join.py` (752 lines) in
full, then `canonical_adapter.py`, `detail_response.py`,
`admin_patterns.py`, `patterns.py`, and `memory.py`'s
`store_detection`/`_row_to_detection`, plus `main.py`'s
`_scan_patterns_daily` write path, to answer the owner's 8 questions
against CURRENT code rather than the Phase-7 spec addendum's
characterization (which was accurate when written, before Packages 8F
and 8G-B shipped):

- **(a) omitted from the live path:** `read_pattern_fields` (the
  ONLY reader `snapshot_builder.py`'s universe-wide `screener_rows`
  snapshot uses, unconditionally, for every user) still selects only
  `sym, pattern_id, direction, confidence, levels_json, detected_at` —
  `status`/`geometry_json`/`quality_json`/`narrative_json`/`eligibility_json`
  are never read there. **By design** (D6's confidence-scale doctrine;
  canonical fields must stay admin/pilot-gated) — not a gap.
- **(b) legacy fields served:** `pattern_engine_ids`,
  `pattern_engine_conf`, `pattern_engine_vcp`/`_flat_base` flags,
  `pattern_engine_dir`, `pattern_entry_px`/`pattern_stop_px` (carriers,
  discarded before `screener_rows`), `pattern_expectancy_r`.
- **(c) Package-8C-persisted fields NOT reconstructed anywhere:
  NONE.** `eligibility_json` and geometry-embedded
  `anchor_roles`/`semantic_subtype` (written at scan-time by
  `adapt_high_tight_flag`/`adapt_power_earnings_gap` when
  `PATTERN_CANONICAL_ADAPT_ENABLED=1`, confirmed ON in prod) are
  already reconstructed by THREE readers: (1)
  `read_pattern_fields_canonical_shadow` → `build_scanner_summary` →
  `ScannerSummary`, which — via `apply_canonical_pilot_overlay` called
  from `query.py:1303` inside `/api/screener/scan` itself — IS a real,
  live (if narrowly gated) request path today, not merely a shadow
  proof; (2) `detail_response.build_canonical_detail`, the admin-only
  `GET /api/patterns/admin/canonical-detail/{id}` proof endpoint
  (`patterns.py:765`), already end-to-end DB-read-back; (3)
  `memory.get_active_detections`/`_row_to_detection`, reachable via
  `GET /api/patterns/{sym}` (paid, non-admin — the chart-overlay path),
  which already serves raw `geometry` (incl. `anchor_roles` for
  PEG/HTF) and `eligibility` when present — this is WHY Package 8D's
  white-outline PEG gap-candle emphasis already works for ordinary
  paid users today, unrelated to this review.
- **(d) PEG vs HTF:** genuinely different, by design. HTF's adapter
  emits ONLY `eligibility` + labeled geometry (no event concept — its
  own file names `base_catalog.py` as the criteria/provenance owner).
  PEG's adapter additionally emits `event` + a reconstructed
  `gate_trace` (detector-authored `geometry.extras` fields, real for
  every persisted PEG row). Both `build_scanner_summary` and
  `detail_response.py` treat `event`/`gate_trace` as optional/absent
  correctly — never fabricated for HTF.
- **(e) which layer:** none — no SQL/reconstruction/DTO change is
  needed. The one real defect found was **documentation**:
  `canonical_adapter.py` carried two docstrings (module-level +
  `build_scanner_summary`'s own) asserting "not wired into
  `pattern_join.py` … or any live request path," which Package 8G-B
  made false on 2026-09-05 by wiring the shadow reader into
  `apply_canonical_pilot_overlay`/`query.py`. Corrected both in place
  (commit `1891b1499`) — comment-only, zero behavior change, focused +
  broader regression both green (`tests/pattern_engine/` +
  `tests/test_screener_wave5_pattern_join_pilot.py`: 2635 passed, 9
  xfailed, same xfail set as the PEG-geometry package's run).
- **(f) ordinary-user impact:** none. Comment-only edit.
- **(g) admin/internal-only scoping:** already correct, unchanged —
  `apply_canonical_pilot_overlay` gates on
  `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED=1` (OFF/unset) + admin +
  PEG-only match; `build_canonical_detail`'s endpoint is
  `require_admin` directly. Nothing here needed broadening or
  narrowing.
- **(h) missing round-trip tests:** none identified — the existing
  `tests/test_screener_wave5_pattern_join_pilot.py` (admin/PEG-gating +
  non-mutation) and `tests/pattern_engine/test_detail_response.py`
  (DB-read-back proof) already cover the round trip this review
  checked; a documentation fix needs no new test.

**No freeze/hold ceremony needed** (unlike the two prior packages) —
this is a zero-behavior-change documentation correction, not a code
change requiring merge/deploy authorization. Left locally committed on
its own isolated worktree/branch regardless, per standing discipline.
Never touched the frozen scan-completeness or PEG-geometry
worktrees/branches. 8G-C remains HOLD overall, unaffected by this
finding (closing a stale-docstring defect does not open any new
surface). No further pattern_join.py work is queued unless the owner
identifies a different concrete gap.

## OWNER ACCEPTANCE — PATTERN_JOIN GAP DISPROVEN; NEXT UNBLOCKED SCANNER PACKAGE REVIEW (2026-09-06)

Owner accepted the finding above verbatim as **"pattern_join.py CANONICAL
PERSISTENCE/SERVING GAP — DISPROVEN AGAINST CURRENT CODE"** and directed:
freeze the docstring fix (kept, unmerged, per the section above — no
further action needed there), remove the disproven item from the 8G-C
blocker list, rebuild that list from current code/durable state, then
run a fresh next-package dependency pass across candidates A-F and
proceed with ONE recommended package if clearly local-only.

### 1-2. Corrected 8G-C blocker list / items disproven as blockers

Rebuilt from actual code (not the 2026-09-06 readiness dossier's own
prose, which — checked this pass — was ITSELF written off `cbe687024`,
a commit that already had Package 8G-B's wiring on it; the dossier
quoted the Phase-7/8C characterization instead of re-deriving against
its own base commit, the identical mistake `canonical_adapter.py`'s two
docstrings made):

**DISPROVEN as blockers** (the readiness dossier's Part 1 §7 "missing
plumbing" list, checked item by item):
- ~~"pattern_join.py doesn't even SELECT eligibility_json yet"~~ — the
  READ path that matters (`read_pattern_fields_canonical_shadow`) already
  selects it; the unconditional legacy path correctly never will (D6).
- ~~"No round-trip parity test exists yet"~~ — `tests/pattern_engine/
  test_detail_response.py` already covers exactly this: raw PEG rows
  (event/gate_trace reconstruct without eligibility), adapted PEG/HTF
  rows (full round trip incl. `anchor_roles`/`eligibility`), an
  out-of-scope family (bull_flag: empty explanation, no
  event/eligibility — the isolation proof), and determinism across
  repeated reads.
- ~~"No admin-auth test proving the proof surface is unreachable by a
  non-admin"~~ — `tests/test_patterns_canonical_detail_admin.py` already
  covers 401 (no session) / 403 (member role) / 404 (unknown id) / 200
  (admin) on `GET /api/patterns/admin/canonical-detail/{id}`.

**Genuinely still real, confirmed by fresh code inspection this pass:**
- **PEG anchor-timestamp geometry quirk** — real on current MASTER (the
  fix is frozen, unmerged, on `uct-dashboard-peg-geometry`). A
  DEPLOYMENT-HELD LOCAL FIX, not an unstarted blocker.
- **No admin-only RENDERED proof surface existed** — the ONE item that
  was genuinely still open. `detail_response.build_canonical_detail`
  produces the full JSON proof already; nothing turned it into an
  admin-viewable chart. **This is what this pass closed** (§7-9 below).

### 3. Deployment-held local fixes (frozen, technically approved, awaiting release condition)

1. Scan completeness / redeploy reliability — `uct-dashboard-scan-completeness`, `baf541526`.
2. PEG geometry anchor-timestamp fix — `uct-dashboard-peg-geometry`, `40c8e578f`.
3. pattern_join.py stale-docstring correction — `uct-dashboard-pattern-join`, `1891b1499` (no hold ceremony needed — zero behavior change — but left unmerged alongside the others for a clean single release event).
4. **NEW** 8G-C admin-only canonical proof surface — `uct-dashboard-8gc-proof`, `400b537e0` (this pass).

None of the four touch each other's worktrees. All four wait on the
same release condition (8G-B closes, OR a separately-authorized
deployment needs a push and bundling is explicitly authorized, OR
explicit owner override).

### 4. True remaining blockers (real, unstarted, unblocked-by-8G-B)

- **8G-C activation itself** — the readiness work (this package +
  the frozen PEG fix) makes 8G-C's admin proof PRODUCIBLE; actually
  producing/recording the proof and deciding to advance past "admin
  proof exists" to any broader exposure remains a separate, later,
  explicit owner decision. Not started, not authorized here.
- **Remaining-family canonical adaptation** (Bull Flag, Engulfing,
  O'Neil Flat Base, VCP, Pullback-to-50-SMA, Episodic Pivot) — 5 of 7
  rows / 6 of 7 detector files still unadapted. Real, unstarted, and
  explicitly NOT blocked by 8G-B (pure local `canonical_adapter.py`
  additions + fixtures, same shape as the two adapters already done).
- **VCP freshness-gate mismatch** (`_MAX_FINAL_LOW_AGE=15` bars vs
  `base_catalog`'s own VCP ceiling of 60 bars for nominally the same
  pattern) — a real, documented, still-unfixed correctness bug,
  structurally identical in shape to the PEG anchor-timestamp bug
  just fixed. Not on the owner's A-F candidate list this pass, so not
  started — flagged here as a genuine finding for a future pass.
- **8G-B final live acceptance** — separately tracked, the standing
  top-priority item; not a code blocker, a natural-load-evidence
  blocker (Tuesday 2026-09-08 RTH).

### 5-6. Candidate next packages — dependency status (owner's A-F)

| Candidate | Current state | Already implemented? | Blocked by 8G-B? | Local-only possible? | Needs merge/deploy? | Category | Evidence it's unresolved |
|---|---|---|---|---|---|---|---|
| A. 8G-C admin-only render-entry-point | No admin-viewable proof existed | No | No | **Yes — done this pass** | Yes, eventually (frozen for now) | Readiness | Verified: no route, no component, `ChartToolbar.jsx` toggle confirmed dead |
| B. Broader Pkg-8C round-trip parity evidence | Fully covered already | **Yes** (`test_detail_response.py` + `test_patterns_canonical_detail_admin.py`) | N/A | N/A | N/A | — | Disproven this pass — reading the test files directly, not inferring |
| C. Next single remaining family (Bull Flag/Engulfing) | Not started | No | No | Yes | No (pure adapter + fixtures) | Correctness/readiness | `canonical_adapter.py` has exactly 2 adapter fns; confirmed no 3rd exists |
| D. HTF live canonical writer validation | Adapter runs today whenever `PATTERN_CANONICAL_ADAPT_ENABLED=1` (confirmed ON) | Partially — writer runs, no one has looked at its output | No (read-only) | Yes | No | Evidence-gathering | Would need a `railway ssh` read against prod `patterns.db` — lower value than A, deferred |
| E. Scanner reliability follow-on, no-deploy | scan-completeness already covers the known gap | Mostly (frozen, held) | No | — | Yes, eventually | Reliability | No second reliability gap found this pass beyond VCP's freshness mismatch (§4) |
| F. Stale-durable-docs cleanup | The 2026-09-06 readiness dossier itself is now stale (see §1-2) | Partially — this checkpoint entry IS that correction | No | Yes | No | Documentation debt | Confirmed: dossier's Part 1 §1/§7 describe a pre-8G-B state as current |

### 7. Recommended single next package

**A — 8G-C admin-only render-entry-point.** Implemented this pass.

### 8. Why higher-value than the alternatives

It was the ONLY candidate that was (a) a real, confirmed-open gap (B is
disproven, D is low-value diagnostic-only, E has no second target
beyond VCP which wasn't on the candidate list) and (b) directly
requested/pre-authorized by the owner's own §5 ("if 8G-C admin-only
render proof is the next real item... you may do readiness/local-only
work... if an admin-only entry point can be added purely locally and
remains inert until explicit activation, you may design it"). C is
real and legitimate but lower-priority: it advances canonical breadth,
not the concrete 8G-C proof deliverable the owner has been steering
toward across three prior packages this session.

### 9. Exact local-only scope of the implemented package

Worktree `C:\Users\Patrick\uct-dashboard-8gc-proof`, branch
`feat/8gc-admin-canonical-proof`, off current `origin/master@090d9b7fd`
(NOTE: origin/master moved since this session's earlier worktrees were
cut — `ef2747618`/`090d9b7fd` are a different, legitimate parallel
session's Notebook Wave-4 readiness docs, "Track B, no shipping",
confirmed unrelated and harmless). HEAD now `400b537e0`.

- **Backend: ZERO changes.** Both endpoints read
  (`GET /api/admin/patterns/recent`, `GET /api/patterns/admin/
  canonical-detail/{id}`) already existed, already `require_admin`-gated.
- **Frontend, additive only:**
  - `StockChart.jsx`: two new props, `forcedDetections=null` /
    `forcedShowPatterns=false`. Every existing caller passes neither,
    so `patternDetections = forcedDetections ?? livePatternDetections`
    and `patternOverlayEnabled = !!forcedShowPatterns || showPatterns`
    both resolve to the exact prior behavior when unset.
  - New `app/src/pages/admin/PatternCanonicalProof.jsx` +
    `.module.css` + `.test.jsx` — a page reachable ONLY via
    `/admin/pattern-canonical-proof` (not linked from any menu/nav),
    gated the same way every sibling `/admin/*` page is.
- **Never touched:** `ChartToolbar.jsx`'s dead toggle,
  `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED`, the frozen
  scan-completeness/PEG-geometry/pattern-join worktrees, any scheduler,
  any production config.

### 10-11. Production code vs tests-only

Production code WAS needed here (tests alone could not close this —
the gap was "no rendered proof exists", which is by definition a UI
gap, not a test-coverage gap). The change is deliberately the smallest
production-code surface that closes it: 2 additive StockChart props +
1 new admin-only page, zero backend, zero shared-component mutation.

### 12. Exact owner gate before any merge/deploy

Identical structure to the three other frozen packages: (A) 8G-B
observation formally closes and its diagnostic is removed/cleaned, or
(B) a separately-authorized deployment already needs a push and the
owner explicitly authorizes bundling this in, or (C) explicit owner
override. **None has occurred.** No merge, no push, no deploy. Do not
merge scan-completeness, PEG-geometry, pattern-join, or this package
without a fresh explicit owner instruction naming which package(s) to
release.

Four packages now frozen on identical hold, zero cross-contamination,
8G-B observation cadence uninterrupted throughout this pass.

Continuing the relaxed observation cadence toward Tuesday's open.

---

## VCP FRESHNESS-GATE ADJUDICATION — CLOSED, NO CODE CHANGE (2026-09-06)

**Worktree:** `uct-dashboard-vcp-freshness`, branch `fix/vcp-freshness-gate-adjudication`,
off `origin/master@d05994e92`, HEAD now `3baadbd21` (tests-only commit).

**Question:** does `pattern_engine/detectors/uct/vcp.py`'s `_MAX_FINAL_LOW_AGE=15`
disagree with `screener/base_catalog.py`'s `VCP_MAX_AGE_BARS=60` — flagged in the
prior "NEXT UNBLOCKED SCANNER PACKAGE REVIEW" pass as a genuine, unresolved-looking
finding structurally similar to the PEG anchor-timestamp bug.

**Verdict: VCP 15/60 VALUES ARE SEMANTICALLY DISTINCT — NO THRESHOLD FIX REQUIRED.**

Four independent, mutually-reinforcing pieces of durable evidence, found by reading
current code (not by trusting the prior review's flag):
1. `vcp.py`'s own 2026-08-31 `⛔@@STOP@` comment: the two engines are a pre-existing,
   owner-ratified, deliberately parallel pair (base_catalog authoritative for WHETHER
   a structure is present; the engine for WHERE TO ENTER one) — explicitly "NOT a bug
   to fix blindly." Standing rail: `tests/test_no_second_authority_across_axes.py`.
2. `base_catalog.py`'s own comment on `VCP_MAX_AGE_BARS=60`: "DELIBERATELY LOOSE,
   PAIRED WITH A STRUCTURAL TEST" — the real currency test is
   `floor <= last_close <= top`, not the age count. A tighter 30-bar version
   regressed by refusing a well-formed 47-bar pattern; already boundary-tested in
   `tests/pattern_engine/primitives/test_vcp.py`.
3. `tests/test_two_engines_do_not_agree.py` pins BOTH exact constants together
   (`MEASURED_AGAINST['vcp']`) as part of a kappa~0.003 (n=1397) independence
   measurement: "these are not the same rule at different sensitivities. They are
   different rules."
4. **The most direct hit** — `api/services/pattern_engine/types.py`'s
   `Eligibility.freshness_window_bars` field comment names this EXACT pair
   verbatim ("the rules-engine VCP's 15-bar ceiling vs. base_catalog's 60-bar
   ceiling for the same pattern name") as the canonical reason the field exists:
   architecture intent is to keep such mismatches visible, never silently
   normalize them away.

No `adapt_vcp` canonical adapter exists — the canonical eligibility layer has never
been invoked for VCP — so there is no ordinary-user-facing impact today; the
"mismatch" is confined to two pre-existing, already-adjudicated legacy detectors.

**One genuine gap found and closed:** no prior test isolated `_MAX_FINAL_LOW_AGE`
at its own boundary in isolation. Added
`tests/pattern_engine/detectors/test_vcp_recency_gate.py` — 5 tests, all passing,
proving the gate fires at exactly 15 bars and rejects at 16, with a non-vacuity
control (the enumerator still finds the 16-bar candidate; only the age gate
discards it) and a source-level proof the two engines' gates read disjoint input
structures by construction. This is the ONLY change — zero production code.

**Pre-existing, unrelated, NOT fixed (flagged only):**
`tests/test_two_engines_do_not_agree.py::test_the_shipped_thresholds_have_not_moved`
fails on unmodified `phase3c@09e27fec3` too — a Phase 3A (2026-09-02) Trend
Template constant drift (`_TREND_TEMPLATE_SMA_SHORT`/`_LONG` added to `vcp.py`,
never added to the test's `MEASURED_AGAINST['vcp']['engine']` pin, because that
sweep has no VCP_-style prefix filter on the engine side the way base_catalog's
side does). Confirmed pre-existing via identical failure on the untouched
`phase3c` worktree. Out of scope for this package (unrelated constant pair, no
bearing on 15-vs-60); left exactly as found.

**Regression:** focused VCP + two-engines suite 86 passed / 1 pre-existing failure
(above). Broader `tests/pattern_engine/` full suite: 2621 passed, 9 xfailed
(documented, pre-existing).

**Frozen, no merge/deploy** — same 3-option gate as the other four packages
(none has occurred). Prior closed VCP decisions (2026-08-31 boundary ruling,
Phase 3A Trend Template correction) unchanged and unreopened. VCP remains NOT
canonically adapted (no `adapt_vcp`) — this closes the freshness question but is
not itself a readiness step toward canonical adaptation.

**Per owner instruction: remaining-family canonical adaptation may now resume**
on a future pass (this was the one blocking condition). 8G-B natural-load
observation continued uninterrupted throughout; Tuesday 2026-09-08 RTH remains
the key live-acceptance window; pilot OFF, adapt ON, 8G-C activation HOLD.

Five packages now frozen/closed on identical hold discipline
(scan-completeness, PEG-geometry, pattern-join docs, 8G-C admin-proof,
this VCP adjudication), zero cross-contamination, 8G-B observation cadence
uninterrupted throughout this pass.

---

## BULLISH ENGULFING CANONICAL ADAPTER — PACKAGE 8F (2026-09-06)

**Worktree:** `uct-dashboard-bullish-engulfing`, branch `feat/canonical-bullish-engulfing`,
off `origin/master@dc5dbe0c9`, HEAD now `43e5ca4dd`.

**Context:** owner authorized resuming remaining-family canonical adaptation
(one family at a time, local/isolated only) once the VCP freshness-gate
adjudication closed. Explicit instruction: do not assume VCP is next just
because it was just discussed — rank all remaining families fresh.

**Ranking (12 owner-specified criteria, re-verified against current code,
not quoted from the prior readiness matrix):** Bullish Engulfing > Bull Flag
> O'Neil Flat Base > Episodic Pivot > VCP > Pullback-to-50-SMA. Bull Flag
was the closest competitor but its own 4 geometry anchors never include the
pole (verified by direct read — `upper_pivots`/`lower_pivots` are built only
from post-pole-top flag bars); Bullish Engulfing's 2 anchors (prior bar
close, engulfing bar close) are both real, and it emits at most one
detection per symbol (`detections[-1:]`) — the simplest eligibility
semantics of any remaining family.

**Contract:** identity = the engulfment geometry + hard reversal-context
gate (`at_swing_low`/`below_50sma`/`recent_decline_pct`), all already
materialized in `geometry.extras`. Lifecycle/eligibility = shared 7d active
window only (no per-family gate). Event provenance = correctly, honestly
ABSENT (a candlestick has no addressable calendar event) — mirrors HTF's
adapter shape exactly. Explanation: real `why_it_matched` (engulfment ratio,
the specific reversal-context reason(s) this candidate cleared, engulfing-bar
DCR); `strengths`/`weaknesses` honestly OMITTED (this family's `_score_context`
is monolithic, no separable DCR/CAN-SLIM helper functions like HTF/PEG/Bull
Flag have — inventing one would risk diverging from the detector's real
judgment).

**Implementation:** `adapt_bullish_engulfing()` added to `canonical_adapter.py`
(eligibility + anchor_roles=`["prior_bar_close","engulfing_bar_close"]` +
semantic_subtype=`"engulfing_pair"`; event/criteria/gate_trace deliberately
absent). `explanation_builder.py` gained bullish_engulfing as a third in-scope
family. Zero persistence/schema/scanner-wiring change — same shadow-mode-only
status as the existing two families. Zero production authority activated.

**Tests:** extended `test_canonical_adapter.py` (+91 lines, mirrors HTF's own
test shape exactly — parity, event/criteria/gate_trace-absent, eligibility
shape, non-mutation, anchor-role order, scanner-summary honesty) and
`test_explanation_builder.py` (+93 lines — why-matched facts, reversal-context
fact names only what actually fired, no-event-section, market_context
composes without duplicating "moving-average", no strengths/weaknesses
section, folded into the existing family-agnostic parametrizations). Reused
the existing 16-fixture `bullish_engulfing` battery — no new fixtures needed.

**Regression:** `test_canonical_adapter.py` 130 passed, `test_explanation_builder.py`
229 passed. Full `tests/pattern_engine/` suite: 2744 passed, 9 xfailed —
same pre-existing xfails as the prior VCP package pass, nothing new broken.

**Frozen, no merge/deploy** — same 3-option gate as every other package.
Bull Flag (pole-anchor gap), O'Neil Flat Base (rectangle 4th-anchor overload),
Episodic Pivot (needs genuinely new event-provenance work), VCP (needs its
own future adapter, deliberately not chosen this pass), and Pullback-to-50-SMA
(single-anchor geometry, the thinnest of the six) all remain unconverted,
ranked and ready for future passes in that order.

Six packages now frozen on identical hold discipline (scan-completeness,
PEG-geometry, pattern-join docs, 8G-C admin-proof, VCP adjudication, Bullish
Engulfing canonical adapter), zero cross-contamination, 8G-B observation
cadence uninterrupted throughout this pass. Tuesday 2026-09-08 RTH remains
the key `screener_live_tier` live-acceptance window.

---

## CORRECTION — Bullish Engulfing final report wording (2026-09-06)

Owner-flagged: the Package 8F report's item 14 said "no request-path wiring
exists for any family yet" — too broad, and it conflicts with previously
verified current code (Package 8C's `/api/patterns/admin/canonical-detail/{id}`
+ the frozen 8G-C admin proof surface DO read canonical fields for HTF/PEG
today, even though nothing is wired into the LIVE scanner/member path).

**Corrected statement:** Bullish Engulfing itself has no request-path wiring
in this package and remains shadow/local-only. Existing canonical admin/
detail paths for previously adapted families (HTF, PEG) remain unchanged —
not touched, not extended, not reduced by this package.

**Owner decision recorded:** BULLISH ENGULFING CANONICAL ADAPTATION — OWNER
TECHNICAL APPROVAL GRANTED. Frozen at `uct-dashboard-bullish-engulfing`,
branch `feat/canonical-bullish-engulfing`, HEAD `43e5ca4dd`. No merge/push/
deploy. Joins the existing hold set.

## 8G-B CHECK (2026-09-06, ~14:45 UTC, quiet Sunday)

Verified without manufacturing any load:
- `contention_trace_temp.py` present at current `origin/master` tip
  (`dc5dbe0c9`) — confirmed via `git show origin/master:api/services/
  screener/contention_trace_temp.py`. Only one follow-up commit since it
  landed (`b5fda5db9`, an env-override fix to its watched DB paths) — no
  revert, no removal.
- `railway logs --service web`: service healthy, `instrument_scheduler`
  wrapping active, `[mem] rss_mb=.../threads=57` telemetry lines present
  (the diagnostic's own "cheap process context" logging convention),
  `[screener-live] cycle skipped: not_regular_session (session=post_market)`
  — correct weekend behavior.
- `GET /api/health`: `{"status":"ok","uptime_seconds":1294,"thread_count":57,
  "rss_mb":1202.3}` — healthy, consistent with the logs.
- **Zero contention log samples today** — expected, not concerning: the
  diagnostic only fires on an actual `/api/screener/scan` request, and a
  quiet Sunday has none. Tuesday 2026-09-08 RTH (Monday 9/7 is Labor Day)
  remains the next real evidence window.

Next family authorized: **Bearish Engulfing**, new isolated worktree, own
package. Bullish/bearish semantic diff required BEFORE any code is copied.

---

## BEARISH ENGULFING CANONICAL ADAPTER — PACKAGE 8G (2026-09-06)

**Worktree:** `uct-dashboard-bearish-engulfing`, branch `feat/canonical-bearish-engulfing`,
off `origin/master@dc5dbe0c9`, HEAD now `15d992f29`. Isolated from the still-
unmerged `uct-dashboard-bullish-engulfing` branch — this worktree's baseline
`canonical_adapter.py`/`explanation_builder.py` are pre-Package-8F (HTF+PEG only).

**Required semantic diff performed FIRST** (owner instruction — do not assume
symmetry). Read both `bullish_engulfing.py` and `bearish_engulfing.py` in full.
Result: a faithful mirror on anchor count/order (2: prior-bar-close,
engulfing-bar-close), geometry shape (`candle_mark`), levels/confidence/quality
structure, single-detection-per-symbol lifecycle, absence of a per-family
freshness gate, and the reversal-context-gate concept. Two real, non-cosmetic
differences found and handled explicitly:
1. 3 of 12 `geometry.extras` keys are DIRECTIONALLY RENAMED, not merely
   re-signed: `at_swing_high`/`above_50sma`/`recent_advance_pct` (bearish) vs
   `at_swing_low`/`below_50sma`/`recent_decline_pct` (bullish).
2. DCR confirmation direction is INVERTED — a LOW `curr_bar_dcr` is bearish's
   confirming signal (opposite of bullish's high-DCR signal). `dcr_strength()`
   is direction-unaware, so its "weak" label would misdescribe the pattern if
   reused naively.

**Implementation:** `adapt_bearish_engulfing()` — same minimal shape as
`adapt_high_tight_flag`/`adapt_bullish_engulfing` (eligibility +
anchor_roles=`["prior_bar_close","engulfing_bar_close"]` +
semantic_subtype=`"engulfing_pair"`; event/criteria/gate_trace absent).
`explanation_builder.py` gained bearish_engulfing as a third in-scope family
with its OWN why_it_matched reader (correct renamed keys, DCR-inversion stated
explicitly rather than copy-pasted). strengths/weaknesses honestly omitted
(monolithic `_score_context`, same as bullish). Zero persistence/schema/
scanner-wiring change. Zero production authority activated.

**Tests:** mirrors Bullish Engulfing's own shape PLUS explicit cross-wire
guards (owner Section 10): proves the bullish-shaped keys are genuinely absent
from real bearish extras and the reversal-context fact only fires against the
correctly-read bearish keys; proves the DCR fact states the inversion
explicitly; proves every real bearish fixture carries the correct pattern_id;
proves the bullish pattern_id is NOT accidentally in scope in this isolated
branch. Reused the existing 15-fixture `bearish_engulfing` battery.

**Regression:** `test_canonical_adapter.py` 131 passed, `test_explanation_builder.py`
238 passed. Full `tests/pattern_engine/` suite: 2754 passed, 9 xfailed — same
pre-existing xfails as every prior pass, nothing new broken.

**Verdict: BEARISH ENGULFING CANONICAL ADAPTATION COMPLETE LOCALLY — READY FOR
OWNER REVIEW.** Bearish Engulfing IS a true semantic mirror of Bullish
Engulfing (confirmed by evidence, not assumed).

**Frozen, no merge/deploy** — same 3-option gate as every other package.

Seven packages now frozen on identical hold discipline (scan-completeness,
PEG-geometry, pattern-join docs, 8G-C admin-proof, VCP adjudication, Bullish
Engulfing, Bearish Engulfing canonical adapters), zero cross-contamination,
8G-B observation cadence uninterrupted throughout. Tuesday 2026-09-08 RTH
remains the key `screener_live_tier` live-acceptance window (Monday 9/7 is
Labor Day).

---

## BULL FLAG CANONICAL ADAPTER — PACKAGE 8H (2026-09-06)

Worktree `uct-dashboard-bull-flag`, branch `feat/canonical-bull-flag`, base
`origin/master@d7b53b339`. Owner steering preference (non-binding) named Bull
Flag next; readiness check confirmed it cleanly ready and proceed-worthy.

**Readiness check findings:** NO competing base_catalog engine (only
`HIGH_TIGHT_FLAG` exists for "flag"; re-confirmed via grep against BOTH
standing two-engines regression rails — zero hits for `bull_flag`/`bull-flag`
in either). NO event concept, NO per-family freshness gate (same absence
shape as HTF — staleness is structurally bounded by re-scan aging past
`bull_flag._MAX_FLAG_BARS`, not a stored age field). HAS separable
`_dcr_score_adjustment`/`_can_slim_score_adjustment` AND matching
`_trend_stage_description`/`_ma_alignment_phrase`/`_rs_trend_phrase` —
identical signatures to HTF/PEG's own, so (unlike both Engulfing families)
Bull Flag DOES support real strengths/weaknesses explanation sections.

**Geometry — pre-existing, disclosed completeness gap, NOT fixed:** only the
4 flag-channel anchors are emitted (`upper_line.p1/p2`, `lower_line.p1/p2`);
the pole segment is never anchored — this is the exact finding HTF's own
adapter comment already names as being "about bull_flag specifically."
Adapter labels the 4 real anchors honestly (`flag_upper_start/end`,
`flag_lower_start/end`, subtype `flag_channel`) — no fabrication, no detector
change.

**⛔⛔ INDEPENDENTLY-PROVEN CORRECTNESS DEFECT FOUND, STOPPED ON, REPORTED
SEPARATELY, NOT FIXED HERE (per this package's own scope gate):**
`bull_flag.py`'s flag-channel anchors carry BAR-INDEX integers in their `t`
field, not unix-second bar timestamps — violating `types.py`'s own contract
(`Bar.t`/`Pivot.t`/geometry `Anchor.t`: `int  # unix seconds, bar start`),
which HTF and PEG both correctly honor (their anchors build from
`int(bars[idx]["t"])`). Root cause: `bull_flag._try_extract_pattern`'s own
inline `upper_pivots`/`lower_pivots` (NOT built via the shared `detect_pivots`
primitive HTF/PEG use) set `"t": pole_top_idx + 1 + i` — a bar index — and
`trendlines.fit_trendline` passes it straight through with no index-to-
timestamp translation; `_build_detection` copies it into `geometry.anchors[]`
unmodified. Verified empirically against a real fixture
(`boundary_max_retrace`): `bars[0].t`/`bars[-1].t` ≈ 1.7e9 (real unix
seconds) while the flag anchors' `.t` were `31`/`37` — small bar-index
integers, nine orders of magnitude off. A future chart consumer plotting
these anchors against real bar timestamps would place the flag-channel
drawing at a wildly wrong x-position. Entirely upstream of anything Package
8H's own code touches (neither `canonical_adapter.py` nor
`explanation_builder.py` reads/interprets `anchors[].t` at all) — pinned by a
dedicated named test (`test_bull_flag_flag_channel_anchor_t_is_a_bar_index_KNOWN_DEFECT_NOT_FIXED_HERE`)
rather than silently tolerated. **`bull_flag.py` is NOT edited by this
package.** Owner adjudication needed on whether/when to authorize a separate
fix.

**Implementation:** `canonical_adapter.py` gained `_BULL_FLAG_ANCHOR_ROLES`/
`_BULL_FLAG_SEMANTIC_SUBTYPE` + `adapt_bull_flag()` (HTF's minimal shape:
eligibility + anchor labeling only; `event`/`criteria`/`gate_trace` absent).
`explanation_builder.py` gained bull_flag as a third in-scope family:
`_bull_flag_why_it_matched_facts` (reads `pole_pct`/`retrace_pct`/`flag_bars`/
`parallel_score` off `geometry.extras`), `_FAMILY_CONTEXT_FNS` entry (real
strengths/weaknesses — a genuine departure from Engulfing precedent),
`_FAMILY_PHRASE_FNS` entry. Zero persistence/schema/scanner-wiring change.
Zero production authority activated.

**Collateral fix (expected consequence of this package, not an unrelated
regression):** `test_detail_response.py::test_out_of_scope_family_returns_base_fields_with_empty_explanation`
used bull_flag as its "genuinely out of scope" fixture — now stale since
bull_flag IS in scope. Swapped to `double_bottom` (still genuinely unadapted),
preserving the test's original intent.

**Tests:** mirrors HTF's own shape (parity, event/criteria/gate_trace-absent,
eligibility incl. outside-window, non-mutation, anchor-role order, scanner-
summary honesty, why-matched facts, warnings) PLUS: an anchors-don't-collapse-
onto-one-point proof (real fixtures, not synthetic) and the dedicated defect-
pinning test above. Reused the existing 16-fixture `tests/fixtures/bull_flag/`
battery — no new fixtures needed.

**Regression:** `test_canonical_adapter.py` + `test_explanation_builder.py` +
`test_bull_flag.py` (detector): 369 passed. Full `tests/pattern_engine/`
suite: 2737 passed, 9 xfailed — same pre-existing xfails as every prior pass.
`test_two_engines_do_not_agree.py`/`test_no_second_authority_across_axes.py`:
31 passed, 1 failed (`test_the_shipped_thresholds_have_not_moved` — the SAME
pre-existing Phase 3A Trend-Template drift confirmed unrelated earlier this
session during the VCP phase; `git status` on this worktree shows zero touches
to `base_catalog.py` or any Trend-Template file).

**Verdict: BULL FLAG CANONICAL ADAPTATION COMPLETE LOCALLY — READY FOR OWNER
REVIEW**, with one independently-discovered, separately-reported, NOT-fixed
correctness defect in `bull_flag.py`'s own geometry construction awaiting
owner adjudication (fix authorization, timing, and scope are the owner's
call — this package deliberately did not touch the detector).

**Frozen, no merge/deploy** — same 3-option gate as every other package.
Committed locally at `5a629be54`, never pushed.

Eight packages now frozen on identical hold discipline (scan-completeness,
PEG-geometry, pattern-join docs, 8G-C admin-proof, VCP adjudication, Bullish
Engulfing, Bearish Engulfing, Bull Flag canonical adapters), zero
cross-contamination, 8G-B observation cadence uninterrupted throughout.
Tuesday 2026-09-08 RTH remains the key `screener_live_tier` live-acceptance
window (Monday 9/7 is Labor Day). Do NOT proceed to another family without
fresh owner authorization; the bar-index anchor-timestamp defect in
`bull_flag.py` is a separate, standing item awaiting owner adjudication.

---

## BULL FLAG ANCHOR TIMESTAMP CORRECTNESS — SEPARATE PACKAGE, OWNER-AUTHORIZED (2026-09-06)

Worktree `uct-dashboard-bull-flag-ts-fix`, branch `fix/bull-flag-anchor-timestamps`,
base `origin/master@d7b53b339` (fresh clean base, NOT the frozen Bull Flag
canonical branch — that branch was never touched). Committed locally at
`b3e2dc2b4`, never pushed.

**The defect, re-proven from current code:** `bull_flag.py`'s flag-channel
geometry anchors (`upper_line`/`lower_line` p1/p2) carried absolute BAR-INDEX
integers in `Anchor.t` instead of real unix-second bar timestamps — verified
against `types.py`'s own contract (`Bar.t`/`Pivot.t`: `int # unix seconds,
bar start`) and against `Pivot`'s own field split (`t` vs `bar_index` are
DIFFERENT fields by design), and against the shared `detect_pivots`
primitive (which HTF/PEG use and which correctly builds both fields
separately). Root cause: `_try_extract_pattern`'s own inline
`upper_pivots`/`lower_pivots` (built directly, NOT via `detect_pivots`) set
`"t": pole_top_idx + 1 + i` — an index — and `fit_trendline` passed it
straight through unmodified into the final anchors. Empirically confirmed
against a real fixture before the fix: anchor `.t` values of `31`/`37` next
to real bar timestamps of `~1.7e9`.

**Real, not hypothetical, production reach.** Traced the full flow: Bull Flag
IS a registered detector (`register(_PATTERN_ID, detect_bull_flag)`), and
`api/main.py::_run_patterns_universe_scan` (daily 1am ET, unconditional —
no flag gate around the job registration) + `_run_patterns_leaders_scan`
(hourly) both call `detect_all()` (every registered detector) and
`memory.store_detection()` UNCONDITIONALLY for every result — so buggy Bull
Flag anchors ARE being persisted into production's `pattern_detections`
table today, not merely in test fixtures. Further traced: Compass's
`find_patterns_on_ticker`/`scan_active_patterns` tools (which explicitly
name "Bull Flag" in their own descriptions) never read `geometry`/`anchors`
— only `levels`/`confidence`/`status` — so no LLM-facing surface is affected.
BUT `app/src/components/chart/PatternOverlay.jsx` (mounted on every
`StockChart` instance dashboard-wide, gated only by a real, member-clickable
"Show Patterns" toolbar toggle, `disablePatterns` false by default) DOES map
`shape: "trendline_pair"` → `TrendlinePair.jsx`, which calls `tToX(anchor.t)`
expecting a real unix timestamp. A bar-index value handed to that function
would almost certainly return `null` (no matching point in the visible
time range) — most likely result: **the Bull Flag pattern silently fails to
draw its trendlines on a member's real chart when they enable "Show
Patterns"**, rather than drawing them in a visibly wrong place. Traced the
code path; did not execute the frontend runtime to confirm the exact
null-vs-off-screen failure mode — stated as the honest boundary of what was
verified.

**The fix** (`_anchor_bar_t()` in `bull_flag.py`): a single, narrow
translation at the ONE place a flag-channel trendline's `t` is read to build
a canonical anchor — `bars[int(pivot_t)]["t"]`. The regression fit itself
(`_try_extract_pattern`'s `upper_pivots`/`lower_pivots`, `fit_trendline`) is
UNTOUCHED — re-fitting on real calendar timestamps would distort the channel
across weekend/holiday gaps (bar-index spacing vs. calendar-time spacing are
legitimately different things, per the owner's own explicit framing).
Verified `channel_width_parallel_score` (the pattern's own parallel-score
gate) reads ONLY `.price`, never `.t`, off these lines — confirming the fix
cannot affect whether a pattern fires or its score.

**Semantics invariance — proven empirically, not just argued.** Dumped every
firing detection (confidence, quality_components, status, direction, levels,
count) from BOTH the frozen pre-fix worktree and this fix's worktree across
all 15 fixtures, diffed them: byte-identical except `geometry.anchors[].t`
(the intended fix) and `detected_at`/`last_seen_at` (wall-clock noise between
the two separate runs). Also pinned structurally: `_build_detection` takes
`confidence`/`geom_score`/`vol_score`/`ctx_score`/`hist_score` as
ALREADY-COMPUTED parameters, so nothing this fix touches can feed back into
scoring by construction.

**Tests added** (`test_bull_flag_anchor_timestamps.py`, 8 tests): anchor-by-
anchor real-timestamp proof with an INDEPENDENT oracle (`bars[expected_index]
["t"]`, never calling the fix's own helper); anchors-don't-collapse-onto-one-
bar proof (real fixtures); price-coordinate sanity (no companion index/swap
defect); the structural scores-computed-first invariant; a REAL SQLite
store/read round-trip proving anchors survive persistence unchanged (Bull
Flag genuinely reaches `pattern_detections` today, so this is not a
hypothetical test); non-mutation of `bars`.

**Read-only same-defect-class audit (Section 14, reconnaissance only, NOT
fixed here):** grepped every detector for a bar-index expression assigned
directly into a `"t"` field. Found the IDENTICAL bug, byte-for-byte, in
`bear_flag.py` (lines ~150/153/456-460) and `pennant.py` (lines ~348/351/
789-792) — same inline-pivot-construction pattern, same anchor-copy site.
**NOT touched.** Reported as candidate cases requiring their own separate
PROVE→LOCALIZE→FIX package.

**Regression:** targeted file (49 passed). Full `tests/pattern_engine/`:
2648 passed, 9 xfailed (same pre-existing xfails as every prior pass — this
worktree is origin/master-based, so the count is lower than the Package 8H
worktree's 2737 by design; it doesn't carry the canonical-adapter test
suite). Two-engines regression rails: 31 passed, 1 failed — the SAME
pre-existing `test_the_shipped_thresholds_have_not_moved` Trend-Template
drift confirmed unrelated earlier this session; `git status` shows zero
touches to `base_catalog.py` here either.

**Relationship to the frozen Bull Flag canonical package (untouched,
confirmed via `git status` — clean, still at `5a629be54`):** the canonical
adapter's own code remains semantically correct without modification (it
only LABELS whatever anchors exist; it never interprets `.t`). ONE test in
that frozen package will need updating whenever it is eventually rebased
onto this fix — `test_bull_flag_flag_channel_anchor_t_is_a_bar_index_
KNOWN_DEFECT_NOT_FIXED_HERE`, which explicitly pins the OLD (buggy) small-
int behavior and would legitimately fail once real timestamps are in place;
that failure is exactly what should happen and is easy to recognize by
name. The frozen package's other geometry test (anchors-don't-collapse)
asserts only ORDER/EQUALITY relationships between `.t` values, which this
fix preserves exactly — that test needs no change. No fixture assumptions
were invalidated (same 16-fixture battery, unmodified either side).

**Verdict: BULL FLAG ANCHOR TIMESTAMP DEFECT CONFIRMED AND FIXED LOCALLY —
READY FOR OWNER REVIEW.**

**Frozen, no merge/deploy** — same 3-option gate as every other package.
Nine packages now frozen total. Two candidate same-defect-class cases
(`bear_flag.py`, `pennant.py`) recorded, awaiting a fresh owner decision on
whether/when to open separate packages for them. 8G-B observation cadence
uninterrupted throughout — no diagnostic touched, no load manufactured;
Tuesday 2026-09-08 RTH remains the next real evidence window.
