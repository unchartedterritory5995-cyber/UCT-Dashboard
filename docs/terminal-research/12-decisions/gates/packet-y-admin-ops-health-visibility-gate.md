---
id: PACKET-Y
title: Admin/ops health-monitor endpoints with zero frontend surface — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET Y — give the owner eyes on health monitors that already work

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-23
APPROVED AT SHA:  4007862bd
SCOPE APPROVED:   CP1, CP2, CP3 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs any of the fourteen
> routes named below. **Non-collision:** grepped `PACKET-Y` and `packet-y-` across both
> worktrees (`s7-price-level`, `terminal-research`) — zero matches. Every other letter
> A–W plus Z is already taken (`docs/terminal-research/12-decisions/gates/packet-*.md`);
> Y is the next free letter and is claimed here.

⛔ **THREE INDEPENDENT CHECKPOINTS, cheapest and lowest-risk first.** CP1 touches one
already-mounted admin page and adds zero new files. CP2 and CP3 each add exactly one new
file (a panel) plus one mount line — no new backend route, no new database, no new auth
surface. None of the three changes what any of the fourteen endpoints returns or who may
call it.

---

## 1 · The finding, re-verified fresh against CURRENT source, 2026-09-22

A cluster of backend admin/ops health-monitor endpoints in `s7-price-level` are fully
built, correct, and either deliberately public read-only or already `require_admin`-gated
— and have **zero frontend callers anywhere in `app/src`** (`grep -rn "<route>" app/src`
for every route below returns nothing). The owner's only way to see any of them today is
curl or `railway ssh`. Filed to `RESEARCH_GAPS.md` as **RG-36** in the same commit as this
packet.

### 1a · SHAPE A — twelve no-auth, read-only, self-documented monitors

Each has no `Depends(...)` on its handler (read directly off the function signature, not
inferred), and its own router-file docstring or handler docstring says so — eight of the
twelve use the literal phrase `"(no auth — read-only)"`; the other four (the
`calendar-*` group) say "read-only" or "(read-only, mirrors …)" without repeating the
word "auth", but carry the identical absence of a `Depends` parameter, confirmed at the
same reads below. All twelve are also named, directly or by family, in
`api/middleware/admin_guard.py`'s own module docstring (`:9-13`, "the read-only status
dashboards (`reconciliation-status`, `fundamentals-health`, `twitter-stats`,
`catalyst-stats`) are intentionally anonymous") or a sibling router's docstring citing
that same convention.

| # | Route | File:line | Auth | Frontend callers |
|---|---|---|---|---|
| 1 | `GET /api/admin/fundamentals-health` | `api/routers/fundamentals.py:224-233` | none — `"(no auth — read-only)"` at `:226` | **0** |
| 2 | `GET /api/admin/reconciliation-status` | `api/routers/bars.py:1056-1066` | none — `"(no auth — read-only)"` at `:1058` | **0** |
| 3 | `GET /api/admin/bars-stream-status` | `api/routers/bars.py:1105-1126` | none — `"(no auth — read-only)"` at `:1107` | **0** |
| 4 | `GET /api/admin/provider-coverage` | `api/routers/provider_coverage.py:17-29` | none — `"(no auth — read-only)"` at `:19` | **0** |
| 5 | `GET /api/admin/warm-universe-status` | `api/routers/bars.py:1129-1141` | none — `"(no auth — read-only)"` at `:1131` | **0** |
| 6 | `GET /api/admin/calendar-date-integrity` | `api/routers/calendar.py:3093-3101` | none — no `Depends`; docstring "Read-only date-drift telemetry…" | **0** |
| 7 | `GET /api/admin/calendar-coverage-status` | `api/routers/calendar.py:3468-3487` | none — no `Depends`; docstring "(read-only, mirrors calendar-enrichment-status)" | **0** |
| 8 | `GET /api/admin/calendar-enrichment-status` | `api/routers/calendar.py:3490-3499` | none — no `Depends`; docstring "Read-only enrichment coverage telemetry…" | **0** |
| 9 | `GET /api/admin/implied-sweep-status` | `api/routers/calendar.py:3502-3528` | none — no `Depends`; docstring "(read-only)" | **0** |
| 10 | `GET /api/admin/call-recap-status` | `api/routers/earnings_intel.py:287-300` | none — the router's own file docstring (`:28-31`) states explicitly *"both are anonymous (no session dependency at all)"* | **0** |
| 11 | `GET /api/admin/transcript-index-status` | `api/routers/earnings_intel.py:479-490` | none — no `Depends` | **0** |
| 12 | `GET /api/admin/yfinance-guard` | `api/routers/yf_guard.py:30-45` | none — `"(no auth — read-only)"` at `:32`; file docstring `:17-21` names it a sibling of `reconciliation-status`/`fundamentals-health`/`provider-coverage` | **0** |

