# Stage A Member-Validation — Durable Report

Owns the durable state for the Stage A→B gate (`primary-platform-implementation-plan.md`
§5, decision-log 2026-09-06 "Stage A→B gate NOT waived" entry, refined by the
"activate the real beta cohort" checkpoint, also 2026-09-06). This file is the
one-place record of cohort definition, exposure state, instrumentation,
privacy constraints, metric definitions, thresholds, and gate status. Live
numbers come from `GET /api/j2/notebook-validation-report`
(`api/services/journal_two/stage_a_validation.py::compute_report`) — this
file records definitions and point-in-time snapshots, not a live dashboard.

**Never write member private content (note bodies, search queries, Ask
Current Note questions) into this file.** Only aggregate counts and
qualitative summaries collected and phrased by staff.

---

## 1. Access reality (verified against code, 2026-09-06)

**Notebook is already fully reachable by every existing, logged-in, paid
UCT member — no additional gate exists or is needed.**

- Nav entry: first-class, unconditional, always-visible primary nav item in
  both active Journal 2.0 shells (`JournalLayout.jsx` `PRIMARY_NAV` /
  `JournalTwoRoot.jsx`), routed at `/journal/notebook`. Not a hidden URL.
- `COMING_SOON_MODE` / `VITE_COMING_SOON` (`app/src/utils/comingSoon.js`)
  gates ONLY pre-launch marketing/signup surfaces (`/landing`, `/pricing`,
  `/signup`, etc.) — its own docstring: *"Login is deliberately untouched so
  existing members keep full access throughout."* It does not touch
  Notebook or any authenticated route.
- No feature flag or admin gate on Notebook. **Correction to the initial
  research pass, verified directly against `api/routers/journal_two.py`:**
  note create/read/edit/search/trash/restore/embed/share are gated only by
  `Depends(get_current_user)` — any logged-in member, free or paid. Only
  **Ask Current Note** (`/notes/{id}/ask/stream`) requires a paid plan
  (`require_paid`, an LLM-cost gate, same shape as every other AI route in
  this codebase) — it is the one Notebook capability not open to every
  member. The cohort definition in §2 (`j2_accounts` membership) is
  unaffected by this correction — it targets "has used Journal 2.0 at all,"
  which remains the right beachhead proxy regardless of payment tier.
- **Classification: (A) Stage A is already available to the intended
  existing-member cohort.** No beta-exposure mechanism needs to be built.
  Per the owner's own instruction, when existing logged-in members can
  already reach a feature, use that path rather than building a new gate.

**Standing item, carried forward, NOT a technical blocker:** the decision
log's "HARD PRE-LAUNCH GATE — PRE-LAUNCH AUTHENTICATED NOTEBOOK SMOKE"
(2026-09-05) has never been executed — no authorized production test/canary
login exists (exhaustively searched twice, 2026-09-05 and 2026-09-06;
`ADMIN_EMAILS` names a `+canary` alias with no password available to any
tooling). Per the owner's explicit standing instruction: never request
credentials, never weaken authentication, never flip `COMING_SOON_MODE` to
manufacture a test path. This stays recorded as an accepted evidence gap.
The sandbox browser E2E (real, unmocked clicks against identical code/schema)
and the automated HTTP-layer test suite (12 tests proving every Stage A
event fires through the real router into a real `activity_log` row) remain
what stands in its place for correctness; only the specific claim "observed
through a real authenticated production member session" is not made.

**No new beta-exposure mechanism was built.** One already exists elsewhere
in the codebase and is available if a narrower controlled rollout is ever
wanted (`COMPASS_MENTOR_MODE` ∈ `{0,1,admin,beta}` + a comma-separated
email allow-list, `coach_chat.py::_mentor_mode_active`) — not applied here
because it isn't needed: access is already open to the real cohort.

---

## 2. Cohort definition

- **Eligible** — distinct users with ≥1 `j2_accounts` row, excluding admin
  accounts (`users.role = 'admin'`).
