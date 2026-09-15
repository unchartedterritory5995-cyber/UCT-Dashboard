"""Wave 1.5 item 3 — the publication floor. ONE authority for the predicate, four call sites.

**The rule (SESSION-STATE, owner):** *no PRINCIPLE or MARKET_SIGNAL publishes under a named author
unless stability = 1.0 (3/3) AND confirmed or provisional-with-evidence; 2/3 may surface only in
the admin review queue.*

⛔⛔ **ONE PREDICATE, NOT FOUR COPIES.** Four different mechanisms reach these record types, so the
floor has four call sites — but a guard written out four times cannot be mutation-proved and
drifts silently (`lesson_a_guard_repeated_is_a_guard_unproved`: delete every copy but one). Every
site calls `passes()` or `sql_clause()` here.

**The four sites, and why one is not enough** (verified from source, session 3):

| lane | how it reaches the record | site |
|---|---|---|
| dossiers, Model Book drafts | `common.select_records` | `select_records` |
| Brain KB rows | a **direct `wisdom_principles` SELECT** — `select_records` never sees it | `brainkb.export_payload` |
| Ask-AI | the **FTS index**, not `select_records` | `retrieval.search` |
| clip export | untyped SQL over all six types, **no feature flag** | `clips.clip_candidates` |

⛔ **`voice.py` is NOT a site** — it has no PRINCIPLE path at all (`:33-39`, `:44-79`). The original
item-3 wording named it and omitted `modelbook.py`, which does have one.

⚠️ **TWO HOLES A RECORD-LEVEL FLOOR DOES NOT CLOSE, stated here so nobody reads this module as
more than it is.** `retrieval._segment_docs` (`retrieval.py:49-81`) indexes the full text of every
authored segment, so the SENTENCE an unstable PRINCIPLE came from stays retrievable through Ask-AI,
attributed and dated; and `voicefmt.corpus_documents` exports raw segment text regardless of record
type. Closing those is a claim-level change (`R13_ITEM3_SCOPE: CLAIM`), which the owner scoped OUT
of this build (`RECORD`). This module implements *no extracted RECORD publishes*, not *the claim
never reaches a member*.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Optional, Sequence

#: The two types the rule names. ⛔ NEVER widen this without an owner ruling: item 2's measured
#: `below_floor` list currently contains all five measured types, and quietly extending the
#: publication floor to CALL/MENTION/LEVEL would stop those lanes dead.
FLOORED_TYPES: tuple = ("PRINCIPLE", "MARKET_SIGNAL")

#: Review-queue tab and reason code for a blocked record.
REVIEW_TAB = "contradictions"
REASON = "below_publication_floor"

#: ⭐ Owner ruling Q17 / R17_MIN_RUNS, 2026-09-14: **FLOOR, min runs 3.**
#:
#: A stability score is only a measurement if enough passes went into it. `stability` is
#: `runs_present / N` (item 2's wording), so a score computed over fewer than this many runs is
#: not a weak score — it is an UNMEASURED one, and it is treated exactly like NULL: it blocks.
#:
#: ⛔ Without this, `stability = 1.0` from a SINGLE run would sail through the floor. One run
#: agreeing with itself is not agreement, and 1/1 = 1.0 is the most confident-looking number the
#: pipeline can produce for the least evidence. That is the hole Q17 closes.
#:
#: ⚠️ This is the ONE place the rule lives. It is not derived from `STABILITY_FLOOR`, which
#: answers a different question (how much agreement), and it deliberately has no env override —
#: a publication floor that can be lowered from the environment is not a floor.
MIN_RUNS = 3


def floor_value() -> float:
    """⛔ Read from `golden.STABILITY_FLOOR`, its single definition — never a literal here.

    ⭐ **Why 0.8 and "3/3" are the same rule, and when they stop being.** With three passes the
    only attainable values are 0, 1/3, 2/3 and 1, so `>= 0.8` admits **exactly 1.0** — the owner's
    "stability = 1.0 (3/3)" and `STABILITY_FLOOR` agree precisely at N=3. They DIVERGE at other
    run counts: at N=5, 4/5 = 0.8 would pass this floor while not being 5/5. If voting ever runs
    at anything but 3 passes that is an owner question, not an implementation detail.
    """
    from api.services.wisdom.extract.golden import STABILITY_FLOOR

    return float(STABILITY_FLOOR)


def passes(record_type: Optional[str], stability: Any, runs: Any = None) -> bool:
    """Is this record allowed to publish under a named author?

    Two conditions, both required (owner ruling Q17: **FLOOR**, min runs `MIN_RUNS`):
      1. the score was measured over at least `MIN_RUNS` passes, and
      2. `stability >= golden.STABILITY_FLOOR`.

    ⛔ **FAIL-CLOSED ON NULL, AND ON TOO-FEW-RUNS.** Every record that exists today has no
    stability measurement, so NULL blocks. A score over fewer than `MIN_RUNS` passes is treated
    identically to NULL — it is unmeasured, not merely weak. The alternative, treating unmeasured
    as passing, is the one failure that cannot be walked back: it publishes before anyone notices
    the rail is inert.

    ⛔ **Never `== 1.0`.** The rule is a floor, so it is expressed as a floor. At N=3 the two
    spellings coincide — the attainable values are 0, ⅓, ⅔, 1 and only 1.0 clears 0.8 — which is
    exactly why "stability = 1.0 (3/3)" and this predicate agree at the intended run count. They
    diverge at N=5, where 4/5 = 0.8 passes, and Q17 ruled FLOOR for that case.
    """
    if record_type not in FLOORED_TYPES:
        return True
    if stability is None or runs is None:
        return False
    try:
        if int(runs) < MIN_RUNS:
            return False
        return float(stability) >= floor_value()
    except (TypeError, ValueError):
        # ⛔ an unparseable score, or an unparseable run count, is an unknown one — and unknown
        # blocks. Silently coercing either would turn a data defect into a publication.
        return False


def sql_clause(alias: str = "r", *, type_column: str = "record_type",
               stability_column: str = "stability", runs_column: str = "stability_runs") -> tuple:
    """The same predicate as SQL, for the lanes that filter in the query.

    ⛔ Must stay in lockstep with `passes()` — `test_the_sql_clause_agrees_with_the_python_predicate`
    cross-checks every combination rather than trusting that they were written together.

    Returns `(clause, params)`. ⛔ The parameters are bound, never interpolated; the column names
    are callers' identifiers and are validated so a caller cannot inject through them.
    """
    for name in (alias, type_column, stability_column, runs_column):
        if not name.replace("_", "").isalnum():
            raise ValueError(f"not an identifier: {name!r}")
    placeholders = ",".join("?" * len(FLOORED_TYPES))
    clause = (f"({alias}.{type_column} NOT IN ({placeholders})"
              f" OR ({alias}.{stability_column} IS NOT NULL"
              f" AND {alias}.{runs_column} IS NOT NULL AND {alias}.{runs_column} >= ?"
              f" AND {alias}.{stability_column} >= ?))")
    return clause, [*FLOORED_TYPES, MIN_RUNS, floor_value()]


def principles_clause(alias: str = "p") -> tuple:
    """`wisdom_principles` has no `record_type` column — every row in it IS a PRINCIPLE.

    ⛔ It carries its OWN `stability_runs` (migration `core_010`) rather than joining
    `wisdom_records` for it. The Brain KB lane reads this table directly and a principle is a
    cross-segment identity that can be supported by several records, so "which record's run count"
    has no single answer — the score and its denominator have to travel together on the row that
    carries the score.
    """
    if not alias.replace("_", "").isalnum():
        raise ValueError(f"not an identifier: {alias!r}")
    return (f"({alias}.stability IS NOT NULL AND {alias}.stability_runs IS NOT NULL"
            f" AND {alias}.stability_runs >= ? AND {alias}.stability >= ?)"), [MIN_RUNS, floor_value()]


def reason(record_type: Optional[str], stability: Any, *, runs: Any = None,
           run_id: Optional[str] = None) -> str:
    """The reason code an admin reads. ⛔ Names the floor, the value (or NULL) and the run.

    A reason that says only "blocked" makes the queue unactionable — the first question an admin
    asks is *how far below, and measured over what?*
    """
    seen = "NULL (never measured)" if stability is None else f"{float(stability):.3f}"
    where = "" if not run_id else f"; run {run_id}"
    # ⛔ Name WHICH condition failed. "below the floor" on a 1.0 score reads as a contradiction
    # and sends the admin looking for a scoring bug that is not there — the real answer is that
    # one run agreeing with itself is not agreement.
    if runs in (None, ""):
        why = f"stability {seen} was measured over an UNRECORDED number of runs (need >= {MIN_RUNS})"
    else:
        try:
            too_few = int(runs) < MIN_RUNS
        except (TypeError, ValueError):
            too_few = True
        why = (f"stability {seen} was measured over only {runs} run(s), below the minimum {MIN_RUNS}"
               if too_few else
               f"stability {seen} over {runs} run(s) is below the floor {floor_value():.3f}")
    return f"{REASON}: {record_type} {why}{where}"


def enqueue_blocked(conn: sqlite3.Connection, *, limit: int = 500, now=None) -> dict:
    """Surface every blocked record in the admin review queue. Idempotent.

    ⛔⛔ **WHY THIS IS A SEPARATE STEP AND NOT A LINE INSIDE `select_records`.** The owner's rule
    says a 2/3 record *"may surface only in the admin review queue"*, and session 3 proved the
    queue is **NOT** upstream of the Brain KB, Ask-AI or dossier lanes — nothing enqueues a
    PRINCIPLE on the publish path at all — so blocking alone makes a blocked record VANISH rather
    than surface. The block and the enqueue therefore have to be paired.

    ⚠️ They are paired by the daily chain, not by the read path, and that is deliberate: the four
    filter sites are member-facing READS running on a read-only connection, and performing a write
    inside one would be both a correctness bug and a per-request cost. This runs once per daily
    run instead.

    ⭐ `review.enqueue` is idempotent through `item_id_for(tab, subject_ref, new)`, so the same
    blocked record re-enqueued every day produces ONE row, not a flood — proved by a test that
    runs it twice and counts.
    """
    from api.services.wisdom.publish import review

    clause, params = sql_clause("r")
    rows = conn.execute(
        "SELECT r.record_id, r.record_type, r.stability, r.stability_runs, r.segment_id, r.author_id "
        "FROM wisdom_records r "
        f"WHERE r.record_type IN ({','.join('?' * len(FLOORED_TYPES))}) AND NOT {clause} "
        "ORDER BY r.record_id LIMIT ?",
        [*FLOORED_TYPES, *params, int(limit)],
    ).fetchall()
    created = 0
    for row in rows:
        subject = f"record:{row['record_id']}"
        summary = reason(row["record_type"], row["stability"], runs=row["stability_runs"])
        out = review.enqueue(
            conn, tab=REVIEW_TAB, subject_ref=subject, summary=summary,
            new={"reason": REASON, "record_id": row["record_id"], "record_type": row["record_type"],
                 "stability": row["stability"], "stability_runs": row["stability_runs"],
                 "floor": floor_value()},
            evidence={"segment_id": row["segment_id"], "author_id": row["author_id"]},
            recommendation="Hold. Re-measure stability over N=3 before this publishes.",
            now=now,
        )
        created += int(bool(out.get("created")))
    return {"blocked": len(rows), "enqueued": created, "floor": floor_value()}


def score_silently(ctx) -> dict:
    """Daily-chain entry point. Enqueues blocked records; publishes nothing, changes no flag."""
    from api.services.wisdom.core import store

    with store.write() as conn:
        return enqueue_blocked(conn)