Zero callers confirmed by grepping each route string against `app/src` in the
`s7-price-level` worktree (all twelve return no matches). Every route the task named
still exists, still lacks a `Depends`, and still has no caller — nothing was dropped from
the original list.

### 1b · SHAPE B — `require_admin`-gated, zero frontend callers

**`GET /api/admin/patterns/health`** — `api/routers/admin_patterns.py:34-39`:

```python
router = APIRouter(prefix="/api/admin/patterns", tags=["admin-patterns"])

@router.get("/health")
def health(_admin: dict = Depends(require_admin)):
    return collect_health()
```

`collect_health()` (`api/services/pattern_engine/diagnostics.py:12-61`) returns
`{generated_at, detector_count, registered_detectors, stored_detections_total,
stored_by_pattern, stored_by_status, recent_24h_count, last_detected_at,
schema_version}`. `grep -rn "admin/patterns/health" app/src` → **0 matches**.

`app/src/pages/admin/PatternAdmin.jsx` (mounted at `/admin/patterns` —
`app/src/App.jsx:183,656`, lazy-loaded) already calls the two SIBLING routes on the SAME
router — `/api/admin/patterns/recent?hours=${hours}` (`PatternAdmin.jsx:29`) and
`/api/admin/patterns/${detectionId}/review` (`:44`) — via `useSWR` and a plain `fetch`,
but never `/health`. Read the file in full (163 lines): it already fetches, filters, and
renders data from this exact router, with an existing header stat strip
(`styles.stats`/`styles.stat`, `:80-99`) showing Detections / Reviewed / Accept Rate /
Target. This is the narrowest, safest, cheapest checkpoint in the packet — one more
`useSWR` call plus a few more `styles.stat` cards on a page that already exists, already
polls every 60s, and is already reachable only as an authenticated admin route.

**`GET /api/theme-engine/status`** — `api/routers/theme_engine.py:43-56`:

```python
router = APIRouter(prefix="/api/theme-engine", tags=["theme-engine"])

@router.get("/status")
def engine_status(user: dict = Depends(require_admin)):
    ...
    return {"runs": [...], "day_cost_usd": store.day_cost_usd(),
            "pending_suppressions": len(store.pending_suppressions()),
            "overlay_adds": len(store.engine_rows())}
```

Each `runs[]` row is one `engine_runs` table row
(`api/services/theme_engine/store.py:67-72`): `run_id, kind, started_at, finished_at,
examined, added, retiered, dropped, skipped, cost_usd, error`. `grep -rn
"theme-engine/status" app/src` → **0 matches**. This is a whole autonomous nightly-LLM
subsystem — Loop 1 orphan-absorption Mon–Fri 23:00 ET, Loop 2 self-improve + co-movement
audit Sat 10:00 ET, `THEME_ENGINE_DAILY_COST_CAP` (default `5.0` USD/day,
`api/services/theme_engine/orphans.py:177,295`), and a documented rollback-by-run-id —
with no visible run ledger or day-cost anywhere in the UI. Today the owner learns what it
did only from the Discord digest it posts itself.

### 1c · Non-collision with Packet M — CONFIRMED scope-wise, and a correction on its status

