# P5 Data-Sharing Decision — Reverse-Proxy (C) vs Shared Postgres (E)

*The direction analysis (2026-07-07, all four lenses `course_correct`) flagged the
data-sharing HALF of P5 as the weak part. The dedicated flow-worker (isolating
the consumer) is unambiguously right and kept. This doc prices how WEB reads flow
data once flow.db moves to that worker, so the choice is deliberate.*

## The prior question (don't skip it)
The analysis's decisive finding: **batching deploys to ≥4:20 PM ET already banks
~100% of the observed value for $0**, and **P5 would have prevented 0 of today's 6
feed gaps** (all were consumer-code edits, which restart the flow worker too).
P5's *unique* win is "a non-flow emergency web deploy that can't wait to 4:20" —
and there's no evidence yet that this recurs. So the **cutover** is gated on:
(a) instrumented evidence that such deploys actually happen, and (b) Massive's
2nd-connection reply (which may collapse most of the build). This C-vs-E choice
only matters *if/when we proceed* — but deciding it now keeps the branch honest.

## The decision
Once the consumer + flow.db live on the flow worker, how does web serve the flow
UI (which reads flow data)?

## Option C — WEB reverse-proxies to the flow worker  *(what's built)*
Web forwards the flow read/auth paths to the worker over Railway private net.

| | |
|---|---|
| **Keeps** | SQLite `flow.db`; **Ravi's `FlowDB.insert_csv` write path byte-for-byte unchanged** |
| **Built?** | ✅ Yes (this branch) — proxy, auth-at-proxy, migration, worker mount |
| **Permanent cost** | web buffers the 50–70 MB `/api/flow/data` on its shared loop per CF cache-miss (the 524 class, pointed back at web); worker-down ⇒ flow UI 502 for all users (a failure mode that doesn't exist today); a permanent proxy + auth-injection + co-tenant-jobs-on-worker regime |
| **Mitigations needed** | measure the real CF hit-rate on `/api/flow/data`; stale-serve + banner instead of hard-502; (both are extra work on top of what's built) |

## Option E — shared managed Postgres  *(not built)*
The consumer writes flow data to a managed Postgres; **web reads it directly** —
no hop.

| | |
|---|---|
| **Deletes** | the proxy, the 60 MB buffer, the 524 risk, the 792 MB file migration, the co-tenant relocation, the auth-injection, the flow-explain partition problem, and the "worker-down = flow-UI-down" dependency |
| **Built?** | ❌ No |
| **One-time cost** | a SQLite→Postgres port that **touches Ravi's write path** (`FlowDB.insert_csv` + ~8 co-tenant readers) — the exact code we've deliberately avoided; a new managed DB (\$ + ops); the write path must be re-validated |
| **End-state** | permanently simpler — the whole class of problems C works around just disappears |

## Honest recommendation
- **If we're not cutting over soon** (the likely case per the analysis): invest in
  **neither** further until the need is proven. Keep the after-close discipline.
  The two blockers are now closed, so the **C branch is correct if we ever proceed**
  — it's a safe, complete fallback sitting dark.
- **If/when the evidence + Massive's 2nd connection justify cutover:** **E (Postgres)
  is the better end-state** — it doesn't carry permanent complexity or reintroduce
  the 524 surface. It costs a one-time, Ravi-involved write-path port. **C is the
  "don't touch Ravi's code" fallback**, acceptable only with the buffer + stale-serve
  mitigations measured and in place.

**Lean:** proceed to cutover only when justified; when justified, prefer **E with
Ravi** for the clean permanent architecture, with **C as the fallback** if his
write path genuinely can't move. Both share the same dedicated flow-worker (already
built) — E just swaps the *data-sharing* half from "proxy a SQLite file" to "read a
shared DB."

## What changes on the branch by choice
- **C:** already built; add the buffer/stale-serve mitigations before cutover.
- **E:** keep `flow_worker_main.py` + the consumer move; **drop** `flow_proxy.py`,
  `flow_db_migrate.py`, and the auth-at-proxy; port `flow_db.py` + co-tenant modules
  to Postgres (Ravi). Net: less permanent code, more one-time porting.
