"""REST endpoints for chart indicator alerts.

Per-user CRUD over the ``indicator_alerts`` table. All endpoints require
an authenticated session via the canonical ``get_current_user`` dependency.

The background evaluator (started from the app lifespan) reads the same
table and dispatches deliveries through the watchlist-alert pipeline, so
these endpoints only need to manage the alert rows themselves.
"""
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import alert_user_series
from api.services import indicator_alert_service as ias
from api.services import indicator_alert_evaluator


router = APIRouter(prefix="/api/indicator-alerts", tags=["indicator-alerts"])


# ─── THE USER LANE'S DOOR, AND WHY IT NEEDED ONE ─────────────────────────────
#
# ⛔ EVERY ROUTE HERE THAT NAMES AN INDICATOR USED TO REFUSE ANY ADDRESS
# `indicator_alert_evaluator.value_function()` MISSES — and that function walks
# the three GLOBAL partitions, from which `alert_user_series.USER_FUNCS` is
# deliberately, permanently absent (it is keyed `<user_id>\x1f<address>`, because
# `u_….value` means something to exactly one account). So Phase D Task 12's whole
# admission chain — the repaint gate, the budget-at-armed-version gate, the
# arm-time cross-lane 1e-9 proof — sat BELOW a refusal nothing could get past, and
# `POST {"indicator": "u_a1b2c3d4e5f6.value"}` answered 400 *"not an indicator
# this chart can evaluate"*. Both sides were correct; the seam was dead.
#
# ⭐ THE FIX IS A SCOPED RESOLUTION, NOT A FOURTH GLOBAL ENTRY. This layer is the
# one that holds a signed-in account, so it is the only layer that CAN resolve a
# per-user address without making one member's formula answer for another. The
# global tables are untouched: `all_addresses()` is still 31, `--diff` is still
# 31/31, and `build_alert_grid` still iterates exactly what it iterated.
#
# ⚠️ A REFUSAL FROM THE ADMISSION CHAIN IS A 400 THAT CARRIES THE GATE'S OWN
# SENTENCE. `AdmissionRefused` is a RuntimeError; letting it escape would be a 500
# on a request the user got wrong, and rewriting its message here would give one
# refusal two spellings (`_save_or_400` in `api/routers/user_definitions.py`
# states the same rule). `.gate` rides along in the text, so a support question
# has an answer.
def _refusal_to_400(exc: alert_user_series.AdmissionRefused) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


class AlertCreate(BaseModel):
    sym: str
    indicator: str
    condition: str
    threshold: Optional[float] = None
    tf: str
    params: Optional[dict[str, Any]] = None
    # ⭐ SPEC §8: WHICH INSTANCE. Optional, and an absent one is not an error —
    # a client that does not know its chart's instances (or an alert armed from
    # somewhere that has no chart at all) still gets an alert; what it does not
    # get is the deletion guard, because there is no binding to guard.
    instance_id: Optional[str] = None
    # ⭐ SPEC §5 / PHASE C TASK 12: WHICH CHART. Optional, and omitting it means
    # GLOBAL — the alert shows on every chart, which is what every alert created
    # before this field existed means and must keep meaning.
    scope: Optional[str] = None


class SnoozeBody(BaseModel):
    minutes: int = 60


# ⚠️ THE OTHER PRICE-ALERT PRODUCT, NAMED SO IT CANNOT BE REBUILT BY ACCIDENT.
# `watchlist_alerts` already exists and already delivers price alerts, through
# `check_alerts_against_prices` on the 15-second live-price poll. A bare price
# alert asked for HERE is the same product under a second name, and two products
# with one name is how a user ends up with two alerts and one notification.
#
# ⭐ NARROWED BY PHASE C TASK 10, NOT DELETED — AND `close` LEFT THE SET.
# Task 11 wrote this list when `close` was not an address, so refusing every
# spelling of "price" was the only available answer. `close` IS an address now
# (`PRICE_FUNCS`), which is what makes price a LEFT operand and makes "price
# crossed above VWAP" sayable in the order a trader says it — the thing Task 11
# recorded as structurally blocked. The refusal survives for the spellings that
# name NO address: they are what a user types when they mean the live-price
# lane, and pointing them at it is more useful than a 400 that says "unknown".
#
# ⛔ THE TWO PRODUCTS STAY DIFFERENT, AND THE DIFFERENCE IS NOT A SLOGAN: this
# lane reads a bar on the alert's own timeframe, fires ONCE per armed episode
# (Task 11's fired log), and re-arms only when the condition goes false;
# `watchlist_alerts` reads a live tick every 15 seconds. Same word, different
# question, different latency — `GET /api/indicator-alerts/latency` states it.
_PRICE_ALIASES = {"price", "last", "last_price", "px"}