`docs/terminal-research/12-decisions/gates/packet-m-compass-health-admin-panel-gate.md`
exists, scopes ONLY `GET /api/j2/compass-health` (a different router, `journal_two.py`,
different data — chat volume/tool-failure-rate/Compass spend), and correctly has no
overlap with any of the fourteen routes in this packet.

**But it is not "proposed, unsigned," and this packet corrects that assumption before
excluding it, per the task's explicit instruction.** Packet M's own YAML frontmatter and
opening prose still read `status: PROPOSED, unsigned` / `⛔⛔ NOT AUTHORIZED. PROPOSED`,
and that text is STALE. `git log` on that file in `terminal-research` shows a second
commit, `fa9d509ed "Packets L, M, N, O, P, Q SIGNED by the owner 2026-09-22"`, whose diff
fills the APPROVAL block's previously-blank fields (`APPROVED BY: Patrick (owner)`,
`APPROVED AT SHA: 3f28cd944`, `SCOPE APPROVED: CP1 ONLY`) without touching the prose
above it — a documentation-drift defect in that packet's own file, not this one's to fix.
Confirmed BUILT, not merely signed: `s7-price-level` commit `e8bd7f161 "Packet M CP1:
Compass Health admin panel on /admin"` adds `app/src/components/admin/CompassHealthPanel.jsx`
+ its test, and `app/src/pages/Admin.jsx:9,2035` imports and mounts it (`{/* ── Section
6f: Compass Health (Packet M, signed 2026-09-22) ── */}`). **Packet M is CLOSED, not
pending.** This does not change this packet's scope — none of Packet M's checkpoint
touches any of the fourteen routes covered here — but the assumption in the task
description was wrong and is recorded as such rather than silently accepted.

---

## 2 · Proposed checkpoints

| CP | scope | new files | new backend routes | risk |
|---|---|---|---|---|
| **CP1** | `/health` stat strip added to the ALREADY-MOUNTED `PatternAdmin.jsx` | 0 | 0 | **XS** |
| **CP2** | new "Data Pipeline Health" admin panel — the 12 shape-A monitors | 1 (+ mount line) | 0 | **S** |
| **CP3** | new "Theme Engine" admin panel — run ledger + day-cost | 1 (+ mount line) | 0 | **S** |

Each CP is independently approvable — `SCOPE APPROVED:` may name any subset (e.g. *"CP1
ONLY"* or *"CP1, CP2 ONLY"*), per this repo's multi-checkpoint convention (`PACKET-K`,
`PACKET-S`: one `⛔ APPROVAL` block, a `SCOPE APPROVED:` line naming whichever
checkpoint(s) are cleared).

### CP1 — `/health` on the already-mounted `PatternAdmin.jsx`

**MUST-BUILD, exactly:**
1. `app/src/pages/admin/PatternAdmin.jsx`: add one more
   `useSWR('/api/admin/patterns/health', fetcher, { refreshInterval: 60_000 })` call,
   reusing the `fetcher` already defined at `:6` and the same 60s cadence the existing
   `/recent` call already uses (`:31`).
2. Render its result as 3–4 more `styles.stat` cards (the exact idiom already at
   `:80-99`) inside the existing `styles.stats` row, or a second small row directly
   beneath it: **Detectors** (`detector_count`), **Stored detections**
   (`stored_detections_total`), **Last 24h** (`recent_24h_count`), **Last detected**
   (`last_detected_at`, printed as-is or via whatever date helper the file already
   imports — it currently imports none, so a plain ISO/epoch print is acceptable).
3. Nothing else on the page changes — the existing `/recent` feed, filters, and review
   flow are untouched.

**Explicitly deferred:** a breakdown of `stored_by_pattern` / `stored_by_status` (both
already in the payload) — a real follow-up chart, not required to close the
"the owner cannot see this at all" gap this checkpoint targets.

### CP2 — "Data Pipeline Health" admin panel (12 shape-A monitors)