- **Broker-synced eligible** — the above, intersected with `j2_broker_accounts`.
- **Recently active** — `users.last_login_at` within the last 30 days
  (`RECENT_ACTIVITY_DAYS` in `stage_a_validation.py`).
- **Recommended beachhead cohort** — recently active AND Journal 2.0 user
  AND broker-synced. Narrower and higher-signal than "ever created a
  `j2_accounts` row"; reported alongside the broader eligible number so
  neither is mistaken for the whole population.
- **Activated** — distinct non-admin users with a `notebook_tab_visit` or
  `notebook_note_created` event.

**Admin/test-account exclusion:** every real-member count in the report
excludes `role = 'admin'` — the same convention already used elsewhere in
this codebase for admin gating. There is no separate "test account" flag in
this schema; admin exclusion is the available, real mechanism. Synthetic
E2E traffic cannot reach production `activity_log` at all (the fail-closed
sandbox uses a fully isolated `DATA_DIR`/DB — see `tools/e2e_sandbox_launcher.py`),
so it needs no separate filtering.

**Production scale, as of 2026-09-05:** 25 total registered users, 89
`j2_notes` rows platform-wide (across all pre-Notebook and Notebook usage).
This is a genuinely small population — thresholds below were chosen with
this in mind (see §4).

---

## 3. Instrumentation status — LIVE

Deployed to production (commit range `0fb917a9b..97901944b`, merged to
`master`, verified via `/api/health` uptime reset + both new routes
returning 401 rather than 404/SPA-fallback).

Events (all via the existing platform-wide `activity_log` table, prefixed
`j2:`, written by `auth_service.log_activity` which never raises):

| Event | Fires on |
|---|---|
| `notebook_tab_visit` | Notebook tab mount (frontend) |
| `notebook_note_created` | Note creation success (backend) |
| `notebook_thesis_note_created` | Note creation with `"thesis"` tag (backend) |
| `notebook_search_used` | A non-empty search, `{"hasResults": bool}` only (backend) |
| `notebook_ask_current_note_used` | Ask Current Note stream settles, `{"settled","hadAnswer"}` only (backend) |
| `notebook_note_trashed` | Successful soft-delete (backend) |
| `notebook_note_restored` | Successful restore (backend) |
| `notebook_capture_saved` | Successful Save-to-Notebook capture (frontend) |

Trade-link creation is derived directly from `j2_note_embeds.trade_ref IS
NOT NULL` — no separate event needed; the typed Wave 3 reference is itself
a durable, timestamped record.

**Privacy constraint (test-proven, not just asserted):**
`test_notebook_analytics_events.py::test_search_event_details_never_contain_the_query_text`
and `test_report_never_contains_note_or_query_content` plant a secret note
body / search string and assert it never appears in any logged event detail
or in the report's serialized JSON. No note body, search query, or Ask
Current Note question is ever logged.

**Event-quality notes (2026-09-06 review):**
- Repeat usage is measured by **distinct calendar days** of Notebook
  activity (`date(created_at)`), which is refresh-safe by construction — a
  member reloading the tab 50 times in one day still contributes exactly
  one day, so it cannot inflate the repeat-usage signal.
- `notebook_tab_visit` fires once per component mount (React `useEffect`
  with an empty dependency array), so a full page reload does produce a new
  event — this can inflate raw visit counts on a noisy session, but does
  not affect any gate criterion (all criteria key off distinct users or
  distinct days, never raw event counts, except the search-total floor,
  which is now paired with a distinct-user floor — see §4).
- Retries on `notebook_ask_current_note_used` (a frontend retry after a
  failed stream) would log a second event — a known, accepted limitation,
  not fixed, per the instruction not to overengineer identity analytics for
  a Stage A cohort this small.
- Admin/staff QA clicks are automatically excluded from every real-member
  count via role exclusion (§2) — an admin cannot inflate any gate
  criterion by testing the feature.

---

## 4. The Early Signal Gate — the exact eight criteria

