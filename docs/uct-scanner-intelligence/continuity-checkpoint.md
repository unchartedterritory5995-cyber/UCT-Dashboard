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