# Worst-case seconds between the event and the notification, per timeframe.
# Spec §8 requires this to be STATED rather than discovered. It is
# (evaluator cycle interval) + (how long a bar takes to close), and the second
# term is zero on the forming lane — which is the lane that repaints.
_TF_SECONDS = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600,
               "D": 86_400, "W": 604_800, "M": 2_678_400}
_CYCLE_SECONDS = 60


@router.get("")
def list_my_alerts(scope: Optional[str] = None,
                   user: dict = Depends(get_current_user)):
    """This user's alerts — all of them, or ONE CHART'S ALERT SET.

    ⭐ PHASE C TASK 12. `?scope=<chartId>` returns *global + that chart*, never
    *that chart alone*: every alert that exists today is unscoped, and unscoped
    has always meant "on every chart". Omitting the parameter is the alert
    manager's view and is byte-for-byte what this returned before.

    ⛔ THIS IS A DISPLAY FILTER AND IT IS NOWHERE NEAR THE EVALUATOR. What FIRES
    is decided by `indicator_alert_service.list_active()`, which is scope-blind
    on purpose — see its docstring, and the rail that keeps it that way.
    """
    return {"alerts": ias.list_for_user(user["id"], scope=scope)}


@router.get("/catalog")
def get_alert_catalog(user: dict = Depends(get_current_user)):
    """What the alert dropdown may offer.

    Served by the module that EVALUATES, so the dropdown cannot offer an alert
    that cannot fire — `IndicatorAlertPopover.jsx` used to hand-write its own
    copy and the two had already drifted apart.

    ⚠️ AUTH-GATED like every other endpoint on this router, deliberately: it is
    an enumeration of internals, not public content. The popover only renders
    for a signed-in user, so nothing is lost by gating it.

    ⚠️ DECLARED BEFORE `/{alert_id}` would matter if a GET on that path existed.
    It does not today (only DELETE and POST /{id}/toggle) — but keep this route
    above any future `GET /{alert_id}` or `catalog` will be parsed as an id.

    ⭐ IT IS SERVED SCOPED, AND THAT IS THE UI PRODUCER FOR A USER FORMULA. The
    popover has no list of its own (`IndicatorAlertPopover.jsx` retired all five
    literals and refuses to carry a fallback), so it offers exactly what this
    returns — which means a user definition that never appeared here had no UI
    producer at all, not merely a missing one. `alert_catalog(user_id)` APPENDS
    this account's own formulas after the global groups; called without an id it
    is byte-for-byte the enumeration every rail in this phase measures.

    🔴 …AND `refusals` IS WHY A FORMULA IS **NOT** IN THAT LIST. `user_catalog`
    omits what the gates refuse — correct, and silent: a member saved a formula,
    the store accepted it, and the picker did not have it with nothing anywhere
    saying why. This is the alert half of `918e3c8a`, which closed the identical
    silence in the indicator library, and it carries the GATE'S OWN SENTENCE
    verbatim (see `indicator_alert_service.user_definition_refusals`).

    ⛔ IT IS A SECOND KEY, NEVER A ROW IN `catalog`. A refused formula has no
    address to submit, so an entry among the offerings would be an option that
    arms nothing — the same reason the library dialog puts its refusals in their
    own section outside `role="listbox"`. It also keeps `catalog` byte-unmoved,
    which `test_the_GLOBAL_catalog_is_BYTE_UNMOVED_by_the_scoped_one` reads.
    """
    return {
        "catalog": indicator_alert_evaluator.alert_catalog(user["id"]),
        "refusals": ias.user_definition_refusals(user["id"]),
    }


