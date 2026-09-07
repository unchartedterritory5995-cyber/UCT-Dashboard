# ACCOUNT SWITCH / FULL SHUTDOWN HANDOFF — uct-terminal

**This is a preservation/continuity artifact, not a status report.** Written
for a brand-new Claude instance with ZERO conversational memory of the prior
session. Do not assume anything in this document is still current without
re-verifying live state per Section T.

---

## A. IDENTITY

- **Session name:** `uct-terminal` (explicitly set via `/rename` immediately
  before this handoff was written)
- **Project:** UCT Dashboard (branded "UCT Intelligence" as a product; the
  `/calendar` route is separately display-named "UCT Terminal" in the UI —
  that is NOT what this handoff's "UCT Terminal" refers to. Here, "UCT
  Terminal" is the *workstream's own umbrella name* for a long-running,
  owner-authorized autonomous convergence/trust-hardening initiative spanning
  many parts of the dashboard, tracked in
  `docs/uct-terminal/continuity-checkpoint.md`.)
- **Workstream:** UCT Terminal Continuous Execution — a standing directive
  authorizing sequential, bounded, independently-safe "Seam" convergence
  programs (identity, search, comparison, attention, alerting, calendar/
  session truth) without a stop-and-wait between each, subject to explicit
  owner-required stop conditions.
- **Repository:** `unchartedterritory5995-cyber/UCT-Dashboard`
  (`https://github.com/unchartedterritory5995-cyber/UCT-Dashboard.git`,
  remote name `origin`)
- **Repository root (this worktree):**
  `C:\Users\Patrick\uct-worktrees\journal-trade-lifecycle-convergence`
- **Worktree:** the path above IS the worktree. It is a git-worktree checkout
  of the shared repo (the repo has MANY other worktrees/branches for other
  concurrent sessions/agents — see Section N). This directory persists on
  disk through an OS reboot and a Claude account switch; neither operation
  deletes or moves it.
- **Branch:** `fix/seam28-verdict-pattern-bridge-trust`
- **HEAD SHA (at checkpoint time):** `0113a00e8a676bc7638e3f6abc4ba40ec3f8a3d3`
- **Upstream:** `origin/master` — branch was fully up to date with upstream,
  0 ahead / 0 behind, at checkpoint time.
- **Date/time of checkpoint:** 2026-09-07, 09:57 CDT (2026-09-07T14:57:03Z)

---

## B. ORIGINAL OBJECTIVE

Execute a standing **"UCT TERMINAL — CONTINUOUS EXECUTION DIRECTIVE"**: after
each bounded convergence/trust-hardening program completes, the owner issues
a "NEXT PROGRAM" directive (or authorizes continuing autonomously) for the
next one, without requiring a stop-and-wait for authorization between
programs — subject to explicit owner-required stop conditions (destructive
migrations, financial-record merging, auth-semantics changes, irreversible
data changes, major policy decisions, ambiguous identity, licensing
decisions, protected-parallel-program conflicts, no independent work left,
trust/safety regressions).

Each program follows the same shape: **Phase A** (read-only investigation,
often re-verifying — and sometimes correcting — a stale ledger claim rather
than trusting it) → **Phase B** (implementation, authorized automatically if
Phase A proves a bounded, safe, additive case) → tests (written + run, with a
non-vacuity check via a safe git-stash pattern) → merge to `master` (via a
specific git-plumbing pattern, see Section N) → Railway deploy → production
verification (commit-SHA match + at least one additional read-only check) →
`docs/uct-terminal/continuity-checkpoint.md` update → move to the next
program, or report a **HOLD** if nothing bounded and unblocked remains.

---

## C. AUTHORITATIVE SCOPE

**In scope this session (window captured by this handoff):**
- Seam 8 — Price-Move Evidence Timestamp Convergence V1
- Chart Comparison Picker Convergence V1
- Seam 7 — Dual NYSE Calendar Architecture Adjudication + V1

**Also completed earlier in this same overall session, before the context
window this handoff was written from began — already fully closed, do NOT
re-investigate:** Seam 1 (read-side identity fix), Seam 19, Seam 17
Remainder, Seam 11, Seam 14, Seam 6, plus an earlier "re-anchor" wave (Seam
28/29 MUST-FIX trust defects, Alert Durability V1/Seam 30, keyboard
accessibility, Compare Coverage V1, Seam 20/21/25, Feature-Flag Governance
Sweep, a `CommandPalette.jsx` fix). **Full historical detail for ALL of these
lives in `docs/uct-terminal/continuity-checkpoint.md`'s "CURRENT ACCEPTED"
section and its debt ledger — that file, not this handoff, is the durable
system of record for session history.** This handoff is a snapshot/pointer
for the account-switch moment, not a re-derivation of that history.

