---
id: PACKET-M
title: A Compass Health admin panel on /admin — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET M — the missing Compass Health connection

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-22
APPROVED AT SHA:  3f28cd944
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-M` appears nowhere in either worktree (checked before writing this
> file).

⛔ **ZERO NEW BACKEND CODE.** Same shape as Packets G–J: the read endpoint already exists,
correct, and admin-gated. This packet's entire MUST-BUILD is one admin panel component, following
this app's own established `/admin` panel idiom exactly.

---

## 1 · The gap, checked directly against source

`GET /api/j2/compass-health` (`api/routers/journal_two.py:215-238`, backed by
`api/services/compass_health.py::compute_health`) already answers "how healthy is the Compass
mentor product" — chat volume, active users, tool-call volume and failure rate, the worst-offending
tools, and today's live model spend + circuit-breaker state (`compass_cost_guard.snapshot()`).
Gated `Depends(require_admin)` — verified directly, admin-only, correctly so (its own docstring
explains this is deliberately NOT anonymous: it exposes business metrics, usage volume, and unit
economics — "a competitor's view of our traction").

**Checked directly: this endpoint has ZERO frontend callers anywhere in `app/src`.** `Admin.jsx`
already has four panels following an identical pattern (`TwitterAccountsPanel`,
`AiSearchInsightsPanel`, `CatalystRulesPanel`, `CommunityReportsPanel`) — grepped for any mention
of "compass" in `Admin.jsx` and found none. The data is not experimental: it is already the sole
input to a real, scheduled, currently-running weekly owner email
(`send_weekly_health_email` / `compass_health_email` job in `main.py`) — the query is trusted in
production today, it simply has no page a human can look at between weekly emails.

**A ready-made template exists in this exact codebase for this exact shape:**
`app/src/components/admin/AiSearchInsightsPanel.jsx` — reuses `Admin.module.css` (no new
stylesheet), a `Stat` card component for headline numbers, and a `BarList` component for a
top-N breakdown (here: `top_failing_tools`). This packet copies that idiom directly rather than
inventing a new one.

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One new admin panel component mounted on `Admin.jsx`, first coverage of the router endpoint | none | **XS** |

### MUST-BUILD, exactly

1. **`tests/test_compass_health_endpoint.py`** (new file): the endpoint's first router-level
   coverage beyond the service-layer tests that already exist (`tests/test_compass_health.py`
   covers `compute_health` directly) — non-admin refusal (403/401), a real admin fetch returning
   the full shape including `cost_today`, and the `days` query param clamping (already implemented
   as `max(1, min(90, int(days)))` — verify it, don't change it unless a real defect is found, in
   which case report it before building further, same discipline as every other packet).
2. **`app/src/components/admin/CompassHealthPanel.jsx`** (new file): modeled directly on
   `AiSearchInsightsPanel.jsx` — `Stat` cards for chat_turns/active_users/tool_calls/
   tool_failure_rate/avg_latency_ms, a `BarList` for `top_failing_tools`, and a small
   `cost_today` summary line (spend + circuit-breaker state). Same error-swallowing fetcher idiom
   (never throws, degrades to empty).
3. **`Admin.jsx`**: mount `<CompassHealthPanel />` alongside the existing four panels, same
   import + render pattern.
4. A rail test confirming the panel renders real data and degrades to an empty/quiet state
   (not a broken render) on a fetch failure.

### Explicitly deferred, NOT authorized by this line

- Any change to `compute_health`, `compass_cost_guard`, or the weekly email job.
- Any change to the endpoint's admin-only gating — it is correctly admin-only per its own
  documented reasoning (business-sensitive metrics), and this packet does not revisit that call.
- Historical/trend charting of Compass health over time (the endpoint takes a `days` window but
  returns one aggregate snapshot, not a time series) — a real possible follow-up, not scoped here.

### Risk

**Very low.** No backend change (beyond adding tests), one small admin-only panel reusing an
already-shipped component idiom verbatim. Only admins see it; no member-facing surface changes at
all.