@router.get("/fired")
def list_my_fires(limit: int = 50, user: dict = Depends(get_current_user)):
    """The fired log — what actually reached this user, newest first.

    ⚠️ DECLARED ABOVE ANY `/{alert_id}` GET, like `/catalog`. There is no such
    route today (only DELETE and POST on that path), and this is the second
    literal segment that would be parsed as an id if one were added.
    """
    return {"fires": ias.list_fires(user["id"], limit)}


@router.get("/delivery-health")
def get_my_delivery_health(limit: int = 20,
                           user: dict = Depends(get_current_user)):
    """🔴 THE ALERTS THAT DID NOT REACH YOU — the read that had no route.

    `alert_fired_log.delivery_failures()` and `delivery_health()` existed, were
    correct, and were exposed BY NOTHING: a member who missed an alert was
    invisible to anyone without direct database access. This is the door, and it
    is MEMBER-FACING rather than admin-only on purpose — the person who needs to
    know they were not told is the person who was not told.

    ⚠️ SCOPED TO THE CALLER IN THE QUERY, not filtered after the fact. Both reads
    take `user_id` and push it into SQL, so there is no shape of this response
    that can hold another member's fire.

    ⭐ IT REPORTS PARTIAL FAILURES, WHICH IS THE COMMON CASE. `health.partial`
    counts fires that reached the member on one channel and not another; those
    rows keep `delivered_at` (something landed) and carry no `delivery_failed_at`
    (the lease was never released), so before the per-channel record they were
    counted — and rendered — as clean deliveries.
    """
    from api.services import alert_fired_log
    return {
        "health": alert_fired_log.delivery_health(user_id=user["id"]),
        "failures": alert_fired_log.delivery_failures(
            limit=limit, user_id=user["id"]),
    }


@router.get("/latency")
def get_alert_latency(user: dict = Depends(get_current_user)):
    """Worst-case seconds from the event to the notification, per timeframe.

    Spec §8 asks for this to be STATED, not discovered by a member timing their
    own alerts. It is the evaluator's cycle interval plus, on the closed lane,
    the time a bar takes to finish — the second term is the honest price of not
    repainting, and it is zero on the lane that does.

    ⭐ IT IS ALSO THE ROLLBACK READBACK. `ALERT_EVAL_MODE` can be overridden from
    the Railway dashboard without a deploy, and an operator who has just pulled
    that lever needs to confirm on the POD which lane is actually running —
    without `railway ssh` (which mangles `/opt/venv/bin/python` under Git Bash)
    and without waiting for an alert to fire or not fire. `eval_mode` here is the
    whole provenance: the effective lane, the variable, its raw value, and
    whether the override was applied or REFUSED.

    ⚠️ ONE RESOLUTION FEEDS BOTH FIELDS. `mode` is read out of the report rather
    than by a second `eval_mode()` call, so this body cannot report one lane in
    `mode` and another in `eval_mode.effective` — the disagreement Task 8's
    tombstone mutation is built out of.

    🔴 …AND `worst_case_seconds` IS ARITHMETIC, WHICH IS WHY `observed` IS NOW
    BESIDE IT. Everything above is derived from two constants, so it cannot be
    wrong and therefore cannot detect a regression: a stalled evaluator thread
    would leave this body byte-identical. `observed` is the MEASUREMENT —
    `fired_at − bar_close` over the fires actually recorded — and it reports
    `observations: 0` with null quantiles rather than a fabricated zero when
    nothing has fired yet.

    ⛔ THE STATED BOUND IS NOT DELETED IN FAVOUR OF THE MEASURED ONE. They answer
    different questions: `worst_case_seconds` is what this lane PROMISES on a
    timeframe nobody has armed yet, and it is also the second, independent
    witness of the running lane (its `5 → 360` arithmetic is only producible by
    the closed branch). A measurement over an empty sample cannot replace either.
    """
    report = indicator_alert_evaluator.eval_mode_report()
    mode = report["effective"]
    closed = mode == "closed"
    return {
        "mode": mode,
        "eval_mode": report,
        "cycle_seconds": _CYCLE_SECONDS,
        "worst_case_seconds": {
            tf: _CYCLE_SECONDS + (secs if closed else 0)
            for tf, secs in _TF_SECONDS.items()
        },
        "observed": indicator_alert_evaluator.observed_latency(
            user_id=user["id"]),
    }


