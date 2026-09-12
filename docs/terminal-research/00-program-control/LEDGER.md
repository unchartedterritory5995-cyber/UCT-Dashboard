---
id: IMPLEMENTATION-LEDGER
title: Terminal-Next Implementation Ledger
role: the single authority for what this program has shipped to production
status: current
generated: 2026-09-11
---

# Terminal-Next Implementation Ledger

**This file is the program's manifest of shipped application code.** The protection rail's
check (1b) validates against it: *every commit returned by the ledger query must have a row here.*
A commit on a program-created path with no row is a **FAIL**.

⛔ **THE LEDGER QUERY** — the only reliable one. A path-filtered or subject-filtered log
answers a different question and undercounted this program twice on 2026-09-11:

```bash
# Section 1 -- the program's own build
git log --format='%h %ci %s' ed6b1f041^1..ed6b1f041^2

# Section 3 -- anyone building on a path this program created
git diff --diff-filter=A --name-only ed6b1f041^1...ed6b1f041^2   # the created paths
git log --format='%h %ci %s' 9c3df14b9..origin/master -- <those paths>
```

---

## Section 1 — the program's own build: `feat/entity-master`, 50 commits

Merged to `origin/master` as **`ed6b1f041`**, 2026-09-05 00:50. `207 files changed, 22049 insertions(+), 1143 deletions(-)`.
Recorded in no program document until 2026-09-11. Treated as a **recording failure, not an
unauthorized merge**, per the owner's ruling of 2026-09-11.

| # | commit | when (CDT) | system | files | subject |
|---|---|---|---|---|---|
| 1 | `3c762d25e` | 2026-09-02 17:51 | **S3** | 4 | Entity Master Checkpoint 1: canonical schema |
| 2 | `8424b8be5` | 2026-09-02 17:55 | **S3** | 4 | Entity Master Checkpoint 2: read primitives |
| 3 | `195e8e24c` | 2026-09-02 18:01 | **S3** | 4 | Entity Master Checkpoint 3: write path |
| 4 | `114052d2d` | 2026-09-02 18:11 | **S3** | 7 | Entity Master Checkpoint 4: seed script + FIRST REAL SEED RUN (HARD STOP) |
| 5 | `b78382f63` | 2026-09-02 18:25 | **S3** | 1 | Entity Master: post-Checkpoint-4 findings investigation |
| 6 | `f1b75e270` | 2026-09-02 18:29 | **S3** | 4 | Entity Master Checkpoint 5: provider mapping |
| 7 | `5ecdae012` | 2026-09-02 18:38 | **S3** | 6 | Entity Master Checkpoint 6: compatibility integration |
| 8 | `dc95c65ff` | 2026-09-02 18:47 | **S3** | 1 | Entity Master: correct Finding A's root-cause diagnosis |
| 9 | `baaf28906` | 2026-09-02 18:49 | **S3** | 4 | Entity Master Checkpoint 7: reconciliation, dry run first, real write |
| 10 | `53b99ad5a` | 2026-09-02 18:54 | **S3** | 5 | Entity Master Checkpoint 8: full adversarial validation at real scale |
| 11 | `ca3176954` | 2026-09-02 19:02 | **S3** | 1 | Entity Master: record accepted-with-conditions follow-ups |
| 12 | `768587e00` | 2026-09-02 19:05 | **D1** | 1 | D1: Section 1 - verify current direct-provider surface |
| 13 | `de579ec8a` | 2026-09-02 19:08 | **D1** | 4 | D1: shared error taxonomy and licensing-class lookup table |
| 14 | `6235cfc2b` | 2026-09-02 19:11 | **D1** | 2 | D1: FMP adapter (fmp_client.py) |
| 15 | `42115935d` | 2026-09-02 19:18 | **D1** | 2 | D1: migrate insider.py off direct FMP call onto fmp_client adapter |
| 16 | `d82f6730a` | 2026-09-02 19:21 | **D1** | 2 | D1: migrate fundamentals.py's FMP metrics trio onto fmp_client adapter |
| 17 | `a137a6c7d` | 2026-09-02 19:25 | **D1** | 3 | D1: migrate analyst_actions.py's FMP grades leg onto fmp_client adapter |
| 18 | `c0a6a5dae` | 2026-09-02 19:42 | **D1** | 6 | D1: migrate earnings_estimates.py's 6 originally-scoped FMP call sites onto fmp_client |
| 19 | `842bd3c52` | 2026-09-02 19:42 | **D1** | 1 | D1: record the shared-_fmp_get discovery in the implementation log |
| 20 | `3a6dea330` | 2026-09-02 19:44 | **D1** | 1 | D1: migrate transcript_indexer.py off earnings_estimates delegation onto fmp_client |
| 21 | `5c94118bd` | 2026-09-02 19:45 | **D1** | 1 | D1: migrate financial_history.py's 3 statement legs onto fmp_client |
| 22 | `9596b6461` | 2026-09-02 19:48 | **D1** | 2 | D1: migrate analyst_grades.py's 5 FMP legs off earnings_estimates delegation |
| 23 | `efa9f0a53` | 2026-09-02 19:55 | **D1** | 4 | D1: migrate engine.py's 2 inline FMP calls onto fmp_client |
| 24 | `09561339a` | 2026-09-02 19:56 | **D1** | 1 | D1: mark FMP call-site migration (Section 4) complete in the implementation log |
| 25 | `2d5d0ddb3` | 2026-09-02 20:02 | **D1** | 2 | D1: minimum-scope Massive adapter for the Real-Provider Validation Checkpoint |
| 26 | `0616369aa` | 2026-09-02 20:07 | **D1** | 2 | D1: fix massive_client 404 misclassification found by real-provider validation |
| 27 | `3ad29e784` | 2026-09-02 20:08 | **D1** | 1 | D1: record the Real-Provider Validation Checkpoint results |
| 28 | `ce8b3f26a` | 2026-09-02 20:37 | **D1** | 11 | D1: complete the Massive adapter per spec (extend _MassiveRestClient in place) |
| 29 | `cf41b6a05` | 2026-09-02 20:43 | **D1** | 5 | D1: AST guard census tools for both vendors (spec §21.1) |
| 30 | `833aac0f6` | 2026-09-02 20:50 | **D1** | 9 | D1: add served_total counter + FMP/Massive admin status endpoints (spec §18.2, §7.3) |
| 31 | `44f667a3e` | 2026-09-02 21:12 | **D1** | 3 | D1: fix false real_time/delayed equivalence in massive.get_quote (Section 10 review) |
| 32 | `9d0b5eb26` | 2026-09-02 21:44 | **D1** | 6 | D1 provenance/freshness hardening: entitlement distinction, stale detection, AI-consumable contract |
| 33 | `7adf80bd4` | 2026-09-02 22:15 | **S8** | 14 | S8 Step 1: relocate CoverageLine, build FreshnessBadge + Provenance's degraded state |
| 34 | `834b45df4` | 2026-09-02 23:02 | **S8** | 3 | S8 Step 2 backend: minimal live D1 -> S8 wiring endpoint |
| 35 | `8d04bf75f` | 2026-09-02 23:02 | **S8** | 11 | S8 Step 2 frontend: live D1 wiring, availability axis, accessible detail, visible demo |
| 36 | `03d399a52` | 2026-09-02 23:52 | **S8** | 3 | S8 continuation: minimal backend surface for <Cited>'s narrow interim form |
| 37 | `48bba9614` | 2026-09-02 23:58 | **S8** | 8 | S8 continuation: <Cited> narrow interim form, live-wired; a real bug caught and fixed |
| 38 | `e14a5836b` | 2026-09-03 07:03 | **S11** | 11 | S11 (Session & Market Clock): real NYSE calendar, completing S8's deferred session_stale |
| 39 | `1cf0bf028` | 2026-09-03 07:19 | **S11** | 1 | S11 verification: correct FreshnessBadge.jsx's stale header comment |
| 40 | `408f04935` | 2026-09-03 08:44 | **A3/A4** | 12 | A3/A4 vertical slice: /research/:sym's Estimates+Financials onto S3+D1+S8+S11 |
| 41 | `e994f5337` | 2026-09-03 10:05 | **S7** | 20 | S7 first slice: alert taxonomy package + document-arrival trigger type |
| 42 | `0eec8343d` | 2026-09-03 10:55 | **S1+S2** | 4 | Narrow S1+S2 slice: global Ctrl/Cmd+K command palette for security search + navigate |
| 43 | `0577245df` | 2026-09-03 12:22 | **S2** | 9 | S2 narrow discoverability slice: visible search trigger + in-box '?' help for the global palette |
| 44 | `66b56ccf1` | 2026-09-03 13:24 | **A6/A7** | 25 | Modernize A6/A7 research tabs (Ratings, Ownership, Filings, Calls & Transcript) |
| 45 | `1214dc246` | 2026-09-03 15:07 | **A5** ⛔TC | 26 | Modernize A5 (Events & Calendar) onto S3/D1/S8 for the four real event categories |
| 46 | `529c54987` | 2026-09-03 16:26 | **A5** ⛔TC | 3 | A5 follow-up: distinguish a genuinely empty calendar week from a provider failure |
| 47 | `a1b10c498` | 2026-09-03 22:30 | **A4** | 18 | Add dedicated Analyst Ratings tab, narrow Estimates, canonicalize analyst_grades.py |
| 48 | `4605aa8dd` | 2026-09-04 00:20 | **A8** | 11 | Add News Slice 1: canonical FMP-backed company news on /research/:sym (A8) |
| 49 | `341bb78de` | 2026-09-04 11:27 | **I1** | 15 | Add AI-Native Research Assistant Slice 1: contextual "Explain" tab (I1) |
| 50 | `a21518d0e` | 2026-09-04 13:46 | **I1** | 10 | Add Security Research Q&A Slice 2: 6-composer contextual assistant (I1) |

⛔TC = the commit modified **Terminal-Current** (`api/routers/calendar.py`, `app/src/pages/Calendar.jsx`,
`app/src/pages/calendar/**`). See the Q4 classification in `PROGRAM_STATUS.md`.

**System totals:** D1 21 · S3 11 · S8 5 · S11 2 · A5 2 · I1 2 · A3/A4 1 · A4 1 · A6/A7 1 · A8 1 · S7 1 · S1+S2 1 · S2 1. **UNASSIGNED: 0.**

## Section 2 — already ledgered elsewhere

| commit | when | what |
|---|---|---|
| `4c4e19ede` | 2026-09-07 | **Seam 7** (convergence program) — added 2027 holidays to S11's `nyseCalendar.js`, added a cross-stack parity test, and fixed `voice_temporal_awareness.py`'s missing early-close awareness and naive-DST `_et_now()`. A strict improvement to S11. |
| `ed6b1f041` | 2026-09-05 | the merge commit itself |

## Section 3 — other workstreams building on paths this program created (19 commits)

**This is the section nobody knew existed.** Terminal-Next shipped foundations; at least four
other workstreams have been extending them ever since, and none of it was recorded here.

| commit | when | program-created files touched | subject |
|---|---|---|---|
| `5f4597ae0` | 2026-09-10 20:00 | `api/routers/alert_taxonomy.py`, `tests/test_alert_taxonomy_router.py` | feat(s7): Stage 4 filing-watch creation UI + Stage 5 Settings management (unmerged; NO FLAG until the commit t |
| `084976270` | 2026-09-10 17:07 | `api/services/ticker_explain.py` | fix(ticker-explain): one binding for _DOMAIN_FETCHERS, not two |
| `65cf9833f` | 2026-09-08 09:04 | `app/src/components/CommandPalette.jsx` | Wave L Slice 5: the integrated E2E found two things every slice-level rail missed |
| `d768c4d4d` | 2026-09-07 23:58 | `app/src/components/CommandPalette.jsx` | Wave L Slice 2b: one capture dialog, two doors, and a shortcut chosen from evidence |
| `3f514c09f` | 2026-09-07 06:07 | `app/src/components/CommandPalette.jsx` | Merge: Wave H -- Research Home + Ticker Research Workspace + Continuation UX |
| `810c78b91` | 2026-09-07 06:07 | `app/src/components/CommandPalette.jsx` | Wave H: Research Home + Ticker Research Workspace + Continuation UX |
| `ac76a93cf` | 2026-09-06 22:12 | `scripts/entity_master_seed.py`, `scripts/test_entity_master_seed.py` | Seam 1 seed script: correct the SPAC-unit claim, verified against real data |
| `039d885bb` | 2026-09-06 22:05 | `scripts/entity_master_seed.py`, `scripts/test_entity_master_seed.py` | Seam 1 (read-side half): seed_dot_form_aliases() for class-share tickers |
| `dba97b6f7` | 2026-09-06 21:14 | `app/src/components/CommandPalette.jsx`, `app/src/components/CommandPalette.test.jsx` | CommandPalette: route ticker-search through jsonFetcher (a non-2xx body is not data) |
| `ec095a23d` | 2026-09-06 18:30 | `api/services/ticker_explain.py`, `tests/test_ticker_explain.py` | Seam 29: thread analyst-source outage signal into Ask AI and Compare |
| `8ebb6f076` | 2026-09-06 16:38 | `api/services/test_ticker_search_entity_master_integration.py` | Ticker Search Identity Convergence V1 (Seam 16) |
| `f74a3d1fb` | 2026-09-06 13:23 | `app/src/components/CommandPalette.jsx`, `app/src/components/CommandPalette.test.jsx` | Merge branch 'notebook-primary-platform' into notebook-waveB-merge-temp |
| `19cd26dcc` | 2026-09-06 13:21 | `app/src/components/CommandPalette.jsx`, `app/src/components/CommandPalette.test.jsx` | feat(notebook): Wave B — High-Frequency Notebook UX / Power-User Foundation |
| `12b204853` | 2026-09-06 09:49 | `app/src/components/CommandPalette.jsx`, `app/src/components/CommandPalette.test.jsx` | feat(search): complete the Ask AI convergence gap on CommandPalette + ChartWidget |
| `97ba5f24a` | 2026-09-06 07:17 | `api/services/research/analyst_ratings.py` | fix: ATTENTION SOURCE-INTEGRITY HARDENING V1 — earnings/analyst status-integrity, honest price-move as_of |
| `ca9093c00` | 2026-09-05 12:47 | `api/services/alert_taxonomy/receipts.py` | fix(s7): dual-write durable read state from the ephemeral mark-read path |
| `d71326261` | 2026-09-05 12:27 | `api/services/alert_taxonomy/db.py`, `api/services/alert_taxonomy/document_arrival.py`, `api/services/alert_taxonomy/receipts.py` | feat(s7): durable in-app notification bridge for document-arrival fires |
| `8ec29b457` | 2026-09-05 11:52 | `api/services/alert_taxonomy/db.py`, `api/services/alert_taxonomy/predicates.py`, `tests/test_alert_taxonomy_predicates.py` | feat(s7): duplicate-predicate guard for document-arrival (Stage 3) |
| `073aa7d4d` | 2026-09-05 00:51 | `api/services/ticker_explain.py`, `api/services/ticker_explain_eval/checks.py`, `api/services/ticker_explain_eval/golden_set.py` +7 | Integrate Slice 3 (bounded multi-turn), UCT Composite Rating AI, Earnings Events AI, and Research Deep-Link &  |

⛔⛔ **The most consequential row class: the convergence program's S7 FILING WATCH is implemented
INSIDE Terminal-Next's S7 Alerts `alert_taxonomy` package** (`d71326261`, `8ec29b457`, `ca9093c00`,
`5f4597ae0`). The two things this program had recorded only as a *naming* collision share actual
code. Neither program's documents say so.