**Explicitly OUT of scope / protected — do not touch without fresh, explicit
authorization:**
- Pattern Vision (external gate — see Section L/R)
- Technical Research (parked behind Pattern Vision acceptance)
- Technical Ask AI (Phase A already complete and fully specced — parked
  behind the same gate; do NOT repeat Phase A on resume)
- S7 alert evaluator / NVDA filing monitor (waiting on a natural external
  SEC filing — never fabricate, replay, or mutate)
- 8G-B scanner/pattern-engine performance work (has its OWN separate
  continuity doc: `docs/uct-scanner-intelligence/continuity-checkpoint.md`)
- Active Notebook-session work (a separate, concurrently-developing
  workstream on this same repo/branch history — treat its commits on
  `master` as ordinary drift unless they show actual file overlap)
- Seam 3, Seam 4, Seam 13, Seam 18, Seam 22, Seam 24, Seam 27 — each
  explicitly gated (product decision, collision risk) or explicitly
  low-priority; not to be picked up "to stay busy"

---

## D. IMPORTANT PRIOR CONTEXT

- This is a marathon, many-program session. The three programs detailed in
  this handoff (Sections G-K) are only the MOST RECENT slice — dozens of
  prior programs already shipped earlier in the same overall session and are
  fully recorded (not re-derived here) in
  `docs/uct-terminal/continuity-checkpoint.md`.
- A **"FRESH WHOLE-PRODUCT STRATEGIC RE-ANCHOR"** (2026-09-06, a 13-lens
  parallel multi-agent review) concluded the deterministic spine
  (identity/routing/comparison/attention/alerting) this session's programs
  have been converging is now **"essentially coherent"** — the product's own
  stated stage is **COMPLETION-HARDENING, not mid-build.** The remaining gap
  was characterized as (a) trust-boundary inconsistency across already-built
  AI surfaces and (b) reachability of already-built capabilities that are
  effectively islands — not missing core capability.
