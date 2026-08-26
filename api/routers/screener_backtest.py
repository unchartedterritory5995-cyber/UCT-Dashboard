"""Screen backtesting — *"did this screen ever work?"* — on a router of its own.

Spec: ``docs/superpowers/specs/2026-08-24-screen-backtest-design.md`` §3/§4.

⭐ WHY THIS IS REACHABLE AT ALL. ``ast_interpret.interpret(tree, bars)`` returns a
value **per bar**, not one value for "now". A screen written in bar terms is
therefore already a time series of true/false and we have simply never read the
earlier entries. Verified in the code before this file was written:
``interpret``'s own contract is *"one aligned column of ``len(bars)``"*. So the
backtester is not a new evaluator — it is reading the part of the answer the
nightly sweep throws away — and the maths lives in ONE place,
``api/services/screener/backtest.py``. This file adds no arithmetic.

⛔ A NEW FILE, DELIBERATELY. ``api/routers/screener.py`` is hot, heavily railed and
carries a route-count oracle (``tests/test_scan_screener_auth.py``); adding a
compute surface to it would make every count in that file collateral damage of a
feature edit. The rail for THIS surface is ``tests/test_screener_backtest_auth.py``,
which is the same shape (route table read off ``router.routes``, count asserted,
cross-checked against an AST walk of this source) and additionally asserts that
``/api/screener/*`` is served by exactly TWO router modules — so a THIRD screener
surface cannot land ungated by landing somewhere neither rail is looking.

⛔ OFF THE REQUEST PATH, AND THE BOUNDS ARE NUMBERS RATHER THAN HOPES. The
"current" universe is the whole cap universe, and ``run_backtest`` holds every
scanned symbol's bars in memory at once — so the cost is ``symbols × bars``, that
product is CAPPED (``max_cells()``) and a request over it is refused with both
numbers quoted. A request over ``INLINE_MAX_SYMBOLS`` symbols is refused on the
request thread and told to pass ``?background=1``, which queues it on this
module's own single-worker pool and hands back a receipt id to poll — the
``status_for`` / ``request_generation`` idiom ``api/services/calendar_sector_read.py``
already uses, with the ``?background=1`` switch ``POST /api/j2/broker/sync``
already uses. ⛔ **NO NEW PROVIDER PATH**: every bar comes from ``bars_sqlite``
(local, no network) through ``bars_fetch._fmt_sqlite_bars`` — the same pairing
``api/services/barspack.py`` calls *"the SAME read"* — which is what keeps this
off the 2026-07-01 fan-out.

⛔ THE JOB ID IS A DIGEST OF THE REQUEST, NOT A UUID. Same inputs, same id, same
receipt — no RNG anywhere on this path, which is what makes "run it twice, get
the same answer" checkable instead of aspirational.

⚠️ AND THE ONE CLOCK READ IS NAMED RATHER THAN DENIED. This block used to say
"no clock ANYWHERE on this path", and a ``def_id`` body that omits ``from``/``to``
is asking for *"as of today"*: its window is derived from
``bars_fetch._expected_latest_session_yyyymmdd()`` BEFORE the digest is taken, so
two such requests agree within a session and move to a new window when the
session does — which is the answer that body asked for. Every other body reaches
the digest with a window it stated itself, and the ENGINE never reads a clock at
all (it is handed literal dates).

⛔ THIS FILE OWNS NO NUMBER THE ENGINE OWNS. ``_envelope`` REFUSES to write a key
the receipt already carries, so "the route says 812 symbols, the receipt says 806"
is impossible by construction rather than by review.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import ast_interpret, bars_fetch, bars_sqlite
from api.services import user_definitions as defs
from api.services.screener import saved_screens as scr_saved
from api.services.screener import snapshot_builder
from api.services.screener import query as scr_query
from api.services.signature import ledger

log = logging.getLogger(__name__)

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """⛔ DEFINED HERE, NOT IMPORTED FROM A SIBLING, WITH ITS OWN SENTENCE.

    The repo-wide rail is
    ``tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…``:
    every router that gates defines its own, and the 402 sentences are DISTINCT so
    "which surface locked me out" is readable off the message alone.

    ⭐ PAID, NOT ADMIN. This spends BARS — a local SQLite read of a store we
    already keep warm — not provider budget. The two admin routes on
    ``screener.py`` are admin because they spend Finviz/FMP calls; nothing here
    does, so admin would be a gate firing for a reason that is not true.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Screen backtesting requires a paid plan")
    return user


# --------------------------------------------------------------------------- #
# the bounds — every one of them a named number a refusal can quote
# --------------------------------------------------------------------------- #

#: v1 is DAILY ONLY, and that is spec §6 ("Intraday backtests" are deliberately
#: out: bars.db intraday retention differs from daily, so a 2024 intraday window
#: would silently be a much shorter window than the member asked for). A tf this
#: does not list is refused BY NAME rather than quietly coerced to "D".
SUPPORTED_TFS = ("D",)

#: The most symbols this surface will hand the engine at all. The current
#: universe is ~3.7k names; this is the ceiling, not the working size.
MAX_SYMBOLS = 4000

#: ⛔ THE REQUEST-PATH BOUND. Above this the run is refused inline and must go
#: through ``?background=1``. A saved screen returning a few dozen names still
#: answers synchronously, which is what makes the feature usable; the whole
#: universe never lands on a request thread.
INLINE_MAX_SYMBOLS = 50

#: Forward horizons: how many, and how far. 250 daily bars ≈ one year.
MAX_HORIZONS = 6
MAX_HORIZON_BARS = 250

#: A window is a real calendar range in YYYYMMDD form. Both ends inclusive.
MIN_SESSION = 19000101
MAX_SESSION = 21001231

#: How long a finished receipt stays pollable.
RECEIPT_TTL = 6 * 3600

