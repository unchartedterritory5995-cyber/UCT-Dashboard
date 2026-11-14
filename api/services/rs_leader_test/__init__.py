"""The Leader score's pre-registered test: a read-only, point-in-time harness.

Plan ``2026-11-14-uct-rs-screens-plan-v2.md`` section 8, unit U9. The Leader score
(``api.services.screener.rs_leader_score``) is shown to members only if it passes this
test; if it fails, the screens stay ordered by RS Rating. Run it with::

    python -m api.services.rs_leader_test --bars-db <bars.db> --screener-db <screener.db> --out <result.json>

READ-ONLY BY CONSTRUCTION. Both databases are opened ``mode=ro`` (``data.connect_ro``)
and the only file written is ``--out``.

POINT IN TIME. For each formation date everything is recomputed from daily bars at or
before that date (``panel``) and from the ratings stored for that session
(``rs_rating_history``). Today's ``screener_rows`` gives three facts only, as held
today and said so in the output: whether a symbol is an ETF, its industry and its sector.

THE HOLDOUT. The newest ``spec.HOLDOUT_SESSIONS`` rating sessions are not read (no
rating of them, no bar after the last development session) unless ``--unlock-holdout``
is passed, and a development result is the same with or without it.

Modules: ``spec`` (the numbers), ``data`` (the read-only store), ``panel`` (one
symbol's values on each formation date), ``stats`` (quintiles, bootstrap, the pass
rule), ``run`` (the whole test), ``__main__`` (the command line).
"""
