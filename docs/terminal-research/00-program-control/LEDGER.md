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

## S7 `price-level` — Checkpoint 1, branch only, UNMERGED

| commit | branch | system | files | what |
|---|---|---|---|---|
| `37cba8111` | `feat/s7-price-level` | **S7 Alerts** | `api/services/alert_taxonomy/price_level.py` (new), `tests/test_alert_taxonomy_price_level_schema.py` (new), `tests/test_alert_taxonomy_filing_watch_parity.py` (control updated by naming) | **GATE-S7-PRICE-LEVEL Checkpoint 1** (packet `123a30054`, approval block **BLANK**). Registers the type; **no evaluator, no delivery, no read of `watchlist_alerts`, no migration, no scheduler entry**. Legacy path byte-identical (`git diff` empty on `watchlist_alert_service.py` + `auth_db.py`). Two findings below moved the scope. Mutation-proved both ways (M1 drop `trendline` → RED; M2 import `delivery` → RED), restored by edit. **30 passed** across both files |

⛔ **DO NOT MERGE.** The packet's four approval lines are blank by design — the session directive
authorized Checkpoint 1 on a branch, and an author filling in the author's own approval reproduces
the S3 defect the rule exists to prevent.

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

**Where it lives:** beside the evaluator, under its own approval — **not in Checkpoint 1**, which
ships no evaluator and therefore has nothing to diff.

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