@router.post("")
def create_alert(body: AlertCreate, user: dict = Depends(get_current_user)):
    # ⛔ THE CREATE PATH USED TO VALIDATE NOTHING. A typo'd indicator was stored,
    # accepted, and then silently never fired — an alert the user believes is
    # watching. That is the same silence `needs_attention` exists to end, reached
    # one step earlier, where it can still be refused instead of explained.
    raw = (body.indicator or "").strip()
    if raw.lower() in _PRICE_ALIASES:
        raise HTTPException(
            status_code=400,
            detail=("A live price alert belongs to the watchlist alert lane "
                    "(/api/watchlist-alerts), which delivers it on the "
                    "15-second live-price poll. This lane reads the bar on your "
                    "chart's timeframe — ask for the indicator 'close' if that "
                    "is the question you mean."),
        )
    # ⭐ A USER ADDRESS SKIPS THE GLOBAL LOOKUP AND IS RESOLVED IN THIS ACCOUNT'S
    # SCOPE INSTEAD — see the block at the top of this module. It is NOT passed
    # through `resolve_address`, which case-folds: a user plot key may be
    # camelCase (`u_abc.fastLine`) and folding it would ask the definition for a
    # plot it does not declare. `ias.create` below runs the admission chain and
    # raises `AdmissionRefused` naming the gate; the refusal a user gets is
    # therefore the gate that means it rather than "unknown indicator".
    if not alert_user_series.is_user_address(raw):
        address = indicator_alert_evaluator.resolve_address(raw)
        if indicator_alert_evaluator.value_function(address) is None:
            raise HTTPException(
                status_code=400,
                detail=(f"{body.indicator!r} is not an indicator this chart can "
                        "evaluate, so an alert on it could never fire. See "
                        "GET /api/indicator-alerts/catalog for what is offered."),
            )
    # ⭐ AND THE THREE THAT ARE ABOUT THE ALERT'S SHAPE, NOT ITS NAME. The two
    # refusals above catch an indicator that does not exist; a `vwap` alert on
    # `tf="D"` names one that does, is accepted by both of them, and is still
    # structurally mute forever. `ias.refusal_for` is the measurement of that —
    # and it refuses ONLY what is dead under `"forming"` AND under `"closed"`, so
    # flipping `ALERT_EVAL_MODE` cannot retroactively make it wrong and it does
    # not pre-judge Task 8. `ichimoku.chikou` fires today and is NOT refused.
    refusal = ias.refusal_for(body.indicator, body.condition, body.tf,
                              body.threshold)
    if refusal:
        raise HTTPException(status_code=400, detail=refusal)
    try:
        alert_id = ias.create(
            user_id=user["id"],
            sym=body.sym.upper(),
            indicator=body.indicator,
            condition=body.condition,
            threshold=body.threshold,
            tf=body.tf,
            params_json=body.params,
            instance_id=body.instance_id,
            scope=body.scope,
        )
    except alert_user_series.AdmissionRefused as exc:
        # ⛔ THE ADMISSION CHAIN, REACHED — and its refusal is the USER'S answer,
        # not a 500. `ias.create` raises BEFORE the INSERT, so a refusal here
        # means nothing was armed and there is nothing to go quiet.
        raise _refusal_to_400(exc) from exc
    return {"id": alert_id}


