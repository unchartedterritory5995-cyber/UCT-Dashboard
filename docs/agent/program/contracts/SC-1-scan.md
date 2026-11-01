# SC-1 — Agent scan contract (v1.1)

- **Owner:** agent-sc.
- **Consumers:** agent-rs, agent-qa, and later the G workstream.
- **Depends on:** MD-1 (envelope, gateway and budgets).
- **Status:** v1.0 accepted for Sprint 1; v1.1 (additive, 2026-11-01) pins the `as_of`/`stale` mapping in §2a.

## 1. Purpose

Opportunity discovery runs on **UCT's canonical screener service**: `api/services/screener/query.py`, which turns a JSON filter spec into SQL over `screener_rows`, plus `coverage_receipt.py`. **No new scan engine.** The Agent never uses the legacy `/api/screener` or `/api/candidates` (`engine.get_screener` / `get_candidates`); see ADR-002.

## 2. Kinds

These are MD-1 gateway kinds with category `scan`. They need both `UCT_AGENT_DATA=1` and `UCT_AGENT_SCAN=1`.

| Kind | Wraps | Declared freshness | `data` |
|---|---|---|---|
| `screen.run` | `screener/query` scan | periodic | `{spec, rows: [≤50 rows: symbol + requested fields], total_matches}` |
| `screen.count` | `screener/query` count | periodic | `{spec, count}` |
| `screen.saved` | saved screens (the member's own, read-only) | periodic | `{screens: [{id, name, spec}]}` |

**Each scan kind's envelope**
- `coverage` is always set, from `coverage_receipt`: `{evaluated, answered, dropped, not_computable}`.
- `as_of` comes from `screener_rows` (`as_of`).
- `stale` is set from the service's own `stale` flag.
- Live-tier overlay fields are labelled in `notes` when they're used.

## 2a. How the envelope fields are derived (v1.1, additive)

The screener has no single `as_of` or `stale` field, so v1.1 pins the mapping:

- **`as_of`** is the close (16:00 ET, as UTC) of the median `bars_asof` session of the **matched rows**. It is computed by the service's own `snapshot_db.describe_rows` over the scan's own plan. `snapshot_date` is when a row was *built*, not the data's time, so it is never `as_of`.
- **`stale`** is true when that session is more than one NYSE session behind the last closed session, or when the matched rows run through more than one session (the service's `mixed` signal).
- **Stopped-bar exclusions** (the service's stale gate) are counted in `coverage.dropped` and named in a note.
- **`status`** is `partial` when `coverage.dropped` or `coverage.not_computable` is non-zero.
- **`provider_calls`** is 0: the screener reads its own local snapshot.
- **Extra `data` fields** (additive): `screen.run` adds `fields` (the columns returned), `excluded` (at most 10 dropped or not-computable names with a reason) and `rank` (the service's rank receipt, for a ranked spec). `screen.count` adds `excluded` and `top_n`.
- **Row limit:** `params.limit` (or `spec.limit` / `spec.page_size`) is clamped to 1–50. Paging is never passed through.

## 3. Specs

- **The spec is the screener's own JSON spec,** validated against its field catalog (`/api/screener/fields`). There's no Agent filter language.
- **Natural language** goes through the existing `/grammar/parse` and `/compile` entry points (`screener_nl.py`).
- **The result** is a spec the member can see. Run and save it in the Screener unchanged.

## 4. Budgets

MD-1 §5 applies:
- 1 scan read per turn, at most 50 rows returned;
- the scan's provider requests count toward the turn's 20;
- enriching scan rows with quotes uses `quotes` reads, which count as logical reads.

## 5. Changes

These follow MD-1 §8.
