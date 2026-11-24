"""READ ONLY: one stock's setup signals (SETH) as this server already holds them, with the universe line per setup and
phase from the study it holds.

`setup_history.get_stock()` asks MKTH for its answer (whose reader starts MKTH's own background build when that is due)
and starts the one-stock background build when nothing is held for the session; it also reads the universe study
through `get_study()`, which starts the weekly study build when that is due. A reader that must never cause that work
(the UCT Agent's `stock.setupHistory` data kind, MD-1 §4.19) reads through `held_signals()` instead: the newest answer
the service holds for the stock (whatever session it was worked out for), with the universe lines attached the way the
route attaches them (`setup_history.universe_lines`, the service's own function) from the study the service holds
(`setup_history.held_study`, read only), or nothing. It never builds, never reads a price, never asks MKTH and never
writes anything.

It lives beside the service and not inside it, so the service's own calls are unchanged. It reads the service's own
holds (`setup_history._STOCK`, a `held_reads.KeyedHeld` keyed on symbol, session and MKTH's stamp, through its
read-only `keys()` and `peek()`; the study through `held_study()`). A rail drives the service itself over invented bars
and reads its answer back through this reader.
"""
from __future__ import annotations

from typing import Optional


def held_signals(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one canonical symbol, without working anything out.

    `how` is `held` (the newest answer the service holds for the symbol: status `ok` with `universe` attached, or
    `not_held` when the service found no stored prices) or `not_held` (nothing is held for the symbol). The universe
    block is `{"state": "not_held"}` when no study is held, and the service's own `unavailable` block when the study held
    is not this library's. Never builds."""
    from api.services import setup_history as svc
    keys = [k for k in svc._STOCK.keys() if isinstance(k, tuple) and len(k) == 3 and k[0] == sym]
    answer = None
    for key in sorted(keys, key=lambda k: str(k[1]), reverse=True):        # the newest session first
        got = svc._STOCK.peek(key)
        if isinstance(got, dict) and got.get("status") in ("ok", "not_held"):
            answer = got
            break
    if answer is None:
        return None, "not_held"
    answer = {k: v for k, v in answer.items() if k != "check"}
    if answer.get("status") != "ok":
        return answer, "held"
    study = svc.held_study()
    if study is None:
        universe = {"state": "not_held"}
    elif not svc._valid_study(study):
        universe = svc.universe_lines(answer, {"status": "unavailable"})
    else:
        universe = svc.universe_lines(answer, study)
    return {**answer, "universe": universe}, "held"
