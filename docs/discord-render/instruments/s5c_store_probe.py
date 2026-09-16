"""D-04 4.2 — production can observe S5c, and S1's population does not move.

⛔⛔ THE PROBLEM. A refusal is answered in the interaction RESPONSE, not a PATCH, so `record_ack`
never fires for one (`commands.py:201`) and every refusal row carries `ack_ms = NULL`. S5c —
"did the refusal reach the member in time" — was therefore measurable only by a HARNESS reading the
wire. Production could not observe it at all.

⛔ THE TRAP THE FIX HAD TO AVOID. Writing the reach time into `ack_ms` would have fixed that in one
line and silently BROKEN S1: its population is `a is not None` (`observe.py:121,129`), so every
refusal would join the ack percentiles S1 is judged on. **Two questions, two columns** — and the
mutation below is what proves the distinction is real rather than intended.
"""
from __future__ import annotations

import os
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for p in (str(HERE), str(ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)


def self_check(out=print) -> int:
    from selfcheck import Cases
    d = pathlib.Path(tempfile.mkdtemp(prefix="s5c-"))
    os.environ["DISCORD_RENDER_DB_PATH"] = str(d / "jobs.db")
    from api.services.discord_render.jobs_store import JobsStore
    from api.services.discord_render.runtime import JobRuntime, Job, INTERACTIVE
    from api.services.discord_render import observe

    cases = Cases("s5c_store_probe")
    store = JobsStore()
    rt = JobRuntime(store=store, handlers={}, edit_fn=lambda *a, **k: True,
                    workers=1, queue_max=1)

    def job(n, u="u1"):
        return Job(corr_id=f"s{n}", command="chart", app_id="a", token="t", args={},
                   label="/chart", user_id=u, guild_id="g", channel_id="c",
                   interaction_id=str(n), interaction_type=2, lane=INTERACTIVE)

    def flush():
        q = rt._writer
        while not q.empty():
            it = q.get()
            store.insert(it[1]) if it[0] == "insert" else store.update(it[1], **it[2])

    rt.offer(job(1))
    rt.record_ack("s1", 4.2)
    flush()
    rt.offer(job(2, "u2"))                       # queue_max=1, so this is refused
    rt.record_refused(job(2, "u2"), "queue_full")
    rt.record_refusal_reach("s2", 0.9)
    flush()

    queued, refused = store.get("s1"), store.get("s2")
    cases.add("a refusal row GETS refusal_reach_ms", refused.get("refusal_reach_ms") == 0.9)
    cases.add("a refusal row still has ack_ms NULL", refused.get("ack_ms") is None)
    cases.add("a queued row gets ack_ms and NOT refusal_reach_ms",
              queued.get("ack_ms") == 4.2 and queued.get("refusal_reach_ms") is None)

    rows = store.recent(3600.0)
    # ⛔ A COLUMN ABSENT FROM `recent()`'S PROJECTION IS A COLUMN NOTHING CAN EVER READ — a silent
    # way to ship a field that does nothing. `recent()` is what observe and every instrument use.
    cases.add("recent() PROJECTS the new column", all("refusal_reach_ms" in r for r in rows))

    # ── the load-bearing pair: S1's population, before and after ──────────
    acks = [r.get("ack_ms") for r in rows]
    cases.add("S1's population counts ONE row — the refusal did not join it",
              sum(1 for a in acks if a is not None) == 1)
    s = observe._summary(rows)
    cases.add("observe's ack percentiles see only the queued job's 4.2 ms",
              s["ack_ms"]["p50"] == 4.2 and s["ack_ms"]["over_3s"] == 0)

    # ⛔⛔ THE MUTATION, applied to a COPY of the rows: had the reach time gone into `ack_ms`, S1's
    # population would be 2, not 1. That is the whole argument for a second column, made as a
    # measurement instead of a claim.
    mutated = [dict(r) for r in rows]
    for r in mutated:
        if r.get("refusal_reach_ms") is not None:
            r["ack_ms"] = r["refusal_reach_ms"]
    cases.add("MUTATION: reusing ack_ms changes S1's population from 1 to 2",
              sum(1 for r in mutated if r.get("ack_ms") is not None) == 2)
    cases.add("...and it moves S1's measured percentile, not just its count",
              observe._summary(mutated)["ack_ms"]["p50"] != s["ack_ms"]["p50"])

    # ⚠️ THE HALF THIS DOES NOT REACH, asserted so it cannot be forgotten: a `user_busy` refusal and
    # a per-member rate limit never create a job row, so production still cannot self-observe those.
    cases.add("a user_busy refusal creates NO row, so the wire stays the only source for it",
              store.get("never-offered") is None)
    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
