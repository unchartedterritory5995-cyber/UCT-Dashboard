"""The forward record, READ — ``GET /api/scans/definition-record``.

⭐ WHY THIS FILE EXISTS. E-6 writes the record every night
(``scan_evaluator._write_rule_record`` → ``definition_record.record_evaluations``)
and ``claim_for`` — *"the ONE function a public claim is allowed to read"* — had
tests and no consumer: measured 2026-08-25, nothing under ``api/routers/``
imported the module. The spec's Evidence tab (§5.9, A8) renders the record
beside the retro study, so this is its door. It adds NO arithmetic and NO
sentence of its own: the claim comes back as ``claim_for`` shaped it, refusal
wording included.

⛔ THE RECORD KEYS ON THE PRODUCT LABEL (``1D``); the scan surface speaks the
bars-store CODE (``D``). The map is ``ledger._BARS_STORE_TF_KEYS`` — read here,
never retyped — and a label handed in where a code belongs is refused by name.

⛔ A CLAIM PROVES A WINDOW BY CONTAINMENT IN ONE ROW PER SYMBOL (rows never
chain), and the sweep writes ONE ROW PER CLOSED MONTH plus a one-bar origin row
on first sight. So the default window is derived FROM THE RECORD: the newest
``through`` shared by the most symbols, and the ``first`` of the anchor symbol's
row that ends there — the latest closed month's common window. A brand-new
definition therefore claims its one-bar origin (*"the record begins when the
definition does"*), a claim across months refuses in the record's words, and
``?from=&to=`` lets a caller ask about any other window explicitly.

🔴 ``claim.hit_rate`` REACHES HTTP HERE FOR THE FIRST TIME, AND IT NAMES ITSELF.
It is an OCCURRENCE rate — ``bars_true / bars_evaluated``, the share of evaluated
bars on which the definition was true — not a win rate, so "never a naked hit
rate" is satisfied by what it counts rather than by a baseline beside it. The
payload says so out loud in ``hit_rate_means`` (see ``HIT_RATE_MEANS`` below),
because the Evidence tab renders this within inches of the backtest's
strategy/baseline pair and an unlabelled percentage there reads as performance.

⛔ THE E-7 CENSUS CLASSIFIES THIS HANDLER (it reads ``definition_record``), so it
carries ``Depends(limits_dependency)`` and APPLIES it: the claim's named
``unproven`` symbols pass through ``entitlements.apply_symbol_cap`` exactly as
``scan_results.py`` passes its hits. One toolkit ships today, so the cap is a
no-op in production — the MECHANISM is what the census asserts.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import ORJSONResponse as JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import definition_record, entitlements
from api.services import user_definitions as defs
from api.services.entitlements import Limits, limits_dependency
from api.services.signature import ledger

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """⛔ DEFINED HERE, NOT IMPORTED — every gating router owns its own, with its
    own 402 sentence (`tests/test_user_definitions_auth.py`)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="A definition's forward record requires a paid plan")
    return user


#: 🔴 WHAT `claim.hit_rate` COUNTS, SAID OUT LOUD, BECAUSE THIS IS WHERE THAT
#: NUMBER FIRST REACHES HTTP.
#:
#: The program's hardest rule is NEVER A NAKED HIT RATE: anything reporting
#: STRATEGY PERFORMANCE renders a baseline beside it or a named refusal. This
#: number is not that. It is `bars_true / bars_evaluated` — the share of evaluated
#: bars on which the definition was TRUE. The record holds no forward return, no
#: entry, no exit, so there is no win to rate and nothing a baseline could be a
#: baseline OF. Saying nothing would still have been wrong: the Evidence tab
#: renders this inches from the backtest's strategy/baseline pair (spec §5.9), and
#: a bare "hit rate: 29.5%" beside two win rates reads as a third win rate. So the
#: field names itself, and `test_the_hit_rate_SAYS_WHAT_IT_COUNTS_and_the_sentence_is_TRUE_of_the_store`
#: checks the sentence against the record's own columns rather than trusting it.
HIT_RATE_MEANS = (
    "the share of evaluated bars on which this definition was TRUE — an "
    "occurrence rate, not a win rate: the forward record stores whether the "
    "screen fired, never what happened next, so there is no return here and no "
    "baseline to put beside it")

#: The key handed to `claim_for` when the record holds NO rows for this
#: definition. The claim answers `NO_RECORD_YET` before it looks at the window
#: (no symbol is known), so this value is never compared against a bar; the
#: response says `window: null` rather than echoing it.
_NO_ROWS_KEY = 0


