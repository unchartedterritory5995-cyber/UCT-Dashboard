---
id: ADR-0025
title: The ten realtime positions (C7-01's D1–D10): keep the pooled client, add no broker, build no board-level aggregation yet
status: accepted
date: 2026-09-26
decided_by: the programme (gate item 24 / ARCH-07)
gate_item: 24
promotion: ⚠️ ON THE BOUNDARY, and said rather than forced. Six of the ten are *"keep doing what we already do"* — locked only in the sense that a change now needs new evidence. Two moved on measurement (D9, D10), one is SETTLED (D6, see ADR-0026/0027), and one is explicitly OPEN (D4). The record exists to stop the six being re-litigated without evidence.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0025 — The ten realtime positions (C7-01's D1–D10): keep the pooled client, add no broker, build no board-level aggregation yet

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate item 24 / ARCH-07) · gate item 24

**Why it is an ADR and not a tracker row:** ⚠️ ON THE BOUNDARY, and said rather than forced. Six of the ten are *"keep doing what we already do"* — locked only in the sense that a change now needs new evidence. Two moved on measurement (D9, D10), one is SETTLED (D6, see ADR-0026/0027), and one is explicitly OPEN (D4). The record exists to stop the six being re-litigated without evidence.

## Context

C7-01 closed with ten questions and a D1–D10 matrix, deferring every choice to ARCH-07. The
§8 baseline was executed once, and item 24 rules on all ten
(`07-technical-architecture/realtime-performance-architecture.md:542-567`).

## Decision

**Do not restate the table — it lives at
`07-technical-architecture/realtime-performance-architecture.md:542-567`.** What this ADR records
is which rows are decided and on what basis:

| row | position | basis |
|---|---|---|
| D1 transport | **Keep pooled SSE** — not a real decision until a panel needs high-rate client→server messaging, and none proposed does | C7-01's analysis; nothing measured contradicts it |
| D2 multiplexing | **Keep the client pool** — optimisation, not architecture. 16 cells → one SSE, measured. Server-side multiplex would be a new protocol on the process that cannot be multi-workered | measured |
| D3 fan-out | **Add no broker** — in-process hubs plus the durable log for the tape; the cross-process condition does not hold today | Q8 |
| D4 conflation | ⛔ **OPEN. The shipped 10 Hz constant has never been measured** | §2.3 shows loop headroom, which argues it is not urgent, not that it is right |
| D5 panel data access | **Keep per-panel access; build NO board-level aggregation endpoint yet** | `/api/flow/aggregate` serialises its client-side transform verbatim at **23.83 MB**; one ticker's flow dump measured 3,651 KB gzipped / 20,252 KB decoded / 4,232 ms. *"An aggregation endpoint inherits the slowest panel"* |
| D6 edge caching | ✅ **SETTLED and the row is moot as written** | ADR-0026 / ADR-0027 |
| D7 tier | **Tier belongs in the handshake, not per-panel** | deferred to gate item 23 (ADR-0022) |
| D8 degradation UI | **One shell-level freshness authority** — per-chart hysteresis is right for one chart and wrong for twelve | Q3 |
| D9 deploy resilience | ⭐ **Re-scored** — see ADR-0029 | §2.2 + §2.4 |
| D10 per-user live budget | ⭐ **Re-scored: the unit is BYTES AND SERVER TIME, not connections.** One cold member page pulls **31.1 MB** and its first two shard requests cost **8.6–10.9 s of SERVER time each**, during which ten unrelated 0–1 KB API calls all wait and land together at ~10.5 s. *"A budget expressed in concurrent streams would not have caught this"* | §2.6 |

**And one interface decision that follows from all of them:** ⭐ **a panel declares a need; it
never owns a transport, a budget, or a freshness opinion.** All three are per-process, shared, and
invisible to the panel author. *"This is one interface decision that forecloses three whole classes
of failure, and it is cheap only before N panels exist."* (`:568-588`)

## Alternatives actually considered

Each row's rejected option is in the source table. The two worth carrying: a **message broker**
(rejected — the cross-process condition does not hold), and a **board-level aggregation
endpoint** (rejected on two measured payload sizes, not on taste).

## Consequences

* ⛔ **Not decided:** the target panel count (Q1, a product decision that blocks D4 and D10);
  whether Terminal-Next runs in its own process (Q7, blocked on Q1 and on the leak); the
  conflation rate (`:589-604`).
* ⭐ The D1–D10 table is a **tracker-shaped artifact inside an accepted document**. This
  ADR deliberately does not copy its cells, to avoid a second authority over ten values.

## Sources

- `07-technical-architecture/realtime-performance-architecture.md:51-76,280-419,542-604`
