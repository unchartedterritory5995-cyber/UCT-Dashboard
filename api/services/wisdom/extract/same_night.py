"""R70 — a night's reconciliation runs the night it finishes, not on Monday.

⛔⛔ WHAT WAS WRONG, MEASURED RATHER THAN ASSUMED (2026-09-17):

  * `extract.run_daily` submits N passes inside the DAILY chain step, at cron
    `mon-fri 18:47` (`publish/jobs.py:32-36`), transport = batch.
  * `wisdom_extract_reap` is cron minute `16,46`, hourly, gated by `flags.extract_enabled`
    (`extract/jobs.py:20-27`). THERE IS NO SEPARATE REAP SWITCH.
  * `batch.reap` -> `_reap_batch` -> `handle_result` -> `run_records.persist_result`
    (`batch.py:736`) is what turns a completed pass into a persisted run directory.
  * `reconcile_stability` and `publication_floor` exist ONLY as DAILY chain steps
    (`publish/chain.py:94` and `:101`).

So a Friday night's three passes finish in the batch window — Friday night or Saturday morning —
and the two steps that SCORE them do not run again until **Monday 18:47**. A whole weekend of
records sitting UNRECONCILED, with `stability` NULL, which the publication floor reads as
fail-closed: nothing publishes, and nothing surfaces in the review queue either, because
`floor.enqueue_blocked` has not run.

⭐ THE FIX IS A RIDER, NOT A NEW PIPELINE. When the reap observes that every pass run of a night
is fully reaped, it runs **the same two functions the chain step names, in the chain's order**,
under the registry's own claim/run-row/heartbeat bookkeeping. Nothing about the chain changes;
Monday's chain re-runs both steps and both are idempotent.

⛔ THE TRIGGER IS COMPLETION, NOT ARRIVAL. A night's passes are its run ids
(`"<stamp>Z-chain-p<N>"`, minted in `batch.run_daily`), and a pass is finished when every request
row carrying that run id is terminal (`done` or `failed`). 2 of 3 reaped triggers NOTHING: a
reconciliation over a partial night is not an early answer, it is a wrong one — `reconcile`
compares SEGMENT SETS and would refuse, or worse, silently score last night's third pass beside
tonight's first two.

⛔ IDEMPOTENCE IS A `wisdom_job_claims` ROW, keyed `(JOB_ID, night)` — the existing durable
(job, slot) idiom, taken through `registry.claim_slot`, the same call `_run_job` makes. It is
durable across a redeploy, atomic through the table's primary key, and readable beside every
other slot the programme claims. The alternatives were considered and rejected: a marker FILE in
the run directory lives in the gitignored volume tree and would be invisible to the admin status
page and gone if the runs root ever moves; a NEW table would be a second answer to a question
this schema already answers.

⛔ NOT A REGISTERED JobSpec. There is no cron slot for "the batch finished", and a spec carries
`expected_every_s`, which the watchdog reads — a spec here would page every time a night did not
complete, i.e. every weekend and every quiet day. The job id is synthetic ON PURPOSE: it names
the work in `wisdom_job_runs` and `wisdom_job_claims` without inventing a schedule for it.

⛔ THE SCORING IS A RIDER AND MUST NEVER FAIL THE REAP. Reap's contract is to advance batches and
persist paid results; a reconciliation that raises costs a scoring cycle, never a paid result.
`batch._same_night_scoring` is where that isolation lives.

⚠️ GATE: this inherits the reap job's gate and deliberately re-reads no flag. With
`WISDOM_EXTRACT_ENABLED` off the job does not run (`extract/jobs.py`) and `batch.reap` returns at
`spend_allowed` before reaching the rider — two layers, both rail-tested, neither restated here.
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)

#: How the triggered scoring is recorded. ⛔ `wisdom_` prefixed like every other job id, so it
#: reads as what it is in `wisdom_job_runs` and `wisdom_job_claims` — but see the module note:
#: it is deliberately NOT a JobSpec.
JOB_ID = "wisdom_same_night_scoring"

#: The run ids `batch.run_daily` mints: `f"{stamp}Z-chain-p{p}"`. The NIGHT is everything before
#: the pass suffix, so all N passes of one chain run share it.
#: ⛔ A run id that does not match is IGNORED and COUNTED, never guessed at: the single-pass path
#: passes no run id at all (the column is NULL and never reaches here), and anything else is a
#: shape this module was not written for. Reporting it is what makes a future shape visible
#: instead of silently unscored.
RUN_ID_RE = re.compile(r"^(?P<night>.+?)-chain-p(?P<pass_index>\d+)$")

#: A request row is finished when it will never be reaped again.
#: ⛔ `retry` is NOT terminal: a retry rides pass 1 of a later night under its ORIGINAL run id
#: (`submit_items` updates a retry row without touching `run_id`/`pass_index`), so its night is
#: not complete until it resolves. Treating it as finished would score a night whose records are
#: still to come.
TERMINAL_STATUSES = ("done", "failed")

#: How many unscored complete nights one reap tick will score.
#: ⭐ Newest first, because R70 is about scoring TONIGHT tonight; a backlog drains over the
#: following ticks (every 30 minutes) rather than firing a burst of identical reconciliations in
#: one. ⚠️ The cap is only meaningful because already-claimed nights are filtered out first —
#: without that filter the same newest night would occupy a slot forever.
MAX_NIGHTS_PER_TICK = 4


def night_of(run_id) -> str | None:
    """The night a pass run belongs to, or None when the id is not a chain pass run."""
    match = RUN_ID_RE.match(str(run_id or ""))
    return match.group("night") if match else None


def scan(conn) -> dict:
    """Every night the request ledger knows about, and whether all of its passes are reaped.

    ⛔ The night's pass set is read from the LEDGER, never forecast from `WISDOM_EXTRACT_PASSES`.
    The env var says how many passes the NEXT night will submit; a night that submitted two
    because the third crossed its budget has two passes as a matter of record, and waiting for a
    third that was never sent would mean never scoring it. What the passes then reconcile to is
    `reconcile`'s answer to give — it refuses a mismatched segment set and says so.
    """
    marks = ",".join("?" * len(TERMINAL_STATUSES))
    rows = conn.execute(
        f"SELECT run_id, COUNT(*) AS total, "
        f"SUM(CASE WHEN status IN ({marks}) THEN 1 ELSE 0 END) AS finished "
        f"FROM wisdom_extract_requests "
        f"WHERE run_id IS NOT NULL AND purpose = 'extract' GROUP BY run_id",
        TERMINAL_STATUSES).fetchall()

    nights: dict = {}
    unparsed: list = []
    for row in rows:
        night = night_of(row["run_id"])
        if night is None:
            unparsed.append(row["run_id"])
            continue
        total, finished = int(row["total"] or 0), int(row["finished"] or 0)
        slot = nights.setdefault(night, {"runs": {}, "open": 0})
        slot["runs"][row["run_id"]] = {"total": total, "finished": finished}
        slot["open"] += total - finished
    for slot in nights.values():
        slot["passes"] = len(slot["runs"])
        slot["complete"] = slot["open"] == 0
    return {"nights": nights, "unparsed_run_ids": sorted(set(unparsed))}


def _already_scored(conn, nights: list) -> set:
    """Nights whose claim row already says `ok`.

    ⚠️ AN OPTIMISATION, NOT THE GUARD — and that is mutation-proved rather than asserted:
    disabling this filter leaves the idempotence test green, because `registry.claim_slot`
    refuses the second attempt anyway. It exists so an old night cannot occupy a slot under
    MAX_NIGHTS_PER_TICK and so a settled night stops writing heartbeats forever.
    """
    if not nights:
        return set()
    marks = ",".join("?" * len(nights))
    return {row[0] for row in conn.execute(
        f"SELECT due_key FROM wisdom_job_claims "
        f"WHERE job_id = ? AND status = 'ok' AND due_key IN ({marks})",
        (JOB_ID, *nights))}


def score_night(ctx) -> dict:
    """Reconcile the night, then apply the publication floor.

    ⛔⛔ THE SAME TWO FUNCTIONS THE DAILY CHAIN NAMES, IN THE CHAIN'S ORDER, and the order is the
    same load-bearing one `publish/chain.py:94,101` documents: the floor reads `stability` and
    `stability_runs`, so a reconciliation running AFTER it would leave the floor judging the
    previous cycle's scores — every record blocked on a NULL the reconciler had just filled in.

    ⛔ No copy of either function's gates lives here. `reconcile.score_silently` refuses below
    `floor.MIN_RUNS` persisted runs and on a version or segment-set mismatch; `floor.score_silently`
    enqueues before it retracts. Calling them is how those stay true of this path.

    ⛔⛔ BUG FOUND 2026-09-19 (adversarial review, session 28 part 3): this used to call
    `reconcile.score_silently(ctx)` with no run ids, which reconciles whichever `floor.MIN_RUNS`
    run directories are alphabetically LAST under the whole shared root — correct only when
    `ctx.due_key` happens to be the single newest pending night. `score_completed_nights` can
    process a BACKLOG of 2+ pending nights in one tick (an outage, or scoring simply falling
    behind), and every older night in that backlog would silently reconcile the SAME newest dirs
    a second time, succeed, and still get marked `'ok'` — permanently starving its OWN records at
    `stability=NULL` with no retry. `ctx.due_key` IS this night (`score_completed_nights` sets it
    from `same_night.scan`'s own key), so its specific pass run ids are looked up here and handed
    to the reconciler explicitly, instead of letting it guess from the whole root.
    """
    from api.services.wisdom.core import store
    from api.services.wisdom.extract import reconcile

    with store.read() as conn:
        run_ids = sorted(scan(conn)["nights"].get(ctx.due_key, {"runs": {}})["runs"])
    out = {"night": ctx.due_key, "run_ids": run_ids}
    out["reconcile"] = reconcile.score_silently(ctx, run_ids=run_ids)
    from api.services.wisdom.publish import floor

    out["floor"] = floor.score_silently(ctx)
    return out


def score_completed_nights(ctx, *, limit: int = MAX_NIGHTS_PER_TICK) -> dict:
    """Score every night whose passes are all reaped and that has not been scored yet.

    Returns what it looked at and what it did, so a reap result says why it scored nothing.
    """
    from api.services.wisdom import registry
    from api.services.wisdom.core import store

    if getattr(ctx, "dry_run", False):
        return {"skipped": "dry run"}

    with store.read() as conn:
        found = scan(conn)
        complete = sorted((n for n, s in found["nights"].items() if s["complete"]), reverse=True)
        pending = [n for n in complete if n not in _already_scored(conn, complete)]

    out = {
        "nights_known": len(found["nights"]),
        "complete": len(complete),
        "incomplete": len(found["nights"]) - len(complete),
        "already_scored": len(complete) - len(pending),
        "deferred": max(0, len(pending) - int(limit)),
        "unparsed_run_ids": found["unparsed_run_ids"],
        "scored": [],
    }
    for night in pending[:int(limit)]:
        result = registry.run_tracked(JOB_ID, score_night, due_key=night, now=ctx.now_et)
        out["scored"].append({
            "night": night,
            "passes": found["nights"][night]["passes"],
            "status": result.get("status"),
            "reason": result.get("reason"),
            "run_id": result.get("run_id"),
            "error": result.get("error"),
        })
        ctx.log(f"same-night scoring: {night} -> {result.get('status')}"
                + (f" ({result.get('reason')})" if result.get("reason") else ""))
    return out