def _tf_label(tf: str) -> str:
    code = str(tf or "D").strip().upper()
    label = ledger._BARS_STORE_TF_KEYS.get(code)
    if label is None:
        raise HTTPException(
            status_code=400,
            detail=(f"`tf` {tf!r} is not a bars-store timeframe code; expected one "
                    f"of {sorted(ledger._BARS_STORE_TF_KEYS)} (the record files "
                    f"`D` under its product label `1D` itself)"))
    return label


def _session(value: Any, field: str) -> int:
    try:
        return int(ledger._normalize_bar_time(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400,
                            detail=f"`{field}`: {value!r} is not a session") from None


def common_window(def_hash: str, rev: int, tf_label: str) -> Optional[dict]:
    """The latest closed month's common window, read off the record — or
    ``None`` when the record holds nothing for this definition.

    Two batched reads, never one per symbol (E-6's own rule): the newest
    ``through`` per symbol in ONE query, then ONE row for the anchor symbol.
    """
    throughs = definition_record.latest_through_by_symbol(def_hash, rev, tf_label)
    if not throughs:
        return None
    through, at_through = Counter(throughs.values()).most_common(1)[0]
    anchor = min(s for s, t in throughs.items() if t == through)
    row = definition_record.latest_evaluation(def_hash, rev, tf_label, anchor)
    if row is None:                                            # pragma: no cover
        return None
    return {"first": int(row["first_bar_time"]), "through": int(row["through_bar_time"]),
            "anchor": anchor, "symbols_at_through": int(at_through),
            "symbols_known": len(throughs)}


@router.get("/api/scans/definition-record")
def definition_record_claim(
    def_id: str = Query(..., min_length=1, max_length=64),
    tf: str = Query("D", min_length=1, max_length=8),
    frm: Optional[str] = Query(None, alias="from", min_length=4, max_length=32),
    to: Optional[str] = Query(None, min_length=4, max_length=32),
    user: dict = Depends(require_paid),
    limits: Limits = Depends(limits_dependency),
):
    """What may honestly be said about one saved definition's forward record."""
    try:
        row = defs.get(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail=f"no definition {def_id!r} for this member")
    doc = row.get("definition") if isinstance(row.get("definition"), dict) else {}
    compute = doc.get("compute") if isinstance(doc.get("compute"), dict) else {}
    tree = compute.get("ast")
    if compute.get("kind") != "ast" or not isinstance(tree, dict) or not tree:
        raise HTTPException(status_code=400,
                            detail=f"definition {def_id!r} carries no `compute.ast` tree")
    rev = compute.get("rev")
    if isinstance(rev, bool) or not isinstance(rev, int) or rev < 0:
        raise HTTPException(
            status_code=400,
            detail=f"definition {def_id!r} carries no usable `compute.rev`, and the record is keyed on it")
    # ⭐ THE MATHS, HASHED — the same `astHash` the sweep filed the record under.
    def_hash = defs.ast_hash(tree)
    label = _tf_label(tf)

    if (frm is None) != (to is None):
        raise HTTPException(status_code=400, detail="`from` and `to` travel together")
    if frm is not None:
        window = {"first": _session(frm, "from"), "through": _session(to, "to"),
                  "anchor": None, "symbols_at_through": None, "symbols_known": None,
                  "derived": False}
    else:
        derived = common_window(def_hash, rev, label)
        window = {**derived, "derived": True} if derived else None

    first = window["first"] if window else _NO_ROWS_KEY
    through = window["through"] if window else _NO_ROWS_KEY
    claim = definition_record.claim_for(def_hash, rev, label,
                                        first_bar_time=first, through_bar_time=through)

    # 🔴 THE ENTITLEMENT, APPLIED — not merely looked up (the eight-features
    # lesson; `scan_results.py` does the same to its hits).
    symbols = dict(claim.get("symbols") or {})
    kept, withheld = entitlements.apply_symbol_cap(list(symbols.get("unproven") or []), limits)
    symbols["unproven"] = kept
    if withheld:
        symbols["unproven_withheld"] = len(withheld)
        symbols["withheld_reason"] = entitlements.SYMBOLS_WITHHELD
    claim = {**claim, "symbols": symbols}

    return JSONResponse(content={
        "def_id": def_id,
        "def_hash": def_hash,
        "rev": rev,
        "tf": str(tf).strip().upper(),
        "tf_label": label,
        "window": window,
        # ⛔ THE CLAIM, WHOLE, IN ITS OWN WORDS — refusal sentence included.
        "claim": claim,
        # 🔴 AND WHAT ITS NUMBER COUNTS, BESIDE IT AND NEVER INSIDE IT. The
        # claim comes back as `claim_for` shaped it; a key added into that dict
        # would be this route editing the record's own words. This is the route
        # speaking for itself, which is a different thing and gets its own field.
        "hit_rate_means": HIT_RATE_MEANS,
    })
