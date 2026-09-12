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
the session reports. These are on feature branches awaiting the owner's merge — **not on
`origin/master`**, so the rail's check (1b) does not yet return them.

| commit | branch | system | files | what |
|---|---|---|---|---|
| `738abc087` | `feat/d1-adoption-sweep` | **D1** | `tools/fmp_guard_census.py`, `tests/test_fmp_guard_census.py` | Retired **2 verified-stale quarantine entries** (`api/routers/calendar.py`, `api/services/econ_calendar_fmp.py`) — both already migrated and measuring zero violations, so their exemptions were **suppressing the rail on clean files**. Added `test_retired_quarantine_entries_are_genuinely_clean` and `test_no_quarantine_entry_is_stale`, the second generalizing the defect |
| `638e12f48` | `feat/d1-adoption-sweep` | **D1** | `docs/d1-implementation-log.md` | Recorded the five adapter gaps (G1–G5) that block every remaining FMP call site |

⛔ **W1-A migrated ZERO call sites, and that is the finding, not a failure.** Every remaining direct
FMP site is blocked by a missing adapter capability, an explicit in-repo directive, or an owner
exclusion. Nothing was hacked around and the adapter was not speculatively extended. Detail and
verification: the session report and `docs/d1-implementation-log.md` on that branch.

⚠️ **Pre-existing red, NOT introduced here:** `tests/test_fmp_guard_census.py::test_real_repo_has_zero_unquarantined_violations`
**already fails on `origin/master`** — `api/services/news/adapters/fmp_news.py:37` carries a
`financialmodelingprep.com` literal and is not quarantined. Independently verified against master's
own tree. Fixing it requires a behaviour change (gap G5: that file has retry, backoff, a request
ceiling and 429 sleep-retry that the adapter does not).

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