Computed live by `GET /api/j2/notebook-validation-report` (dual-gated: a
real admin session, or the `PUSH_SECRET` bearer for ops tooling — mirrors
`api/routers/desk_zoom_webhook.py`'s existing pattern). Six are
telemetry-computable; two require an explicit owner judgment call and are
**never silently assumed true**.

`MULTI_USER_MIN = 3` for every "multiple members" criterion — chosen so a
single enthusiastic member (or two staff testing together) cannot
independently satisfy activation, discovery, repeat usage, research
accumulation, or trade-link adoption for the whole cohort (2026-09-06
checkpoint item 11). This is a real constraint against the 25-user
population above — revisit with the owner if the real recommended-beachhead
cohort (§2) turns out too small to ever clear 3 distinct members on a given
criterion; do not silently lower it without recording that decision here.

| # | Name | Why it matters | Metric | Threshold |
|---|---|---|---|---|
| 1 | Multiple members completed the core workflow | Proves task completion is a real capability, not one person's fluke | distinct non-admin members with `notebook_note_created` | ≥ 3 |
| 2 | Multiple members discovered Save to Notebook unprompted | Organic discovery, not staff instruction | distinct non-admin members with `notebook_capture_saved` | ≥ 3 |
| 3 | Multiple members returned on a later day | Strongest Stage A signal — they came back because they needed it | distinct non-admin activated members with Notebook activity on ≥2 distinct calendar days | ≥ 3 |
| 4 | Multiple members accumulated research | Notebook must be cumulative, not disposable | distinct non-admin activated members with ≥3 non-deleted notes | ≥ 3 |
| 5 | The thesis-trade link is understood and used by multiple members | Proves the Wave 3 contract is adopted, not unused surface area | distinct non-admin members with ≥1 trade-linked note embed | ≥ 3 |
| 6 | Search is used enough to justify Wave 4 | Wave 4 IS the search wave | total non-admin search events AND distinct searching members | ≥ 5 events AND ≥ 3 members |
| 7 | No trust or data-loss defect observed | Per the plan's Wave 0 exit criteria, independently disqualifying regardless of every other metric | owner/admin judgment — not derivable from telemetry | owner confirms none observed/reported |
| 8 | Qualitative feedback is not fundamentally negative | A statistically-satisfied gate is meaningless if members found it confusing or pointless | owner/admin judgment from direct member outreach | owner confirms feedback collected is not fundamentally negative |

`computedCriteriaMet` in the API response reflects criteria 1–6 only.
**Even when all six pass, this does not by itself authorize Wave 4** — per
checkpoint item 20, the owner makes the final gate decision, giving
evidence for criteria 7–8 explicitly; there is no automatic gate pass.

---

## 5. Full Stage A Validation

The plan's original multi-week repeat-usage study — not shortened by the
Early Signal Gate opening, and continuing on its own timeline even after
Wave 4 work begins. Judged from the `repeatUsage`/`researchAccumulation`
trend over the full validation window, plus direct qualitative member
feedback (§6), not from a single snapshot.

---

## 6. Qualitative feedback

Not derivable from telemetry — collect directly from the validation
cohort: discovery friction, understanding of the thesis/trade link,
workflow-replacement signal (did this replace an existing note-taking
habit), what would make them keep research in UCT rather than elsewhere.
Record summaries here (never verbatim member content) as they come in.

*(No entries yet — instrumentation is newly live.)*

---

## 7. Point-in-time snapshots

Each entry: date, who pulled it, and the report's headline numbers. Full
detail lives in the live endpoint; this is a durable trail so the gate's
history over time is auditable without re-querying production.

### 2026-09-06 — instrumentation deployed, first real query (deploy `a0119804`)

Queried via `GET /api/j2/notebook-validation-report` (PUSH_SECRET bearer)
immediately after the fresh-process uptime reset confirmed rollout.

**Cohort:** 25 total registered users · 17 eligible (non-admin, ≥1
`j2_accounts` row) · 2 broker-synced eligible · 12 recently active (login
within 30d) · **2** in the recommended beachhead (active + J2 + broker-synced).
**Activated (touched Notebook):** 0.

**All Early Signal Gate criteria: FAIL / REQUIRES_OWNER_JUDGMENT** — expected,
this is the first query immediately post-deploy with zero real usage yet.
This snapshot exists to confirm the report itself computes correctly against
real production data (no errors, sane numbers), not to represent any real
usage.

**Important sizing note, confirmed by this query, not assumed:** the
"recommended beachhead" (active + J2 + broker-synced) is only **2 people**
today — too small to ever independently produce `MULTI_USER_MIN=3` evidence
on its own. This is why the gate criteria in §4 are computed against the
broader **eligible** population (17, non-admin `j2_accounts` users), not the
narrow recommended-beachhead number — the beachhead figure is reported for
sizing context only, never as the gating population. If eligible-pool growth
stalls, revisit `MULTI_USER_MIN` with the owner rather than silently
lowering it.

### 2026-09-06 — Bucket A experience-integrity remediation, baseline redefined

Per the authorized "BUCKET A ONLY" UX remediation pass: two P0 defects (the
thesis-trade link silently failing to create from 3 of 5 `AddPositionModal`
entry points; note-load hanging on "Loading…" forever on any fetch failure)
and two P1 defects (raw error-leak surfaces; `LinkedNotesPanel` absent from
the open-position view) were fixed, tested (105 targeted + 1,532
journal-2-0-suite tests, all green), and live-browser-verified end-to-end in
the fail-closed sandbox against the real, unmocked code path — see
`notebook-ux-ui-competitive-ledger.md` for the full certification report.

**Baseline determination (per the authorizing directive's Case A/B logic):**
the most recent recorded snapshot above (2026-09-06, pre-fix) shows
**Activated (touched Notebook): 0** — zero real eligible member activity
occurred before this fix, at any point in the instrumentation's existence.
This is unambiguously **Case A**: no real behavioral evidence exists to
invalidate or exclude, because none was ever collected. Per instruction:

- The pre-fix Day 0 record above is **preserved verbatim** for chronology —
  nothing is deleted or rewritten.
- The **Stage A validation-eligible baseline is redefined as the moment of
  this fix's production deployment** (deploy `d7b53b339`+Bucket-A-merge,
  2026-09-06) — behavioral evidence collected from this point forward is
  what counts toward the Early Signal Gate. Evidence collected before this
  point does not exist (0 activations), so nothing is being excluded that
  would otherwise have counted.
- No reset "more than necessary": the six computable criteria, their
  thresholds, and the cohort definition (§2–§4) are **unchanged** — only the
  START of the clock moves, from "instrumentation went live" to
  "instrumentation went live AND the experience it measures is honest."

---

## 8. Blockers

- The standing pre-launch authenticated-member smoke gate (§1) — an
  accepted evidence gap, not a technical blocker to real usage.
- None else. Notebook is live, reachable, instrumented, and privacy-reviewed.

---

## 9. Gate status

- **Early Signal Gate:** not yet met — see the live endpoint for current
  criterion-by-criterion values. **Validation-eligible baseline: 2026-09-06,
  post-Bucket-A-deploy** (see §7 — Case A, zero pre-fix activity, nothing
  excluded, gate criteria/thresholds unchanged).
- **Full Stage A Validation:** in progress, day 1 of the (redefined) honest
  baseline.
- **Wave 4 authorization:** NOT granted. Per the decision log, begins when
  the Early Signal Gate's six computable criteria pass AND the owner
  confirms criteria 7–8, OR the owner explicitly waives the gate based on
  new judgment.
- **Bucket B UX debt:** deliberately NOT addressed this pass — remains
  backlog per `notebook-ux-ui-competitive-ledger.md`'s remediation package
  (command palette, native-confirm replacement, shared skeleton,
  favorites/recents, zero-result search guidance, capture destination-menu +
  4 uncovered surfaces, in-note keyboard shortcuts, mobile re-verification).