- **A near-incident worth knowing about:** during Seam 8's Phase A, a
  dispatched investigation fork — explicitly instructed READ-ONLY — self-
  reported having violated that instruction and modified 8 files in this
  shared active worktree, then was killed. A full forensic file-by-file diff
  audit proved every changed file matched EXACTLY what had already been
  independently written and documented — a false alarm (likely the fork
  misattributing the worktree's own pre-existing dirty state to itself), not
  actual misbehavior — but it cost a full audit cycle before work could
  safely continue. This matches a known pattern in the owner's own
  standing operating guidance: **after dispatching any fork/subagent with
  file-system access, verify `git status`/`git diff` yourself before trusting
  its self-report, every time, no exceptions.**

---

## E. DECISIONS ALREADY MADE (carry these forward — do not re-litigate)

1. **ComparisonPicker.jsx (Chart Comparison Picker Convergence V1):** KEEP
   the existing chart-toolbar comparison surface. ADD canonical
   `/api/ticker-search`-backed live symbol search, implemented via
   `useTickerSuggest.js` (the shared HOOK) — deliberately NOT via the full
   `TickerCombobox` component (see Section M for why). PRESERVE the existing
   7 curated quick-pick buttons unchanged, as a permanently distinct
   "browse without typing" affordance. This was an explicit owner product
   decision, already implemented and live.
2. **Seam 7 architecture decision — Option D:** KEEP both `nyseCalendar.js`
   (frontend, bundled, zero network dependency by design) and
   `bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD` (backend) as **separate
   runtime-local datasets.** Do NOT collapse into one network-fetched
   authority — chart/session-state needs zero-latency local truth for a
   tight render loop; `useMarketCalendar.js` (`GET /api/market-calendar`)
   already correctly implements the network-fetch pattern for the ONE
   consumer (the Dashboard session pill) that can tolerate a round trip. The
   fix that was actually missing was GOVERNANCE (a cross-stack parity test +
   coverage-window discipline), not a redesign.
3. **Owner explicitly authorized (via an AskUserQuestion mid-program)
   implementing BOTH the Seam 7 architecture-guard V1 AND two newly-found,
   unrelated live defects in `voice_temporal_awareness.py`** (discovered
   during the same Phase A, not originally part of Seam 7's scope) **in the
   same program**, rather than deferring the defects to a separate program.
4. **Seam 8's `price_move.as_of`:** derived from a REAL vendor observation
   timestamp when one is available (converted to an ET calendar date string,
   matching every other Attention fact kind's own `as_of` convention — never
   a raw timestamp, never a wall-clock fabrication). The `freshness` field on
   the same fact is DELIBERATELY left untouched (still hardcoded `"fresh"`)
   — that is a separate, still-open, explicitly out-of-scope gap (see
   Section L).
5. **`priceObservedAt` (Watchlist Attention) is deliberately kept OUT of its
   SWR hook's cache key** — including it would refetch the whole intelligence
   batch on every ~15s live-price tick. Mirrors the pre-existing `changes`
   parameter's own established off-key design.

---

## F. RESEARCH / FINDINGS ALREADY ESTABLISHED

### Verified (by direct code reading AND empirical execution — not just inference)

- `massive.py::get_batch_quotes` already computed each ticker's own vendor
  observation timestamp; it was being silently discarded after being folded
  into an aggregate freshness classification. (Seam 8's core finding — fixed
  by stamping it per-ticker instead of discarding it. Zero new provider
  calls needed.)
- `ComparisonPicker.jsx` never had a real 7-symbol ceiling. `MAX_COMPARISONS
  = 5` (concurrent comparison slots) is a separate, unrelated number from
  the 7 curated quick-pick shortcuts — the product ledger had conflated the
  two. The actual gap was zero identity-resolution on the free-text "Add"
  path (any typed string was accepted with no validation, no search, no
  existence check). (Chart Comparison Picker Convergence V1's core finding.)
- **THREE (not two) independent, hand-maintained NYSE calendar tables
  exist**, not the two the product ledger had recorded:
  1. `app/src/lib/marketClock/nyseCalendar.js` (frontend, bundled)
  2. `api/services/bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD` (backend)
  3. `api/services/voice_temporal_awareness.py` (backend) — **previously
     unrecorded anywhere in the ledger.** Feeds EVERY Compass voice/chat
     session's temporal narration (`build_temporal_prompt_line` is injected
     into every session's system prompt; `get_market_context` is registered
     as an AI-callable tool).
  All three were verified PROGRAMMATICALLY (not by eye) to agree on every
  overlapping date at audit time — zero mismatches.
- `nyseCalendar.js`'s `COVERED_YEARS` was `[2026]` only — roughly 4 months of
  runway at audit time, versus roughly 16 months for the other two tables —
  with a degrade-to-"every weekday is a full trading day" behavior for any
  out-of-coverage date that is TEST-PINNED as intentional (existing
  `extSession.test.js`/`marketSession.dailypaint.test.js` assertions
  explicitly expect this). But there was ZERO mechanism reminding anyone to
  extend coverage before that cliff — unlike the backend's own
  `market_calendar.py` router, which has a genuinely sophisticated
  milestone-gated Discord-alert system for ITS OWN table's runway (that
  system does not, and structurally cannot, protect the frontend table's
  much sooner cliff, since it watches a different dataset).
- `voice_temporal_awareness.py::_session_state()` had **ZERO early-close
  awareness** — CONFIRMED LIVE by directly executing the (pre-fix) function
  in this environment against real, already-scheduled 2026 dates: at
  2026-11-27 13:30 ET (30 minutes after the real 1:00 PM NYSE early close)
  it returned `{"state": "rth", "detail": "close in 150 min"}`; same class
  of wrong answer at 2026-12-24 14:00 ET.
- `voice_temporal_awareness.py::_et_now()` used naive DST arithmetic
  (`-4 if 3 <= month <= 10 else -5`) instead of `zoneinfo` — CONFIRMED LIVE
  by direct execution to be off by exactly 1 hour for the roughly 1 week
  each March between March 1 and the real 2nd-Sunday DST transition (e.g.
  2026-03-03 12:00 UTC computed as 08:00 ET instead of the real 07:00 EST).

**All of the findings above were fixed and are live in production as of this
checkpoint** (see Sections G-I).

### NOT fully verified / explicitly out of scope — do not assume resolved

- Whether any file BEYOND the three found here independently encodes NYSE
  holiday/session logic was not exhaustively, mathematically proven
  impossible — the Phase A sweep was thorough (broad keyword + hardcoded-
  date-literal grep across both frontend and backend) but is empirical, not
  a formal guarantee of completeness.
- `watchlist_intelligence.py`'s `freshness` field (distinct from `as_of`) is
  STILL hardcoded `"fresh"` for `price_move` facts, not derived from actual
  data staleness. This is a real, known, currently-unaddressed gap,
  explicitly out of Seam 8's own scope, and is NOT currently tracked as its
  own numbered program.

---

## G. WORK COMPLETED (this handoff's window)

All three programs below are **RESOLVED, IMPLEMENTED + ACCEPTED, DEPLOYED,
and PRODUCTION VERIFIED** — nothing here is partial or in-progress.

1. **Seam 8 — Price-Move Evidence Timestamp Convergence V1**
   (merge `22452cff7` / `dbd08ece6`)
2. **Chart Comparison Picker Convergence V1**
   (merge `ac93afc68` / `1fa935e80`)
3. **Seam 7 — Dual NYSE Calendar Architecture Adjudication + V1**
   (merge `4c4e19ede` / `141dd978f`)

Plus a continuity-checkpoint update after each of the above (commits
`1486b7daf`, `924f25c97`, `e6f8ead72`), and a final **Formal Hold Checkpoint**
continuity update (commit `0113a00e8` — current `master` HEAD) recording that
the workstream has entered a legitimate, owner-accepted hold with no bounded,
unblocked work remaining as of this checkpoint.

---

## H. FILES / MODULES CHANGED (this window — all already committed/merged/deployed)

**Seam 8:**
`api/services/massive.py` · `api/routers/live_prices.py` ·
`api/services/watchlist_intelligence.py` · `api/routers/journal_two.py` ·
`api/routers/watchlists.py` · `app/src/hooks/useWatchlistIntelligence.js` ·
`app/src/pages/Watchlists.jsx` · `tests/test_watchlist_intelligence.py` ·
`tests/test_live_prices_observed_at.py` (new) ·
`tests/test_journal_two_positions_attention.py`

**Chart Comparison Picker Convergence V1:**
`app/src/components/chart/ComparisonPicker.jsx` ·
`app/src/components/chart/ComparisonPicker.module.css` ·
`app/src/components/chart/ComparisonPicker.test.jsx` (new — first-ever
direct test coverage for this component)

**Seam 7:**
`app/src/lib/marketClock/nyseCalendar.js` ·
`api/services/voice_temporal_awareness.py` ·
`tests/test_nyse_calendar_parity.py` (new) ·
`tests/test_voice_temporal_awareness.py` ·
`app/src/utils/extSession.test.js` ·
`app/src/utils/marketSession.dailypaint.test.js` ·
`app/src/lib/marketClock/marketClock.test.js`

**Continuity (updated after every program via the blob-swap pattern, see
Section N):** `docs/uct-terminal/continuity-checkpoint.md`

---

## I. COMMITS / SHAs

All of the following are **fully promoted**: local → pushed → merged into
`master` → deployed to Railway `web` production → verified live. **None are
lab/research-only or superseded.**

| SHA | Description |
|---|---|
| `22452cff7` | Seam 8 implementation |
| `dbd08ece6` | Seam 8 merge into master |
| `1486b7daf` | Seam 8 continuity-checkpoint update |
| `ac93afc68` | Chart Comparison Picker Convergence V1 implementation |
| `1fa935e80` | Chart Comparison Picker merge into master |
| `924f25c97` | Chart Comparison Picker continuity-checkpoint update |
| `4c4e19ede` | Seam 7 implementation |
| `141dd978f` | Seam 7 merge into master |
| `e6f8ead72` | Seam 7 continuity-checkpoint update |
| `0113a00e8` | **Formal Hold Checkpoint continuity update — CURRENT `master` HEAD, confirmed live in production at checkpoint time** |

---

## J. CURRENT GIT STATE

- **Staged:** none
- **Unstaged:** none
- **Untracked:** none, aside from this handoff file itself (about to be
  added/committed as part of this same checkpoint operation) and its
  external copy (outside the repo, never tracked — see Section T)
- `git status` at checkpoint time: `nothing to commit, working tree clean`,
  branch up to date with `origin/master`.

**There is no in-flight operation, no partial merge, no pending deploy.**

---

## K. VALIDATION / TEST EVIDENCE

For each of the 3 programs in this window:
- Backend `pytest` suites run and green (191 backend tests for the Seam 7
  window alone; 76+ for Seam 8's own adjacent suite).
- Frontend `vitest` suites run and green (199 for the Seam 7 window; 82 for
  Chart Comparison Picker's adjacent `ChartToolbar`/`ComparisonPicker`
  suites; 6 for Seam 8's frontend piece).
- `npm run build` clean (no errors) after every frontend-touching program.
- **Non-vacuity checks performed for every new/changed test file**, via the
  established safe git-stash pattern (stash only the implementation files,
  confirm the new/changed assertions genuinely FAIL against the pre-fix
  code, restore via `git stash apply <exact-sha>` — never `pop` — then drop
  by that exact SHA). Confirmed genuine (non-vacuous) failure subsets for
  all three programs.
- Production verified via commit-SHA match on every deploy, PLUS at least
  one additional read-only method per program: a live `GET` endpoint check
  (Seam 8: `/api/live-prices`), a compiled-bundle content grep (Chart
  Comparison Picker: new UI strings found in the deployed JS chunk; Seam 7:
  `"2027-01-01"` / `"Martin Luther King, Jr. Day"` found in the deployed
  entry bundle), or a direct pure-function execution against an explicit
  test instant via `railway ssh` (Seam 7's `voice_temporal_awareness.py`
  fix) — **never** by manipulating a real clock or a real price in
  production.
- **No known test skips or unresolved evidence gaps for these three
  completed programs.** The only acknowledged evidence gap anywhere in this
  workstream is Pattern Vision's still-accumulating real-session evidence —
  which is expected and by design, not an oversight (see Section L).

---

## L. OPEN ISSUES / RESIDUAL DEBT

- **Pattern Vision:** `PATTERN_VISION_ENABLED=1`, LIVE, **NOT YET
  ACCEPTED.** Needs two real trading-session observations — Tue 2026-09-08
  and Wed 2026-09-09 — before an honest acceptance classification can run.
  2026-09-07 (Monday, the day this checkpoint was written) was explicitly a
  holiday-safety-observation day and does **NOT** count as either required
  session.
- **Technical Research:** implemented + tested, **PARKED** behind Pattern
  Vision acceptance. Do not auto-merge even if Pattern Vision passes —
  requires its own fresh drift check + bounded re-test + contract
  verification first (see Section R).
- **Technical Ask AI:** Phase A already complete and fully specced,
  **PARKED** behind the same gate. Do NOT repeat Phase A on resume — resume
  directly from the recorded specification.
- **S7 alert evaluator:** WAITING on a natural, newer NVDA SEC filing.
  `alert_fires` table confirmed **0 rows** as of this checkpoint. Never
  fabricate, replay, or mutate a filing/baseline to force this.
- **Awareness Reachability Restoration V1:** built, deliberately SKIPPED
  pending a genuine owner monetization/entitlement decision — not an
  engineering blocker, do not resolve unilaterally.
- **Seam 13:** risk of colliding with concurrent, actively-developing
  Notebook-session work — do not pick up while that collision risk remains
  live (re-check `git log` on `origin/master` for recent Notebook-related
  commits before considering it).
- **Seam 18 / Seam 22 / Seam 24:** each needs an explicit owner product/UX
  decision before any V1 is even definable.
- **Seam 3 / Seam 4 / Seam 27:** explicitly LOW-PRIORITY. Not to be picked
  up merely to fill idle time.
- **`watchlist_intelligence.py`'s `freshness` field** (separate from
  `as_of`) is still hardcoded, not derived from real staleness — a known,
  minor, currently-unaddressed gap (see Section F).
- **`SwitchTickerBox`/`MobileSymbolSheet.jsx` convergence:** a real,
  recorded, NOT-yet-bounded future candidate — would need its own scoping
  pass before it is a definable V1.

---

## M. REJECTED / RULED-OUT APPROACHES

- **Seam 7:** did NOT collapse `nyseCalendar.js` into a network-fetched-
  from-backend model ("Option C"). Considered and rejected: chart/session-
  state needs zero-latency local truth for a tight render loop; Option C is
  already correctly used elsewhere (`useMarketCalendar.js`, the Dashboard
  session pill) for the one consumer that CAN tolerate a network round trip
  — that precedent is exactly why extending it to chart-session code would
  be the wrong fit, not evidence it should be extended.
- **Chart Comparison Picker:** did NOT reuse the full `TickerCombobox`
  component. Considered and rejected: `TickerCombobox` bundles its
  underlying hook's own 12-item empty-query fallback list directly into its
  dropdown, which would have visually duplicated/competed with
  `ComparisonPicker`'s own distinct, product-curated 7-item quick-pick row.
  Reused the underlying `useTickerSuggest.js` HOOK directly instead, gating
  the new dropdown to only render once the member has actually typed
  something.
- **Seam 7 parity test:** did NOT retype/duplicate `nyseCalendar.js`'s dates
  into a separate Python fixture file. The test regex-parses the REAL `.js`
  source file directly (with its own explicit non-vacuity guard against the
  parser silently matching zero dates and passing vacuously) — specifically
  to avoid creating a FOURTH hand-typed copy of the same underlying data.
- **`voice_temporal_awareness.py`'s early-close fix:** an early draft
  accidentally shifted the existing "lunch chop"/"afternoon trend" sub-label
  boundary by 30 minutes on ORDINARY (non-early-close) days while adding
  early-close support. Caught via a byte-identical-behavior check across the
  full 9:30–16:00 minute range and corrected: regular-day behavior now uses
  the EXACT original absolute-time boundaries, unchanged; the new logic is
  scoped to apply ONLY on early-close days.

---

## N. CRITICAL CONSTRAINTS — do not accidentally violate these

- **Never** manufacture Pattern Vision acceptance evidence, or accept it
  before the real two-session window (Tue 9/8 AND Wed 9/9) genuinely
  completes.
- **Never** fabricate, replay, or mutate an S7 alert/filing baseline.
- **Never** touch Pattern Vision, Technical Research, Technical Ask AI, S7,
  8G-B, or active Notebook work without fresh, explicit authorization.
- **Every merge to `master` uses a specific git-plumbing pattern** — do not
  substitute a plain local `git merge`:
  ```
  git fetch origin master
  BASE=$(git rev-parse origin/master)
  HEAD_SHA=$(git rev-parse HEAD)
  TREE=$(git merge-tree --write-tree $BASE $HEAD_SHA)
  MERGE=$(git commit-tree $TREE -p $BASE -p $HEAD_SHA -m "...")
  git push origin $MERGE:master
  ```
  This lets a fresh `origin/master` fetch happen immediately before the tree
  is built, which matters because `master` moves frequently from other
  concurrent sessions (mainly Notebook waves).
- **Every `docs/uct-terminal/continuity-checkpoint.md` edit uses a blob-swap
  pattern**, always re-pulling fresh from `origin/master` immediately before
  editing (`git show origin/master:docs/uct-terminal/continuity-checkpoint.md
  > <scratch-file>`, edit that, `git hash-object -w`, build a tree via a
  temp index, `commit-tree`, push) — **never** trust a previously-cached
  local copy of that file, even one from minutes earlier in the same
  session.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is
  SHARED across this repo's many concurrent worktrees/sessions. Always use
  a uniquely-tagged `git stash push -u -m "<unique-tag>"`, capture its exact
  SHA immediately via `git stash list --format='%H %gs'`, restore via
  `git stash apply <that-exact-sha>` (never `pop`), then drop it by that
  exact SHA — never by a `stash@{n}` index alone, which can shift.
- **A push to `master` — even a docs-only continuity commit — triggers a
  FULL Railway rebuild + redeploy** (the `web` service has no narrow
  `watchPatterns`). Expect and wait out a full BUILDING → DEPLOYING →
  SUCCESS cycle (historically 3-6 minutes) before treating any change as
  live; verify via `railway ssh -s web -e production -- "env | grep
  RAILWAY_GIT_COMMIT"` (commit-SHA match against the pushed SHA).
- **Railway CLI project link** (re-link if a fresh session finds itself
  unlinked):
  ```
  railway link -p d6574d0b-7973-4ece-b35c-65c0ad4c453d \
                -e 4c2149a7-d7bd-4bf9-9a4c-a879a5800067 \
                -s f57fc2b1-0dbc-44e6-9514-84f55a94fc37
  ```
  (project `luminous-recreation`, env `production`, service `web`)
- Any `railway ssh` command referencing an absolute Unix-style path must be
  prefixed `MSYS_NO_PATHCONV=1` (a Git-Bash/MSYS2 path-mangling gotcha on
  this specific Windows box).
- **`C:\data` is REAL on this Windows box** and resolves to LIVE PRODUCTION
  DATA for any code path that reads `/data/...` locally. The repo's own
  `conftest.py` guards the pytest suite against this specifically, but any
  ad-hoc script run OUTSIDE pytest is NOT protected — never point a local
  script at `/data`.
- This repo has MANY concurrent git worktrees under
  `C:\Users\Patrick\uct-dashboard\.claude\worktrees\` and
  `C:\Users\Patrick\uct-dashboard\.worktrees\` belonging to other
  sessions/agents — do not assume this is the only active workstream on
  this repository.

---

## O. DEPENDENCIES / GATES

- **Pattern Vision acceptance** (external, real-world evidence, 2-session
  window ending 2026-09-09) gates the Technical Research release and the
  Technical Ask AI resume.
- **A natural NVDA SEC filing** (external, unpredictable timing) gates S7's
  next real evaluation cycle.
- **An owner monetization/entitlement decision** gates Awareness
  Reachability Restoration V1.
- **Owner product/UX decisions** gate Seam 18 / Seam 22 / Seam 24.
- **Concurrent Notebook-session activity** (a separate, actively-developing
  workstream on this same repo, sharing `master`) is a standing collision
  risk specifically for Seam 13 — check `git log --oneline -15
  origin/master` on any resume to see what has landed since this checkpoint
  before assuming Seam 13 is still untouched.
- **Railway** (deploy target, project `luminous-recreation`) and **GitHub**
  (`unchartedterritory5995-cyber/UCT-Dashboard`, the `origin` remote) are
  both live external services this entire workflow depends on for every
  merge/deploy/verify step. Both use credentials SEPARATE from the Claude
  account being used — see Section P.

---

## P. ENVIRONMENT / CONFIGURATION

- **OS:** Windows 11 Home. Shell tools available: PowerShell (primary) and
  Git Bash (this session's `Bash` tool ran POSIX `sh` via Git Bash almost
  exclusively for `git`/`railway`/`pytest`/`npm` work).
- **Model:** Claude Sonnet 5 (`claude-sonnet-5`) was the main-loop model this
  session.
- **Node/npm** (frontend): build via `cd app && npm run build`; tests via
  `cd app && npx vitest run <path>`; lint via `cd app && npx eslint <path>`.
- **Python** (backend): tests via `python -m pytest tests/<file> -v` (or
  `api/services/<file>_test.py` for co-located test files) run from the
  repo root. **`python`, not `python3`, is the correct interpreter alias on
  this box** (`python3` was tried once and failed — not installed under that
  name here).
- **Railway CLI:** must be logged in (`railway whoami` → was
  `unchartedterritory5995@gmail.com` at last check) and linked to the
  project/env/service in Section N. Re-verify both on any resume — this is a
  LOCAL credential (separate from the Claude account), so it should survive
  the account switch + reboot, but confirm rather than assume.
- **Scratchpad directory used this session:**
  `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\5fdcc575-4f52-479e-98de-94a56d52ccfb\scratchpad`
  — held continuity-doc drafts (before pushing), deploy-status poll JSON
  snapshots, and an ad-hoc `parse_deploy_status.py` helper script.
  **⚠️ THIS PATH IS TIED TO THIS SPECIFIC SESSION ID AND WILL NOT BE
  REACHABLE OR RELEVANT TO A NEW SESSION AFTER THE ACCOUNT SWITCH** — a new
  session gets its own fresh scratchpad path. Nothing of unique,
  unrecoverable value lives there; everything durable has already been
  committed to this repository and to
  `docs/uct-terminal/continuity-checkpoint.md`. Do not attempt to locate or
  rely on that path after resume.
- **MCP / tools:** `mcp__claude-in-chrome__*` browser-automation tools were
  available (deferred, load-on-demand) but were NEVER actually invoked this
  session — no browser tabs, no browser state to recover. The GitHub MCP
  plugin (`plugin:github:github`) was connected-but-failing all session
  ("Authorization header is badly formatted") — all GitHub/git operations
  were done via the Bash `git` CLI instead, which worked fine throughout. If
  a fresh session specifically needs the GitHub MCP connection, that failure
  may still need fixing independently — it is unrelated to the account
  switch itself.
- No new secrets/credentials were created or modified this session; nothing
  beyond what already lives in the repo and in Railway's own variable store
  was read or changed.

---

## Q. EXACT STOPPING POINT

Immediately after: **(1)** completing and fully production-verifying Seam 7
(Dual NYSE Calendar Architecture Adjudication + V1); **(2)** pushing a
**Formal Hold Checkpoint** continuity-doc update (commit `0113a00e8`, current
`master` HEAD, confirmed live in production) that records the workstream is
in a legitimate, owner-accepted HOLD with no bounded, unblocked work
remaining; and **(3)** a brief, purely conversational exchange — the owner
asked a reflective "how close is this to complete relative to the overarching
vision" question (answered narratively; no code or doc changes resulted from
that exchange), then renamed the session to `uct-terminal` and initiated this
full-shutdown/account-switch handoff.

**There is no in-progress program, no uncommitted change, no pending merge or
deploy.** This is a full stop at the cleanest possible boundary — right after
a complete push → deploy → verify cycle for the hold checkpoint itself.

---

## R. NEXT RECOMMENDED ACTION

**Do nothing engineering-wise until Pattern Vision's real-session evidence
window closes (2026-09-09 or later).** The smallest correct next action on
ANY resume before then is purely verification, not action:

1. `git fetch origin master && git log --oneline -10 origin/master` — see
   whether `0113a00e8` is still the tip, or what (most likely more Notebook
   waves) has landed since.
2. `git status` in the worktree — confirm still clean.
3. `railway whoami` and `railway status --json` — confirm Railway CLI is
   still logged in and linked (re-link per Section N if not).
4. **Read `docs/uct-terminal/continuity-checkpoint.md` fresh from
   `origin/master`** (never from a locally-cached copy) — this file is the
   single most important artifact in this whole handoff chain: it is the
   authoritative, continuously-updated record for the ENTIRE workstream, and
   will be MORE current than this document if any real time has passed
   between this checkpoint and the resume. Its own **"⛔⛔ FORMAL HOLD
   CHECKPOINT"** section (placed near the very top of that file,
   immediately after the "Last verified" summary paragraph) is the live,
   authoritative version of everything in this handoff's Sections L, Q, R,
   and S.
5. Live-check Pattern Vision's actual acceptance state and S7's
   `alert_fires` row count (both were live-checkable in under a minute this
   session — see the continuity doc's own recorded method for each).

**Only once Pattern Vision genuinely reaches LIVE + ACCEPTED against real
evidence** (or the user gives fresh explicit direction) does the "priority
interrupt" sequence become the next real action: Technical Research Release
Review (fetch fresh master, inspect drift, reconcile only if clean, re-run
bounded tests, verify its confirmed-pattern contract still matches the
now-accepted Pattern Vision system, then classify release readiness) → if it
passes, merge/deploy/verify/update continuity → then resume Technical Ask AI
directly from its already-complete Phase A specification (do not repeat
Phase A).

**If Pattern Vision does NOT pass:** do not force Technical Research or
Technical Ask AI into production. Record the exact failure evidence.
Determine the smallest evidence-based remediation program. Do not reopen
unrelated Terminal convergence work as a consolation activity.

---

## S. DO-NOT-DO LIST

- Do not start a new architecture review or multi-agent re-anchor merely
  because the session/account is fresh.
- Do not pick up Seam 3 / Seam 4 / Seam 13 / Seam 18 / Seam 22 / Seam 24 /
  Seam 27 "to stay busy" — all are explicitly gated or low-priority.
- Do not touch Pattern Vision, Technical Research, Technical Ask AI, S7,
  8G-B, or active Notebook work without fresh, explicit authorization.
- Do not accept Pattern Vision after only ONE real session (Tue 9/8 alone is
  not sufficient) — BOTH Tue 9/8 AND Wed 9/9 are required before
  classification.
- Do not manufacture Pattern Vision detections or manually invoke scanner
  activity to force evidence into existence.
- Do not replay, fabricate, or mutate any S7 filing/baseline state.
- Do not reopen Seam 6, Seam 7, Seam 8, Seam 11, Seam 14, Seam 17 Remainder,
  or Chart Comparison Picker Convergence V1 (or any other RESOLVED program)
  without concrete, freshly-observed regression evidence — re-read the
  relevant `continuity-checkpoint.md` entry first.
- Do not rebase, force-push, delete branches, delete worktrees, or run any
  other destructive git operation on this repo without explicit fresh
  authorization.
- Do not trust this handoff's recorded git SHAs as still-current without
  re-verifying live — concurrent sessions (mainly Notebook) push to
  `origin/master` frequently.
- Do not assume the scratchpad path recorded in Section P is reachable from
  a new session — it is not.
- Do not overwrite or delete `docs/uct-terminal/continuity-checkpoint.md`'s
  history when next editing it — it is edited via a targeted blob-swap, not
  a wholesale rewrite (see Section N).

---

## T. RECOVERY INSTRUCTIONS

1. On the new machine session (same Windows box, different Claude account),
   open Claude Code with working directory set to
   `C:\Users\Patrick\uct-worktrees\journal-trade-lifecycle-convergence` — the
   worktree persists on disk through the account switch and the reboot;
   neither operation deletes or moves it.
2. Read this file in full:
   `docs/uct-terminal/ACCOUNT_SWITCH_HANDOFF_uct-terminal_2026-09-07.md`
   (primary copy, tracked in the repo, committed and pushed as part of this
   same checkpoint operation).
   - A secondary, NEVER-tracked copy also exists outside any git repository
     at:
     `C:\Users\Patrick\ACCOUNT_SWITCH_HANDOFFS\ACCOUNT_SWITCH_HANDOFF_uct-terminal_2026-09-07.md`
     — use this one only if the worktree above is ever unavailable.
3. Verify current state matches this document's recorded state — do **not**
   assume it is still accurate. Follow Section R's exact verification steps.
4. If `origin/master` has moved since this checkpoint, treat that as
   ordinary, expected drift (most likely from a concurrent Notebook-session
   wave) — do not investigate it unless it touches files this workstream
   cares about (the files listed in Section H, or
   `docs/uct-terminal/continuity-checkpoint.md` itself).
5. Do not begin any engineering action until the Pattern Vision gate
   resolves or the user gives fresh direction — per Section R, this is a
   legitimate, owner-accepted hold, not a stall to break out of on your own
   initiative.

---

## U. FIRST MESSAGE TO CLAUDE AFTER RECOVERY

> Read `docs/uct-terminal/ACCOUNT_SWITCH_HANDOFF_uct-terminal_2026-09-07.md`
> in full — it's a complete account-switch handoff for the UCT Terminal
> Continuous Execution workstream, written for exactly this situation (zero
> conversational memory). Then verify current live state per that document's
> own Section T/R (fresh `git fetch origin master`, `git status`, Railway CLI
> link, and — most importantly — re-read
> `docs/uct-terminal/continuity-checkpoint.md` fresh from `origin/master`,
> since it is the more current authoritative record and has its own live
> "FORMAL HOLD CHECKPOINT" section near the top). Report what you find before
> taking any action — this workstream was in a legitimate hold waiting on
> Pattern Vision's real-session evidence (Tue 2026-09-08 + Wed 2026-09-09),
> and nothing should be started unilaterally.

---

*End of handoff. Written by Claude (session `uct-terminal`) at 2026-09-07
09:57 CDT, immediately before an intentional full shutdown + Claude-account
switch.*