Other extenders: **`CommandPalette.jsx`** (7 commits — Wave H, Wave L, notebook Wave B, search
convergence); **`scripts/entity_master_seed.py`** (Seam 1 dot-form alias seeding for class shares);
**`ticker_explain.py`** + its eval harness (I1's Ask AI, extended by Seam 29 and Slice 3);
**`research/analyst_ratings.py`** (A4, extended by attention source-integrity hardening).

## Section 4 — Wave 1+ (2026-09-11 onward), owner-authorized, **branches only, unmerged**

Per the standing rule, every application-code commit this program makes gets a row here **before**
the session reports.

## ✅ MERGE CHECK SUPERSEDED — three of five merged 2026-09-11 22:41 CDT (see the table above)

> The section below recorded the 22:2x state, when a session opened on "merged: all five" and none
> were. Kept as the record of how that was established — the three-way check is the reusable part.

A session opened on the statement that all five had merged. **Verified against `origin/master @
a10c7c94a` and they have not**, by three independent measurements rather than one:

1. **Ancestry** — no branch tip is an ancestor of master. (Inconclusive alone: a squash merge
   produces a new SHA, so this is exactly what a successful squash also looks like.)
2. **Content** — the decisive check. `tests/test_alert_taxonomy_filing_watch_parity.py`,
   `app/src/pages/research/i1S8Boundary.test.js`, `tests/test_ticker_explain_full_text_completeness.py`,
   `api/routers/entity_master_admin.py` and `tests/test_entity_master_seed.py` are all **ABSENT** on
   master; `scripts/test_entity_master_seed.py` is **still in its old location**; `AlertBell.jsx` has
   **zero** `document_arrival` references.
3. **History** — master's last 12 commits are entirely other workstreams (flow-worker weekend bundle,
   the CI rail, hub smoke, deploy-window docs). No merge commit references any of the five.

