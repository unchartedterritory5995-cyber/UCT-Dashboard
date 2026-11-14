"""The Leader score's pre-registered test: a read-only, point-in-time harness.

Plan ``2026-11-14-uct-rs-screens-plan-v2.md`` section 8, unit U9. The Leader score
(``api.services.screener.rs_leader_score``) is shown to members only if it passes this
test; if it fails, the screens stay ordered by RS Rating. Run it with::

    python -m api.services.rs_leader_test --bars-db <bars.db> --screener-db <screener.db>
        --industry-db <industry_map.db> --out <result.json>

READ-ONLY BY CONSTRUCTION. Every database is opened ``mode=ro`` (``data.connect_ro``)
and the only file written is ``--out``.

POINT IN TIME. For each formation date everything is recomputed from daily bars at or
before that date (``panel``), the RS Rating included: by default it is COMPUTED from
the bars in memory with the rating job's own functions (``ratings``), so the test needs
no stored rating history; ``--ratings stored`` reads ``rs_rating_history`` instead.
Where a stored session can also be read, the two are compared and the output carries
the comparison. Today's ``screener_rows`` gives three facts only, as held today and
said so in the output: whether a symbol is an ETF, its industry and its sector.

THE HOLDOUT. The newest ``spec.HOLDOUT_SESSIONS`` sessions (of the benchmark's bar
dates; of the stored rating sessions in ``stored`` mode) are not read (no rating of
them, no bar after the last development session) unless ``--unlock-holdout`` is
passed, and a development result is the same with or without it.

Modules: ``spec`` (the numbers), ``data`` (the read-only store), ``panel`` (one
symbol's values on each formation date), ``ratings`` (each date's computed ratings and
the check against the stored ones), ``stats`` (quintiles, bootstrap, the pass rule),
``run`` (the whole test), ``__main__`` (the command line).
"""
