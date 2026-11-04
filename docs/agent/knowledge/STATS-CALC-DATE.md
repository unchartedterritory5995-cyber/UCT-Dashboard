# Calculation-date integrity for Brain statistics (Track C safeguard b)

Status: 2026-11-04, branch `agent/kn/stats-asof`. Brain (`UCT_AGENT_KNOWLEDGE`) stays OFF; nothing here changes
behaviour while it is off.

## The rule
Owner standing rule: statistics are withheld when the calculation date is insufficient, and an export / import / sync
timestamp is never used as a calculation date.

1. Every **served** record figure (`setup.record` → `engine`, `triggers`, `team_archive`) carries its calculation date,
   `as_of`, and the browser card states it ("…, calculated Nov 3, 2026").
2. The date is read ONLY from the source's **attested** column. In `policy.json`, `records.<source>.calc_date_field`
   names the column, and `calc_date_attestation` records the evidence that the producer writes it at computation
   time. Without both, the source has no calculation date.
3. **Allow-list (review #789):** only `computed_at`, `calculated_at`, `calc_date`, `calculation_date`,
   `computation_date` or `updated_at` can ever be a calculation-date field (`policy.CALC_DATE_FIELDS`), and each still
   needs the attestation. Any other name (`packed_at`, `synchronized_at`, `restored_at`, `snapshot_at`, `modified_at`,
   `imported_at`, `through`, ...) is refused whatever the policy says.
4. No date, or one more than **15 minutes** in the future (`kinds.MAX_CLOCK_SKEW_DAYS`, producer clock skew) →
   `undated_record`; older than `pack.stats_stale_days` (14.0 days) by any amount → `stale_record`. Neither
   serves a figure, a verdict or an interval. Conditional sources keep their existing checks (methodology id, Wilson
   interval, calculation not earlier than its data, data not older than `stats_data_stale_days`).
5. There is no fallback: if the attested column is missing from the pack, `updated_at` is NOT used instead.

## Sources (shipped policy v6)

| source | calc_date_field | evidence | result |
|---|---|---|---|
| `setup_performance` | `updated_at` | `uct-intelligence` `update_setup_performance()` sets `updated_at = datetime('now')` in the recompute's own upsert (the insert uses the column default); no other writer; the Brain Pack is a SQLite backup, so the value is carried unchanged. Verified read-only at uct-intelligence `a668b39`. | served when fresh |
| `trigger_performance` | none | no writer exists in the uct-intelligence repository, so the meaning of its `updated_at` cannot be verified | **withheld** (`undated_record`) |
| `team_archive` | none | `through` is a data-through date, never a calculation date (review #789); no calculation field is attested for the payload yet; never `imported_at` | **withheld** (`undated_record`) until the producer writes the scoring run's finish time and it is attested |

## Behaviour changes (dark)
- `trigger_performance` figures are withheld under the shipped policy until its producer attests a computation-time
  field. Producer ask: write `computed_at` (ISO-8601 UTC, set by the computation) or confirm that `updated_at` is only
  ever written by the computation; then add `calc_date_field` + `calc_date_attestation` to the policy (owner review).
- A figure the live facade (`brain_service.setup_winrate`) answers with no pack row is now withheld: it has no
  attested calculation date. This reverses the earlier "the facade read the pack itself" allowance.
- An undated record is labelled `undated_record` (previously folded into `stale_record`).

## Tests
`tests/test_uct_agent_knowledge.py` `test_calc_date_*`:
- the shipped policy attests `setup_performance` only;
- transport-stamp names and unattested fields are refused;
- only the attested column is read (no `updated_at` fallback);
- an attested trigger date serves the figure with `as_of`;
- a future date is undated;
- a FIXED clock at the boundaries: exactly 14.0 days served, 14 days + 1 s stale, 10 min ahead served (skew), 1 h and
  36 h ahead undated;
- the archive's `through` alone never dates a figure, and the shipped policy withholds archive figures;
- every served figure across setups × regimes, under the test and the shipped policy, carries `as_of`.

`app/src/agent/agentKnowledge.test.js`: the card states "calculated <date>", and a withheld block states no figure.