**MUST-BUILD, exactly:**
1. **`app/src/components/admin/DataPipelineHealthPanel.jsx`** (new file), modeled
   directly on `AiSearchInsightsPanel.jsx`'s idiom **verbatim**: an error-swallowing
   fetcher (`fetch(url, {credentials:'include'}).then(r => r.ok ? r.json() : null).catch(() => null)`),
   one `useSWR` per monitor (12 total; `refreshInterval: 60000`, matching
   `AiSearchInsightsPanel`'s live-lane cadence), `Admin.module.css` classes only
   (`styles.healthSection`, `styles.sectionTitle`, `styles.statCard`/`statNumber`/
   `statLabel` for a reused `Stat` component, `styles.analyticsBarLabel` for row
   labels) — **no new stylesheet**. `credentials:'include'` costs nothing on these
   no-auth routes and keeps the fetcher identical across every admin panel in the file.
2. One compact row per monitor — name / a "last run" value / one headline number / a
   flagged-or-clean badge. Per-monitor field mapping, read from each route's actual
   response shape (verified in §1a, not guessed):

   | Monitor | Route | Last run | Headline | Flagged when |
   |---|---|---|---|---|
   | Fundamentals Accuracy | `fundamentals-health` | `last_cycle_at` | `checked_total` checked / `healed_total` healed | `flagged_current` non-empty |
   | Bars Reconciliation | `reconciliation-status` | `last_cycle_at` | `audits_run` audits / `rows_healed_total` healed | `last_detect_drift` non-empty (unhealed drift still standing — the route's own distinction between healed and detect-only drift) |
   | Bars Push Feed | `bars-stream-status` | `broadcaster.last_emit_age_s` | `broadcaster.bars_emitted_total` emitted | `enabled` true AND (`websocket.connected` false OR `broadcaster.bars_dropped_total` > 0) |
   | Warm Universe | `warm-universe-status` | `completed_iso` (or `started_iso` while `running`) | `done`/`total` | `errors` > 0 |
   | Provider Coverage | `provider-coverage` | `last_cycle_at` | count of `fields` tracked | `defects_current` non-empty |
   | Calendar Date Integrity | `calendar-date-integrity` | *(no timestamp published — say so, don't invent one)* | `tracked` tracked / `with_moves` moved | *(no defect signal in this payload — badge is always "info", never flags)* |
   | Calendar Coverage | `calendar-coverage-status` | `as_of` | `supplemented` | `error` key present, OR `supplemented === 0` AND every `days[*]` has `served === schedule_only` (the exact defect shape the route's own docstring names — "supplemented pinned at 0 … is the 2026-08-16 shape") |
   | Calendar Enrichment | `calendar-enrichment-status` | newest `dates[*].computed_at` | that date's `with_em`/`total` | any `dates[*].em_collapsed === true` (a field the endpoint already computes for exactly this purpose) |
   | Implied Sweep | `implied-sweep-status` | `runs[0].started_at` | `runs[0].symbols_done`/`symbols_total` | `unfinished` array non-empty (the endpoint already computes this — `[r["run_id"] for r in runs if not r.get("finished_at")]`, `calendar.py:3525`) |
   | Call Recap | `call-recap-status` | *(no timestamp published)* | `generated_today` generated / `$spend_today_usd` spend | `spend_today_usd >= daily_cap_usd` |
   | Transcript Index | `transcript-index-status` | `newest` (newest transcript's `call_date`) | `transcripts` transcripts / `symbols` symbols | *(no defect signal — badge is always "info")* |
   | yfinance Guard | `yfinance-guard` | `last_trip_epoch` | `calls_total` calls / `suppressed_total` suppressed | `breaker_open === true` |

3. **`app/src/pages/Admin.jsx`**: import + mount `<DataPipelineHealthPanel />` as one
   more section, same pattern as the existing panels at `:2019-2035` (e.g. directly
   after `<CompassHealthPanel />`, before `{/* ── Section 7: System Health ── */}`).
4. Nothing else changes. No new backend route, no new database, no change to any of
   the 12 monitors' own logic, cadence, or cost caps.

**Explicitly deferred:** wiring the 12 `useSWR` calls through a single batched endpoint
— today's twelve small, cheap, no-auth GETs are the cost this checkpoint accepts rather
than designing a new aggregate route; a batching follow-up is real but not required to
close the visibility gap.

### CP3 — "Theme Engine" admin panel (run ledger + day-cost)

**MUST-BUILD, exactly:**
1. **`app/src/components/admin/ThemeEngineHealthPanel.jsx`** (new file), same
   `AiSearchInsightsPanel.jsx` idiom: one
   `useSWR('/api/theme-engine/status', fetcher, {refreshInterval: 60000})` — this route
   IS `require_admin`-gated, so the fetcher's existing `credentials:'include'` is
   load-bearing here (unlike CP2's anonymous routes, where it merely costs nothing).
2. Three `Stat` cards up top: **Day spend** (`day_cost_usd`, displayed as `$X.XX /
   $5.00 cap` — the endpoint does not publish the cap itself, so display `$5.00` as a
   documented literal matching `THEME_ENGINE_DAILY_COST_CAP`'s current default at
   `orphans.py:177`, with a code comment flagging that the two must be kept in sync if
   that default ever changes), **Pending suppressions** (`pending_suppressions`),
   **Overlay adds** (`overlay_adds`).
3. Below that, a compact run ledger: the `runs[]` rows the endpoint returns (up to 20,
   per its own `LIMIT 20` query), each row showing `kind`, `started_at`, `finished_at`
   (or an explicit "running" label when null and `started_at` is recent, vs. an
   "unfinished — check logs" flagged badge when null and older than a stated threshold,
   e.g. 2 hours — pick one bound and state it in a code comment), `examined`/`added`/
   `retiered`/`dropped`/`skipped`, `cost_usd`, and `error` (rendered as a flagged badge
   when non-null/non-empty).
4. **`app/src/pages/Admin.jsx`**: mount `<ThemeEngineHealthPanel />` alongside CP2's
   panel, same import + render pattern.
5. Nothing else changes — no change to `theme_engine`'s crons, cost cap, rollback
   endpoint, or dry-run/clear-decisions flow; this checkpoint is read-only surfacing of
   data the router already computes on every request.

**Explicitly deferred:** wiring the existing `POST /rollback/{run_id}`, `/dry-run`,
`/suppress/{theme_id}/{sym}/dismiss`, or `/clear-decisions` **write** endpoints into this
panel — this checkpoint is read-only visibility, and any button that fires a mutating
theme-engine endpoint is a materially bigger, riskier change deserving its own gate.

### Explicitly deferred, NOT authorized by this packet (all checkpoints)

- Any change to what any of the fourteen endpoints returns, computes, or costs.
- Any change to any endpoint's auth (leave the twelve shape-A routes exactly as
  anonymous as they are today; leave both shape-B routes `require_admin`-gated).
- A batched/aggregate backend endpoint for CP2's twelve reads (see CP2's own deferred
  note).
- Any write/mutating action surfaced from CP3's panel (see CP3's own deferred note).
- Historical/trend charting for any of the three panels — every payload here is a
  present-moment snapshot; a time series is a real follow-up, not this packet.
- Anything in `journal_two.py` / `/api/j2/compass-health` — that is Packet M's territory
  (see §1c), CLOSED and built, not reopened here.

### Risk

**Low, per checkpoint, independently.** CP1 adds one `useSWR` call and a few `Stat`
cards to a page that already fetches from the same router and is already reachable only
as an authenticated admin route in the SPA. CP2 and CP3 each add exactly one new
frontend file plus one mount line, reusing an established, already-shipped panel idiom
(`AiSearchInsightsPanel.jsx`) and an existing stylesheet (`Admin.module.css`) — no new
backend route, no new database table, no change to any of the fourteen endpoints'
behavior, cost, or gating. The worst case for any of the three is a broken or empty
admin-only panel; none of the three touches a member-facing route, a scheduler, or a
write path.
