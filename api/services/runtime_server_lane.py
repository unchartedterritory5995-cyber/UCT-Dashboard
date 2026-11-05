"""W5-T11 -- the server lanes' adapter for a stored runtime document.

``docs/pine/SERVER-RUNTIME-DESIGN.md`` 5.1 and 5.2. ``runtime_column_fn(row, plot_key, lane)``
returns the callable a lane evaluates: ``fn(bars, params, *, tf, ticker, ...) -> column``. On
EVERY call, before any network call, it asks, in the 5.2 order:

  2. the stored verdict   ``user_definitions.engine_withheld_reason(row)``        -> ``withheld``
  4. runtime admission    ``runtime_definitions.server_lane_refusal(row, lane=)`` -> its own guard
  6./7. the run           ``pine_runtime_client.PineRuntimeClient.run``           -> run / transport guards

Nothing is decided once and captured: a kill, a stage change, a demotion or a new verdict reaches
the very next call, even when the cycle's ``RunCache`` already holds the value (the cache sits
behind both questions). Steps 1, 3 and 5 are the lanes' own (T13-T17) and run before this.

A refusal RAISES ``ServerLaneWithheld`` (guard + sentence). It never returns an empty or
all-na column: a refusal read as "no number" is a scan symbol counted as a non-hit and an alert
that arms and never fires (3.7 rule 3).

``admission(row, plot_key, lane)`` is the same chain as a public question (no service call) for
lanes that must decide before they fetch bars; ``_verdict`` (step 2) and ``_admission`` (step 4)
stay as the thin underscore names T13-T15 were written against.

``server_lane_refusal`` is W5-T12's (``runtime_definitions``); it is reached through
``_admission`` at call time, so a build without it refuses every call by name.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, List, Mapping, Optional, Tuple

from api.services import pine_runtime_client as client_mod

log = logging.getLogger(__name__)

#: The guard of step 2 (5.2: "withheld (engine-refused: ...)"): the stored verdict binds.
VERDICT_GUARD = "withheld"


class RuntimeColumn(list):
    """The plot's column (a list, one float per bar) carrying the run's warm-up as ``.warmup``
    (``{"withheldBars": k}``, W5-T7b), which W5-T16's ``record_runtime_pass`` reads."""

    def __init__(self, values: Any, warmup: Mapping[str, int]):
        super().__init__(values)
        self.warmup = dict(warmup)


class ServerLaneWithheld(RuntimeError):
    """This lane has no value for this plot on this call, and says why. Never a falsey return."""

    def __init__(self, guard: str, sentence: str):
        super().__init__(f"{guard}: {sentence}")
        self.guard = guard
        self.sentence = sentence


def _admission(row: Mapping[str, Any], lane: str) -> Optional[Tuple[str, str]]:
    """Step 4, through the module at call time. Anything but ``None`` or a ``(guard, sentence)``
    pair, and any failure to ask, is a refusal: the admission fails closed."""
    from api.services import runtime_definitions
    ask = getattr(runtime_definitions, "server_lane_refusal", None)
    if ask is None:
        return (client_mod.UNAVAILABLE, "this build has no server-lane admission "
                "(runtime_definitions.server_lane_refusal), so no script runs on the server")
    try:
        out = ask(row, lane=lane)
    except Exception:  # noqa: BLE001 -- an admission that cannot answer admits nothing
        log.exception("[runtime-server-lane] server_lane_refusal raised; refused")
        return (client_mod.UNAVAILABLE, "the server-lane admission could not answer, so this script does not run")
    if out is None:
        return None
    if (isinstance(out, tuple) and len(out) == 2 and all(isinstance(x, str) and x for x in out)):
        return out
    return (client_mod.UNAVAILABLE, "the server-lane admission gave no reason, so this script does not run")


def _verdict(row: Mapping[str, Any]) -> Optional[str]:
    """Step 2. A failure to read the verdict holds the version (fails closed)."""
    from api.services import user_definitions
    try:
        return user_definitions.engine_withheld_reason(row)
    except Exception:  # noqa: BLE001
        log.exception("[runtime-server-lane] engine_withheld_reason raised; withheld")
        return "the stored verdict for this version could not be read, so it is withheld"


def admission(row: Mapping[str, Any], plot_key: str, lane: str) -> Optional[Tuple[str, str]]:
    """THE PUBLIC ADMISSION QUESTION a server lane asks before it evaluates one plot of a stored
    runtime row: ``(guard, sentence)`` for the first refusal, or ``None``. The 5.2 chain, in order:
    the stored verdict (``withheld``), then ``server_lane_refusal`` (step 4). It makes no service
    call. ``runtime_column_fn`` asks exactly this on every call, so the two cannot disagree.
    A plot key that is not a non-empty string is refused (``runtime:server-integrity``): a lane
    that cannot name its plot has nothing to evaluate."""
    if lane not in client_mod.PROFILES:
        raise ValueError(f"lane {lane!r} is not one of {client_mod.PROFILES}")
    if not isinstance(plot_key, str) or not plot_key:
        return (client_mod.INTEGRITY, "the lane named no plot, so nothing is evaluated")
    reason = _verdict(row)
    if reason:
        return (VERDICT_GUARD, reason)
    return _admission(row, lane)


def runtime_column_fn(row: Mapping[str, Any], plot_key: str, lane: str, *,
                      client_factory: Optional[Callable[[], client_mod.PineRuntimeClient]] = None,
                      cache: Optional[client_mod.RunCache] = None) -> Callable[..., List[float]]:
    """The column function for one stored runtime row and one plot, in one lane (a service
    profile: ``alert``, ``on-demand``, ``backtest``, ``sweep``, ``record``).

    ``fn(bars, params, *, tf, ticker, exchange="", history_from_listing=False)`` returns the
    plot's full column (a ``RuntimeColumn``: one float per bar, NaN for na, with ``.warmup``) or
    raises ``ServerLaneWithheld``.
    ``params`` are the script's input values (``ctx.runtimeInputs``)."""
    if lane not in client_mod.PROFILES:
        raise ValueError(f"lane {lane!r} is not one of {client_mod.PROFILES}")
    make_client = client_factory or client_mod.client_from_env

    def fn(bars: Any, params: Optional[Mapping[str, Any]], *, tf: str, ticker: str,
           exchange: str = "", history_from_listing: bool = False) -> List[float]:
        refused = admission(row, plot_key, lane)
        if refused is not None:
            raise ServerLaneWithheld(*refused)
        job = client_mod.Job(job=f"{ticker}|{tf}", ticker=ticker, exchange=exchange, tf=tf, bars=bars,
                             want=(plot_key,), runtime_inputs=dict(params or {}),
                             history_from_listing=history_from_listing)
        [res] = make_client().run(def_id=row.get("def_id"), version=row.get("version"),
                                  doc=row.get("definition"), owner_id=row.get("user_id"),
                                  profile=lane, jobs=[job], cache=cache)
        why = res.refusal_for(plot_key)
        if why is not None:
            raise ServerLaneWithheld(why.guard, why.sentence)
        return RuntimeColumn(res.columns[plot_key], res.warmup)

    fn.__name__ = f"_runtime_{plot_key}_{lane}"
    return fn
