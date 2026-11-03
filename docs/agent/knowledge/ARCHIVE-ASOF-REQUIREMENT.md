# Requirement: a computation date on the team archive's setup record

Status: REQUESTED (owner decision 2026-11-03, via AUDIT). Additive metadata only. Nothing in the archive pipeline changes without its owner's approval.

## Why
`setup.record` serves the team archive's measured record only when its figures carry a trustworthy date. Today `wisdom/archive/team_record.setup_record()` returns no date at all. The KN-1 rule "undated = stale" therefore withholds every archive figure **and** its verdict; only `n` and the reason are served. The owner decided to keep that fail-safe until a real date exists.

The only date the archive stores today is `imported_at` (`wisdom/archive/schema.py`: every archive table). It is the time the export was loaded into `wisdom.db`, **not** the freshness of the calculation. The owner ruled that an export or import timestamp must not be used.

## The field
| Field | Type | Meaning | Required |
|---|---|---|---|
| `through` | ISO date `YYYY-MM-DD` | The last trading session whose price bars were included in the scoring run that produced this setup's statistics (the newest bar date the scorer read for these calls) | yes |
| `as_of` | ISO-8601 UTC timestamp | When that scoring run finished | optional |

Semantics: `through` comes **from the computation itself**: the ledger's scoring run (`tools/score.py` → `scored/calls.jsonl` → `tools/build_setup_library.py` → `structured/setup_library/<setup>.json`) knows the newest bar date it used (its bars fingerprint). It must not be filled from the export time, the import time, a file mtime or the request time. If one setup's statistics mix runs, `through` is the OLDEST run's date.

## Where it appears (additive)
1. **Ledger (partner):** `structured/setup_library/<setup>.json` gains `"through": "<date>"` (and optionally `"as_of"`) at top level. Partner-owned; requires the partner's approval.
2. **Archive import (dashboard, Wisdom):** the playbook import that writes `wisdom_archive_playbooks` stores it in a new nullable column `computed_through TEXT` (one additive migration in `wisdom/archive/schema.py`; existing rows stay NULL). `service._setup_dict` returns it.
3. **`wisdom/archive/team_record._setup_payload`:** adds one top-level key beside `"all_calls"`:
   ```
   "through": pb.get("computed_through"),      # None until the ledger exports it
   ```
   No other key changes; every existing consumer (Compass beside-source, Terminal CHK, Ask AI) is unaffected because the key is new.

## How KN-1 consumes it (already implemented, `api/services/uct_agent/knowledge/kinds.py::record`)
- Reads `through`, then `as_of`, from the archive record. It deliberately does NOT read `imported_at` or `updated_at`.
- No date → `team_archive = {label: "undated_record", n, method}`: no figures, no verdict (current behaviour).
- Date older than `policy.pack.stats_stale_days` (14 days) → `stale_record`: figures and verdict withheld.
- Otherwise → the signed, floored verdict block (`measured_edge_controlled` / `measured_underperformance_controlled` / `not_proven` / `insufficient_sample`), with `as_of` set to that date and served with its source and licence.

## Test plan
- **Archive side (Wisdom owner):** migration test (column added, existing rows NULL); import test (a setup-library JSON with `through` stores it; without it stores NULL); `_setup_payload` test (`through` present and equal to the stored value; absent → `None`); a rail that `through` is never derived from `imported_at` (AST or grep on the import path).
- **KN-1 side (already in `tests/test_uct_agent_knowledge.py`):** undated → `undated_record` with no figures or verdict; dated within 14 days → signed verdict and figures; dated older → `stale_record`; a record carrying only `updated_at` or `imported_at` stays undated (to add when the field lands, alongside one end-to-end test with a fixture archive row).
- **Acceptance:** with a real import, `setup.record` for a team setup shows the archive block with `as_of` equal to the scoring run's last bar date, and a stale archive (> 14 days) shows `stale_record`.

## Owners
- `wisdom/archive/**` (dashboard): no named maintainer is recorded in the repository. All 40 commits touching it were made by automated Claude sessions on the owner's account, and `docs/wisdom/` names no owner for the archive package. Route to the Wisdom programme's integrator, or ask the owner to name one.
- The ledger and its setup-library export (`tsdr-ledger`, partner's PC): the partner.