#: ⛔⛔ THE MEMORY BOUND, AND IT IS ``symbols × bars`` BECAUSE THAT IS WHAT THE
#: ENGINE HOLDS. ``run_backtest`` appends ``(sym, bars, scan)`` for every symbol
#: it scans and keeps them ALL until the last horizon is computed, so peak
#: footprint is the whole sweep's bars at once (~300 B per bar dict). Backgrounding
#: a whole-universe sweep moves it off the request thread but NOT off the pod:
#: 3,742 symbols × 5,000 bars is ~18.7M dicts, which is an OOM, not a slow job.
#: 1.2M cells ≈ 350 MB on a box that is ONE uvicorn process also serving members.
#:
#: ⚠️ THIS DEFAULT IS REASONED, NOT MEASURED — which is exactly why it is an env
#: var and not a literal inside a handler. Measure the real peak on the pod and
#: set ``SCREEN_BACKTEST_MAX_CELLS``; ``max_cells()`` reads it at call time, so the
#: knob reaches the one stage that consumes it rather than being inert.
DEFAULT_MAX_CELLS = 1_200_000


def max_cells() -> int:
    """The sweep ceiling in ``symbols × bars``. Read at call time, never cached."""
    try:
        n = int(os.environ.get("SCREEN_BACKTEST_MAX_CELLS", DEFAULT_MAX_CELLS))
    except (TypeError, ValueError):
        return DEFAULT_MAX_CELLS
    return n if n > 0 else DEFAULT_MAX_CELLS


#: ⛔ THE PER-SYMBOL BAR CEILING, DECLARED HERE BECAUSE THIS SURFACE OWNS IT.
#: The obvious move was `scan_evaluator._MAX_BARS`, and a standing rail refuses a
#: router to import that module at all (see `_bars_reader`). It matches the chart
#: lane's own depth (`/api/bars?bars=5000`, `warm_universe(bars=5000)`) — ~20 years
#: of daily sessions, which is more history than `bars.db` holds for most names.
MAX_BARS_PER_SYMBOL = 5000

#: Calendar slack when turning a bar count into a date span: five sessions a week,
#: plus a week for holidays. Deliberately generous in ONE direction — reading a few
#: bars too many costs a row scan, reading too few silently shortens the member's
#: window, and only one of those is visible in the receipt.
_SLACK_BARS = 10
_SLACK_DAYS = 7


