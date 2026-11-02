"""C48 / C45 -- A PLOT THAT READS A CALL WHOSE CODE MAY NOT RUN ON EVERY BAR, on the
server lanes. The Python twin of ``app/src/components/chart/engine/blockRuns.js``.

Pine keeps a call's history per EXECUTION. A ``ta.*`` written inside an ``if`` block
(capture ``vw-call-site-history``, C48), in one arm of a ``?:`` or on the right of a
Pine v6 ``and`` / ``or`` (capture ``vw-arm-history``, C45) advances only on the bars
that code runs, and the columnar lanes compute every tree over EVERY bar. The two
readings agree exactly when the code's executions are the bars -- a fact about the
DATA, not the script -- so the member door stamps each such plot with the guard that
says when the code runs (``meta.blockRuns.keys[].gates[] = {why, guard, what?}``) and
the chart's bind refuses the plot, by name, on a chart where the code runs after a bar
it skipped.

⛔⛔ THE SERVER EVALUATES THE SAME SAVED DOCUMENT. A member pane attaches ONE document
to ``/api/user-definitions``; a user-series alert arms on its plots and the scan sweep
runs it as a screen. Both evaluate its trees column-wise with ``ast_interpret`` -- the
every-bar number -- and until this module neither read the stamp, so a plot the
member's chart withholds could still fire an alert or match a screen off a value that
is not TradingView's. This is the same check, asked of the same stamp, with the same
sentence.

⛔ ONE RULE, TWO LANES, HELD EQUAL BY A FIXTURE BOTH READ
(``tests/fixtures/ast/block_runs_parity.json``, written by the JS lane's
``blockRunsParity.test.js``; read by ``tests/test_block_runs_parity.py``).
"""
from __future__ import annotations

import math
from typing import Any, Callable, Mapping, Optional, Sequence

#: The guard name a refused column carries -- the translation's own (``pine:block``).
BLOCK_RUNS_GUARD = "pine:block"


def _stamp_of(definition: Any) -> Optional[Mapping[str, Any]]:
    meta = definition.get("meta") if isinstance(definition, Mapping) else None
    br = meta.get("blockRuns") if isinstance(meta, Mapping) else None
    keys = br.get("keys") if isinstance(br, Mapping) else None
    return br if isinstance(keys, list) and keys else None


def block_runs_for(definition: Any, key: Any) -> Optional[list]:
    """The gates plot ``key`` carries -- ``[{why, guard, what?}]`` -- or ``None``."""
    br = _stamp_of(definition)
    if br is None:
        return None
    for entry in br["keys"]:
        if isinstance(entry, Mapping) and entry.get("key") == key:
            gates = entry.get("gates")
            return gates if isinstance(gates, list) and gates else None
    return None


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_run(v: Any) -> bool:
    if v is True:
        return True
    return _is_number(v) and math.isfinite(float(v)) and float(v) != 0.0


def _is_skip(v: Any) -> bool:
    if v is False:
        return True
    return _is_number(v) and float(v) == 0.0


def first_run_after_skip(column: Optional[Sequence[Any]]) -> Optional[tuple]:
    """The first bar on which the code RUNS after a bar it SKIPPED --
    ``(skipped, bar)`` -- or ``None`` when its executions are the bars it ran on.
    ⛔ A bar where the guard is not computable (``None`` / ``NaN``) is neither a run
    nor a skip: the plot is not computable there either."""
    skipped = -1
    for i, v in enumerate(column or ()):
        if _is_skip(v):
            if skipped < 0:
                skipped = i
        elif skipped >= 0 and _is_run(v):
            return (skipped, i)
    return None


def block_runs_refusal(definition: Any, key: Any,
                       evaluate: Callable[[Any], Sequence[Any]]) -> Optional[str]:
    """Why plot ``key`` is not computable on these bars, or ``None``.
    ``evaluate(tree)`` computes one guard tree over the binding's own bars, inputs and
    opts (the plot's own). ⛔ A guard that cannot be evaluated refuses the plot too:
    an unread guard is not code that ran on every bar."""
    gates = block_runs_for(definition, key)
    if not gates:
        return None
    for gate in gates:
        why = gate.get("why") if isinstance(gate, Mapping) else None
        why = why if isinstance(why, str) else "a call whose code may not run on every bar"
        try:
            column = evaluate(gate.get("guard") if isinstance(gate, Mapping) else None)
        except Exception as exc:  # noqa: BLE001 -- the evaluator's own refusal, named below
            return (f"{why} — and whether the block runs on every bar of this chart could not be "
                    f"computed ({str(exc)[:160]})")
        hit = first_run_after_skip(column)
        if hit is not None:
            what = gate.get("what") if isinstance(gate, Mapping) else None
            what = what if isinstance(what, str) and what else "the block"
            return (f"{why} — on this chart {what} skips bar {hit[0]} and runs again on bar "
                    f"{hit[1]}, so its calls have not run on every bar")
    return None


def scan_plot_key(definition: Any) -> Optional[str]:
    """The plot key whose tree a SCAN evaluates (``compute.ast``): a multi-tree
    document's ``compute.scanPlot``; otherwise its one data-bearing plot (the plots
    that are not ``hlines`` guides -- ``nativeRegistry.js::astPlotKey``). ``None``
    when the document says neither unambiguously."""
    if not isinstance(definition, Mapping):
        return None
    compute = definition.get("compute") if isinstance(definition.get("compute"), Mapping) else {}
    scan = compute.get("scanPlot")
    if isinstance(compute.get("trees"), Mapping):
        return scan if isinstance(scan, str) and scan else None
    keys = [p.get("key") for p in (definition.get("plots") or [])
            if isinstance(p, Mapping) and p.get("style") != "hlines" and isinstance(p.get("key"), str)]
    return keys[0] if len(keys) == 1 else None
