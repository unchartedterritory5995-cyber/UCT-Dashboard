"""USER-AUTHORED INDICATOR DEFINITIONS — the network edge of the append-only store.

  GET    /api/user-definitions            → every live definition (newest version)
  POST   /api/user-definitions            → create; the server mints the `u_<12 hex>` id
  POST   /api/user-definitions/propose    → English in, a canonical tree out (the concierge)
  GET    /api/user-definitions/{def_id}   → one definition; `?version=N` serves a PIN
  PUT    /api/user-definitions/{def_id}   → save an edit (appends a version)
  DELETE /api/user-definitions/{def_id}   → soft delete (appends a tombstone version)

⛔ `require_paid` IS DECLARED PER HANDLER, NOT ON THE ROUTER — and the shape is
copied from `api/routers/signature.py:174`, which defines its own and repeats it
on every route. `main.py` calls `include_router` without a router-level
dependency, so a route that omits its own is reachable by anybody.

⛔ AND THE COVERAGE TEST IS DERIVED FROM `router.routes` WITH THE COUNT ASSERTED.
Phase C Task 13 MEASURED the failure this prevents: the shipped test hand-listed
THREE paths while the router had FIVE, so two paid-gated endpoints rode with no
auth coverage at all and deleting a `Depends(require_paid)` passed every test.
`tests/test_user_definitions.py` reads the route table, asserts the count so a
router that stopped mounting cannot pass by iterating zero times, and checks the
gate both structurally (dependency identity) and behaviourally (a free user gets
402 on every route).

⚠️ EVERYTHING HERE IS PAID (owner ruling). There is no free read: a definition
list is user content on a premium surface, and a "just the list" exemption is the
sixth route that rides in uncovered.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import scan_definition
from api.services import user_definitions as svc
from api.services.entitlements import Limits, limits_dependency

router = APIRouter(prefix="/api/user-definitions", tags=["user-definitions"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(
            status_code=402,
            detail="Custom indicators require a paid plan",
        )
    return user


class DefinitionIn(BaseModel):
    definition: dict


class ProposeIn(BaseModel):
    """The English, the kind of formula wanted, and the bars the chart holds.

    The bars come from the CLIENT because the chart already has them and the
    concierge's compute stage has to run on the same window the user is looking
    at — a formula that computes nothing on the bars in view is refused there.

    ⛔ `kind` IS PASSED THROUGH, NEVER VALIDATED HERE. The kinds live in
    `definition_concierge.KINDS` and an unrecognised one is refused at
    `kind:unknown` by the pipeline that owns the distinction — a `Literal` typed
    here would be a second list of kinds to keep in step, and a 422 would report
    the refusal under a door that decides nothing about formulas.
    """

    prompt: str
    kind: Optional[str] = None
    bars: Optional[list] = None


#: A body cap, because an unbounded array is an unbounded request. The chart caps
#: at 5,000 bars on every timeframe (`/api/bars` and `StockChart` both), so this
#: is that number rather than a new one.
MAX_PROPOSE_BARS = 5000

# ── The AI door's INVOCATION bound ──────────────────────────────────────────
#
# 🔴 THE GAP THIS CLOSES. `MAX_PROPOSE_BARS` bounds how BIG one call is. Nothing
# bounded HOW MANY. `/propose` is the only route on this router that spends model
# tokens per request, `require_paid` is a one-time yes/no, and a paid session in a
# `while true` loop was an unmetered bill on the firm's key. Same shape E-7's
# census caught on `/api/scans/definition-results`: right auth class, missing
# bound.
#
# ⛔ AND IT IS DELIBERATELY *NOT* A FIFTH `Limits` AXIS. `entitlements.Limits` is
# a BREADTH model — its own docstring: *"Symbols, history depth, definition count,
# refresh cadence"* — with four REQUIRED fields, one place the numbers live, and
# rails asserting all of it. An invocation-rate cap is a COST axis, not a breadth
# axis; bolting it onto `Limits` would change every toolkit and every entitlement
# rail for a number that has nothing to do with how much market a plan may ask
# about. Note too that `tests/test_entitlements.py` EXCLUDES `/propose` from the
# toolkit-write census on purpose (`not k[1].endswith("/propose")`) — because
# `limits_dependency` bounds `max_definitions`, and a route that stores nothing
# cannot move a definition count. Adding `Depends(limits_dependency)` here would
# have looked like the fix and bounded nothing: a gate that cannot fail.
#
# ⚠️ PER-PROCESS, AND THAT IS A REAL LIMIT. The web pod is one uvicorn process
# (CLAUDE.md, "SINGLE-PROCESS assumptions"), so this counter is exact today and
# would become per-instance the day web scales out — at which point the ceiling
# multiplies by the instance count rather than failing open. Recorded here so the
# scale-out change is a decision, not a surprise.
PROPOSE_MAX_PER_HOUR = int(os.environ.get("PROPOSE_MAX_PER_HOUR", "40"))
_PROPOSE_WINDOW_SECONDS = 3600
_propose_calls: dict[str, list[float]] = {}
_propose_lock = threading.Lock()


def _charge_propose(user_id: str, *, now: float | None = None) -> None:
    """Record one call for `user_id`, or raise 429 if the window is full.

    ⛔ THE CHARGE HAPPENS BEFORE THE MODEL RUNS, not after. Billing on success
    would let a caller loop refusals for free, and a refused proposal costs the
    same tokens as an accepted one.
    """
    now = time.time() if now is None else now
    cutoff = now - _PROPOSE_WINDOW_SECONDS
    with _propose_lock:
        recent = [t for t in _propose_calls.get(user_id, ()) if t > cutoff]
        if len(recent) >= PROPOSE_MAX_PER_HOUR:
            retry_after = max(1, int(recent[0] + _PROPOSE_WINDOW_SECONDS - now))
            _propose_calls[user_id] = recent
            raise HTTPException(
                status_code=429,
                detail=f"At most {PROPOSE_MAX_PER_HOUR} indicator proposals per "
                       f"hour. Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        recent.append(now)
        _propose_calls[user_id] = recent
        # Bound the dict itself: a key per member is fine, a key per member
        # FOREVER is a leak. Drop anyone whose window has fully aged out.
        if len(_propose_calls) > 5000:
            for uid in [u for u, ts in _propose_calls.items()
                        if not ts or ts[-1] <= cutoff]:
                _propose_calls.pop(uid, None)


def _save_or_400(user_id, def_id: str, definition: dict,
                 limits: Limits | None = None) -> dict:
    """Every store refusal is a 400 that carries the store's own sentence.

    ⛔ THE MESSAGE IS NOT REWRITTEN HERE. The caps live in one place and their
    wording names the number that was exceeded; a router-local paraphrase is a
    second vocabulary for the same refusal. `entitlements.ToolkitLimitExceeded`
    IS a `ValueError`, so a toolkit refusal comes out of the same door rather
    than needing a second handler.

    ⛔ `limits` IS PASSED THROUGH, NEVER RE-DERIVED HERE. Re-deriving it would be
    a second authority over one member's plan, on the write path.
    """
    try:
        return svc.save(user_id, def_id, definition, limits=limits)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _stamped(row: dict) -> dict:
    """One definition, plus THE SERVER'S OWN ANSWER to "can this be a screen?".

    ⛔⛔ THIS EXISTS BECAUSE THE CLIENT WAS ANSWERING IT SECOND, AND WEAKER.
    `components/screener/scanSession.js::scannableScreens` checked that `compute`
    was an object, `compute.ast` was present and `compute.fn` was a non-empty
    string -- a SHAPE check wearing the name of a SCANNABILITY check -- and
    `ScreensManager` offered every row that passed as `Use as filter`.

    Measured end-to-end in a browser (X88): `macd(close, 12, 26)` saved with that
    plot marked Scan, listed under My Scans, applied as a filter, and the chip
    read `first sweep tonight` -- while `run_sweep` refused it every night with
    `[gate:yields] this tree returns a number, not a 0/1 column`. A refused
    definition never earns a receipt, so the join stayed `applied: false` and the
    chip said "tonight" FOREVER, over the UNFILTERED universe. That is verbatim
    the state `screener/filters.py::_my_scans_entry` gates against -- and that
    gate works; it is simply on the other door.

    ⭐ SO THE KNOWING SIDE STAMPS ITS ANSWER, rather than a second reader
    re-deriving it. `assert_scannable` runs the canonical check, the
    `max_lookback` RESOLVE pass and `is_boolean_tree`; a client cannot reach the
    middle one at all, which is why "just tighten the JS predicate" would have
    closed `yields` and left `tree` open -- a `resolve:domain` refusal produces
    the same forever-chip by the same mechanism.

    ⚠️ THE LIST IS STAMPED; `POST ""` AND `PUT /{def_id}` ARE NOT, deliberately.
    `useUserDefinitions` re-reads the list after a write (`mutate(
    USER_DEFINITIONS_KEY)`) rather than inserting the write's answer, so `rows`
    only ever holds stamped rows and the write path keeps its resolve pass. ⛔ A
    future caller that DID insert a write's answer straight into that list would
    silently lose the row from My Scans -- stamp the write too at that point
    rather than teaching the client to default it.

    ⚠️ `refusal` IS THE POINT, not a debug field. Everything else in this engine
    refuses BY NAME and says what would unblock it; a formula that silently fails
    to appear under My Scans is the one place a member is told nothing
    (`lesson_an_over_refusal_is_invisible`). The sentence is shipped so a surface
    can show it. `gate` is a closed set (`scan_definition.GATES`) -- branch on the
    gate, never on the prose.
    """
    out = dict(row)
    try:
        scan_definition.assert_scannable(row.get("definition") or {})
    except scan_definition.ScanRefused as exc:
        out["scannable"] = False
        out["scan_refusal"] = {"gate": exc.gate, "detail": exc.detail}
    except Exception as exc:  # noqa: BLE001
        # ⛔ NEVER let one bad row take the list down, and never call an
        # unclassifiable row scannable -- offering it is the failure this
        # function exists to stop. Fail CLOSED, and say the classifier is what
        # broke so the member is not told their formula is wrong when it is ours.
        out["scannable"] = False
        out["scan_refusal"] = {
            "gate": "tree",
            "detail": "this formula could not be checked for screening "
                      f"({type(exc).__name__}), so it is not offered as a scan.",
        }
    else:
        out["scannable"] = True
        out["scan_refusal"] = None
    return out


@router.get("")
def list_definitions(user: dict = Depends(require_paid)):
    return {"definitions": [_stamped(r) for r in svc.list_for_user(user["id"])]}


@router.post("")
def create_definition(body: DefinitionIn,
                      user: dict = Depends(require_paid),
                      limits: Limits = Depends(limits_dependency)):
    """Create. THE SERVER MINTS THE ID.

    A client-supplied id would let one member write into another's namespace by
    guessing, and it would let a definition claim a native id (`rsi`) whose
    bindings a rev bump would then force-migrate.

    ⭐ AND IT CARRIES THE CALLER'S TOOLKIT BESIDE `require_paid`, NOT INSTEAD OF
    IT. `require_paid` decides WHETHER (402); `limits_dependency` decides HOW MUCH
    (the definition-count axis). Collapsing them would make one 402 mean two
    things and lose "which surface refused me".
    """
    def_id = svc.new_def_id()
    definition = dict(body.definition or {})
    definition["id"] = def_id
    return _save_or_400(user["id"], def_id, definition, limits)


@router.post("/propose")
def propose_definition(body: ProposeIn, user: dict = Depends(require_paid)):
    """THE AI DOOR. English in, a canonical tree out — or a refusal.

    ⛔ IT STORES NOTHING. A proposal is a suggestion the user has not confirmed;
    persisting it would make an unconfirmed, model-authored formula a definition
    the alert lane could bind to. The client shows the read-back, the user
    accepts, and the ordinary `POST ""` / `PUT /{def_id}` doors do the writing —
    through the same validation everything else goes through.

    ⛔ AND A REFUSAL IS A 200 WITH `ok: False`, NOT A 4xx. That is
    `brain_service`'s shape and this is the same kind of answer: "I could not turn
    that into a formula" is a legitimate reply, not a transport failure, and the
    caller renders `reason` next to the box the user typed in. `gate` names the
    door that decided so a support question has an answer.

    ⚠️ DECLARED PER HANDLER, like every other route on this router. See the module
    docstring: `main.py` mounts this router with no router-level dependency, so a
    route that omits its own is reachable by anybody.

    ⭐ AND IT IS BOUNDED PER CALLER, NOT ONLY PER CALL. `MAX_PROPOSE_BARS` caps
    how big one proposal is; `_charge_propose` caps how many a member may fire in
    an hour. See the note above `PROPOSE_MAX_PER_HOUR` for why that bound is a
    rate limit here and not a fifth `entitlements.Limits` axis.
    """
    _charge_propose(str(user["id"]))
    bars = body.bars or []
    if not isinstance(bars, list) or len(bars) > MAX_PROPOSE_BARS:
        raise HTTPException(
            status_code=400,
            detail=f"bars: at most {MAX_PROPOSE_BARS} bars, got "
                   f"{len(bars) if isinstance(bars, list) else type(bars).__name__}")
    from api.services import definition_concierge
    #: ⭐ THE DEFAULT IS THE PIPELINE'S OWN, READ OFF IT. A body with no `kind`
    #: is every caller that shipped before scans existed, and spelling
    #: `"indicator"` here would be a second declaration of the default.
    kind = body.kind if body.kind is not None else definition_concierge.INDICATOR_KIND
    return definition_concierge.propose(body.prompt, user_id=user["id"], bars=bars,
                                        kind=kind)


@router.get("/library")
def public_library(limit: int = 24, after: Optional[int] = None,
                   user: dict = Depends(require_paid)):
    """Every definition its owner asked to be listed, newest first.

    ⛔⛔ DECLARED BEFORE `/{def_id}`, AND THAT ORDERING IS LOAD-BEARING. FastAPI
    answers on first match, so with the wildcard first this route would be read as
    a definition whose id is the literal string "library" — a 404 on a path that
    exists. The same trap the breadth live-drill route documents one directory
    over, and the reason `test_the_library_route_is_not_shadowed` exists.
    """
    return svc.public_library(limit=limit, after=after)


@router.get("/{def_id}")
def get_definition(def_id: str,
                   version: Optional[int] = Query(None, ge=1),
                   user: dict = Depends(require_paid)):
    try:
        row = svc.get(user["id"], def_id, version)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return row


@router.put("/{def_id}")
def save_definition(def_id: str, body: DefinitionIn,
                    user: dict = Depends(require_paid),
                    limits: Limits = Depends(limits_dependency)):
    """An EDIT. A maths change bumps `rev` and force-migrates every binding.

    ⚠️ IT CARRIES THE TOOLKIT TOO, AND THE REASON IS THE RESURRECT. An edit of a
    live definition never touches the count cap; saving over a TOMBSTONE makes a
    definition live that is not live now, which is exactly the case
    `user_definitions.save` checks. A PUT without the toolkit would be the way to
    stand at a hundred definitions on a plan that sells fifty.

    ⭐ AND AS OF THIS COMMIT IT HAS A PRODUCT CALLER. `BuilderSheet` opens a saved
    formula, and its Save button routes here through the SAME document builder,
    the SAME `validateUserDefinitions` door and the SAME `installUserDefinitions`
    that a create goes through — one write path, not two. Until now this route
    existed in shape only, which is why `compute.rev` in every stored blob had
    stayed `1` since Phase D shipped: nothing in the product could move it.

    ⛔ AN EDIT REQUIRES SOMETHING TO EDIT — 404, NOT AN UPSERT. `save()` is happy
    to append version 1 at any id in the caller's own namespace, so this route
    used to let a client CHOOSE its definition ids by PUTting one that did not
    exist. That is exactly the property `create_definition` refuses ("THE SERVER
    MINTS THE ID"), arriving one route over, and it makes a typo'd id a silent
    second definition rather than a 404. `history()` is read rather than `get()`
    so a RESURRECT still works: a tombstoned definition has versions, and saving
    over it is an edit that brings it back.
    """
    try:
        exists = bool(svc.history(user["id"], def_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not exists:
        raise HTTPException(status_code=404, detail="Not found")
    definition = dict(body.definition or {})
    definition["id"] = def_id
    return _save_or_400(user["id"], def_id, definition, limits)


@router.delete("/{def_id}")
def delete_definition(def_id: str, user: dict = Depends(require_paid)):
    try:
        removed = svc.soft_delete(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "def_id": def_id}


# ═══ sharing ════════════════════════════════════════════════════════════════
#
# ⛔⛔ NOTHING HERE IS PUBLIC BY DEFAULT. Every route below is `require_paid` and
# scoped to `user["id"]` EXCEPT `resolve` and `install`, which take a token — and
# a token exists only because an owner minted one. There is no listing of shared
# definitions and no way to walk the token space (128 bits), so the only route to
# somebody else's work is a link they chose to send.


@router.post("/{def_id}/share")
def share_definition(def_id: str, user: dict = Depends(require_paid)):
    """Mint (or return) the share link for one of my definitions.

    ⭐ IDEMPOTENT. Pressing Share twice returns the SAME token, because the first
    one may already be in somebody's chat window and minting a replacement would
    break it while the button said success. Re-sharing after an edit moves the
    pinned version and leaves the link alone.
    """
    try:
        out = svc.share(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if out is None:
        raise HTTPException(status_code=404, detail="Not found")
    return out


@router.get("/{def_id}/share")
def share_state(def_id: str, user: dict = Depends(require_paid)):
    """Is this definition shared, and under what token? ⛔ READ-ONLY — a GET that
    minted a token would publish a definition because somebody opened a panel."""
    try:
        out = svc.share_status(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return out or {"token": None}


@router.delete("/{def_id}/share")
def unshare_definition(def_id: str, user: dict = Depends(require_paid)):
    """Turn the link off. The token is tombstoned rather than deleted, so a
    recipient gets `revoked` — which explains their 404 — instead of
    `not-found`, which does not."""
    try:
        revoked = svc.unshare(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "def_id": def_id, "revoked": revoked}


@router.get("/{def_id}/history")
def definition_history(def_id: str, user: dict = Depends(require_paid)):
    """Every version of one of my definitions, oldest first, tombstones included.

    ⭐ THE STORE ALREADY KEPT THIS — every save appends a row rather than
    overwriting one, and `soft_delete` writes a tombstone version. What was
    missing was a door onto it.
    """
    try:
        rows = svc.history(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    return {"def_id": def_id, "versions": rows}


#: share refusal → HTTP status. ⭐ A CLOSED MAP, so a reason this module does not
#: know becomes a 400 rather than silently reading as "not found" — the two say
#: very different things to somebody holding a link.
_SHARE_STATUS = {"not-found": 404, "revoked": 410, "gone": 410, "table-version": 409}


def _share_http(exc: "svc.ShareRefused") -> HTTPException:
    return HTTPException(status_code=_SHARE_STATUS.get(exc.reason, 400),
                         detail={"reason": exc.reason, "message": exc.detail})


# ═══ the public library ═══════════════════════════════════════════════════
#
# ⛔⛔ THE COMMENT ABOVE STILL STANDS FOR SHARES: a token exists only because an
# owner minted one, and nothing walks the token space. What is new is a SECOND,
# separate opt-in — `POST /{id}/list` — and the separation is the safety property.
# Treating the existing share rows as a directory would have published every link
# any member ever sent to one person, retroactively and irreversibly.
#
# ⚠️ BROWSING IS `require_paid`, LIKE EVERY OTHER ROUTE IN THIS FILE. Whether the
# library should be readable BEFORE signup is a real product question (it is the
# best possible shop window) and it is a paywall decision, not this router's to
# make. Written down here rather than answered.


@router.post("/{def_id}/list")
def publish_definition(def_id: str, user: dict = Depends(require_paid)):
    """Put one of my definitions in the public library.

    ⭐ IT MINTS THE SHARE LINK IF THERE ISN'T ONE — a listing nobody can open is a
    broken row, and publishing to a library IS making it openable. The response
    names the token that now serves it, so nothing about that is hidden.
    """
    try:
        out = svc.publish(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if out is None:
        raise HTTPException(status_code=404, detail="Not found")
    return out


@router.delete("/{def_id}/list")
def unpublish_definition(def_id: str, user: dict = Depends(require_paid)):
    """Take it out of the library. ⛔ THE LINK KEEPS WORKING — withdrawing from a
    directory and revoking a link somebody already holds are different decisions.
    `DELETE /{id}/share` does both, because a listing is only live while its share
    is."""
    try:
        removed = svc.unpublish(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "def_id": def_id, "removed": removed}


@router.get("/{def_id}/list")
def listing_state(def_id: str, user: dict = Depends(require_paid)):
    """Is this in the library? ⛔ READ-ONLY, for the same reason `GET
    /{id}/share` is: a GET that published would list a definition because
    somebody opened a panel.

    ⭐ IT RETURNS THREE FACTS, NOT ONE. `listed` is what a reader sees; `requested`
    is what the owner asked for; `shared` is whether the link it rides on is still
    live. They come apart exactly when the owner revoked the link without
    un-listing — and a panel showing a single boolean could not explain why the
    entry vanished.
    """
    try:
        return svc.listing_status(user["id"], def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/shared/{token}")
def resolve_shared(token: str, user: dict = Depends(require_paid)):
    """Preview a shared definition before installing it.

    ⛔⛔ THIS IS WHERE THE GRAMMAR CHECK FIRES, and it is the acceptance
    criterion rather than a nicety: a byte-identical, hash-verified copy can
    still COMPUTE SOMETHING ELSE if the closed table moved under it, because the
    numbers live in the table and not in the document. A mismatch refuses by
    name, with both versions in the message.
    """
    try:
        return svc.resolve_share(token)
    except svc.ShareRefused as exc:
        raise _share_http(exc) from exc


@router.post("/shared/{token}/install")
def install_shared(token: str,
                   user: dict = Depends(require_paid),
                   limits: Limits = Depends(limits_dependency)):
    """Install a shared definition as MY OWN copy, carrying its origin.

    ⚠️ IT TAKES THE TOOLKIT, for the same reason `PUT` does: an install makes a
    definition live that was not live before, so it is exactly the case the count
    cap exists for.
    """
    try:
        return svc.install_share(user["id"], token, limits=limits)
    except svc.ShareRefused as exc:
        raise _share_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