def padded_end(to: int, max_horizon: int) -> int:
    """The far end of the READ, as a ``YYYYMMDD`` key: the window's end pushed
    forward by the longest horizon.

    ⛔ THE READ IS BOUNDED AT BOTH ENDS, AND THIS IS THE FAR ONE.
    ``bars_sqlite.get_bars_before`` takes it, so a 2020 window reads 2020 bars
    instead of the newest N (which would be 2026 bars, and the engine would
    truthfully report that no symbol had bars in the window).

    ⭐ PADDED, BECAUSE A SIGNAL ON THE LAST DAY STILL HAS A FORWARD RETURN and
    that return is what the member asked for — not lookahead. Cutting the read at
    ``to`` would silently turn every late signal into ``no_forward_room``.
    """
    to_d = datetime.date(to // 10_000, (to // 100) % 100, to % 100)
    end = to_d + datetime.timedelta(days=(max(0, max_horizon) * 7) // 5 + _SLACK_DAYS)
    return end.year * 10_000 + end.month * 100 + end.day


def bars_wanted(frm: int, to: int, warmup: int, max_horizon: int) -> int:
    """How many bars per symbol this window actually needs.

    ⛔ THE SWEEP IS SIZED BY THE REQUEST, NOT BY THE STORE'S CEILING. Reading
    ``MAX_BARS_PER_SYMBOL`` for every symbol regardless of window is what
    turns "backtest my 40-name screen over 2024" into a 200,000-bar read; the cap
    still applies as the ceiling, but it is no longer the default.

    ⭐ ``warmup`` IS THE TREE'S OWN DECLARATION (``ast_interpret.max_lookback``) —
    the same number the engine charges against the window, the budget guard reads
    and the repaint linter reads. Deriving it here rather than padding by a guess
    is what stops the slice and the warmup disagreeing.

    ⭐ AND THE FORWARD ROOM IS PART OF THE SIZE, NOT AN AFTERTHOUGHT. A signal on
    the window's last day resolves ``max_horizon`` bars LATER; that is the forward
    return the member asked for, not lookahead. Sizing to the window alone turns
    every late signal into ``no_forward_room``.

    ⚠️ It is an over-estimate on purpose (5/7 of calendar days, plus slack at both
    ends). ``get_bars`` returns the NEWEST ``want`` rows, so under-reading drops
    the OLD end of the window — the half the member is asking about.
    """
    frm_d = datetime.date(frm // 10_000, (frm // 100) % 100, frm % 100)
    to_d = datetime.date(to // 10_000, (to // 100) % 100, to % 100)
    forward = datetime.timedelta(days=(max(0, max_horizon) * 7) // 5 + _SLACK_DAYS)
    span_days = ((to_d + forward) - frm_d).days + 1
    span_bars = max(0, span_days) * 5 // 7 + _SLACK_BARS
    want = span_bars + max(0, warmup) + _SLACK_BARS
    return max(1, min(want, MAX_BARS_PER_SYMBOL))


#: The derived-window search space, in calendar days. The floor is the smallest
#: window worth replaying.
#:
#: ⛔⛔ THE CEILING IS AN INDEPENDENT BOUND, NOT A REDUNDANT ONE, WHICH IS WHY IT
#: IS DISCLOSED (``window_request.max_days``). This comment used to defend it as
#: harmless — *"past which MAX_BARS_PER_SYMBOL caps the read anyway"* — and that
#: is MEASURED FALSE: at 3,650 days with ``sma(close, 3)`` and a 20-bar horizon a
#: symbol reads **2,655** bars against a clamp of **5,000**, and the clamp does
#: not begin to bind until **6,932 days (19.0 years)**. So raising this ceiling
#: really would widen every derived window, and below roughly 450 symbols
#: (451 at that warmup, 444 at a 50-bar one) it — not
#: ``SCREEN_BACKTEST_MAX_CELLS`` — is the bound that decides the window. A
#: ``window_request`` naming only the cap told those members the wrong reason.
MIN_DERIVED_WINDOW_DAYS = 30
MAX_DERIVED_WINDOW_DAYS = 3650


def _as_date(session: int) -> datetime.date:
    """``20240628`` → ``date(2024, 6, 28)``."""
    return datetime.date(session // 10_000, (session // 100) % 100, session % 100)


def _session_back(end: int, days: int) -> int:
    d = _as_date(end) - datetime.timedelta(days=days)
    return d.year * 10_000 + d.month * 100 + d.day


def fit_window_start(end: int, symbols: int, warmup: int, max_horizon: int,
                     cap: int) -> Optional[int]:
    """The earliest ``from`` (YYYYMMDD) whose read fits ``cap`` — or ``None``
    when even the floor window does not.

    ⛔ SIZED BY THE SAME ``bars_wanted`` THE REQUEST IS CHARGED AGAINST, so a
    window derived here can never be refused by the ceiling it was fitted to. A
    binary search over calendar days: ``bars_wanted`` is monotone in the span.

    ⚠️ ``cap`` IS ONE OF **TWO** BOUNDS. The span is also capped at
    ``MAX_DERIVED_WINDOW_DAYS``, and for a universe of a few hundred symbols that
    is the one that binds — ``window_bound`` says which, and the payload names
    both, because "we picked the widest window your memory ceiling allows" is a
    false sentence for exactly the narrow saved screen this surface serves best.
    """
    def fits(days: int) -> bool:
        return symbols * bars_wanted(_session_back(end, days), end,
                                     warmup, max_horizon) <= cap

    lo, hi = MIN_DERIVED_WINDOW_DAYS, MAX_DERIVED_WINDOW_DAYS
    if not fits(lo):
        return None
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fits(mid):
            lo = mid
        else:
            hi = mid - 1
    return _session_back(end, lo)


def window_bound(start: int, end: int) -> str:
    """``"cap"`` or ``"max_days"`` — which bound actually decided a DERIVED window.

    ⭐ READ OFF THE WINDOW THAT CAME BACK, not off the search that produced it: a
    span that reached the day ceiling is one the search never had to shrink for
    memory, so the ceiling is what stopped it. Deriving it here rather than
    returning a second value from ``fit_window_start`` keeps that function's
    contract (a ``from``, or ``None``) intact and keeps one answer to "how wide".
    """
    span = (_as_date(end) - _as_date(start)).days
    return "max_days" if span >= MAX_DERIVED_WINDOW_DAYS else "cap"


#: ⛔ ONE WORKER. Two concurrent whole-universe sweeps would double this single
#: pod's SQLite read pressure for no member benefit; a second request for the
#: same job dedupes onto the first, and a different job queues behind it.
_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="screen-backtest")
_INFLIGHT: set[str] = set()
_INFLIGHT_GUARD = threading.Lock()


def _cache():
    from api.services.cache import cache
    return cache


def _receipt_key(job: str) -> str:
    return f"screen_backtest::{job}"


# --------------------------------------------------------------------------- #
# the request
# --------------------------------------------------------------------------- #

class BacktestRequest(BaseModel):
    """``{ast | def_id, universe, from, to, horizons, tf}``.

    ⚠️ ``from`` IS THE WIRE NAME. The spec's payload says ``from``, which is a
    Python keyword, so it is ALIASED rather than renamed — a member-facing body
    that quietly wants ``from_`` would be a second vocabulary for one field.
    ``populate_by_name`` keeps ``from_`` working too so a caller written against
    the Python attribute is not silently ignored.

    ``source`` is accepted so its refusal can NAME the reason rather than the
    field the spec advertises 422-ing as unknown — see ``_tree_of``.
    """
    ast: dict | None = None
    source: str | None = None
    universe: Any = "current"
    # ⚠️ `Annotated[...]` IS THE DOCUMENTED FORM, and it is NOT a fix for the
    # `UnsupportedFieldAttributeWarning` this raises — MEASURED: pydantic 2.12 emits
    # it from FastAPI's OpenAPI schema pass for BOTH spellings, typed or `Any`. The
    # ALIAS ITSELF WORKS, which is a behavioural claim and therefore has a test
    # (`test_the_wire_name_is_from_and_the_python_name_also_binds`) rather than a
    # comment. Saying "Annotated silences it" here would have been a comment that
    # is simply false, beside code that disproves it.
    from_: Annotated[Any, Field(alias="from")] = None
    to: Any = None
    #: ⛔ NO DEFAULT LIST HERE. ``(5, 10, 20)`` is the ENGINE's
    #: ``backtest.DEFAULT_HORIZONS``, and a second copy in this model would drift
    #: the day either moves — the receipt's ``method.horizons`` would then disagree
    #: with the door that asked for them. ``None`` means "the engine's default",
    #: resolved once in ``_horizons``.
    #:
    #: ⚠️ ``list[Any]`` ON PURPOSE. Typed ``list[int]``, pydantic answers 422 naming
    #: a field; ``_horizons`` answers 400 naming the bound that was crossed, which
    #: is the difference between "invalid" and "here is the ceiling".
    horizons: list[Any] | None = None
    tf: str = "D"
    #: A member's OWN saved definition, replayed by id. Mutually exclusive with
    #: `ast`: two trees for one backtest are two authorities over which screen is
    #: being replayed. The tree is `compute.ast` — the scan tree by the v2
    #: document contract — read through the same member-scoped store door
    #: `GET /api/user-definitions/{def_id}` answers through.
    def_id: str | None = None

    model_config = {"populate_by_name": True}


def _definition_tree(def_id: str, user_id: Any) -> tuple[dict, dict]:
    """``(tree, provenance)`` for a member's OWN definition.

    ⛔ SCOPED TO THE MEMBER AT THE STORE (`user_definitions.get(user_id, def_id)`)
    so another member's id is a 404, not a leak. ⭐ `compute.ast` IS THE SCAN
    TREE by the v2 document contract (the plot `scanPlot` names; single-tree
    documents unchanged) — reading `compute.trees` here would put a second
    opinion on "which tree is the scan" beside the one the sweep uses.
    """
    try:
        row = defs.get(user_id, def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404,
                            detail=f"no definition {def_id!r} for this member")
    doc = row.get("definition") if isinstance(row.get("definition"), dict) else {}
    compute = doc.get("compute") if isinstance(doc.get("compute"), dict) else {}
    tree = compute.get("ast")
    if compute.get("kind") != "ast" or not isinstance(tree, dict) or not tree:
        raise HTTPException(
            status_code=400,
            detail=f"definition {def_id!r} carries no `compute.ast` tree to replay")
    # ⚠️⚠️ TWO SOURCES, ON PURPOSE, BECAUSE THERE ARE TWO `rev` NUMBERS IN THIS
    # SYSTEM AND THEY DIVERGE. `version` is the STORE's (one per saved version,
    # the row). `rev` is the BLOB's `compute.rev` — the number
    # `scan_evaluator.evaluate_one` reads (`rev = compute.get("rev")`) and writes
    # into the E-6 rule record, which is the thing this receipt is rendered
    # BESIDE. The row's own `rev` column is a different number: it moves when
    # `ast_hash` moves, while `compute.rev` sat at 1 for every stored blob until
    # `PUT /api/user-definitions/{def_id}` gained a product caller. Reading both
    # from the row would look tidier and would silently stop matching the record.
    return tree, {"def_id": def_id, "version": row.get("version"),
                  "rev": compute.get("rev")}


def _tree_of(body: BacktestRequest, user_id: Any = None) -> tuple[dict, dict]:
    """``(tree, provenance)`` — the canonical tree, or a 400 that says which half
    is missing. ``provenance`` is ``{}`` for an ``ast`` body.

    ⛔ ``source`` IS REFUSED BY NAME, NOT IGNORED. There is no server-side parser
    in this repo: ``canonicalise`` lives in
    ``app/src/components/chart/engine/ast/parse.js`` and the only Python bridge to
    it (``tools/ast_conformance.run_js``) spawns a node process — a per-request
    subprocess is precisely the fan-out this surface exists to avoid. So the
    browser lane parses and this door takes the tree. Accepting ``source`` and
    silently doing nothing with it is the shape that ships a field nobody serves.
    """
    if body.def_id:
        if isinstance(body.ast, dict) and body.ast:
            raise HTTPException(
                status_code=400,
                detail=("send `def_id` OR `ast`, not both — two trees for one "
                        "backtest are two authorities over which screen is replayed"))
        return _definition_tree(body.def_id, user_id)
    if isinstance(body.ast, dict) and body.ast:
        return body.ast, {}
    if body.source:
        raise HTTPException(
            status_code=400,
            detail=("this endpoint takes a canonical tree, not formula text: "
                    "the parser is the browser lane (engine/ast/parse.js), and "
                    "running node per request is the fan-out this surface is "
                    "bounded to avoid. Send `ast`."))
    raise HTTPException(status_code=400,
                        detail="a backtest needs an `ast` (or a `def_id`) — the screen to replay")


def _hash_of(tree: dict) -> Optional[str]:
    """``astHash`` of the tree the engine is about to RUN — the maths, not a
    stored field. ``None`` when a hand-posted ``ast`` is not canonical (the
    store never hands one back that is not), stated rather than guessed."""
    try:
        return defs.ast_hash(tree)
    except (ValueError, TypeError):
        return None


def _session(value: Any, field: str) -> int:
    """One end of the window, as the YYYYMMDD session key the whole lane uses.

    ⛔ NORMALISED BY ``ledger._normalize_bar_time``, THE LANE'S ONE NORMALISER —
    the same function ``scan_evaluator._last_confirmed_index`` keys bars by, so a
    window boundary and a bar can never disagree about what day they name. A
    second date parser here is how "2024-01-01" and 20240101 become two sessions.
    """
    if value is None:
        raise HTTPException(status_code=400,
                            detail=f"a backtest needs `{field}` — the window is not inferred")
    try:
        key = int(ledger._normalize_bar_time(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400,
                            detail=f"`{field}`: {value!r} is not a date") from None
    if not (MIN_SESSION <= key <= MAX_SESSION):
        raise HTTPException(
            status_code=400,
            detail=(f"`{field}`: {value!r} is not a YYYYMMDD date between "
                    f"{MIN_SESSION} and {MAX_SESSION}"))
    try:
        datetime.date(key // 10_000, (key // 100) % 100, key % 100)
    except ValueError:
        raise HTTPException(status_code=400,
                            detail=f"`{field}`: {value!r} is not a real calendar date") from None
    return key


def _horizons(raw: Any) -> list[int]:
    """The forward horizons, validated.

    ⛔ THE DEFAULT IS READ OFF THE ENGINE, NEVER RETYPED. ``backtest`` owns
    ``DEFAULT_HORIZONS`` and states it in the receipt's ``method`` block; a copy
    here would be a second authority over one value, which is this repo's most
    repeated defect.
    """
    if raw is None:
        return list(_engine().DEFAULT_HORIZONS)
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=400, detail="`horizons` must be a non-empty list of bar counts")
    if len(raw) > MAX_HORIZONS:
        raise HTTPException(status_code=400,
                            detail=f"at most {MAX_HORIZONS} horizons; got {len(raw)}")
    out: list[int] = []
    for h in raw:
        if isinstance(h, bool) or not isinstance(h, int):
            raise HTTPException(status_code=400, detail=f"`horizons`: {h!r} is not a bar count")
        if not (1 <= h <= MAX_HORIZON_BARS):
            raise HTTPException(
                status_code=400,
                detail=f"`horizons`: {h} is outside 1..{MAX_HORIZON_BARS} bars")
        out.append(h)
    # Stable, deduped, ascending — so two spellings of the same request digest
    # to the same job id.
    return sorted(set(out))


def _tf(raw: Any) -> str:
    tf = str(raw or "D").strip().upper()
    if tf not in SUPPORTED_TFS:
        raise HTTPException(
            status_code=400,
            detail=(f"backtesting is daily-only in v1 (got {tf!r}). Intraday is "
                    "deliberately out of scope: bars.db intraday retention "
                    "differs from daily, so the window you asked for is not the "
                    "window you would get."))
    return tf


# --------------------------------------------------------------------------- #
# the universe — CURRENT membership, and the payload has to say so
# --------------------------------------------------------------------------- #

#: ⛔⛔ THE SURVIVORSHIP CAVEAT IS **NOT** WRITTEN HERE, AND THAT IS THE POINT.
#: Spec §3 rule 4 says it must be stated in the payload and rendered beside the
#: result — and it IS: ``Receipt.universe`` is a REQUIRED field on the engine's
#: dataclass carrying ``membership``, ``symbols_requested``, ``survivorship_bias``
#: and the sentence itself, so a receipt cannot be built without it.
#:
#: A second, kinder wording of the same caveat lived here for one draft. It read
#: like diligence and it was the defect: two sentences at two addresses, one of
#: which a later edit softens while the other still says the hard thing. DERIVE,
#: NEVER RESTATE — so what this route contributes below is only what the engine
#: cannot know: which door built the list, and whether the screen matched more
#: names than one page holds.
#:
#: Rail: ``test_the_route_writes_no_SECOND_survivorship_caveat``.


def _universe_for(spec: Any, user_id: Any) -> tuple[list[str], dict]:
    """``(symbols, provenance)`` — the symbol list, and WHICH DOOR BUILT IT.

    ⚠️ PROVENANCE ONLY. "how many symbols", "which membership" and the
    survivorship caveat are all the RECEIPT's (see the block above), so none of
    them appears here. What is left is the half the engine genuinely cannot know:
    ``kind`` (the whole universe or a saved screen), the screen's id and name, how
    many rows the screen actually matched, and whether that exceeded what one page
    could hand over.

    ⛔ ``truncated`` IS THE HONEST-NONE HALF. A universe silently cut to its first
    page returns fewer signals and reads as a screen that rarely fires — the
    absence has to be visible, not inferred from a smaller number.
    """
    if spec is None or (isinstance(spec, str) and spec.strip().lower() in ("", "current")):
        syms = [str(s).strip().upper() for s in (snapshot_builder._load_universe() or [])
                if str(s).strip()]
        syms = sorted(set(syms))
        if not syms:
            # ⛔ NOT an empty backtest. An empty universe produces an empty result
            # that is indistinguishable from a screen that never fired.
            raise HTTPException(
                status_code=503,
                detail="the screener universe is empty on this box — nothing to backtest")
        return syms[:MAX_SYMBOLS], {
            "kind": "current",
            "matched": len(syms),
            "truncated": len(syms) > MAX_SYMBOLS,
        }

    try:
        sid = int(spec)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail=f"`universe` is \"current\" or a saved screen id; got {spec!r}") from None

    screen = scr_saved.get(sid, user_id)
    if not screen:
        raise HTTPException(status_code=404, detail=f"no saved screen {sid} for this member")

    # ⛔ THE PAGE SIZE IS READ BACK OFF THE PLAN, NOT TYPED. `build_scan_sql`
    # clamps to its own `_MAX_PAGE`; asking for more and reporting what came back
    # keeps that cap in ONE place. Truncation is DISCLOSED — a universe silently
    # cut to its first page returns fewer signals and looks like a screen that
    # rarely fires.
    screen_spec = dict(screen.get("spec") or {})
    screen_spec.update({"page": 1, "page_size": MAX_SYMBOLS})
    result = scr_query.run_scan(screen_spec) or {}
    rows = result.get("rows") or []
    syms = sorted({str(r.get("ticker")).strip().upper() for r in rows
                   if isinstance(r, dict) and r.get("ticker")})
    if not syms:
        raise HTTPException(
            status_code=400,
            detail=(f"saved screen {sid} matches nothing today, so there is no "
                    "universe to replay it over"))
    total = result.get("total")
    return syms[:MAX_SYMBOLS], {
        "kind": "saved-screen",
        "screen_id": sid,
        "screen_name": screen.get("name"),
        "matched": total,
        "truncated": bool(isinstance(total, int) and total > len(syms[:MAX_SYMBOLS])),
    }


# --------------------------------------------------------------------------- #
# the bars — bars_sqlite + the serve-time formatter, bounded at BOTH ends
# --------------------------------------------------------------------------- #

def _bars_reader(tf: str, to_key: int):
    """``read_bars(sym, want) -> [{'t': 'YYYY-MM-DD', 'o','h','l','c','v'}, …]``.

    ⛔⛔ ``bars_sqlite`` DIRECTLY, AND **NOT** ``scan_evaluator._read_bars``. That
    was the first draft and a STANDING RAIL refused it:
    ``tests/test_scan_evaluator_off_request_path.py::test_the_evaluator_module_is
    _not_imported_by_any_ROUTER_at_all`` — *"api/routers/ is the request path; the
    sweep has no business in its namespace even unused."* The rail caught it, the
    rail was right, and it was NOT weakened to fit this file. ``bars_sqlite`` is
    what the spec names as the reader anyway, and this is the same pairing
    ``api/services/barspack.py`` calls *"the SAME read"*.

    ⭐ ``_fmt_sqlite_bars`` IS LOAD-BEARING, TWICE OVER.
      * It is the ONE serve-time chokepoint that turns the store's ``YYYYMMDD``
        int into the ``"YYYY-MM-DD"`` string every daily consumer reads — and
        ``backtest.bar_date`` is the single owner of "what date is this bar" and
        answers to nothing else. Handed raw rows, the engine refuses
        ``non_daily_bars`` for the WHOLE universe: a correct refusal about
        something the member never asked for.
      * It also drops null / non-positive-price bars and runs
        ``bars_sanitize.sanitize_daily_bars`` — recycled-ticker pre-listing
        history, provider split-adjustment gaps, lone bad-print wicks.
        Backtesting unsanitised rows is how a split artefact becomes a 300%
        "signal", and a backtest is the one surface where nobody eyeballs the
        candle before believing the number.

    ⭐ ``get_bars_before``, NOT ``get_bars``. ``get_bars`` returns the NEWEST
    ``want`` rows, so a 2020 window sized to 2020's length would come back full of
    2026 bars and the engine would truthfully report that no symbol had bars in
    the window. The far end is the window's end PADDED BY THE LONGEST HORIZON
    (``padded_end``) — a signal on the last day resolves after the window, and
    that forward return is what was asked for, not lookahead.
    """
    def read_bars(sym: str, want: int) -> list:
        n = max(1, min(int(want), MAX_BARS_PER_SYMBOL))
        try:
            rows = bars_sqlite.get_bars_before(sym, tf, n, to_key) or []
        except Exception as exc:                                  # noqa: BLE001
            # ⛔ ONE SYMBOL'S READ FAILING IS "NOT TESTED", NOT A DEAD REQUEST.
            # `bars_sqlite` RAISES when the store has no `ohlcv` table — a fresh
            # pod before the prewarm, a restored volume, a sandbox — so an
            # unguarded read turns the ENTIRE backtest surface into a 500 that
            # says nothing about bars. Returning empty hands the engine the state
            # it already models: the symbol lands in
            # `coverage.symbols_missing_bars` and the member is told how many
            # names could not be tested.
            #
            # ⭐ THIS IS HONEST-NONE, NOT A SWALLOWED ERROR. The absence is
            # COUNTED and reported in the receipt rather than dropped silently
            # into or out of the denominator — which is the whole reason coverage
            # travels with the result.
            log.warning("[screen-backtest] bars read failed for %s/%s: %s", sym, tf, exc)
            return []
        return bars_fetch._fmt_sqlite_bars(rows, tf, sym)
    return read_bars


#: What this route hands the engine, as the engine's ``bars_source`` LABEL.
#: ⛔ A STRING, BECAUSE `Receipt.bars_source` IS ONE, AND IT IS THE ONLY COPY.
#: The receipt is the single writer of "where did these bars come from"; the
#: route feeds it and then keeps quiet, rather than publishing a second
#: description of the same fact beside it (`_envelope` would refuse, and it is
#: right to — this is the collision it exists to catch).
_BARS_STORE = "bars.db"
_BARS_READER = "bars_sqlite.get_bars_before -> bars_fetch._fmt_sqlite_bars"


def _bars_source_label(tf: str = "D", want: int | None = None,
                       to_key: int | None = None) -> str:
    n = MAX_BARS_PER_SYMBOL if want is None else want
    end = "" if to_key is None else f", to={to_key}"
    return f"{_BARS_STORE} via {_BARS_READER} (tf={tf}, bars={n}{end})"


# --------------------------------------------------------------------------- #
# the engine — ONE point of contact, and no arithmetic on this side of it
# --------------------------------------------------------------------------- #

def _engine():
    """Imported lazily so this router mounts even while the engine is in flight,
    and so the contract test can name exactly one import site."""
    from api.services.screener import backtest as engine
    return engine


def _iso(session: int) -> str:
    """``20240131`` → ``"2024-01-31"``.

    ⛔ THE TWO HALVES SPELL A DATE DIFFERENTLY, AND THIS IS THE ONE PLACE THAT
    KNOWS IT. This router keys windows by the lane's ``YYYYMMDD`` session int
    (``ledger._normalize_bar_time``, so a boundary and a bar can never disagree);
    the engine's window is ``YYYY-MM-DD`` text and it REFUSES anything else
    (``backtest._DATE``). Handing the int straight over returned ``bad_date`` —
    a refusal about the member's request that the member never made.
    """
    return f"{session // 10_000:04d}-{(session // 100) % 100:02d}-{session % 100:02d}"


def _run_engine(tree: dict, symbols: list[str], *, start: int, end: int,
                horizons: list[int], read_bars, want: int, to_key: int,
                tf: str = "D") -> dict:
    """The ONLY call into ``api/services/screener/backtest.py``.

    ⛔ Nothing is post-processed. Whatever receipt the engine returns — including
    ``{backtestable: false, refused: …}``, which is an ANSWER and not an error — is
    what the member gets, with only this route's own keys added beside it.

    ⭐ THIS FUNCTION IS THE SEAM, AND IT IS WHERE THE TWO HALVES ARE MADE TO AGREE.
    The engine's contract is ``run_backtest(tree, symbols, frm, to, *, bars_for,
    horizons, …) -> Receipt``: a positional ``YYYY-MM-DD`` window, a
    ``bars_for(sym)`` reader of ONE argument, and a frozen dataclass out. This
    router speaks session ints and a ``read_bars(sym, want)`` of two. Every one of
    those three mismatches is adapted HERE rather than by moving either side, so
    the engine stays pure and the route keeps its own vocabulary.

    ⚠️ ``want`` is the reader's second argument and the engine does not supply
    one — it asks for a symbol's bars, full stop. So the SIZE of the read is the
    caller's decision, and it comes from ``bars_wanted``: the window, plus the
    tree's own declared warmup, plus forward room for the longest horizon, capped
    by ``MAX_BARS_PER_SYMBOL``. Passing the cap itself for every
    request — which is what this did first — reads twenty years of history to
    answer a question about one, and the engine holds all of it at once.
    """
    engine = _engine()
    receipt = engine.run_backtest(
        tree, symbols, _iso(start), _iso(end),
        bars_for=lambda sym: read_bars(sym, want),
        horizons=horizons,
        bars_source=_bars_source_label(tf, want, to_key))
    # ⛔ `.to_dict()` AND NOT `dataclasses.asdict`. The receipt decides which keys
    # a refusal carries and which an answer carries (`forward_returns`/`baseline`
    # only when `backtestable`), and `asdict` would flatten that decision into
    # every key always — publishing empty answer fields beside a refusal.
    return receipt.to_dict()


# --------------------------------------------------------------------------- #
# the envelope — one writer per value, enforced
# --------------------------------------------------------------------------- #

class EnvelopeCollision(RuntimeError):
    """The route tried to write a key the engine already wrote."""


def _envelope(receipt: dict, extras: dict) -> dict:
    """``receipt`` verbatim + ``extras``, REFUSING any key that appears in both.

    🔴 THIS IS THE "one writer per value" RULE AS CODE. A route that quietly
    overwrote ``symbols_tested`` with its own count would publish a number the
    engine did not compute, beside numbers it did — the exact drift this repo
    keeps rediscovering (the writer index's FOUR, the COT router's "4 routes").
    Colliding is a bug in THIS file, so it raises rather than picking a winner.
    """
    if not isinstance(receipt, dict):
        raise EnvelopeCollision(
            f"the engine returned {type(receipt).__name__}, not a receipt")
    clash = sorted(set(receipt) & set(extras))
    if clash:
        raise EnvelopeCollision(
            f"the route tried to restate {clash} — those belong to the engine's "
            "receipt, and two authorities over one value is the defect this "
            "guard exists to make impossible")
    out = dict(receipt)
    out.update(extras)
    return out


# --------------------------------------------------------------------------- #
# the job id — a digest of the request, so the receipt is reproducible
# --------------------------------------------------------------------------- #

def job_id(tree: Any, symbols: list[str], tf: str, start: int, end: int,
           horizons: list[int]) -> str:
    """Deterministic id for one backtest. No clock, no RNG, no counter.

    Same inputs → same id → the poll finds the receipt that was already computed,
    and "run it twice, get the same answer" is checkable rather than promised.
    """
    payload = json.dumps(
        {"ast": tree, "symbols": list(symbols), "tf": tf,
         "from": start, "to": end, "horizons": list(horizons)},
        sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _stored(job: str) -> Optional[dict]:
    hit = _cache().get(_receipt_key(job))
    return hit if isinstance(hit, dict) else None


def status_for(job: str) -> dict:
    """The poll's view of one job.

    ⛔ FOUR STATES, AND ``unknown`` IS ONE OF THEM. A job id nobody has heard of
    must NOT read as "running" — a poll that never resolves is how a dead job
    looks exactly like a slow one (``lesson_a_warm_pass_that_persists_nothing_
    reads_as_healthy``). The in-flight set outranks the cache, so an evicted
    receipt for a job still on the pool still reads ``running``.
    """
    with _INFLIGHT_GUARD:
        running = job in _INFLIGHT
    if running:
        return {"job": job, "status": "running"}
    stored = _stored(job)
    if stored is not None:
        return stored
    return {"job": job, "status": "unknown"}


def _record(job: str, payload: dict) -> None:
    _cache().set(_receipt_key(job), payload, RECEIPT_TTL)


def _submit(job: str, run) -> dict:
    """Queue ``run`` under ``job``, deduped. Returns the caller's receipt."""
    stored = _stored(job)
    if stored is not None:
        return stored
    with _INFLIGHT_GUARD:
        if job in _INFLIGHT:
            return {"job": job, "status": "running"}
        _INFLIGHT.add(job)

    def _work():
        try:
            _record(job, run())
        except Exception as exc:                                  # noqa: BLE001
            # ⛔ RECORDED, NEVER SWALLOWED. A failed job that leaves nothing behind
            # polls as `unknown` forever, which reads as "you asked for something
            # that does not exist" instead of "it broke".
            log.warning("[screen-backtest] job %s failed: %s", job, exc)
            _record(job, {"job": job, "status": "error",
                          "detail": f"{type(exc).__name__}: {exc}"[:300]})
        finally:
            with _INFLIGHT_GUARD:
                _INFLIGHT.discard(job)

    _POOL.submit(_work)
    return {"job": job, "status": "running"}


# --------------------------------------------------------------------------- #
# the routes
# --------------------------------------------------------------------------- #

@router.post("/api/screener/backtest")
def run_screen_backtest(body: BacktestRequest,
                        background: bool = False,
                        user: dict = Depends(require_paid)):
    """Replay a bar-expressible screen over a window and report what it did.

    ``?background=1`` queues the run and returns ``{job, status:"running"}``; poll
    ``GET /api/screener/backtest/{job}``. Without it the run happens inline and is
    REFUSED above ``INLINE_MAX_SYMBOLS`` symbols rather than tying up a request
    thread with a whole-universe sweep.

    A screen that reads a declared scalar comes back ``200`` with
    ``{backtestable: false, refused: "scalar_no_history", names: [...]}`` — a
    refusal is an ANSWER about what we hold, not an error.

    ``def_id`` replays the member's OWN saved definition instead of a posted
    ``ast`` (never both), and MAY omit ``from``/``to``: the window is then the
    widest one BOTH bounds allow — the memory ceiling and the ~10-year span cap —
    with ``window_request`` naming both and saying which one bound.

    ``def_hash`` — the hash of the tree that RAN — rides on every answer THIS
    route gives, including the ``?background=1`` acknowledgement and every
    refusal. ⚠️ It is NOT on a ``running``/``unknown`` poll of
    ``GET /api/screener/backtest/{job}``: a job id is a digest of the request and
    carries no tree, so there is nothing there to derive it from. Poll answers
    have it once they are ``ready``.
    """
    tree, definition = _tree_of(body, user.get("id"))
    tf = _tf(body.tf)

    # ⛔⛔ THE WINDOW THE MEMBER TYPED IS PARSED **HERE**, BEFORE THE UNIVERSE IS
    # BUILT — where it was before this door learned to derive one. Only a body
    # that states no window at all waits, because deriving one needs the symbol
    # count. Moving the whole block below `_universe_for` changed which refusal a
    # body with two defects gets: a mistyped `from` beside a saved-screen id
    # answered a 404, and on a box with an empty snapshot it answered 503. The
    # shipped refusal parametrisation could not see it — every fixture there
    # carries exactly one defect — so the rail that CAN lives in
    # `tests/test_screener_backtest_def_id.py`.
    derived = bool(definition) and body.from_ is None and body.to is None
    start = end = 0
    if not derived:
        start = _session(body.from_, "from")
        end = _session(body.to, "to")
        if start > end:
            raise HTTPException(status_code=400,
                                detail=f"`from` {start} is after `to` {end}")

    horizons = _horizons(body.horizons)

    # ⛔ THE TREE IS RESOLVED ONCE, AT THE DOOR. `max_lookback` walks every call on
    # its way to a number, so a tree naming a function the table does not declare
    # refuses HERE — once, loudly — instead of 3,742 times inside the sweep. That
    # is the argument `scan_evaluator` makes for the same call in the same place,
    # and the number it returns is what sizes the read below.
    try:
        warmup = ast_interpret.max_lookback(tree)
    except ast_interpret.TableRefusal as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    symbols, universe = _universe_for(body.universe, user.get("id"))

    # ⛔ THE CEILING IS READ ONCE PER REQUEST, and it is the SAME number the
    # derived window is fitted to and the sweep is charged against. Two reads
    # would let a window fitted to one ceiling be refused by another.
    cap = max_cells()

    # ── the derived window: the widest one BOTH bounds allow ──────────────── #
    # ⭐ A `def_id` body may omit the window, and then it is DERIVED from the same
    # bounds that would otherwise refuse it, ending at the lane's own latest
    # session. It is STATED in `window_request` and the engine echoes the dates it
    # actually compared bars against in `window`.
    window_request: Optional[dict] = None
    if derived:
        # ⛔ THE DERIVED END GOES THROUGH THE SAME VALIDATOR THE MEMBER'S `to`
        # DOES. It is our own fact, not theirs, but "is this a session key" has
        # one owner — and an unvalidated int from a helper would have raised
        # somewhere downstream as a 500 instead of refusing by name.
        end = _session(bars_fetch._expected_latest_session_yyyymmdd(),
                       "to (derived from the latest session)")
        start = fit_window_start(end, len(symbols), warmup, max(horizons), cap)
        if start is None:
            raise HTTPException(
                status_code=400,
                detail=(f"even a {MIN_DERIVED_WINDOW_DAYS}-day window over "
                        f"{len(symbols):,} symbols exceeds the memory ceiling of "
                        f"{cap:,} bars. Narrow the universe."))
        window_request = {
            "derived": True,
            # ⛔ BOTH BOUNDS, AND WHICH ONE BOUND. This sentence named only the
            # cap for one round, and it was FALSE for the case this surface serves
            # best: under ~450 symbols the cap is nowhere near binding (a 20-name
            # screen used 4% of it) and the span is decided by the day ceiling —
            # so the member was told the wrong reason beside a number that would
            # not have moved the window by a day if it were raised 100×.
            "rule": ("the widest window under BOTH bounds: symbols x bars must "
                     "fit SCREEN_BACKTEST_MAX_CELLS, and the span itself is "
                     "capped at MAX_DERIVED_WINDOW_DAYS calendar days"),
            "bound": window_bound(start, end),
            "cap": cap,
            "max_days": MAX_DERIVED_WINDOW_DAYS,
        }

    want = bars_wanted(start, end, warmup, max(horizons))
    to_key = padded_end(end, max(horizons))

    # ⛔⛔ THE SWEEP IS BOUNDED BEFORE IT IS QUEUED, NOT AFTER IT OOMs. Backgrounding
    # moves the work off the request thread; it does not make it free. The engine
    # holds every scanned symbol's bars at once, so `symbols × bars` is the number
    # that matters and it is refused with BOTH LEVERS NAMED — never silently
    # truncated to a smaller universe, which would publish a win rate for a screen
    # the member did not ask about.
    cells = len(symbols) * want
    if cells > cap:
        raise HTTPException(
            status_code=400,
            detail=(f"this backtest would hold {cells:,} bars in memory "
                    f"({len(symbols):,} symbols x {want:,} bars) and the ceiling "
                    f"is {cap:,}. Narrow the universe or shorten the window."))

    job = job_id(tree, symbols, tf, start, end, horizons)

    # ⛔ `universe_request`, NOT `universe`, AND NO `bars_source` AT ALL.
    # The engine's receipt already writes both: `Receipt.universe` is a REQUIRED
    # field carrying the survivorship statement, and `Receipt.bars_source` is the
    # label this route hands IN. What `_universe_for` returns is a DIFFERENT fact
    # — which door built the symbol list, and whether the screen matched more names
    # than one page holds — so it gets a key of its own. Reusing the engine's names
    # made `_envelope` raise `EnvelopeCollision`, which was that guard working
    # exactly as designed: two writers had reached for one value.

    # ⭐ THE REQUEST-FACTS, KEPT TOGETHER BECAUSE THEY RIDE ON TWO ANSWERS. They
    # go into the receipt envelope below AND onto the queued acknowledgement a
    # `?background=1` POST returns — which is the FIRST answer the Evidence tab
    # ever sees, so it cannot be the one that does not say which definition it is
    # about. ⚠️ The POLL is a different matter: a job id is a digest of the
    # request and holds no tree, so a `running` / `unknown` poll has nothing to
    # derive a hash from. The claim is therefore "every POST answer and every
    # `ready` receipt", and the route docstring says so rather than leaving a
    # consumer to find out.
    asked = {
        # ⭐ THE MATHS THAT RAN, HASHED — `astHash(tree)`, the same string the
        # chart, the scan and the record key on. The consumer compares it to the
        # definition it asked about and refuses a receipt for any other. DERIVED
        # from the tree, never the store's `ast_hash` column: the column describes
        # the row, this describes what the engine was handed.
        "def_hash": _hash_of(tree),
    }
    if definition:
        asked["definition"] = definition
    if window_request:
        asked["window_request"] = window_request

    extras = {
        "job": job,
        "status": "ready",
        # ⛔ `tf` AND NOTHING ELSE ABOUT THE REQUEST. The window is the receipt's
        # (`window`, in the YYYY-MM-DD spelling the engine actually compared bars
        # against) and the horizons are the receipt's (`method.horizons`). Echoing
        # either back here would be a second spelling of one value — the exact
        # drift `_envelope` refuses one level up. `tf` appears nowhere in the
        # receipt, because the engine is handed bars and never asks what timeframe
        # they are, so this route is its only writer.
        "tf": tf,
        "universe_request": universe,
        **asked,
    }

    def _run() -> dict:
        receipt = _run_engine(tree, symbols, start=start, end=end,
                              horizons=horizons,
                              read_bars=_bars_reader(tf, to_key),
                              want=want, to_key=to_key, tf=tf)
        return _envelope(receipt, extras)

    if background:
        # ⛔ THE STORED PAYLOAD WINS ON A COLLISION, AND NOTHING IS MUTATED.
        # `_submit` may hand back a receipt already in the cache; that dict is the
        # cache's own object, so it is merged INTO a new one rather than written
        # to, and its own keys outrank these.
        return {**asked, **_submit(job, _run)}

    if len(symbols) > INLINE_MAX_SYMBOLS:
        # ⛔ THE BOUND, QUOTED. Not a silent truncation and not a slow 504: the
        # member is told the size, the ceiling, and the door that takes it.
        raise HTTPException(
            status_code=400,
            detail=(f"{len(symbols)} symbols is more than this endpoint will "
                    f"sweep on a request thread ({INLINE_MAX_SYMBOLS}). Re-send "
                    "with ?background=1 and poll "
                    "GET /api/screener/backtest/{job} for the receipt."))

    cached = _stored(job)
    if cached is not None:
        return cached
    out = _run()
    _record(job, out)
    return out


@router.get("/api/screener/backtest/{job}")
def read_screen_backtest(job: str, user: dict = Depends(require_paid)):
    """Poll one queued backtest: ``running`` / ``ready`` / ``error`` / ``unknown``.

    ⛔ TWO ROUTES AND NO MORE. A third "what would this refuse?" convenience door
    was drafted and dropped: nothing on the screen calls it, and a route with no
    consumer is the built-tested-green-and-unreachable shape this repo has already
    paid for twice. The refusal already arrives on the POST, by name.
    """
    return status_for(job)
