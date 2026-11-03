# Interface contract ARCHIVE-ASOF-1: a calculation date on the team archive's setup statistics

| | |
|---|---|
| **To** | the partner / ledger maintainer (`tsdr-ledger`), the PROPOSED owner of this metadata, pending confirmation (owner decision 2026-11-03, `docs/agent/program/PROGRAM.md` on `agent/int` @ `b8d20a1286`) |
| **From** | agent-kn (UCT Agent knowledge kinds, PR #735), via the Agent integrator (AUDIT) |
| **Status** | PROPOSED. Additive only. Nothing in the partner repository changes without the partner's authorization; this branch does not touch it. |
| **Consumer behaviour until delivered** | UNCHANGED fail-safe: without a calculation date, the Agent serves no archive figure and no archive verdict, only `n` and the reason (`undated_record`). |

## 1. Why
UCT Agent may show the team archive's measured record for a setup only with a trustworthy date that reflects **the freshness of the calculation**. Today the archive record carries no such date. The only stored date, `imported_at` (`api/services/wisdom/archive/schema.py`), is the time the export was loaded into the dashboard. The owner ruled that an export or import timestamp must not be used.

## 2. What we ask the ledger to provide (producer side)
In each `structured/setup_library/<setup>.json` written by `tools/build_setup_library.py`, add at top level:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `through` | `YYYY-MM-DD` | yes | the last trading session whose daily bars were included in the scoring run that produced this file's statistics, i.e. the newest bar date `tools/score.py` read (its bars fingerprint date) |
| `as_of` | ISO-8601 UTC | no | when that scoring run finished |
| `scoring_run` | string | no | the scoring run's identifier (e.g. its bars fingerprint), for provenance |

Rules:
- The value must be written **by the computation**, never filled from the export time, the import time, a file mtime or a clock read at publication.
- If one file's statistics combine several scoring runs, `through` is the **oldest** run's date.
- A file the scorer did not refresh keeps its previous `through` (so staleness shows).
- Additive: existing keys and their meaning do not change; a consumer that ignores the new keys behaves exactly as today.

## 3. What the dashboard does with it (consumer side; Wisdom archive owner + agent-kn; after the partner delivers)
1. **Import** (`wisdom/archive`, owner to be confirmed by the integrator): one additive migration adds a nullable column `computed_through TEXT` (and optionally `computed_as_of TEXT`, `scoring_run TEXT`) to `wisdom_archive_playbooks`; the playbook import copies the JSON fields; existing rows stay NULL.
2. **Payload** (`wisdom/archive/team_record._setup_payload`): one new top-level key, `"through": pb.get("computed_through")`, beside `"all_calls"`. No existing key changes, so Compass, the Terminal CHK and Ask AI are unaffected.
3. **Agent** (`api/services/uct_agent/knowledge/kinds.py::record`, already implemented):
   - reads ONLY `through`, then `as_of`; never `imported_at` or `updated_at`;
   - no date → `undated_record`: no figures, no verdict;
   - date older than `policy.pack.stats_stale_days` (14 days) → `stale_record`: no figures, no verdict;
   - otherwise → the signed, floored verdict block (`measured_edge_controlled` / `measured_underperformance_controlled` / `not_proven` / `insufficient_sample`), carrying its source, licence and `as_of`.

## 4. Acceptance tests
- **Producer (partner):** a scoring run over bars ending session D writes `through = D` into every refreshed setup file; an unrefreshed file keeps its old value; no code path assigns `through` from the clock or a file time.
- **Import (Wisdom):** migration adds the column with existing rows NULL; a JSON with `through` stores it; a JSON without it stores NULL; a rail that `computed_through` is never derived from `imported_at`.
- **Payload (Wisdom):** `_setup_payload` returns `through` equal to the stored value, or `None`.
- **Agent (agent-kn, in `tests/test_uct_agent_knowledge.py`):** undated → `undated_record` with no figures or verdict (exists); dated within 14 days → signed verdict and figures (exists, `test_n4_archive_in_record_scope_staleness_and_sign`); dated older → `stale_record` (exists); an end-to-end test against a fixture archive row carrying `computed_through` (added when the import change lands).

## 5. Open items
- Confirmation of the proposed owner (partner / ledger maintainer) for the producer side.
- A named owner for `api/services/wisdom/archive/**` on the dashboard side: none is recorded in the repository (all commits by automated sessions); the integrator routes this to the owner.
