---
id: ADR-0031
title: The bars serving gate is ≥ 99 % `mem`/`sqlite` warm ratio
status: superseded
date: in force until 2026-09-26
decided_by: the programme (§8 of the perf baseline)
gate_item: 24, 25
promotion: Promoted as a SUPERSEDED record because the reason it failed is a reusable defect class, and because the instrument that implements it is STILL on the old definition — so the superseded gate is what a reader measuring today actually gets.
supersedes: none
superseded_by: ADR-0032
register_row: none
---

# ADR-0031 — The bars serving gate is ≥ 99 % `mem`/`sqlite` warm ratio

**STATUS: SUPERSEDED** · in force until 2026-09-26 · decided by the programme (§8 of the perf baseline) · gate item 24, 25

**Why it is an ADR and not a tracker row:** Promoted as a SUPERSEDED record because the reason it failed is a reusable defect class, and because the instrument that implements it is STILL on the old definition — so the superseded gate is what a reader measuring today actually gets.

⛔⛔ **SUPERSEDED BY ADR-0032 — DO NOT ACT ON THIS RECORD.** It is kept, with its reasoning intact, because deleting it is how the next engineer re-proposes it.

## Context

§8 of the bars baseline bucketed `stale-swr` with `fetch` and `miss` under *"the user
waited"*, and gated serving on ≥ 99 % of samples coming from `mem` or `sqlite`.

## Decision as taken

A timeframe passes when ≥ 99 % of its samples are `mem`/`sqlite`.

## Why it was retired

On a valid 942 s pod, **daily is 0 % warm and p50 104 ms at the same time**; intraday is 98 %
`sqlite` at p50 65 ms (`12-decisions/DECISION_CARDS_2026-09-26.md:203-208`).

⛔ **A member served from cache in 104 ms did not wait, and a metric that calls that a total
failure will be ignored within a week — which is worse than having no metric** (`:210-212`).

## Consequences

* Superseded by ADR-0032.
* ⛔⛔ **The instrument was never changed with the definition, so this superseded gate is
  what an engineer measuring today still gets.** `tools/bars_warmth_audit.py` keeps
  `WARM = {"mem","sqlite","yf-only"}` and `COLD = {"fetch","stale-swr","inflight-wait","disk",
  "miss","unknown"}` (`:27-28`); samples bucket on that constant (`:99-103`) and the p95 line is
  computed over `warm_ms` **only**, inside `if warm_ms:` (`:109-112`). Daily has been 100 %
  `stale-swr` since 2026-08-19, so on daily `warm_ms` is **empty and no p95 prints at all**
  (`10-roadmap/observability-plan.md:50-115`, finding 3).
* ⭐ That is the programme's kind-3a instrument failure: **the ruling changed the definition
  and the instrument did not** (`observability-plan.md:50-115`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:203-224`
- `10-roadmap/observability-plan.md:50-115,351-395`
- `07-technical-architecture/realtime-performance-architecture.md:286-306`