**Behaviour on master is unchanged, and both reds are still red** — measured, not inferred:
`test_test_discovery_coverage` **1 failed / 4 passed** (same single orphan,
`scripts/test_entity_master_seed.py`), and the FMP census **1 unquarantined violation, 12 quarantine
entries** (D1's tightening to 10 has not landed), rail **1 failed / 7 passed**.

✅ **What DID merge: `ci/flow-worker-watch-coverage` (`2db52c8f3` via `6d40106df`)** — a different
workstream's branch, which is why `tools/flow_worker_watch_coverage.py` is now on master.

⛔ **Consequence: slice 2, S7 price-level and the G2/G4 census delta are all still blocked**, because
each has a precondition that names these merges. Nothing was built on the assumption.

## ⛔ EVERY ROW IN THIS SECTION IS **PENDING-MERGE**

They live on feature branches, **not on `origin/master`**, so the rail's check (1b) does not return
them and cannot yet validate them. Five PRs, merged by the owner, in this order:

| # | branch | tip SHA | status | merge SHA |
|---|---|---|---|---|
| 1 | `feat/s7-filing-watch-parity` | `c46be401f` | ✅ **MERGED** 2026-09-11 22:41 CDT | **`6ed34c4b0`** |
| 2 | `feat/i1-rails` | `be3474241` | ✅ **MERGED** | **`8bf8e93b1`** |
| 3 | `fix/alert-bell-filing-icon` | `76f6e2e77` | ✅ **MERGED** ⛔ MEMBER-VISIBLE | **`080297866`** |
| — | *(runbook Interpretation section)* | — | ✅ **MERGED** 22:52 | **`5b85e0e6c`** |
| 4 | `feat/s3-admin-routes` | `3ebe013a5` | ✅ **MERGED** — **flow-worker stranded: ADDITIVE** | **`1667fc64d`** |
| 5 | `feat/d1-adoption-sweep` | `638e12f48` | ✅ **MERGED** — rail N/A | **`449c3907b`** |
| 6 | `feat/d1-adapter-gaps-g2-g4` | `c8c1e431f` | ✅ **MERGED** — **flow-worker stranded: ADDITIVE** | **`1a3668eaf`** |

### Strand classifications, under the runbook's Interpretation section

| merge | classification | why, in one line |
|---|---|---|
| `1667fc64d` **#4** | **ADDITIVE, safe; redeploy at next window** | **Zero deletions anywhere in `api/`.** Adds a new router, two lines in `main.py` (import + mount), and `store.status_counts()`. flow-worker reaches `entity_master/store.py` transitively via `massive.py` and would run a version lacking only a function **it never invokes**. |
| `449c3907b` **#5** | **N/A — rail does not fire** | Touches no `api/` file at all (`tools/`, `tests/`, `docs/`). |
| `1a3668eaf` **G2/G4** | **ADDITIVE, safe; redeploy at next window** | The **only** deletion in the diff is a `typing` import line gaining `Sequence`. Adds twelve new functions to `fmp_client.py`; flow-worker reaches that module but **calls none of them**. |

⛔ **Both ADDITIVE claims were checked against the diff, not the intent** — `git diff <merge-base>..HEAD -- api/ | grep -cE '^-[^-]'` returned **0** for #4 and **1** for G2/G4, and that one was read (the import line).

### ✅ Post-merge verification on production

**Deploy `SUCCESS`** for `1a3668eaf` (confirmed from `railway deployment list --service web --json`,
matched on the commit hash — not from a health-check guess).

**The first merge in this program with new API surface to actually probe, so it was probed, with a control:**

| probe | result |
|---|---|
| `GET /api/admin/entity-master/status` unauthenticated | **401 · `application/json`** — mounted and admin-gated, exactly as specified |
| `GET /api/admin/entity-master/nope-not-a-route` (control) | **200 · `text/html`** — the SPA catch-all |

⭐ **The control is what makes the 401 mean something.** Without it, a 200 from the catch-all reads
as a healthy route; with it, the JSON-401-vs-HTML-200 split proves the router is live rather than
being answered by the frontend shell.

⚠️ **AND IT CAUGHT A REAL INSTRUMENT ERROR OF MINE, worth recording as the session's sixth false
signal.** My first probe, minutes after the push, returned **200 `text/html` for BOTH** the route and
the control — i.e. not mounted. The cause was my own deploy watcher: it fired on *any* `uptime < 400`,
and an earlier push's build was still settling, so it reported "WEB REDEPLOYED" for the **previous**
deploy. **A watcher that cannot tell two deploys apart will always confirm the wrong one.** The fix
was to key the watch on the **commit hash** in Railway's deployment list, which reported `BUILDING`
at exactly the moment the uptime watcher had declared success.

### Both reds, re-measured on the merged tree

| rail | before | after |
|---|---|---|
| `test_test_discovery_coverage` | 1 failed / 4 passed | ✅ **5 passed, exit 0 — GREEN** |
| `test_fmp_guard_census` | 1 failed / 7 passed, quarantine **12** | **1 failed / 9 passed**, quarantine **10** |

The census failure is the unchanged pre-existing `fmp_news.py:37`, blocked by **G5** (that file
carries a 3-attempt retry loop and a `RequestBudget` ceiling the adapter has no equivalent for). Two
more tests pass than before, and two stale quarantine entries are gone.

### ⛔⛔ FLOW-WORKER REDEPLOY RAN — AND DID **NOT** CLEAR THE STRAND

**Executed 2026-09-12 04:07 UTC (Fri 23:07 CDT, market closed) on owner authorization:**
`railway redeploy --service flow-worker --yes`, exit 0.

| artifact | value |
|---|---|
| deployment status | **`SUCCESS`** (watched BUILDING → DEPLOYING → SUCCESS) |
| **running commit** | **`9efbb34a8`** — ⛔ **unchanged** |
| master at the time | `b272db249` |
| the strands | `1667fc64d`, `1a3668eaf` — **still not in flow-worker's running code** |

⛔⛔ **`railway redeploy` RE-RUNS THE LAST *ACTUAL* DEPLOYMENT, NOT MASTER'S TIP.** Flow-worker's most
recent deployment *records* are `SKIPPED` (17 of the last 20 — the strand, visible in the artifact),
and the CLI resolved "latest deployment" to the last **SUCCESS**, `9efbb34a8`. It rebuilt the code
flow-worker was already running.

⭐ **So the redeploy dropped the OPRA websocket and bought nothing.** The cost was zero only because
the market is closed. Had this been run in a window with the tape live, it would have cost a
permanent gap for no benefit whatsoever.

### ⛔ THE STANDING AUTHORIZATION NEEDS REVISING — its premise is false

The owner's new standing rule reads: *"for future ADDITIVE strands, you may run the flow-worker
redeploy yourself via CLI — weekend or after-hours only, market closed, artifact-confirmed,
ledgered."* **A CLI redeploy cannot discharge an ADDITIVE strand**, because it does not advance the
running commit. Verified above by artifact, not inferred.

**The CLI has no command that can.** `railway deployment` offers only `list`, `up`, `redeploy`; there
is no "deploy commit X". `railway up` uploads the *local directory* — a non-git deploy source — which
is not an acceptable way to put code on a production service.

**What actually clears a strand, as far as this session can establish:**

1. **A push touching a watched file** — the conventional `api/flow_worker_main.py` header edit. ⛔
   Barred to this program by the standing "nothing in flow-worker" rule, and it is the runbook's own
   documented trigger.
2. **A Railway dashboard action that builds the latest commit**, if one exists — not reachable from
   the CLI, and untested.

⚠️ **Until one of those is settled, an ADDITIVE strand stays stranded until some *other* workstream
happens to push a watched file.** The runbook's "redeployed at the next window regardless, so stale
never exceeds a week" is therefore an assumption about other people's commits, not a mechanism this
program controls. **That should be corrected in the Interpretation section once the owner rules on
which path to use.**

### ✅ THE FIX — deploy marker created, pending ONE owner click

| commit | what |
|---|---|
| **`f42b11c65`** | `api/flow_worker_deploy_marker.txt` (new) + the corrected `deploy-windows.md` Interpretation section. On master. |

**`api/flow_worker_deploy_marker.txt`** is read by nothing. Its only job is to sit on flow-worker's
watch list so that appending a dated line forces a rebuild **from master's tip**. Rail checked with it
committed: **OK** — a `.txt` is not importable, so it creates no strand of its own.

⛔ **NOT LIVE YET. The authenticated CLI CANNOT write service build config.** `railway service` offers
only `link / status / logs / redeploy / restart / scale`; `railway variables` is *environment*
variables. There is no `service update` and no settings command. **Owner action, one pattern:**

```
api/flow_worker_deploy_marker.txt
```

Added to flow-worker → Settings → Build → Watch Paths, **appended, nothing else changed**. It becomes
the 24th entry.

⚠️ **And the header mirror cannot be synced by this program.** `api/flow_worker_main.py` carries the
in-repo mirror of the watch list, and that file is barred by the standing "nothing in flow-worker"
rule — the narrow exception the owner granted covers **the marker file only**. So once the pattern is
live the mirror will read 23 while Railway reads 24. ⭐ **That is real drift, and it belongs to
whoever owns `ops/watch-mirror-sync`** — the workstream that synced it last. Flagged rather than
fixed, because fixing it would breach the rule that makes the exception meaningful.

### Corrections shipped in `f42b11c65`

- The Interpretation section's *"flow-worker is redeployed at the next window regardless, so stale
  never exceeds a week"* — **my sentence, and it was an assumption about other workstreams' commits,
  not a mechanism.** Replaced with the marker.
- A new **"How a strand is actually discharged"** section recording the 04:07 no-op as a standing
  hazard: a CLI redeploy returns SUCCESS on the commit it started from, so **the artifact is the
  commit hash, never the status.**
- The owner's earlier *"you may run the flow-worker redeploy via CLI"* line is **rescinded** and
  replaced by the marker rule: window only, append never rewrite, confirm the commit advances,
  ledger it, and the marker is the only flow-worker path this program may touch.

### ✅ WATCH PATTERNS — the CLI CAN read them; RAILWAY_TOKEN item is closed

`railway deployment list --service flow-worker --json` exposes
`meta.serviceManifest.build.watchPatterns` — **23 entries**, read live. **Diffed against the
`api/flow_worker_main.py` header mirror on current master: ZERO DRIFT, 23 = 23, both directions.**

⚠️ An earlier reading in this session found the header listing 21 `.py` files with TODOs about
`confluence_flow.py` — that was a **stale** copy. Another workstream's `ops/watch-mirror-sync` merge
(`9efbb34a8`) synced it since. The mirror is now accurate, and this is the first time it has been
**measured** against Railway rather than trusted.

⛔ **The `RAILWAY_TOKEN` caveat is retired.** Earlier ledger text said tier verification was "reasoned
from the committed mirror rather than measured against the Railway dashboard, which is the
authority." It has now been measured, without a token — the authenticated CLI session is sufficient,
exactly as `deploy-windows.md` says ("no token is needed on a machine where `railway` works").

### (superseded) FLOW-WORKER REDEPLOY — OWED, NOT YET DONE

Two ADDITIVE strands are now on master (`entity_master/store.py`, `fmp_client.py`). Per the
Interpretation section, flow-worker gets redeployed at the next window so staleness never exceeds a
week. **`RAILWAY_TOKEN` is not set**, so the owner's stated fallback applies — though the `railway`
CLI *is* authenticated on this machine, so the action is one command away on the owner's word. ⛔ Not
taken unilaterally: a flow-worker redeploy drops the OPRA websocket and Massive does not replay, and
the owner reserved this click for themselves in the no-token case.

### F-I1-3 — CLOSED

✅ Delivered inside GATE-I1 slice 1 and merged at `8bf8e93b1`: golden-set adversarial cases B01–B06
for the hard boundary plus 15 payloads across four families. **No gate line was needed.**

**Master `a10c7c94a` → `080297866`.** Verified per merge: content present, rail OK, and on the final
stack **361 backend passed / exit 0** and **3 frontend files, 26 tests passed / exit 0**.

✅ **PRODUCTION TOOK IT — verified by artifact, not inferred.** Push 22:41 CDT; the web pod's
`/api/health` **uptime reset to 15 s** about two minutes later (a boot, not a rising counter — the
distinction this program has had to re-learn: a 200 and a rising uptime are compatible with a deploy
that never swapped). Post-deploy liveness, browser UA because Cloudflare 1010-blocks curl's default:

| route | result |
|---|---|
| `/api/health` | **200**, `status: ok`, uptime 32 s, rss 845 MB (down from 1722 MB pre-swap — a fresh process) |
| `/calendar` | **200**, 14,507 B, SPA shell `id="root"` present |
| `/research/:sym` | **200** |

⚠️ All three merges were test-only or a single frontend icon entry, so there is **no new API surface
to probe** — this confirms the deploy swapped and the app serves, not that any new behaviour works.
The icon is verifiable only in a browser.

| `c8c1e431f` | `feat/d1-adapter-gaps-g2-g4` | **D1** | `api/services/fmp_client.py` (+344), `tests/test_fmp_client_gaps_g2_g4.py` (new, 365) | ⛔ **HELD — same rail failure.** G2: **11** typed functions (not the 9 the prior sweep estimated), led by `get_company_profile` (8 modules). G4: `get_news_stock_multi` as a **separate** function, with a test asserting the built request is byte-identical for one symbol. **No call site changed.** ⭐ Its endpoint census was derived by AST with a third rule added because the first two **missed six endpoints** bound to module-level constants — *the instrument reproduced its own blind spot and the agent caught it*. 12 mutations each RED with a real totals line, after a first round produced six bogus REDs from a wrong `cwd` and no totals line, caught and rerun |

## ⛔⛔ THE RAIL BLOCKS THIS PROGRAM'S BACKEND WORK — structural, not a one-off

**Two branches now fail `tools/flow_worker_watch_coverage.py` for the same reason**, naming different
files: `feat/s3-admin-routes` (`api/services/entity_master/store.py`) and
`feat/d1-adapter-gaps-g2-g4` (`api/services/fmp_client.py`). Both are reachable from
`api/flow_worker_main.py`; neither is on the watch list.

**Measured on `origin/master` — the number that matters:**

| | count |
|---|---|
| files flow-worker **reaches** | **154** |
| files on its **watch list** | **23** |
| ⛔ **reachable but UNWATCHED** | **133** — of which **83 are in `api/services/`** |

⭐ **So the rail fires on any change to 133 files, by anyone.** This is not a quirk of our two
branches — it is the designed behaviour of a rail that is 8 hours old, against a watch list covering
23 of the 154 files flow-worker actually loads. This program's backend work lives almost entirely in
`api/services/**`.

⚠️ **CORRECTION TO THE RECOMMENDATION THIS LEDGER CARRIED EARLIER.** I recommended adding
`api/services/entity_master/**` to flow-worker's watch list. **The tool's own author explicitly
rejects that remedy** — `.github/workflows/flow-worker-deploy-coverage.yml`'s header reads: *"This
does NOT widen the watch list. A wider list means more flow-worker restarts, and each one gaps the
OPRA tape permanently until the T+1 flat file. It makes 'this push deploys nothing to flow-worker'
visible at review time."* ⭐ **The rail's purpose is VISIBILITY, not prohibition.** I recommended the
one remedy its designer argued against, having read the tool but not the workflow that runs it.

**It runs on `push` as well as `pull_request` for `api/**`,** so a direct master push trips it too —
the red is a CI signal either way, not a merge gate that can be routed around.

**The three real options, for the owner:**

1. **Read the red and push anyway** — the tool's own stated intent. Both stranded changes are
   **additive**: flow-worker would run an older `store.py`/`fmp_client.py` missing functions it never
   calls. ⚠️ This is a judgement per push, and it stops being safe the moment a change is not additive.
2. **Force a flow-worker redeploy** by touching a watched file in the same commit (the conventional
   `api/flow_worker_main.py` header edit). Costs one tape gap — **free tonight, market closed** — but
   ⛔ barred to this session by the standing "nothing in flow-worker" rule.
3. **Widen the watch list** — effective, and explicitly against the tool author's design intent.

## ⛔⛔ WHY #4 IS HELD — `tools/flow_worker_watch_coverage.py` exits 1

```
[watch-coverage] FAIL — flow-worker RUNS these files but will NOT redeploy for them:
    api/services/entity_master/store.py
  This push would leave flow-worker on the OLD code with every test green.
```

**The chain, taken from the rail's own reachability function rather than re-derived:**
`api/flow_worker_main.py` → … → **`api/services/massive.py`** → `entity_master/api.py` →
**`entity_master/store.py`**. Flow-worker loads it transitively via Massive, and
`api/services/**` is not on flow-worker's watch list.

⭐ **This is a real strand the earlier WEB-ONLY assessment could not have caught.** That assessment
intersected the changed files with the *watch list* and correctly found no watched file. The rail
asks a different and better question — *does flow-worker RUN a changed file it won't redeploy for?* —
and the tool that asks it only landed on master at 22:14 tonight, after the assessment was written.

⚠️ **Risk of the strand itself is nil TODAY and that is not the point.** The change is additive
(`status_counts()` added to `store.py`); flow-worker would simply run a version lacking a function it
never calls. The rail cannot know that, and the next change to that file might not be additive.

**The two documented remedies, and why neither is mine to apply:**

1. *Touch a watched file in the same commit* — the conventional trigger is an
   `api/flow_worker_main.py` header edit. ⛔ **Prohibited by the standing "nothing in flow-worker"
   rule.**
2. *Add `api/services/entity_master/**` to flow-worker's watch list* — Railway dashboard config, the
   owner's, and it widens the list, which the runbook notes means more tape gaps.

**Measured fallback, already verified:** merges 1, 2, 3 **and 5** together pass the rail (exit 0) —
**only #4 strands.** #5 is held not for any technical reason but because its whole purpose was to be
read *after* #4 cleared the discovery-coverage red; landing it alone puts two unexplained reds on
master at once.

⛔ **THE NEXT SESSION'S FIRST ACTION, on the owner's word "merged":** re-run the protection rail
against `origin/master`, flip each row above to **MERGED** with its **merge SHA** (the SHA on master,
not the branch tip — they differ if the merge is a squash or a merge commit), and confirm rail PASS.
**Nothing else starts before that.** A row left at PENDING-MERGE after its branch is on master is the
exact drift this ledger exists to prevent.

## ✅ THE STRANDS ARE DISCHARGED — the deploy-marker mechanism, proved by a control

**Owner ruling, 2026-09-12: a deploy-marker file.** `api/flow_worker_deploy_marker.txt` is read by
nothing. Its only job is to sit on flow-worker's Railway watch list, so that appending a dated line
forces a rebuild **from master's tip** — picking up every ADDITIVE strand flow-worker would otherwise
skip forever. Registered in the Railway dashboard through the browser, 2026-09-12; CLI readback
confirms **24 patterns**, the previous 23 unchanged and in order.

**⭐ The mechanism is proved by a CONTROL, not by a single green.** The same file appears in two
consecutive pushes, and the ONLY variable between them is whether it was on the watch list yet:

| time (UTC) | commit | marker on watch list? | flow-worker |
|---|---|---|---|
| 04:19:08 | `f42b11c65` — **creates** the marker | ❌ not yet registered | **SKIPPED** |
| 04:25:39 | `f42b11c65` — same commit | (settings save rebuilt master tip) | SUCCESS |
| 04:31:55 | `fd735513b` — **appends** to the marker | ✅ registered | **SUCCESS** |
| 04:34:22 | `5ec0a771f` — another workstream, no watched file | ✅ registered | SKIPPED |
| 04:36:19 | `33e7ba497` — I1 slice 2, frontend only | ✅ registered | SKIPPED |

⛔ **Do not read the 04:25 SUCCESS as proof of the mechanism.** That build was triggered by the
watch-pattern *settings save*, which Railway treats as a config change and rebuilds at master tip. It
proves the registration took; it says nothing about whether appending a line triggers a deploy. Only
the 04:31 push — whose sole claim on the watch list is the marker file itself — tests the mechanism,
and only because the 04:19 SKIPPED row sits beside it as the negative control.

⭐ **The two SKIPPED rows after registration matter as much as the SUCCESS.** They prove the watch
list was **not accidentally widened** by the browser edit: a push touching no watched file is still
skipped, so the marker bought a lever without buying extra tape gaps.

**⛔ CONFIRMED AT THE TREE, not at the merge graph.** A green deploy proves a build ran; it does not
prove the stranded code is in it. Measured with `git show <sha>:<file>` on both sides:

| | `9efbb34a8` (what flow-worker WAS running) | `fd735513b` (what it runs now) |
|---|---|---|
| `entity_master/store.py` → `def status_counts` | **0** | **1** |
| `fmp_client.py` top-level `def`s | **32** | **45** (+13) |

The 13 gained are `get_analyst_estimates`, `get_company_profile`, `get_etf_holdings`,
`get_grades_news`, `get_grades_latest_news`, `get_news_general_latest`, `get_news_stock_latest`,
`get_news_stock_multi`, `get_news_press_releases_latest`, `get_sp500_constituents`,
`get_nasdaq_constituents`, `get_dowjones_constituents`, `_symbols_csv`. ⭐ The **zero** in the first
column is the load-bearing cell — without it, "the function is present now" is compatible with its
having been present all along.

⚠️ **Flow-worker is at `fd735513b`, NOT at master's tip, and that is correct.** Master moved on to
`5ec0a771f` and `33e7ba497` within five minutes, both correctly SKIPPED. The claim to make is
"flow-worker advanced to the tip **as of the bump**", never "flow-worker is at master tip" — the
second sentence will be false within the hour of any marker bump and would teach the next reader to
expect something the mechanism does not promise.

**Strands discharged by the bump:**

| strand | system | what was stranded | class |
|---|---|---|---|
| `1667fc64d` | **S3** | `api/services/entity_master/store.py` — `status_counts()` | **ADDITIVE** |
| `1a3668eaf` | **D1** | `api/services/fmp_client.py` — 12 new typed functions (G2/G4) | **ADDITIVE** |

Both add functions flow-worker never calls, so the stranded interval carried nil risk — and that is
**a property of these two changes, not of the mechanism**. The classification row is required before
every future push under the standing coverage-rail ruling, and a BEHAVIOUR-CHANGING strand does not
get to ride a marker bump silently.

**Marker-bump rules (owner, standing):** window only (weekend or after-hours, market closed) ·
**append, never rewrite** · confirm by the **commit hash advancing**, never by a SUCCESS status ·
ledger the before/after · and the marker is the ONLY flow-worker path a non-flow-worker program may
touch. **Market was closed for this bump.**

⚠️ **The mirror is the one in-repo copy and it is now synced.** `_EXTRA_WATCHED` in
`tools/flow_worker_watch_coverage.py` reads 24; the rail reports `reachable=154 watched=24`, exit 0.
⛔ The marker **cannot** live in the header's `api/{...}.py` brace list — that list expands as
`api/<name>.py`, so a `.txt` there becomes `api/flow_worker_deploy_marker.txt.py` and silently
watches nothing.

⚰️ **AND THE CLI CANNOT DO THIS.** `railway redeploy --service flow-worker` returned exit 0 and went
BUILDING → DEPLOYING → **SUCCESS on the same commit it started from** (`9efbb34a8`, while master was
`b272db249`, 04:07:16). The CLI resolves "the latest deployment" to the last **actual** deployment,
and flow-worker's recent records are mostly SKIPPED. It dropped the OPRA websocket and advanced
nothing — free only because the market was closed. `railway deployment` offers list, up and redeploy;
`up` uploads the local directory, which is not an acceptable production deploy source.


**Tier verification, 2026-09-11:** all five checked against flow-worker's committed watch list — the
21 `api/<name>.py` files mirrored in `api/flow_worker_main.py`'s header. **None touches a watched
file**, so none needs an after-hours window. Two (`feat/i1-rails`, `feat/s3-admin-routes`) touch
`api/services/**` or `api/routers/**`, which deploys web + worker + bars-api and **explicitly not**
flow-worker. ⚠️ `RAILWAY_TOKEN` is not set in this session, so this is reasoned from the committed
mirror rather than measured against the Railway dashboard, which is the authority.

| commit | branch | system | files | what |
|---|---|---|---|---|
| `738abc087` | `feat/d1-adoption-sweep` | **D1** | `tools/fmp_guard_census.py`, `tests/test_fmp_guard_census.py` | Retired **2 verified-stale quarantine entries** (`api/routers/calendar.py`, `api/services/econ_calendar_fmp.py`) — both already migrated and measuring zero violations, so their exemptions were **suppressing the rail on clean files**. Added `test_retired_quarantine_entries_are_genuinely_clean` and `test_no_quarantine_entry_is_stale`, the second generalizing the defect |
| `638e12f48` | `feat/d1-adoption-sweep` | **D1** | `docs/d1-implementation-log.md` | Recorded the five adapter gaps (G1–G5) that block every remaining FMP call site |

| `7f483014b` | `feat/s3-admin-routes` | **S3** | `api/routers/entity_master_admin.py` (new, 272), `api/main.py` (+2 mount), `api/services/entity_master/store.py` (+66 `status_counts()`), `scripts/entity_master_seed.py` (+17 docstring correction), `tests/test_entity_master_admin.py` (new, 576) | **Closes the S3 open item.** `GET /api/admin/entity-master/status` with spec §7.3's exact field names, `last_*_at` **derived** from `MAX(applied_at)` by `entity_events.source` rather than a counter, zero-denominator guarded. `POST /api/admin/entity-master/reconcile?dry_run=true` (default **true**), single-flight with 409, no client-supplied `db_path`, nothing scheduled. **26 tests, independently re-run by the orchestrator: `26 passed … in 6.35s`, exit 0.** Mutation-proved six ways, all reverted |

| `3ebe013a5` | `feat/s3-admin-routes` | **S3** | `scripts/test_entity_master_seed.py` → `tests/test_entity_master_seed.py`, `docs/entity-master-implementation-log.md` (+path note) | **Collected a suite that no standard pytest run had ever executed.** `pytest.ini` declares `testpaths = tests, api`, and `tests/test_test_discovery_coverage.py` was **already failing on `origin/master`** naming this file as its single orphan. The suite was sound the whole time: **18 passed, exit 0** once collected; the discovery rail then goes **5 passed, exit 0**. ⛔ Moved rather than adding `scripts` to `testpaths`, because that would make a standard run collect `scripts/test_massive_ws.py` — which the same rail exempts as "a manual probe against the LIVE Massive WS; Massive allows ~1 connection per key, so running it kicks production off the OPRA feed." **Extending `testpaths` would have turned a routine test run into a production-outage risk** |
| `4d7a795a4` | `feat/s7-filing-watch-parity` | **S7 Alerts** | `tests/test_alert_taxonomy_filing_watch_parity.py` (new, 595) | **The filing-watch parity rail — the precondition for every remaining S7 trigger type.** 20 tests over the three observables. **Test-file only; zero source changes; working tree clean.** Mutation-proved: M1 deleted `symbol` from `predicates.resolve_entity_scope` → **5 failed**, the entity id leaking into the bell title and the `/research/` URL; M2 changed the `fire_key` scheme → **2 failed**, and ⚠️ **the existing suites stayed green on M2 — that regression is silent today.** Control `test_CONTROL_document_arrival_is_still_the_only_trigger_type_in_the_package` AST-scans for module-level `TYPE_ID` and flips the day S7 lands any new type |

| `be3474241` | `feat/i1-rails` | **I1** | `app/src/pages/research/i1S8Boundary.test.js` (new, 457), `tests/test_ticker_explain_full_text_completeness.py` (new, 320), `tests/test_ticker_explain_adversarial.py` (new, 194), `api/services/ticker_explain_eval/{golden_set,checks}.py` (+401), `tests/test_ticker_explain_eval.py` (+6) | **GATE-I1 first slice, approved before Checkpoint 1 — the first gate this program's rule has actually preceded.** F-I1-1 S8-boundary AST rail (acorn+acorn-jsx; I1 surface, S8 primitives and the concept vocabulary all **derived**, never hand-typed). F-I1-4 `_full_text()` completeness rail, fields derived from `EXPLAIN_SCHEMA` with an unfamiliar shape **raising rather than skipping**. B01–B06 hard-boundary cases + 15 adversarial payloads. ⛔ **`ticker_explain.py` and `AskAiTab.jsx` byte-identical to master — no product path touched.** Orchestrator re-ran: backend **312 passed, exit 0**; frontend **Test Files 1 passed (1), Tests 8 passed (8)**, file count asserted |
| `76f6e2e77` | `fix/alert-bell-filing-icon` | **filing watch** (protected consumer) | `app/src/components/AlertBell.jsx` (+6) | ⛔ **MEMBER-VISIBLE — its own PR by ruling 2b, flagged to the owner by name, never bundled with S7 work.** Adds the missing `document_arrival: 'document'` entry so a new 10-K no longer looks identical to a price alert. `document` is an existing UIcon glyph. Existing AlertBell suites re-run: **2 files, 18 tests passed, exit 0** |
| `c46be401f` | `feat/s7-filing-watch-parity` | **S7 Alerts** | parity test docstring (+31) | Records that the rail pins the **shipped** shape deliberately, and why, so a future reader holding an older spec does not "correct" the assertions. Carries **F-S7-1** at the point of use. Docstring only; **20 passed, exit 0** |

### ⛔ F-S7-1 — migrate filing watch to join on `{kind, id}`

**Recorded, not scheduled.** Once S3 entity ids are the canonical key across alert types, filing
watch should stop joining on `entity_scope.symbol`. ⛔ **Sequenced with the first trigger type that
needs entity-scoped matching — never standalone.** Alone it would touch a live member-facing feature
for no member benefit, and per the protected-consumer ruling it would be an owner-flagged PR anyway.
When it lands, the parity rail's `symbol` assertions change with it, on purpose.

### ⛔⛔ F-I1-1 FOUND A REAL, LIVE VIOLATION — the Phase-2 defect never actually closed

`AskAiTab.jsx`'s "Sources" block **renders its own citation list** — `[E#]` marks, source, date and
link in local CSS-module classes — instead of composing S8's `<Cited>` / `<Provenance>`. Its sibling
tabs on the same page (NewsTab, OwnershipTab, AnalystRatingsTab) all compose the S8 primitives, so
**the Ask-AI answer shows a different provenance affordance from every tab beside it.**

⭐ **This is the exact defect Phase 2's adversarial validation "fixed" in 2026-09-02 — by writing a
sentence into an architecture document.** The sentence was true as a decision and false as a
description, and stayed false for nine days while I1 shipped generated prose to members. **A rail
built to catch it caught it on its first run.** Recorded in the branch's `RECORDED_BOUNDARY_DEBT`;
**not fixed — it is member-visible and out of GATE-I1's approved scope.**

⚠️ Second finding, fixed in the eval harness only: **`checks._full_text` never read the refusal
sentence.** Its docstring claimed it covered `refusal_reason`; the code read only
`insufficient_evidence_reason` — the served name, not the raw-payload name. **A fabricated number or
a Buy directive inside a refusal passed every mechanical check.** Two adversarial cases (A04, A14)
passed before the fix. No product path was touched.

⛔ **TWO DEVIATIONS ON `feat/s3-admin-routes`, both caused by the orchestrator's brief, both needing
an owner ruling — neither is the agent's error:**

1. **`/status` is ADMIN-GATED; `entity-master-spec.md` §7.3 specifies a NO-AUTH read.** The spec
   reasons explicitly that it mirrors `bars-stream-status` and `reconciliation-status` "rather than
   inventing a third auth posture for the same kind of endpoint." The brief said admin-only and the
   agent complied, recording the deviation in the module header. ⭐ **Recommendation: keep
   admin-only and amend the spec** — this program's own **R-17** finding flags unauthenticated
   endpoints as a live risk in this codebase, and this route exposes counts over the security
   universe. But it is a spec change, so it is the owner's call.
2. **`/reconcile`, not `/reseed`.** Correct, and better than the brief: the seed lives in `scripts/`
   and `reconciliation.py`'s own header forbids the job depending on `scripts/` at runtime, so a
   `/reseed` route would have broken that boundary. §7.4 names `/reconcile`.

⚠️ **The brief also mis-cited its own precedent**: it claimed `cot.py`'s `/reseed` "uses a background
thread." **It uses `BackgroundTasks`** (`force_reseed`, line 93); the daemon-thread precedent in that
file is `POST /narratives/prewarm` (line 129). The agent caught this and followed the thread, for the
right reason — `BackgroundTasks` borrows the shared 64-slot anyio pool, which is the **2026-07-01
524-outage mechanism**, for a 60-page Massive walk. ⭐ **The agent's reading of the codebase beat the
orchestrator's.**

⛔ **W1-A migrated ZERO call sites, and that is the finding, not a failure.** Every remaining direct
FMP site is blocked by a missing adapter capability, an explicit in-repo directive, or an owner
exclusion. Nothing was hacked around and the adapter was not speculatively extended. Detail and
verification: the session report and `docs/d1-implementation-log.md` on that branch.

⚠️ **Pre-existing red, NOT introduced here:** `tests/test_fmp_guard_census.py::test_real_repo_has_zero_unquarantined_violations`
**already fails on `origin/master`** — `api/services/news/adapters/fmp_news.py:37` carries a
`financialmodelingprep.com` literal and is not quarantined. Independently verified against master's
own tree. Fixing it requires a behaviour change (gap G5: that file has retry, backoff, a request
ceiling and 429 sleep-retry that the adapter does not).

## WAVE 3 CONTINUED — four more merges on the owner's rulings, all ADDITIVE, 2026-09-12

| what | commit | classification |
|---|---|---|
| **D2 CP1** — the canonical address book as inert data | **`b9783d509`** | ADDITIVE — 5 files, 0 in flow-worker's closure |
| **S12 first migration** — both S7 cohorts onto `user_tags` | **`56df6803f`** | ADDITIVE — 7 files, 0 in the closure |
| **F-S10-2** — `<Cited>` pins ET with a label (MEMBER-VISIBLE) | **`e909279e1`** | ADDITIVE — 4 files, 0 in the closure |
| the load-sensitive rail fix | **`de9551dd9`** | ADDITIVE — 1 file |

⛔ **Every classification confirmed with `reachable_paths()` and the intersection printed, not
inferred from file extensions.** No marker bump on any of the four.

---

### D2 CP1 — `b9783d509`. Gate `1a0adb471`. Rulings A / YES / A / YES; CP1 signed.

**137 metrics, derived, inert.** Every value comes from a declaration that already exists —
`closedTable.json` via `ast_lint.TABLE`, `resolve_entity_scope`, `_BARS_STORE_TF_KEYS`,
`ProvenanceRecord`. **Not one value is typed.** `test_no_product_path_reads_the_address_book` walks
every module under `api/` with prose stripped and fails by name if one reads it — a reader is CP2.

⭐ **THE POPULATION IS REPORTED, NEVER ASSERTED AS A COUNT.** There is no `assert len(metrics) == N`
anywhere. The axis check asserts the PROPERTY — one store, one cadence, one grain — and PRINTS the
count.

⚰️ **AND THAT IS THE CORRECTION THIS CHECKPOINT OWED.** `scan_evaluator.py` said *"all 54 declared
scalars are unanimous"* and warned about *"a fifty-fifth"* — **inside a paragraph whose own last
line reads "⛔ NOTHING HAND-LISTS WHICH SCALARS ARE NIGHTLY."** The manifest had grown well past 54
and the unanimity claim was **still true**: the mechanism was right, only the number drifted. Count
gone, retired sentence kept verbatim, a test reports it now.

**⛔ TWO THINGS THE RAILS CAUGHT WHILE BEING WRITTEN, both about committing generated data:**

1. The book **would not have been committed** — `.gitignore`'s `data/` excludes `api/data/`, so it
   needs `git add -f`. A generated file nobody can diff in review is a second authority with extra
   steps, and the rail that asks *git* whether the file is tracked is what caught it.
2. ⚰️ **The negation that looks like the fix cannot work.** Git cannot re-include a file whose
   PARENT DIRECTORY is excluded, so a `!api/data/<file>` line reads like a working mechanism and
   does nothing. ⚠️ **That is also true of the existing `!api/data/voice_kb/` lines** — those files
   are tracked because they were force-added. Recorded, not fixed; not this program's.

Mutations, restored by re-deriving or by edit: a metric's cadence diverges → **2 RED** · a declared
scalar name missing → **8 RED** · a product path references the book → **1 RED**, by name.

**DEC-14's expiry condition is now in `ARCHITECTURAL_DECISION_REGISTER.md` verbatim**, with the
census rail cited by test name (`test_real_repo_has_zero_unquarantined_violations`) and the clause
that distinguishes *not yet addressed* from *deliberately outside* — without which it can never
reach zero, because `fmp_news.py` must never migrate.

**`indicator-condition` is sequenced behind D2 CP1 PLUS the first non-screener store**, recorded as
§2b of the S7 completion plan. ⛔ CP1 alone is not enough, and that is the point: all 137 metrics
are `store: screener_rows`, so the book can address a nightly screener column and nothing else.

---

### S12 first migration — `56df6803f`. Gate `afdd4adf5`.

Both S7 projections' cohorts are one SQL predicate over `user_tags` now. **A rollout gate that was
written as a role check**, duplicated across two modules, with a third copy already scheduled.

⛔⛔ **AN EMPTY COHORT MEANS NO MEMBERS. NEVER A FALLBACK TO ADMINS.** The comfortable alternative
needs no seeding step and puts a **second authority** on who is in a cohort — so the day somebody
emptied the tag deliberately, the system would silently re-cover every admin.

**THE SWAP IS A NO-OP, MEASURED** — in a sandboxed `auth.db` with the census pins applied before any
`api.**` import, so no write touched a shared data root:

```
BEFORE (retired role rule) ....... 15 projected
AFTER, UNSEEDED .................. 0     <- the ruling, demonstrated
seeded ........................... 5 tag rows
AFTER, SEEDED .................... 15 projected, IDENTICAL ROW IDS
members with alerts .............. 7, none projected either way
```

⭐ **Identical ROW IDS, not an identical count** — 15 → 15 is compatible with one row entering and
another leaving.

⛔ **AND THE DRY RUN AGAINST FRIDAY'S BARS COULD NOT VERIFY IT, WHICH IS THE FINDING.** It returns
`projected 0` **before AND after**, because the dev box's `auth.db` has **116 admin accounts and
ZERO active admin alerts** (read live, read-only). That `0 == 0` is the **NO DATA case wearing the
QUIET case's clothes**, and banking it as verification is exactly what the four comparison outcomes
exist to prevent. Both dry runs re-ran clean; `--self-check` PASSED, so the scratch guard still
bites.

⛔ **The seed is in `api/main.py`, NOT `auth_db.init_db()`** — `auth_db.py` is inside flow-worker's
import closure and is **not** on its watch list, so editing it would strand flow-worker on stale
code for a change it runs. Measured, not assumed.

**CP4's all-members flag is no longer a code path.** Its rail now asserts the stronger truth —
**unset changes nothing, AND SO DOES SET** — and ends by adding a TAG and watching the cohort widen
with no variable at all.

---

### F-S10-2 — `<Cited>` pins ET with a visible label. `e909279e1`. MEMBER-VISIBLE.

One instant, one S8 surface, read four different ways depending on where the member sat:

| viewer zone | BEFORE | AFTER |
|---|---|---|
| `America/New_York` | `"9/11/2025, 9:32:15 AM"` | `"9/11/2025, 9:32:15 AM ET"` |
| `America/Chicago` | `"9/11/2025, 8:32:15 AM"` | `"9/11/2025, 9:32:15 AM ET"` |
| `Europe/London` | `"9/11/2025, 2:32:15 PM"` | `"9/11/2025, 9:32:15 AM ET"` |
| `Asia/Tokyo` | `"9/11/2025, 10:32:15 PM"` | `"9/11/2025, 9:32:15 AM ET"` |

⭐ **A London reader was shown a bar validated at "2:32 PM" and nothing said which afternoon that
was.** ⛔ The label is the other half, not decoration: pinning the zone silently would swap one
unlabelled timestamp for another.

The snapshot-identity tests **changed, as expected**, and three retired assertions are kept verbatim.
What stays pinned byte-for-byte is the ABSENT behaviour. Mutations: the zone un-pinned → **3 RED**;
the label dropped → **7 RED**.

---

### F-S10-1 — two `formatPrice`s, six importers. RECORDED, folded into S10 CP2. No fix now.

`chart/drawingLabels.js::formatPrice` renders `"123.46"` — no currency symbol, tick-aware decimals,
**the empty string** when absent — against `presentationFormat.js`'s `"$12.50"` and em dash. Four
product modules and two test files import the first.

⚠️ **`StopConfirmSheet.jsx` seeds an EDITABLE INPUT from it**, so changing the format changes what a
member sees *and then edits and submits* — CP2 must treat that site as behaviour, not presentation.

⭐ **The hard part is not the code, it is deciding which rule is right — and the answer is probably
"both, for different surfaces."** A chart label must be tick-aware and must not spend pixels on a
currency symbol; a provenance disclosure must be unambiguous. ⛔ And the two absent sentinels are
read by LAYOUT: an em dash holds a column, an empty string collapses it.

---

### F-S7-5 — the catalyst dedup collision is a LIVE PRODUCTION BUG

> **An admin who also WATCHES a name never receives the must-know alert for it.**

Both legacy rules write `catalyst_alerts_fired` keyed `(user_id, ticker, market_date)`, watchlist
first. ⭐ **The suppressed alert is the HIGHER-severity one**, and the suppression lands exactly on
the names an operator cared enough to watch — while a must-know alert exists to reach somebody
*regardless* of their watchlist.

⚰️⚰️ **CORRECTED BY A LIVE READ, SAME DAY.** This row first said *"latent, not safe —
`CATALYST_MUSTKNOW_ALERTS_ENABLED` defaults OFF and was not observed set, so there are no live
victims today."* **Wrong.** Read live on `web`: `CATALYST_MUSTKNOW_ALERTS_ENABLED=1`,
`CATALYST_MUSTKNOW_GRADES=A`, and `CATALYST_ALERTS_ENABLED` unset (code default ON). **Both rules
are armed. The collision has live victims today.**

⭐ *"Was not observed set"* was true and misleading — the variable had not been looked at, and a
code default was allowed to stand for a configuration. **The `SMOKE_LOGIN_LINK_ENABLED` shape, for
the second time in one day, and the second time it was this session's own claim.**

⛔ **AND THE SAME READ EXPOSED A DEFECT IN CP2's MIRROR** (fixed, `ee8bac5e9`): the legacy reads
`CATALYST_MUSTKNOW_GRADES` **at call time** and production runs `A`, while the mirror answered from
the `("A","B")` code default. Against production it would have called **every grade-B row
`new_only`** — a disagreement manufactured by the harness, in the column that means *"this member
starts getting an alert they do not get today"*. ⚠️ The mirror rail did not catch it because every
fixture ran with the variable unset, so both sides used the default and agreed: **the rail drove the
real function correctly, under a configuration production does not use.**

⚠️ **NOT MEASURED:** how often the two rules actually collide on real data, because a read-only
probe of production `/data/catalysts.db` was refused by tooling policy. That is the number that
would size the fix.

**The one line the owner asked for: YES — fix it in the legacy path before absorption. It is the
safer order, but ONLY as the narrow fix (namespace the must-know dedup key) and ONLY while the flag
is still OFF.** Absorbing the bug makes it permanent and invisible: the dark rule reproduces it
faithfully, the comparison reports `agreed`, and the defect becomes a *specification* — a later fix
would then read as a `new_only` regression against its own baseline. Full reasoning and the four
conditions: §8b of the catalyst-match gate packet.

---

## WAVE 3 — three merges, all ADDITIVE, no marker bump, 2026-09-12

| what | commit | classification |
|---|---|---|
| **S10 Presentation Primitives** | **`3c539d011`** | ADDITIVE — 9 files, all `app/**`, **0** in flow-worker's 154-file closure |
| **S7 `catalyst-match` CP1** | **`faaa30146`** | ADDITIVE — 3 files, 0 in the closure |
| **S7 `catalyst-match` CP2** | **`d9631afa5`** | ADDITIVE — 3 files, 0 in the closure |
| **S10 rail: walk the tree ONCE** | **`de9551dd9`** | ADDITIVE — 1 file, 0 in the closure |

⚰️ **THE FOURTH ROW IS A DEFECT IN A RAIL THIS WAVE SHIPPED, FOUND BY RE-VERIFYING RATHER THAN BY A
FAILING GATE — and it is recorded because the temptation was to call it noise.**
`presentationSingleFormatter.test.js` walked all of `app/src` TWICE, once per test, reading and
comment-stripping ~1,400 files each pass. It went **RED once in an 8-file run** and **GREEN both
alone and on an immediate re-run of the identical eight** — `lesson_a_rail_can_be_green_alone_and_
red_in_company`.

⛔ **A LOAD-SENSITIVE RED IS NOT BANKED AS PERMITTED BREAKAGE.** The repo's own rule: re-run it
alone, then FIX it — a banked slot in the baseline is one a real failure can occupy unnoticed.
Fixed by walking once into a memoized corpus.

⭐ **And sharing the corpus made the non-vacuity control STRONGER.** Two independently-built walks
could in principle disagree about which files they visited, so the control was proving a property
of ITS OWN walk and not of the assertion's. One corpus, queried twice, means the control now
witnesses the exact set the assertion ran over. Mutation-proved both ways (give `formatPercent` a
consumer → RED; make the walk return nothing → RED), each restored by edit.

⛔ **CLASSIFICATION WAS CONFIRMED, NOT ASSUMED.** `reachable_paths()` was called directly for each
merge and the intersection with the changed set printed. The owner's instruction for S10 was
*"should be `app/**` only — confirm rather than assume"*; it is, and the confirmation is the empty
intersection rather than the file extensions.

---

### S10 — the presentation primitives, and what adopting them found

**Five pure functions** — number, percent, currency, date/time-with-session, freshness — in
`app/src/lib/presentation/presentationPrimitives.js`, adopted by `<Provenance>`,
`<FreshnessBadge>`, `<Cited>` and `<CoverageLine>`, and by nothing else.

⭐ **THE MIGRATION WAS ALREADY WRITTEN DOWN, IN THE CODE, BY WHOEVER WROTE THE INTERIM.**
`presentationFormat.js`'s header has said since 2026-09-02: *"When S10 ships,
`<Provenance>`/`<FreshnessBadge>` swap onto it … and this file is deleted, not generalized."* This
build is that swap. It ratified a plan rather than making one.

**⛔ THE FINDING: one formatter, two files, one field apart.** `presentationFormat.formatEtTime`
(`9:32:15 AM`, ET) and `FreshnessBadge.formatAsOf` (`9:32 AM`, ET) were the SAME function differing
by `second: '2-digit'`, in two files inside one four-component directory. Each looked correct alone.

**⚠️⚠️ AND A REAL DEFECT THAT IS NOT FIXED.** `<Cited>` renders its `Validated:` timestamp in the
**VIEWER's timezone** while its two neighbours pin **ET** a few pixels away, and **neither carries a
zone label**. A member outside ET reads one S8 surface in two timezones and is told about neither.
⛔ Changing it moves a rendered string for every non-ET member, which is exactly what the approval's
byte-identity condition forbids. **Recorded in three places and it needs its own line.**

**⛔ BYTE-IDENTITY IS PROVED BY AN ORACLE, NOT A SNAPSHOT FILE — and that is a correction to the
approval's own wording, made openly rather than quietly.** Three of the four replaced formatters are
timezone-sensitive and one renders in the viewer's zone, so a committed expected-string is a fact
about the machine that generated it: run the suite in another timezone and a green snapshot turns
red for a reason that is not a regression. ⭐ **So the deleted implementations are frozen verbatim
in the test files and run in the same process** — `newFn(x) === oldFn(x)` over a wide matrix
(ordinary values, DST boundaries, the ambiguous fall-back hour, every shape of absent), true in
every timezone at once.

**⚠️ TWO HONEST DEVIATIONS, both inside the approval's boundary:**

1. **`presentationFormat.js` was NOT deleted**, correcting its own plan. It said *"used only by this
   component family"*; measured, `epochSecondsToIso` has **four importers outside S8's four** —
   `ProvenanceDemo.jsx` and three research tabs. Deleting it would have migrated four consumers
   under cover of a refactor, which the approval forbids in those words. It survives narrowed:
   `formatEtTime` gone, `formatPrice` delegating, `epochSecondsToIso` untouched.
2. **`formatPercent` ships DECLARED AND ADOPTED BY NOTHING** — none of the four renders a
   percentage. Built because the approval named five, and the consequence is said out loud in a test
   that goes **RED the day somebody adopts it**, forcing the next reader to record the change rather
   than letting the fact quietly become false. ⭐ `lesson_built_tested_green_and_unreachable` caught
   in the act.

**⛔⛔ AND THE BIGGEST THING IT FOUND IS OUT OF SCOPE: there is a SECOND `formatPrice`.**
`chart/drawingLabels.js::formatPrice` renders `"123.46"` — no currency symbol, tick-aware decimals,
**the empty string** rather than an em dash when absent — and has **six importers**. Its own comment
calls it *"already the one place in the app that knows how a price is rendered"*, a sentence that
has been false for as long as the other one has existed. Reconciling them moves six call sites
visibly; it is the first migration S10's next line should consider.

Mutation-proved four ways, each restored by EDIT: seconds ignored → 6 RED · `real_time` suppression
removed → 3 RED · a raw `toLocaleString` back in component CODE → 1 RED by file name · the comment
stripper neutered → 6 RED, because the rail reads its own prose.

**Measured: 335 passed / 20 files**, VITEST_EXIT=0.
Gate packet: `12-decisions/gates/s10-presentation-primitives-pre-implementation-gate.md`.

---

### S7 `catalyst-match` — CP1 + CP2, and the schema was pinned only after reading the code

⛔ **THE LEGACY PATH IS TWO FIRING RULES SHARING ONE DEDUP TABLE**, which the type's name does not
suggest:

| | rule A — watchlist | rule B — must-know |
|---|---|---|
| gate | `CATALYST_ALERTS_ENABLED`, default **ON** | `CATALYST_MUSTKNOW_ALERTS_ENABLED`, default **OFF** |
| cohort | any user with a watchlist row | **admins only** |
| condition | ticker is on the member's list | `grade` ∈ `CATALYST_MUSTKNOW_GRADES` (default `A,B`) |
| needs a watchlist? | yes | **no — that is its entire point** |

Both write `catalyst_alerts_fired` keyed `(user_id, ticker, market_date)`, and rule A runs first.
**So for an admin who also watches the name, the must-know alert is silently skipped that day.**
⚠️ Reproduced, not fixed: a dark rule firing both would report `new_only` on every admin's watchlist
and the comparison would be measuring the fix instead of the migration.

**⛔⛔ `catalyst_type` IS UNCONSTRAINED MODEL OUTPUT — the F-S7-4 lesson one level up.**
`synthesize.py`'s PROMPT asks for one of fifteen labels; the parser then does
`"catalyst_type": (parsed.get("catalyst_type") or None)` with **no normalisation at all**, two lines
under a `grade` that DOES get `_normalize_grade`. ⭐ The tempting reading is *"fifteen types, pin an
enum"*, and it would have been wrong the first time a model returned `FDA Approval` instead of
`FDA`. So `catalyst_types` is pinned **OPEN** and matched case-insensitively, and the fifteen are
recorded as a convention **derived from the prompt by a test** — edit the prompt and it goes red.

⭐ **Pinning one axis as a closed enum (`tag`, which `tagging.py` really does assign by rule) and its
neighbour as an open list, in one schema, each with its reason, is what this checkpoint was for.**

**⚠️ AND THE MEMBER SET IS NARROWER THAN ITS OWN DOCSTRING.**
`_collect_user_watchlist_tickers` says *"any watchlist or flagged ticker"* — the flagged list IS a
`watchlists` row, so that is true — but **the seven colour-tag auto-lists are not in that query**,
nor are J2 positions or UCT20. A member who tags a name gold and never adds it to a list is
invisible to this alert. `member_set` pins all four values so the narrowing is DETECTABLE.

**⛔ NO `replay_fn`, for the THIRD distinct reason this programme has met.** `price-level`: a
trendline has no past. `event-proximity`: a calendar date moves. **`catalyst-match`: the candidate
set is PAID LLM OUTPUT behind a daily cost cap and a skip-if-stable hash, cut by a quality gate
tuned between runs.** Replay re-runs today's gate over a row whose grade was written by a call that
will not be made again.

**CP2 — `would_fire` returns a LIST, not a boolean, and the legacy shape forces it.** One refresh
fires once PER MATCHING TICKER and dedups per ticker. ⭐ A boolean would collapse *"three names
alerted"* and *"one name alerted"* into one outcome and make the comparison **structurally unable to
see a member's inbox double**.

**⭐ THE MIRROR IS RAILED AGAINST THE REAL FUNCTIONS.** `legacy_would_fire` restates the legacy rules
read-only because the real ones MUTATE and DELIVER — so the rail **drives the real
`_fire_catalyst_alerts` and `_fire_mustknow_alerts`** with delivery and the dedup store stubbed, and
asserts the mirror reproduces the decisions they actually made, with a control proving the driver
can tell a firing decision from a non-firing one.

**§2a, all four:** (1) every shape pinned including the unreachable ones; (2) forward-only, four
outcomes, `NO DATA`/`QUIET`/`OBSERVED` distinguished, four blind spots printed every time; (3) the
"what calls this evaluator" answer in writing — *the harness does, and nothing else* — with a rail
asserting the caller list is **exactly** `[catalyst_match_compare.py]`, failing both if a second
caller appears and if the harness stops calling it; (4) a heartbeat written on **every** tick
including the quiet ones.

Mutation-proved five ways, each restored by EDIT: admin guard removed · cross-rule suppression
removed · `catalyst_types` matched exactly · an ungraded row hidden by `min_grade` · the heartbeat
beating only on an outcome. **All five RED.**

⚰️ The filing-watch parity control flipped as designed and was **updated BY NAMING**, with the
reason steps 2–3 stay undone recorded beside it. **Parity 20/20.**
**Measured: 74 passed** (18 schema + 36 compare + 20 parity), PYTEST_EXIT=0.
Gate packet: `12-decisions/gates/s7-catalyst-match-pre-implementation-gate.md`.

---

### ⚠️ ONE MEASUREMENT THIS WAVE COULD NOT TAKE, AND IT CHANGED A DECISION

A read-only probe of production `/data/catalysts.db` — the histogram of real `catalyst_type` and
`grade` values, and the row count in `catalyst_alerts_fired` — was attempted and **refused by
tooling policy**. Every shape above is therefore source-derived.

⛔ **It is recorded at the point where it bites rather than only here**: it is precisely the argument
for pinning `catalyst_types` OPEN. The one check that could have said whether the model stays inside
its fifteen labels is the one that did not run, and an enum guessed from a prompt is the F-S7-4
mistake made deliberately. Also carried as blind spot 3 of the harness's own report, so it prints
every time rather than living in a document.

---

### D2 + S12 — DOCS ONLY, nothing authorized

- **D2 Canonical Data Model & Metric Address Book** — PRD + spec + gate packet with an **EMPTY
  approval block**. ⭐ **The implicit canonical form the owner said existed was found, and it is
  better than expected**: `closedTable.json` is a genuinely closed **137-entry** manifest, unanimous
  on store / cadence / grain, **zero** entries whose name differs from their column, read by both
  the JS parser and the Python evaluator, with `cadence_ceiling` already DERIVING a scheduling
  decision from it. The spec's schema change is **one field**. ⚠️ Its one real limit: every entry is
  `store: screener_rows`, so it addresses a nightly screener column and nothing else.
- **S12 Rollout** — one spec, no code. `user_tags` is written by two admin endpoints and read into
  two admin screens **and by no gate at all**. First migration named: the two S7 projections'
  `_cohort_user_ids()`, size **S**, with one ruling the owner still owes — what an EMPTY cohort
  means.

⚰️ **AND D2's OWN APPENDIX FOUND THE DEFECT IT EXISTS TO PREVENT, INSIDE THE COMMENT THAT WARNS
AGAINST IT.** `scan_evaluator.py` states *"all **54** declared scalars are unanimous"* and warns
about *"a **fifty-fifth** scalar"*. The manifest declares **137**. The unanimity claim is **still
true** at 137 — measured, all three axes — and the derivation the comment describes is exactly
right. What drifted is the number beside the list, in a comment whose own last line reads
*"⛔ NOTHING HAND-LISTS WHICH SCALARS ARE NIGHTLY."*

---

## ⛔⛔ A2 STOPPED — `SMOKE_LOGIN_LINK_ENABLED` IS **ARMED IN PRODUCTION**, NOT DARK

**The owner's instruction carried its own stop condition, and the condition fired.**
Wave 3 asked for a flag-ledger entry reading *"dark-with-reason — owned by the smoke-login
workstream (`35dca25fd`), unset in production"*, **"unless the flag is actually SET in
production (read live, not inferred) — then stop and tell me instead, that entry would be
wrong."**

Read live, 2026-09-12, `railway variables --service web --kv`:

```
SMOKE_LOGIN_LINK_ENABLED=1
```

and confirmed in the RUNNING process on a prior read (`IN-PROCESS SMOKE_LOGIN_LINK_ENABLED
= '1'`, `gate would open: True`) — the `--kv` read alone says only what the SERVICE is
configured with, which is why both were taken.

**No entry was written.** The declaration rail stays RED, deliberately, and the red is now
a TRUE statement about the repo rather than a missing row.

### Three artifacts, three different answers, about one live door

| artifact | what it says | true? |
|---|---|---|
| `api/routers/auth.py:615` — the code's own comment | *"OFF by default, everywhere"* | true of the DEFAULT, false of production |
| `docs/feature_flags.json` | **says nothing — no entry at all** | the gap the rail is red about |
| Railway `web` | `SMOKE_LOGIN_LINK_ENABLED=1` | the only one measured |

⭐ **This is the flag-ledger defect in its purest form and from the opposite direction to
the usual one.** `project_feature_flag_ledger`'s standing concern is *"off-and-unset is
indistinguishable from off-on-purpose."* Here the ledger's silence is being read as
"presumably dark", and the flag is **ARMED**. A ledger that is silent about an armed
member-facing door is worse than one that is silent about a dark one.

### What the flag actually opens, read from `api/routers/auth.py:607-653`

An **admin-only, single-use, 5-minute login link** for exactly one hard-coded synthetic
user id (`SMOKE_USER_ID`, default `f4433528-6466-474a-949c-8d5eda8a7b91` — the
`smoke@uctintelligence.internal` account). Four independent conditions gate it; it refuses
an account with TOTP enabled; and it answers **404, not 403**, for every other id, so the
endpoint cannot be used as an oracle for which account is privileged.

⛔ **It is not this program's flag and Terminal-Next did not arm it.** It belongs to the
smoke-login workstream (`35dca25fd`), whose own documentation in `CLAUDE.md` already
carries the removal instruction — `railway variables --service web --unset
SMOKE_LOGIN_LINK_ENABLED` **"to be run when the programme closes"**. Terminal-Next reached
it only because `test_every_off_by_default_gate_is_declared` names it, by design, as the
one undeclared gate in the repo:

```
SMOKE_LOGIN_LINK_ENABLED  (default='', api/routers/auth.py)
```

**Measured:** `tests/test_feature_flag_ledger.py` — 138 passed, **1 failed**, PYTEST_EXIT=1,
the failure being exactly that assertion and nothing else. The other 137 gates are declared.

### ⛔ THE DECISION IS THE OWNER'S, AND IT IS A CHOICE OF TWO, NOT A ROW TO TYPE

1. **Declare it `armed`** (`where: ["web"]`, note naming the workstream and the flip) — one
   docs line, rail goes green, and the ledger then tells the truth about a live door.
2. **Unset it** on `web` — the smoke-login programme's own recorded exit — then declare it
   `dark` with that reason, which is the entry Wave 3 asked for and would then be TRUE.

⭐ Both are one command. What must not happen is (1) being written *as if* it were (2),
which is what the instruction's stop condition was protecting against.

### ⚰️ RESOLVED THE SAME DAY, BY ANOTHER WORKSTREAM, INDEPENDENTLY — and it chose option 1

While this wave was building, `6905906cb` landed on master: *"docs(flags): reconcile the ledger with
Railway; declare SMOKE_LOGIN_LINK_ENABLED"*. It declares the flag **`armed`**, `where: ["web"]`,
with a note recording that the CODE default is off everywhere and the SERVICE value is what turns it
on. `tests/test_feature_flag_ledger.py` is **GREEN** — measured on this branch after the rebase,
140 passed.

⭐⭐ **AND THAT COMMIT'S OWN MESSAGE RECORDS IT NEARLY MAKING THE EXACT MISTAKE THE STOP CONDITION
EXISTS FOR:**

> *"I first wrote `SMOKE_LOGIN_LINK_ENABLED` as `dark` on the audit's 'off by default' line and
> caught it before committing: the flag is SET on web, and declaring it dark would have been exactly
> the defect this file warns about — a ledger describing an unreleased surface while it is live. The
> status comes from Railway, not from the code default."*

⛔ **Two independent readers, on the same afternoon, both started from the code default and both had
to be stopped by a live read.** That is not two people being careless; it is the audit tool's own
"off by default" framing pointing at the wrong authority, and it is the strongest possible argument
for the owner's stop condition being a live read rather than an inference.

⚠️ One detail not reconciled: that note says *"read 2026-09-13"* while this session's read was
2026-09-12. Recorded, not resolved — it is that workstream's row.

---

## ✅ A1 — WEB DEPLOY CONFIRMED BY ANCESTRY, NOT BY STATUS. `07ce46090` IS LIVE.

⚠️ **The obvious check said the wrong thing.** `railway deployment list --service web`
reports `07ce46090` as **REMOVED**, which reads as a failure and is not one: another
workstream pushed `ee9c96fa1` while our build was still running, and Railway cancels a
build superseded by a newer push. **REMOVED is a cancellation, not a rejection**, and the
newer deploy carries our content.

```
git merge-base --is-ancestor 07ce46090 ee9c96fa1   ->  0
```

**`07ce46090` IS an ancestor of the live commit `ee9c96fa1` — its content is deployed.**

| check | reading |
|---|---|
| `/api/health` | 200, **uptime 270 s** — a fresh boot, not a stale pod |
| price-level flag, IN-PROCESS | `'1'` |
| event-proximity flag, IN-PROCESS | `'1'` |
| both armed | **True** |

⚠️ **The boot lines were NOT the artifact, and saying so matters.** The 500-line log window
had already scrolled past startup, so the grep for *"S7 price-level DARK comparison
ENABLED"* returned nothing. **An empty grep over a window that cannot contain the line is
not evidence of absence** — the in-process environment read was substituted deliberately as
the stronger artifact, because it reports what the RUNNING process holds rather than what
the service is configured with.

### ⚰️ A correction to the expectation this check was given

The instruction expected flow-worker's running commit to be **`a0c2bfee4`**. Measured:

```
flow-worker  c97e2a501  SKIPPED     <- event-proximity CP3 merge, correctly skipped
flow-worker  b5133f50d  SKIPPED     <- F-S7-4 merge, correctly skipped
flow-worker  3b817186c  SUCCESS     <- marker bump #4, rode in with the G1 tranche-1 merge
```

**The running commit is `3b817186c`, not `a0c2bfee4`.** `a0c2bfee4` was bump **#3**'s merge;
bump #4 rode in `3b817186c`. Two SKIPPED deploys since, both ADDITIVE, both correct — the
marker mechanism is still doing exactly what the control proved it does.

---

## D1 G1 TRANCHE 1 — MERGED `3b817186c`, BEHAVIOUR-CHANGING, marker bump #4

Owner error-semantics ruling: **the adapter's fail-fast contract stands; the CALL SITE
owns degradation.**

⚠️ **AND THE GAP WAS WIDER THAN THIS LEDGER SAID LAST WAVE.** The previous row recorded
that the typed functions raise where legacy `_fmp_get` returns `[]` on NOT-FOUND. Reading
the helper: it catches `Exception` and returns `None` for **everything** — network error,
5xx, auth failure, rate limit, malformed JSON. Every migration therefore converts a silent
`None` into a raised typed error, and the only question per site is who can degrade
honestly.

| | |
|---|---|
| merge | **`3b817186c`** |
| marker bump #4 | in the same push |
| classification | **BEHAVIOUR-CHANGING** — `industry_map.py` and `ticker_meta.py` are in flow-worker's closure and unwatched |

**The two member-request-path sites** catch the adapter error, return the legacy empty
shape, and attach an S8 envelope (`source=provider_error`). ⛔ **DEGRADED IS NOT ABSENT**,
and until now they rendered identically: an outage returned `null` at 200,
indistinguishable from a quiet ticker. ⭐ The empty shape is preserved exactly, the
envelope is additive, **genuine emptiness still returns `None`**, and a degraded response
is **not cached** — caching an outage would freeze a blank quote onto the page after the
provider recovered.

**The other ten:** `analyst_pass` ×4 migrated as-is (AST-verified: the caller wraps EACH
leg); `ticker_meta` / `ticker_logos` / `industry_map` keep their docstring promise of
*never raises* via a local catch — ⭐ the promise is the contract their callers were
written against, and the legacy helper merely happened to keep it.

### ⛔⛔ A BLIND SPOT IN THIS PROGRAMME'S OWN CENSUS

`research.py` passes `_fmp_get` to `ThreadPoolExecutor.submit` **as a callable**. That is
a `Name` node in an argument position, not a `Call` — so the census that produced last
wave's **12 → 31** walked straight past it. The site happens to pass a timeout, so nothing
was broken; **what was broken is the instrument**, which reported a census it could not
have made. Reference sites are now enumerated and must each be KNOWN.

⚰️ And that rail's own non-vacuity control was a **count** (`>= 25 sites`). Tranche 1
migrated nine away and it went red for the right reason and the wrong cause — it was
measuring migration progress, not scan health. Replaced with a **named member**.

---

## F-S7-4 — MERGED `b5133f50d`, ADDITIVE. Luck becomes design.

Production carries a third `alert_type`: **`line`** — drawing-bound, **no anchors** — found
by the CP3 dry run, not by reading the legacy code.

⭐ **Both level functions already resolved it correctly, and that was LUCK.** Each keys
interpolation on `== 'trendline'` and falls through otherwise. The tempting reading of a
drawing-bound row is *"bound to a drawing, therefore interpolate"* — and that reading would
have disagreed with legacy on **every one of those rows**, for a reason that is not the
migration.

`level_at` now has **one branch per shape** (behaviour byte-identical; what changed is that
the next editor must read the word `line` and choose). ⛔ **An unknown kind still falls
through**, deliberately — raising would make the dark side disagree with legacy the moment
a fourth type appears, and the comparison would start measuring our refusal. The loudness
lives in `KNOWN_LEVEL_KINDS` and in the dry run, **which exits 3** on an unpinned shape.

---

## S7 `event-proximity` — CP1 + CP2 MERGED 2026-09-12, both ADDITIVE

The **second absorption**. Gate packet `GATE-S7-EVENT-PROXIMITY`, approval line
CP1–CP2 only, `AT SHA 76529e75b`. Absorbs `api/services/calendar_alerts.py`.

| step | SHA | where |
|---|---|---|
| gate packet + approval | **`a31f02374`** | `terminal-research` |
| **CP1 merge** | **`3316e0d0b`** | **`master`** |
| **CP2 merge** | **`923afd783`** | **`master`** |
| approval line 2 (CP3) | **`09785ac95`** | `terminal-research` |
| **CP3 merge** | **`c97e2a501`** | **`master`** |

### ⛔⛔ CP3 — THE CALENDAR IS RE-READ EVERY TICK (the who-refreshes-the-date ruling)

CP2's mirror rail exposed that the legacy path **re-reads the calendar every run** while a
stored `event_date` is only a snapshot. Left alone, a reschedule makes the two rules
describe different worlds and the dark week would measure **a data-freshness artefact**
instead of the rule difference it exists to size.

**The ruling, implemented:** the projection re-reads the calendar every tick — through
`calendar_alerts._get_reporters_for_date`, the legacy module's **own** function, never a
reimplementation. The stored date is an **audit snapshot**. Calendar ≠ snapshot **is** a
reschedule: clock resets, pre-reschedule span discarded into `not_comparable`, snapshot
replaced with a version bump. ⭐ **The two worlds then converge by construction.**

⛔ The predicate id is keyed on **(user, ticker) and NOT the date** — keying the date in
would make every reschedule look like a brand-new predicate and **hide** the reset.

**The wire (§2a item 3):** `ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED`, DEFAULT OFF,
07:05 and 18:05 ET weekdays — the legacy path's own two slots. ⭐ Cadence is daily, not
per-minute: the legacy notion of time is a DATE, so a minute-by-minute sweep would re-ask a
question whose answer cannot change until tomorrow.

Mutation-proved on disk, both named guards: drop the role predicate → **4 RED**; disable
the reschedule reset → **RED**.

⚰️ Two CP2-era assertions discharged and **rewritten, not deleted**. And price-level's own
wire test asserted `main.count("run_dark_sweep()") == 1`; a second sweep made it 2 — the
same count-as-instrument defect as the census floor, scoped to its own job body.

**Classification: ADDITIVE on both.** Measured with `reachable_paths()` — every
touched file `reachable=False`, **offenders NONE**, rail exit 0. **No marker bump**,
and flow-worker SKIPPED, which is the artifact saying so. Legacy
`calendar_alerts.py` byte-identical, railed in both suites.
**Parity 20/20 throughout**; the control updated **by naming**, never by deleting.

### ⛔ F-S7-EP-1 — the legacy shapes, read from the code

| what the name implies | what `run_prereport_alerts` actually does |
|---|---|
| many event kinds | **earnings only** — `_get_reporters_for_date` reads the earnings calendar and nothing else |
| hours of proximity | **day granularity** — `market_date` is a date string, the dedup PK is per date |
| session awareness | **no BMO/AMC in the alert**, though the calendar carries it |
| a 3-day window | ⚠️ **belongs to a different subsystem** |

⛔⛔ **THE TRAP, AND IT IS THE SHARPEST THING IN THIS ROW.**
`EARNINGS_PROXIMITY_DEFAULT_DAYS = 3` and `collect_earnings_window()` live in
`calendar_alerts.py` and are consumed by **`awareness/engine.py`**, *never* by the
alert path. A reading that took the 3 for this alert's window would build a type that
fires **three days early** and then conclude the legacy path was "missing" alerts it
was never designed to send. **The constant is in the file; the behaviour is not.**

⭐ Pinned as a rail rather than a sentence: the schema text for `lead_days` must name
the constant *and* name `awareness`, with a CONTROL asserting the constant still lives
in the legacy file — because a warning about a trap that has moved is worse than none.

⭐ **The schema pins the WIDER set anyway** — four event kinds, day *and* hour — three
of which nothing populates, exactly the call F-S7-2 made for `trendline`. ⛔ Pinning is
not authorizing: firing on another kind, or finer than the legacy day, is out of scope,
and both halves are railed.

### ⭐ WHAT THE MIRROR RAIL FOUND THAT REASONING DID NOT

`legacy_would_fire` restates the legacy decision because the real function MUTATES its
dedup table and DELIVERS. Driving the real `_get_reporters_for_date` beside it exposed
a **structural difference between the two rules**:

> The **legacy** path re-reads the calendar every run. The **dark** rule reads the
> predicate's **stored** `event_date`. They agree exactly while that stored date is
> truthful — and the moment a company reschedules they describe different worlds:
> legacy follows the calendar, the dark predicate keeps firing against the old date
> until something updates it.

⚠️ **Not fixed, and deliberately so.** It is a finding the dark period exists to size;
it is *why* `note_event_change` discards the pre-change span into `not_comparable`; and
it hands CP3 a question it must answer — **who refreshes a projected event date?**
Recorded as its own test so it cannot be rediscovered later as a bug.

**A second divergence, visible from the source:** the legacy dedup PK is
`(user, ticker, market_date)` with **no notion of a lead day**, so whichever slot runs
first wins and the other is deduped away. The dark `fire_key` is
`(entity_ref, event_date, lead_days)`. **One legacy alert, up to two dark ones.**

### ⛔ HARNESS-ONLY IS IN THE SIGNATURE, NOT IN THE CALL SITE

`evaluate(*, today, predicate_ids, ...)` — `predicate_ids` is **required, with no "all"
mode**. Sweeping the store is something a future caller **cannot express**, rather than
something they must remember not to do. That is CP3. Railed by inspecting the signature
*and* by asserting the call raises without it.

⚰️ And `test_CP1_ships_no_evaluator_and_nothing_calls_register` was **rewritten, not
deleted**, when CP2 added the evaluator: its first half is discharged by approval, the
half that still matters — *nothing calls `register()`* — stands, and a new rail asserts
`event_proximity` appears nowhere in `api/main.py`. ⭐ Registration is not activation, in
the direction `price-level` got wrong.

Mutation-proved four times, restored by edit: narrow `EVENT_KINDS` → RED · drop the
3-day trap warning → RED · disable the event-change reset → 2 RED · give
`predicate_ids` a default → RED.

**Tests: 20 CP1 + 26 CP2. 200 passed across the alert-taxonomy family.**

---

## D1 G1 — MERGED 2026-09-12, BEHAVIOUR-CHANGING, marker bump #3

| step | SHA | where |
|---|---|---|
| G1 | **`d050f867f`** | `feat/s7-price-level` |
| marker bump #3 | **`e1d4b348a`** | same commit series |
| **merge** | **`a0c2bfee4`** | **`master`** |

**Deploy artifacts:** web **SUCCESS** 16:12:59Z · flow-worker **SUCCESS** 16:12:59Z,
advancing `59388e52c → a0c2bfee4`. ⭐ flow-worker BUILT rather than SKIPPED — the first
bump in this programme that discharged a real strand, and the artifact proves the
mechanism end to end.

### ⛔ CLASSIFICATION — BEHAVIOUR-CHANGING, IT STRANDS

The rail exited **1** and named four files flow-worker RUNS and does not watch:
`fmp_client.py` · `earnings_estimates.py` · `earnings_history_fmp.py` ·
`fmp_transcripts.py`. Without the bump the push would have left flow-worker on the old
copies **with every test green** — the exact failure the marker exists for.

### CENSUS — the number G1 actually moved

| | before | after |
|---|---|---|
| `_fmp_get` sites naming a timeout | 12 | **31** |
| sites inheriting a default | **21** | **2** |

The two survivors are both `bars_sanitize.py` — bars-api territory, owner-reserved,
excluded **by name** in a single constant so widening the exemption stays reviewable.

⚠️ **The review doc said "eight named" explicit sites; there are twelve** (ten literal,
two env-configured). A hand-typed count beside the list it describes, again.

### ⛔ WHAT DID NOT SHIP, AND WHY — tranche 1

The twelve explicit sites are **not** migrated to the typed adapter. Reading the code
turned up something the G1 review never flagged: **the typed functions RAISE
(`FMPNotFound`) where legacy `_fmp_get` RETURNS `[]`/`None`.** So migrating is not
"pass the same number through" — it converts not-found from a falsy value into an
exception, and two of those sites (`routers/research.py`, `services/fundamentals.py`)
are on a **member request path** where an unhandled raise is a 500.

⭐ **The review sized G1 as a timeout question. It is also an error-semantics question**,
and each of the twelve needs its own not-found decision. That is a ruling, not a refactor.

---

## S7 `price-level` — APPROVED 2026-09-12 · CP1–CP3 MERGED · DARK RUN STARTS MONDAY'S OPEN

| commit | branch | system | files | what |
|---|---|---|---|---|
| `37cba8111` | `feat/s7-price-level` | **S7 Alerts** | `api/services/alert_taxonomy/price_level.py` (new), `tests/test_alert_taxonomy_price_level_schema.py` (new), `tests/test_alert_taxonomy_filing_watch_parity.py` (control updated by naming) | **GATE-S7-PRICE-LEVEL Checkpoint 1** (packet `123a30054`, approval block **BLANK**). Registers the type; **no evaluator, no delivery, no read of `watchlist_alerts`, no migration, no scheduler entry**. Legacy path byte-identical (`git diff` empty on `watchlist_alert_service.py` + `auth_db.py`). Two findings below moved the scope. Mutation-proved both ways (M1 drop `trendline` → RED; M2 import `delivery` → RED), restored by edit. **30 passed** across both files |

✅ **APPROVED 2026-09-12** on **two lines** — line 1 CP1–2 at **`644497c6a`**, line 2 CP3 at
**`b54564bb8`** (both recorded AT SHA `644497c6a`; packet SHA of record `123a30054`).
⛔ **CP4 (all members), the FLIP, and the LEGACY SWITCH-OFF each need a new line.**

| step | SHA | where |
|---|---|---|
| approval block (line 1, CP1–2) | **`644497c6a`** | `terminal-research` |
| CP1 merge | **`2fcd33b28`** | `master` |
| marker bump #2 | **`59388e52c`** | `master` |
| CP2 merge | **`6524d7ab8`** | `master` |
| approval line 2 (CP3) | **`b54564bb8`** | `terminal-research` |
| CP3 commit | **`169c1fd53`** | `feat/s7-price-level` |
| **CP3 merge** | **`ea0326717`** | **`master`** |
| **CP3b — the tick + the report** | **`baea70d76`** | **`master`** |

⛔⛔ **CP3 SHIPPED A DARK RUN THAT NOTHING RAN, AND CP3b IS THE FIX.** At
`ea0326717` `register()` was wired, the projection and the harness were built, 18 tests were
green — and **nothing called `run_projected_comparison`**. Monday's open would have produced zero
rows, and next weekend an empty comparison store reads *exactly* like five sessions of agreement.

⚰️ **How it happened, because the shape is worth more than the fix.** CP1 and CP2 were correctly
*"registration only, no scheduler entry"* — the type had no evaluator, so arming a predicate nothing
evaluates was the hazard. That invariant was carried into CP3 **by habit**, written into the
`api/main.py` comment, and then **enforced by a test asserting `add_job` must NOT appear beside the
registration**. Approval line 2 says the opposite in as many words: *"the comparison harness **runs**
against the projected predicates … Verdict gate = five full trading sessions."*

⭐ *Registration is not activation* is true. *Putting the dark evaluator on a tick is the flip* is
the half that was false — the **flip is delivery plus the legacy switch-off**, both still
unapproved. The owner's own CP3 ruling warned about classifying by habit; this was that error
pointing the other way, and it had a green test holding it in place.

⭐ **The rail that would have caught it asserts the WIRE, not the parts** —
`test_the_dark_sweep_is_actually_wired_to_a_tick`. Every other test in the file calls the evaluator
itself, which is exactly why eighteen of them said nothing about whether anything would ever run
(`lesson_built_tested_green_and_unreachable`).

### ⛔ HOW THE DARK RUN IS ARMED — IT IS OFF RIGHT NOW

The sweep is flag-gated and **DEFAULT OFF**, deliberately: it reads REAL member rows (admin
accounts), so an unset variable must mean **nothing runs** — the `DESK_TSDR_ANNOUNCE_SHOWS`
contract, where the failure direction is silence rather than exposure. **Until this is set, Monday's
dark run does not start:**

```
railway variables --service web --set "ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED=1"
```

⚠️ A variable set is a **restart**, so do it this weekend, not at Monday's open. And per this repo's
own measured rule, `--set` has been seen both to stage and to auto-redeploy: **verify a NEW BOOT by
startup-line timestamp**, then confirm the running process rather than reading `--kv` back. The boot
line to look for is:

```
[startup] S7 price-level DARK comparison ENABLED (every minute, weekdays 09:00-16:59 ET, admin cohort, no delivery)
```

⛔ If it instead prints `S7 price-level DARK comparison OFF`, the flag did not reach the process and
**the week will collect nothing**. Rollback is unsetting it — no code change, no deploy of ours.

### ✅ ARMED — 2026-09-12 (owner-authorized, this one variable only)

```
railway variables --service web --set "ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED=1"
```

| | |
|---|---|
| set at | **2026-09-12 14:58:47 UTC** |
| behaviour of `--set` | **AUTO-REDEPLOYED** — a new web deployment appeared 2 s later (14:58:49 UTC). This matches the 2026-09-09 `web` measurement and *not* the 2026-08-30 `chart-renderer` one; the repo's rule that the behaviour is unsettled per-service stands, and this is a third data point, not a settlement. |
| deploy artifact | web **SUCCESS**, uptime reset at `/api/health` |
| running commit verified | `329a4a322` (CP3b) proved an **ancestor** of the running commit, and `git show <running>:api/main.py` contains `id="alert_taxonomy_price_level_dark"` exactly once — ⭐ the code is verified present in the artifact that is running, not assumed from the branch |
| flag ledger | `docs/feature_flags.json` → `status: armed`, with this timestamp |

⛔ **THE SWEEP WILL NOT TICK UNTIL MONDAY, AND THAT IS THE CRON, NOT A FAULT.** Its trigger is
`day_of_week="mon-fri", hour="9-16"`, so there is **no heartbeat row and no span in the store over
the weekend**. ⚠️ Anyone running the report today gets `NO DATA`, which is correct and must not be
read as a failed arming — the first honest liveness reading is **Monday after 09:00 ET**.

### ⭐ THE KNOWN-GOOD BASELINE — captured 2026-09-12, BEFORE any real data

⛔ Recorded now so next weekend's read has something to diff against. **A report you have never
seen working is not a report**, and the failure this guards is specific: an empty store prints four
zeroes per predicate and reads exactly like perfect agreement.

`python tools/s7_price_level_report.py --self-check` → **PASS** (exit 0). It builds two throwaway
stores — one empty, one carrying a real disagreement — and asserts the output tells them apart.

**A. EMPTY STORE — what Monday morning looks like before the first crossing:**

```
GATE-S7-PRICE-LEVEL - dark comparison, forward-only
store: <empty>

NON-VACUITY CONTROL
  predicates seen ....... 0
  comparison spans ...... 0
  recorded outcomes ..... 0

NO DATA. The store holds no comparison spans at all.
This is NOT 'they agree' - nothing was ever compared. Check that
ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED=1 on the web service and
that the sweep is printing '[alert_taxonomy] price-level DARK sweep'.
```

**B. SYNTHETIC FIXTURE — the shape a real week should produce:**

```
NON-VACUITY CONTROL
  predicates seen ....... 2
  comparison spans ...... 2
  recorded outcomes ..... 17

PER PREDICATE  (legacy watchlist_alerts row id after 'legacy:')

  predicate                   agreed  new-only legacy-only  not-comparable sessions verdict
  legacy:a1                        3         0           2               4        2 NOT READY (2/5)
      -> anchors rewritten 1x - the pre-move spans are in not-comparable BY DESIGN, never counted as agreement
      -> TRENDLINE: its level moves between ticks by construction, so its disagreements are not the same fact as a fixed level's
  legacy:b2                        7         0           1               0        5 ready

VERDICT GATE
  five full trading sessions of forward data, per predicate.
  status: NOT READY - do not read a flip decision out of this yet

!! KNOWN BLIND SPOT, and it points the flattering way.
  The legacy path is ONE-SHOT (_trigger_alert sets is_active = 0) and the
  projection reads only active rows, so once legacy fires, that row leaves
  the comparison. This report sees the FIRST divergence per predicate and
  CANNOT see a second crossing. A new-only of 0 is therefore not evidence
  that persistent-vs-one-shot is harmless - it is a thing we cannot observe.
```

⭐ **Diff next weekend's output against B, not against expectations.** The columns, the ordering,
the annotation lines and the blind-spot footer are all pinned here; anything structurally different
means the tool changed, not the market.

⚰️ **The tool crashed the first time it was rendered with real content** — `UnicodeEncodeError:
'charmap' codec can't encode character '\u21b3'`. The rendered output is now **ASCII by
construction** (docstrings keep their marks), with a `sys.stdout.reconfigure` backstop and a rail
that renders a populated report and calls `.encode("cp1252")` on it. ⛔ This repo has paid for this
exact bug before: `tools/flag_ledger_audit.py` reported *"could not enumerate the project's
services"* for two days because cp1252 killed a reader thread on the first box-drawing byte — which
reads as an **auth** problem, not an encoding one, and is why it went unfixed rather than unnoticed.

### ⭐ MONDAY, ~09:05 ET — ONE COMMAND, YES/NO WITH THE ROW COUNT

**PowerShell / cmd:**

```
railway ssh --service web "/opt/venv/bin/python tools/s7_price_level_report.py --ticking"
```

**Git Bash** — ⛔ needs `MSYS_NO_PATHCONV=1`, or MSYS rewrites `/opt/venv/bin/python` into
`C:/Program Files/Git/opt/...` and the pod answers `sh: 1: C:/Program: not found`:

```
MSYS_NO_PATHCONV=1 railway ssh --service web "/opt/venv/bin/python tools/s7_price_level_report.py --ticking"
```

⚰️ **Verified by RUNNING it against production, not by writing it down** — the first form failed
exactly that way. The same prefix applies to the full report command above.

Exit **0** = ticking, or legitimately outside the window · **1** = stalled, or never started while
INSIDE the window. Healthy output looks like:

```
TICKING: YES -- last tick 43s ago, 6 ticks total
  WRITING: 1 spans, 0 recorded outcomes, 1 predicates projected
  priced 1, no_price []
  (0 outcome rows is NORMAL early -- it means nobody's line has been crossed yet, not that the sweep is broken)
```

⛔ **IT REPORTS TWO FACTS, NOT ONE, BECAUSE THEY FAIL SEPARATELY.**

- **TICKING** is the heartbeat's *age*. ⭐ Nothing else can answer it: a span OPENS once per
  predicate and thereafter only its counters move, with **no timestamp on them** — so a sweep that
  died at 09:01 looks, at 15:00, **identical** to one that never stopped. The heartbeat
  (`price_level_sweep_heartbeat`, one row, stamped on EVERY tick including the empty ones) is the
  smallest thing that separates them. A heartbeat that only beat on success would be a success
  detector, not a liveness one.
- **WRITING** is spans + recorded outcomes. A sweep can tick perfectly and write nothing, and that
  is a different problem with a different cause.

⛔ **AND IT KNOWS WHAT DAY IT IS.** Run before Monday and it answers:

```
TICKING: n/a -- it is Sat 11:17 ET, and the sweep only runs weekdays 09:00-16:59 ET.
  No heartbeat yet is EXPECTED here, not a fault. Re-run after Monday's open.
```

⭐ **exit 0**, because "outside the window" and "armed but broken" leave an IDENTICAL store and call
for OPPOSITE actions — wait, versus investigate. ⛔ The window check is only ever allowed to excuse
the NEVER-STARTED case: a heartbeat that exists and has aged out is a stall whatever the day, and
still exits 1. And a clock it cannot resolve fails **loud** (treated as inside the window), because
an instrument that cannot tell the time must not be the thing that decides nothing is wrong. Both
directions plus the unresolvable-clock case are railed in
`test_the_weekend_case_never_swallows_a_real_stall`.

⚠️ **`0 outcome rows` at 09:05 is the NORMAL answer** and the tool says so in words — nobody's line
has been crossed yet. ⛔ What is *not* normal is `projected=0`, which means no ACTIVE
`watchlist_alerts` row belongs to an admin account: the sweep is healthy and comparing **nobody**.
The tool flags that separately, because a week of that would arrive next weekend looking exactly
like a week of agreement.

### ✅ PIPELINE VERIFIED AGAINST REAL BARS — 2026-09-12, projected = 12

```
MSYS_NO_PATHCONV=1 railway ssh --service web   "/opt/venv/bin/python tools/s7_price_level_dryrun.py --date 2026-09-11"
```

**`PIPELINE: VERIFIED -- a real row reached a real span.`** 12 rows projected across 11
symbols, 10 priced, 10 spans opened, 0 anchor moves, `heartbeat stamped 0`.

⛔ **THAT SENTENCE IS THE ONLY RESULT THIS RUN MAY CONTRIBUTE.** It is a REPLAY of a past
session, and F-S7-3 is *no replay, ever* for the comparison — so its outcome counts are
**not** comparison data and are recorded nowhere. The tool enforces the separation
structurally: a scratch store it creates itself, a refusal on any path resolving inside
the shared data root, and no heartbeat stamp, so a replay can never make a dead sweep
look alive.

### ⚠️ WHAT THE DRY RUN REVEALED ABOUT THE COHORT — a fact about the DATA, not a result

The admin cohort's twelve rows break down as:

| `alert_type` | anchors | bound to a drawing | count |
|---|---|---|---|
| `price` | none | no | **10** |
| `line` | **none** | yes | **2** |
| `trendline` | — | — | **0** |

⛔⛔ **THERE ARE NO TRENDLINES IN THE ADMIN COHORT.** The hardest and most
divergence-prone half of this type — the interpolated level, the anchor-move reset, the
whole of F-S7-2 — will collect **nothing** over the five sessions. A verdict read next
weekend covers **fixed levels only**, and must say so rather than read as coverage of
the type.

⚠️ **And production carries a THIRD `alert_type`, `line`**, which neither F-S7-2 nor the
schema anticipated: bound to a drawing, carrying **no anchors**. Both level functions
fall through to `target_price` for it, so the two sides agree — ⭐ **by luck, not by
design.** Had either side keyed interpolation on "has a drawing_id" rather than
`alert_type == 'trendline'`, every one of those rows would have disagreed for a reason
that is not the migration.

⭐ **The move this suggests, for the owner:** arm one admin trendline alert before
Monday's open, or accept that CP4's authorization rests on fixed-level evidence alone.
That is a cohort decision, not a code change, so it is recorded here rather than acted on.

### ⭐ HOW THE OWNER READS THE COMPARISON NEXT WEEKEND

**One command, on the web pod, read-only:**

```
railway ssh --service web "/opt/venv/bin/python tools/s7_price_level_report.py"
```

Add `--json` for machine-readable output, `--db <path>` to point at a copy, and `--self-check` to
prove the report can still tell "no data" from "agreement" before trusting a quiet one.

**What it prints, and why in that order:**

1. **The non-vacuity control first** — predicates seen, spans, recorded outcomes. ⛔ An empty store
   prints four zeroes per predicate and reads like perfect agreement, so the report **refuses to
   summarise** and says `NO DATA` instead. *A dark run that never ran and a dark run that found no
   disagreement are different facts.*
2. **Per predicate, the four outcomes, never collapsed into a pass rate** — `agreed` / `new-only` /
   `legacy-only` / `not-comparable`. A single percentage answers the wrong question: **`legacy_only`
   is an alert somebody LOSES at the flip, `new_only` is one they start getting TWICE** — different
   defects, different members. `not_comparable` is span time we deliberately refuse to score, and
   folding it into a denominator would make *moving a trendline* look like agreement.
3. **`verdict_ready` on its own line, per predicate** — five full trading sessions, and below that
   it says so in words rather than showing a number. *"Not enough data yet"* and *"they agree"* are
   different answers.
4. **Anchor rewrites are annotated** (`anchors rewritten N×`) and **trendlines are named**, because
   a trendline's level moves between ticks by construction and its disagreements are not the same
   fact as a fixed level's.

⚠️ **AND IT PRINTS ITS OWN BLIND SPOT EVERY TIME, pointing the flattering way.** The legacy path is
**one-shot** (`_trigger_alert` sets `is_active = 0`) and the projection reads only active rows, so
the moment legacy fires, that row **leaves the comparison**. The report therefore sees the FIRST
divergence per predicate and **cannot see a second crossing at all**. ⛔ So a `new_only` of **0** is
NOT evidence that persistent-vs-one-shot is harmless — it is a thing this instrument cannot observe,
and CP4 must not be sized against it. Rail:
`test_KNOWN_LIMIT_the_one_shot_divergence_is_invisible_to_a_projection`.

### ⚠️ WHAT THE DARK PERIOD IS EXPECTED TO SURFACE — PREDICTED FROM SOURCE, BEFORE THE DATA

Recorded now so the week's result can be checked against a prediction rather than rationalised
after the fact:

| outcome | expected? | why, from the legacy source |
|---|---|---|
| `legacy_only` | **yes, and it is the important one** | legacy fires on a LEVEL TEST (`>=`/`<=`), the dark rule needs a TRANSITION — an alert armed while price is already through its level fires immediately on the legacy path and never on the dark one. **Those members lose that alert at the flip.** |
| `new_only` | **structurally invisible** | see the blind spot above |
| `not_comparable` | only if an admin moves a bound trendline | the anchor-move reset, working as ruled |
| `agreed` | the ordinary case | a genuine crossing, both sides |

**Deploy artifacts for the CP1 merge (`59388e52c`):** web **SUCCESS** 05:26:01Z, uptime reset
confirmed at `/api/health` (321 s); flow-worker **SUCCESS** 05:26:01Z, advancing `fd735513b →
59388e52c`. ⭐ The push immediately before it (`d89948912`, another workstream) was **SKIPPED** —
which is the useful half of the artifact: it shows the browser watch-list edit did **not** widen the
list, so the marker bought a lever and not extra tape gaps.

### ⛔ RAIL CLASSIFICATION — ADDITIVE, STRANDING NOTHING, ON ALL THREE CHECKPOINTS

Measured with the rail's **own** `reachable_paths()`, never a hand BFS. CP3's six changed files:

| file | reachable | watched |
|---|---|---|
| `api/main.py` | **False** | False |
| `alert_taxonomy/price_level.py` | **False** | False |
| `alert_taxonomy/price_level_compare.py` | **False** | False |
| `alert_taxonomy/price_level_projection.py` | **False** | False |
| the three test files | False | False |

**offenders: NONE. Rail exit 0 on all three checkpoints. NO MARKER BUMP FOR CP3.**

⚰️⚰️ **A PREDICTION THIS ROW PUBLISHED, THE MARKER FILE REPEATED, AND THE MEASUREMENT KILLED.**
This section used to read:

> ⛔ **CP3 breaks that**: `api/services/alerts.py` IS in flow-worker's reachable closure and imports
> the taxonomy modules (that is precisely why `document_arrival.py` is reachable today), so the
> moment `register()` is wired, `price_level.py` becomes reachable-and-unwatched and the next merge
> carries a real strand needing a real window.

**It is false, and CP3 is merged with `price_level.py` still `reachable=False`.** Two things were
wrong at once:

1. `alerts.py` does **not** import "the taxonomy modules". It imports **`receipts` and
   `document_arrival` BY NAME** — which is exactly why `document_arrival.py` is reachable and why
   nothing else in the package is. The sentence generalised from one sibling to a package.
2. `register()` is wired in **`api/main.py`**, which is the **WEB** entry. Flow-worker's closure is
   computed from `api/flow_worker_main.py`; `api/main.py` is not in it and never was.

⭐ **Why it survived long enough to be published twice:** it was derived from a true observation
(`document_arrival.py` IS reachable) by an inference that was never run through
`reachable_paths()`, and then it was *restated* in the marker file — where the second copy read as
corroboration of the first. The repo has a name for this shape already: **a claim about what a
thing imports is only true if you have asked the import graph.**

### ⛔ THE BEHAVIOUR-CHANGING RECLASSIFICATION — DEFERRED, CONDITIONAL, AND RAILED

The owner ruled: *"From then on the module is BEHAVIOUR-CHANGING under the rail — record that in the
ledger so nobody classifies a later change as ADDITIVE by habit."* That ruling stands, but its
**condition — reachability — does not hold yet**, so recording "it is now BEHAVIOUR-CHANGING" here
would be recording something the rail contradicts.

⭐ **So it is a test, not a sentence.**
`tests/test_flow_worker_watch_coverage.py::test_price_level_is_STILL_OUTSIDE_flow_workers_closure`
asserts the measured state today and **fails BY NAME** the day anything in flow-worker's closure
imports `price_level`, printing the reclassification instruction in its failure message.
Mutation-proved: adding the import to `alerts.py` turns it RED. ⛔ A ledger line nobody re-reads is
the artifact that goes stale; a rail fires on the commit that makes it wrong.

**The trip-wire will fire on one of two events, and both are foreseeable:** the FLIP (an evaluator
wired into a worker tick), or anything in `api/services/alerts.py`'s closure naming `price_level`.

⚠️ **The marker bump therefore discharged NOTHING, and its row says so.** Of the 29 files master
gained since flow-worker's running commit, **zero** were reachable-but-unwatched. It was bumped to
establish a **known-current baseline before CP2** rather than to clear a backlog — a classification
row that claimed a discharge here would have been ceremony, and the next one would mean less for it.

⚰️ Recorded in the marker itself: its first two lines are stamped `2026-09-12` but were written
2026-09-11 ~23:15/23:27 CDT, so the file's timestamps read out of order. **Not corrected in place** —
the file is append-only by owner rule, and rewriting a past line is exactly what that rule forbids.
The note is the fix.

### ⛔ THE COMPARISON DESIGN — this row is its SINGLE AUTHORITY

The absorption default (completion plan §4a) says the new type runs **dark** and the flip plus the
legacy switch-off happen in the **same PR**. ⭐ **The dark period is only worth having if the diff is
designed before the evaluator ships** — otherwise "it ran dark for a week" is a duration, not
evidence. GATE-S7-PRICE-LEVEL §5 condition 5 points HERE and deliberately restates none of it.

**The question the comparison answers:** *for the same price cross, did `price-level` fire when
`watchlist_alerts` fired, and only then?*

**The join key.** `(user_id, sym, direction, level_at_fire)` bucketed to the **evaluation cycle**, not
to a wall-clock instant. Both paths ride the same 15s `/api/live-prices` poll, so two fires for one
cross land in the same cycle; a timestamp equality test would fail on ordinary scheduling jitter and
manufacture disagreement.

**Four outcomes, never collapsed to a pass rate** — the `CoverageLine` idiom, because *"we could not
compare"* and *"they disagreed"* are different facts:

| outcome | meaning | what it implies |
|---|---|---|
| **agreed** | both fired, same cycle, same level | the absorption is faithful |
| **new-only** | `alert_fires` fired, legacy did not | ⛔ the member would get an EXTRA alert on flip |
| **legacy-only** | legacy fired, `alert_fires` did not | ⛔ the member would LOSE an alert on flip |
| **not comparable** | no legacy counterpart exists to compare against | **not a disagreement** — see below |

⛔ **"Not comparable" is load-bearing and must not be folded into "agreed."** A predicate armed
during the dark window has no legacy twin; a legacy row deleted mid-window has no new twin. Counting
either as agreement inflates the pass rate in the flattering direction, which is exactly how a dark
period ends up certifying nothing.

⛔ **The comparison must be able to report a disagreement it did not cause.** Before the diff is
trusted, arm one predicate on each path with DELIBERATELY different levels and confirm it reports
`new-only` and `legacy-only` — the non-vacuity control. A differ that has only ever printed "agreed"
has not been shown to be able to print anything else.

⚠️ **Trendline alerts need their own bucket in the report, named.** Their level moves between cycles
by construction, so a small numeric difference is expected rather than a defect; folding them in with
fixed levels would either mask a real disagreement or cry wolf on every one. F-S7-3 is the same root
cause seen from the replay side.

**Where it lives:** ✅ **BUILT IN CP2** — `api/services/alert_taxonomy/price_level_compare.py`,
with `tests/test_alert_taxonomy_price_level_compare.py` as its rail.

⛔ **RULED 2026-09-12 — FORWARD-ONLY, NO REPLAY.** The design above survives intact; the owner's
ruling removed one question from it. Both sides are evaluated live on the same tick from the moment
the dark predicate arms — **no backfill over historical bars, ever**. ⭐ That is stronger than
"decline to replay a line that moved", because deciding *whether* it moved needs a fact the legacy
row does not carry; forward-only never needs the geometry's history at all.

**Added by the ruling:** an anchor rewrite **RESETS the comparison clock** and the pre-move span's
counts are **discarded into `not_comparable`** — never kept as agreement. `anchors_set_at` + a
monotonic `anchor_version` land on the **NEW store only**; ⛔ `watchlist_alerts` gains no columns.
**No verdict is shown before five full trading sessions** of forward data (`verdict_ready`, returned
as its own field so "not enough data yet" can never be read as "they agree").

⚠️ **A real defect the anchor-move test caught, worth keeping visible.** `note_anchor_move` cleared
the legacy baseline but not the predicate's `prev_price`, so the dark side would have reported a
crossing that never happened — **the price did not move through the new line, the line moved under
the price**. `note_anchor_write` now clears it. That is what "the clock resets" means on the dark
side, and nothing in the design document would have caught it.

### ⛔ F-S7-2 — a `price-level` alert can be a TRENDLINE, whose level is a function of TIME

`_alert_level_now` (`:94`) interpolates AND extrapolates between two anchors when
`alert_type == "trendline"`. The legacy module handles exactly two shapes, `"price"` and
`"trendline"`, and the rail DERIVES that set by AST rather than trusting any comment. A schema of
`{symbol, target_price, direction}` drops half the shipped alerts — member-visible (an armed alert
quietly ceasing to be armed), so a separate PR under ruling 2b. ⚠️ The extrapolation means a
`price-level` predicate has **no natural expiry**. Recorded in SPEC-S7 §5.1.

### ⛔ F-S7-3 — "would have fired N times" is NOT honestly computable for a bound trendline

`resync_bound_alerts` (`:130`) rewrites anchors in place when the member moves the drawing, and
`watchlist_alerts` has **no `updated_at`** (`auth_db.py:599`). The replay would run today's line over
last month's bars as though it had always been in force, undetectably. ⭐ A figure is *more*
convincing than a blank — the fabricated receipt S8 forbids. ⚠️ The existing `is_active = 1` scoping
is CORRECT and must survive absorption: a fired alert's geometry is already protected. Three options
recorded in the packet, **none chosen — it is a product call**. Checkpoint 1 registers **no
`replay_fn`**. Recorded in SPEC-S7 §5.6, which named the `price-level` replay case explicitly.

## ⛔⛔ OWNERSHIP RULING — `alert_taxonomy` (owner, 2026-09-11)

**Terminal-Next OWNS `api/services/alert_taxonomy/` and `api/routers/alert_taxonomy.py`.** It built
them (`e994f5337`). The convergence program is closed, so there is no second owner to sign off.

**The convergence program's FILING WATCH is a PROTECTED CONSUMER of this package** — implemented
inside it by `d71326261`, `8ec29b457`, `ca9093c00`, `5f4597ae0` (Section 3 above). It is live to
members since 2026-09-11 12:07:29 ET. Three binding rules:

1. **Any change to predicate or receipt shape ships with a parity test** proving filing watch's
   observable behaviour — **fires, delivery, receipts** — is unchanged. ⛔ **The test goes in
   BEFORE the change and must fail on regression.** A parity test written after the change, or one
   that has never been seen to fail, proves nothing.
2. **Any change that alters what a member sees from filing watch is a SEPARATE PR, flagged to the
   owner by name.** Never bundled with S7 Alerts work.
3. This ruling is recorded here and in both S7 blocks (`product-architecture.md`,
   `alerts-monitoring-spec.md`) so the shared-code fact and the rule live where the next session
   actually reads them.

⭐ Ownership resolves the blocker; it does not authorize the work. S7 Alerts completion is **Wave 2,
plan-only** until the owner authorizes trigger types individually.

## Member-facing copy shipped by this program

Recorded so the owner can find and reword it without reading a diff.

| surface | exact string | shipped by | condition |
|---|---|---|---|
| Calendar header (`app/src/pages/calendar/CalendarHeader.jsx`) | **"Some earnings/economic data may be incomplete this week (a provider was unavailable)."** | `1214dc246` (A5 modernization) | renders only when `earningsProvenance.degraded` or `econProvenance.degraded`; desktop only (`!isPhone`); a healthy week shows nothing |

⛔ This is the one row from the A5 Terminal-Current change set that a member can see on an otherwise
healthy day. Owner ruling 2026-09-11: **KEEP.** Reword freely — it is a string, not a contract.

## Method note — why the PASS condition uses CREATED paths, not touched paths

A first attempt defined the program's footprint as **every file the 50 commits touched** (209
files) and returned **126 leftover commits** in `9c3df14b9..origin/master`. Nearly all were other
workstreams' legitimate work — notebook waves, the joystick hub, pattern-vision, OCR — because the
program edited shared high-traffic files (`api/main.py` and the like) that everyone edits.

⭐ **A shared file cannot attribute authorship.** The discriminator that works is the set of paths
the program **created** (102 files): those have a single origin, so a later commit touching one is
either this program continuing, or another workstream building on it — and both belong in the
ledger. That is the query above, and it is the rail's PASS condition.
