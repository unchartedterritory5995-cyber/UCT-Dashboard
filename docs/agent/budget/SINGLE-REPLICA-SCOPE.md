# Agent limits: one web replica is the supported scope

**One replica is what is supported today. It is not a permanent restriction.** The limits below were built and proved
for one `web` instance, and the owner approved that scope. Scaling out is fine once they move.

## What depends on it

| Limit | Where it counts |
|---|---|
| $1 a day per member on vision | `catalyst_cost_log` in `/data/catalysts.db` |
| 20 concurrent Agent turns, one per member | `agent_inflight` in `/data/uct_agent.db` |

There is no Postgres or Redis. These are SQLite files on `web`'s own volume, and SQLite's locking needs one local file.
They hold across every process on that volume. A second instance on its own volume would count separately: 40 turns,
and $2 for a member who reached both.

The $0.25 turn, $5 Agent day and $15 shared caps use the same files, so they would double the same way.

## What stops a second replica

- `railway.web.json` pins `"numReplicas": 1`, and a test fails CI if it changes or if `multiRegionConfig` adds up to
  more than 1. `tests/test_uct_agent_limits_two_processes.py` holds `SHARED_STORE_EXISTS`.
- At runtime, `limits.admit` records this replica in `agent_replicas`. If two replicas of one deployment appear within
  5 minutes, paid turns are refused with a 503 and `#breadth-alerts` is told.

**⛔ The runtime check only sees replicas that share the file.** Replicas on separate volumes each see one and carry on.
`test_REPLICAS_separate_volumes_are_invisible_to_this_check` pins this. It catches a shared-volume mistake, and it is
not proof of the live replica count. Nothing in this repo reads the live count yet: that needs a Railway API token
in CI. ~~The dashboard stays the authority until then.~~ ⚰️ Superseded 2026-11-09: the repo pin (`railway.web.json`
`numReplicas`) is the authority. See "Owner decision 2026-11-09" below.

## Before scaling horizontally

1. Move the in-flight table and the vision member count, plus the Agent ledger they sit beside, to a store every
   instance shares, with an atomic count-and-reserve.
2. Prove it with the same shape as `tests/test_uct_agent_limits_two_processes.py`, on separate machines, not separate
   processes.
3. Only then flip `SHARED_STORE_EXISTS` and raise `numReplicas`.

## Owner decision 2026-11-09: the repo pin is the authority

- The `"numReplicas": 1` pin in `railway.web.json` was approved by the owner on 2026-11-09, to keep the AI-spending safeguards
  correct (they hold only on one web replica; see above).
- From now on the pin in the repo is the authority for the replica count. This supersedes the struck "the dashboard stays the
  authority" line in the section above. Do NOT change the replica count by hand in the Railway dashboard: the next deploy applies the repo's
  config, so a dashboard value that differs is silently overridden.
- Scaling beyond one replica requires BOTH a reviewed config change AND a review of the AI-spending architecture, including
  whether the spending limits are enforced globally across replicas (the steps in "Before scaling horizontally").