@router.get("/current-value")
def get_current_value(sym: str, tf: str, indicator: str,
                      params: Optional[str] = None,
                      user: dict = Depends(get_current_user)):
    """⭐ SPEC §8: *"threshold prefilled from current value"*.

    What this plot reads RIGHT NOW on this symbol and timeframe, so the
    threshold box opens on a number that is near the market instead of on a
    constant. `_DEFAULT_THRESHOLDS` can only serve the bounded oscillators (RSI
    70, ADX 25); every price-scale address — vwap, atr, the bands, every
    Ichimoku line, and now `close` — has no meaningful default without knowing
    the symbol, which is why they all render an empty box today.

    ⛔ IT IS THE EVALUATOR'S OWN `address_value`, NOT A SECOND COMPUTE. A
    prefill that came from a different code path would suggest a number the
    alert would not agree with, on the one screen where the two are compared.

    ⚠️ NEVER AN ERROR FOR "NOT ENOUGH BARS". `{"value": null}` is the honest
    answer for a cold symbol and it renders as an empty box, which is exactly
    what the user had before. Only an address that cannot be evaluated at all
    is a 400 — the same refusal the create path makes, one step earlier.

    ⚠️ DECLARED ABOVE `/{alert_id}`, like `/catalog` and `/fired`.
    """
    raw = (indicator or "").strip()
    # ⭐ THE SAME SCOPED RESOLUTION THE CREATE PATH MAKES, FOR THE SAME REASON.
    # This gate carried the identical `value_function(...) is None` refusal, so
    # the threshold box on a user formula opened on a 400 rather than on a number
    # — the prefill half of the same dead seam.
    user_fn = None
    if alert_user_series.is_user_address(raw):
        try:
            user_fn = alert_user_series.user_value_function(user["id"], raw)
        except alert_user_series.AdmissionRefused as exc:
            raise _refusal_to_400(exc) from exc
        address = raw
    else:
        address = indicator_alert_evaluator.resolve_address(raw)
        if indicator_alert_evaluator.value_function(address) is None:
            raise HTTPException(
                status_code=400,
                detail=f"{indicator!r} is not an indicator this chart can evaluate.")
    parsed: dict[str, Any] = {}
    if params:
        try:
            decoded = json.loads(params)
            if isinstance(decoded, dict):
                parsed = decoded
        except ValueError:
            raise HTTPException(status_code=400,
                                detail="params must be a JSON object")
    try:
        # The prefill must show the number the ARMED alert will report. Sized off
        # the same declaration the evaluator uses, or the value a member sees
        # before arming is computed over a different window than the one that
        # then fires — `ema(close,200)` differed by −4.80% between the two.
        bars = indicator_alert_evaluator._fetch_bars_for_alert(
            sym.upper(), tf,
            indicator_alert_evaluator.bars_needed_for_alert(
                {"indicator": address, "params_json": parsed,
                 "user_id": user["id"]}))
        value = (user_fn(bars, parsed) if user_fn is not None
                 else indicator_alert_evaluator.address_value(address, bars, parsed))
    except Exception as exc:  # noqa: BLE001 - a prefill is never worth a 500
        return {"value": None, "detail": f"{type(exc).__name__}: {exc}"}
    label = (alert_user_series.instance_label_for(user["id"], address, parsed)
             if user_fn is not None
             else indicator_alert_evaluator.instance_label(address, parsed))
    return {
        "value": None if value is None else float(value),
        "instance_label": label,
    }


@router.delete("/{alert_id}")
def delete_alert(alert_id: int, user: dict = Depends(get_current_user)):
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    ias.delete(alert_id)
    return {"ok": True}


@router.post("/{alert_id}/toggle")
def toggle_alert(alert_id: int, user: dict = Depends(get_current_user)):
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    new_state = not alert["active"]
    ias.set_active(alert_id, new_state)
    return {"active": new_state}


@router.post("/{alert_id}/snooze")
def snooze_alert(alert_id: int, body: SnoozeBody,
                 user: dict = Depends(get_current_user)):
    """Quiet for N minutes, then speak again if the condition is still true.

    ⛔ NOT `toggle`. A toggled-off alert stops being EVALUATED, so it cannot
    observe the condition going false and can never re-arm; a snoozed one keeps
    being evaluated and keeps its `last_value` current — which under
    `ALERT_EVAL_MODE == "forming"` is the `prev` its next crossing is measured
    against. Snooze is silence; toggle is absence.
    """
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    try:
        return ias.snooze(alert_id, body.minutes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{alert_id}/rearm")
def rearm_alert(alert_id: int, user: dict = Depends(get_current_user)):
    """Arm it again now — "tell me the next time this happens".

    The automatic re-arm needs the condition to be observed FALSE first, which
    is correct and is also why a user staring at a fired alert on a level that
    has not come back needs a button.
    """
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    return ias.rearm(alert_id)


@router.get("/{alert_id}/fires")
def list_alert_fires(alert_id: int, limit: int = 50,
                     user: dict = Depends(get_current_user)):
    """One alert's own history. Ownership-checked like every other route here."""
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    from api.services import alert_fired_log
    return {"fires": alert_fired_log.fires_for_alert(alert_id, limit)}
