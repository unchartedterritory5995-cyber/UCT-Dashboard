# SC-1 — Agent scan contract (v1.0)

- **Owner:** agent-sc.
- **Consumers:** agent-rs, agent-qa, and later the G workstream.
- **Depends on:** MD-1 (envelope, gateway and budgets).
- **Status:** v1.0, accepted for Sprint 1.

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
