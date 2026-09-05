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
