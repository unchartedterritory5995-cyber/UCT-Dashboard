"""In-house expected move from Massive options chains (ATM straddle).

Replaces the slow, delayed-quote yfinance straddle for the research/earnings
surfaces. Horizon-honest: expiry is the first on/after the report date and the
payload carries it ("through YYYY-MM-DD") so the UI can state the denominator.
"""
from __future__ import annotations

import datetime as _dt
import logging

from api.services import polygon_options
from api.services.cache import TTLCache
from api.services.serve_stale import ServeStale

_log = logging.getLogger(__name__)


def select_report_expiry(expirations: list[str], report_date: str | None) -> str | None:
    """First expiry ≥ report_date; front expiry when no date; None when the
    report lies beyond every listed expiry (better no number than a wrong one)."""
    exps = sorted(e for e in (expirations or []) if e)
    if not exps:
        return None
    if not report_date:
        return exps[0]
    try:
        target = _dt.date.fromisoformat(report_date)
    except (TypeError, ValueError):
        _log.warning("select_report_expiry: unparseable report_date=%s, returning None", report_date)
        return None
    for e in exps:
        try:
            if _dt.date.fromisoformat(e) >= target:
                return e
        except ValueError:
            continue
    return None


def _mid(row: dict) -> float | None:
    bid, ask = row.get("bid"), row.get("ask")
    try:
        bid, ask = float(bid), float(ask)
    except (TypeError, ValueError):
        return None
    if ask <= 0 or bid < 0 or ask < bid:
        return None
    return (bid + ask) / 2


# ── The bounds: was there an at-the-money strike, and is the answer defensible ─
#
# WHY THIS EXISTS — the fabricated-percentage defect, measured on production
# 2026-08-08 (`implied_snapshots`, 1,321 rows across `massive-chain` and
# `massive-backfill`):
#
#     MAPS   pct=2150.0%  spot=$0.35  strike=$0.50   |K-S|/S = 0.43
#     SGMOQ  pct=1675.0%  spot=$0.10  strike=$0.50   |K-S|/S = 4.00
#     NRDY   pct=1373.5%  spot=$0.85  strike=$2.50   |K-S|/S = 1.94
#     CTSO   pct= 615.4%  spot=$0.39  strike=$2.50   |K-S|/S = 5.41
#
# The arithmetic was never wrong: `dollar / spot == pct` held on 776 of 776
# chain rows. The error is upstream of the arithmetic — the chain listed NO
# strike at the money, `_atm` returned the nearest one anyway, and a deep-OTM
# straddle over a tiny spot fabricated an enormous percentage.
#
# ── MAX_ATM_MONEYNESS = 0.10, and why that number ─────────────────────────────
#
# STRUCTURAL derivation (this is the load-bearing argument; the empirics below
# only corroborate it). US equity option strike intervals are $2.50 for strikes
# up to $25, $5.00 over $25 through $200, and $10.00 above $200. The coarsest a
# COMPLIANT grid can ever be, relative to spot, is half an interval at the
# bottom of its tier:
#
#     $5.00 interval at its $25 floor   -> 2.50 / 25  = 10.0%   <- the maximum
#     $10.00 interval at its $200 floor -> 5.00 / 200 =  2.5%
#     $2.50 interval at $12.50          -> 1.25 / 12.50 = 10.0%
#
# So 10% of spot is exactly the widest gap a standard grid produces at a tier
# boundary. Past it the chain is coarser than ANY standard tier at that price —
# which is the precise, checkable statement of "the market never listed a
# strike at the money here." Below ~$12.50 on a $2.50 grid (or ~$5 on a $0.50
# grid) that is structurally guaranteed, which is why this bound also disposes
# of sub-dollar chains without a second guard (see the note under
# MAX_MOVE_PCT).
#
# EMPIRICAL corroboration, same 776 chain rows. `|K-S|` is pure INTRINSIC value
# — a certainty, not a forecast — so it is a hard floor under the reported
# percentage. Median intrinsic share of the straddle, by moneyness bucket:
#
#     [0.000,0.005) n=138  0.015     [0.075,0.100) n= 28  0.488
#     [0.005,0.010) n= 97  0.068     [0.100,0.125) n= 37  0.486
#     [0.010,0.020) n=123  0.123     [0.125,0.150) n= 21  0.563
#     [0.020,0.030) n= 83  0.179     [0.150,0.200) n= 20  0.700
#     [0.030,0.050) n= 98  0.261     [0.200,0.300) n= 19  0.700
#     [0.050,0.075) n= 84  0.334     [0.300,+inf)  n= 28  0.600-0.736
#
# and the median reported pct climbs in lockstep (11.07 at the money -> 22.02
# at 10-12.5% -> 35.93 at 20-30% -> 209.75 past 50%), which is the signature of
# contamination rather than of genuinely more volatile names.
#
# COST at each candidate, `massive-chain` (776 rows), rows refused:
#     0.01: 541   0.02: 418   0.03: 335   0.05: 237   0.075: 153
#     0.10: 125   0.125: 88   0.15:  67   0.20:  46   0.25:  37   0.30: 28
# 0.10 refuses 125 (16.1%). Tighter is not free and is NOT structurally
# justified: 0.05 refuses 237 (30.5%) including compliant $5-grid chains such
# as PSIX (spot 32.61, strike 35.00, 7.3%) and CTEV (26.84 / 25.00, 6.9%) that
# genuinely DO have the market's at-the-money strike. Refusing those would be
# the second defect this fix is warned against.
#
# ── No separate spot floor: the ATM bound already subsumes it ─────────────────
# A sub-dollar floor was considered and REJECTED as a duplicate guard, on the
# measurement rather than on taste. 24 chain rows had spot < $1. 21 of them are
# already refused by the 10% bound. The 3 survivors are AKBA (spot 0.99, strike
# 1.00, 30.3%), ATYR (0.52 / 0.50, 28.8%) and BLNK (0.54 / 0.50, 27.8%) — every
# one a genuine at-the-money strike on a real sub-dollar name, with a
# percentage a $1 biotech plausibly carries into a print. A spot floor would
# refuse exactly those three and not one additional fabricated row. It is not a
# second condition; it is the first one restated, and it only costs coverage.
#
# ── MAX_MOVE_PCT = 60.0 — a DIFFERENT concern, not a stricter ATM bound ───────
# A perfectly at-the-money strike can still be priced off a wide/stale quote.
# Proven by the data, not assumed: at EVERY ATM bound from 0.02 to 0.30 the
# worst surviving row is PEPG at 409.09% — spot 1.98, strike 2.00, moneyness
# 0.0101. No tightening of the ATM bound reaches it; only an output bound does.
# Others in the same class: RC 132.45% (moneyness 0.0066), GNLX 121.00%
# (0.0000), HYPR 100.00% (0.0000), CDLX 97.19% (0.0220).
#
# Placement, from the pct histogram of the 651 ATM-valid rows. The real
# population decays by roughly half per 5-point bucket and then simply stops:
#     [15,20) 110  [20,25) 67  [25,30) 19  [30,35) 12  [35,40) 7
#     [40,45)   2  [45,50)  2  [50,55)  2  [55,60)  2  [60,70) 4
#     [70,80)   2  [80,100) 5  [100,150) 3  [150,+) 3
# Extrapolating the decay past 40% predicts well under one row per bucket above
# 55%; 17 are observed above 60%. That non-decaying tail is the wide-quote
# population. 60.0 is chosen as the most CONSERVATIVE cut that still sits
# wholly inside it (40 would refuse 25 rows, 50 would refuse 21, 60 refuses
# 17) — this bound is a backstop, and an output bound that fires on real data
# is worse than one that lets a marginal row through. The three genuine rows
# this fix must not touch sit at 7.41% / 3.68% / 6.59%, i.e. 8-16x inside it.
MAX_ATM_MONEYNESS = 0.10
MAX_MOVE_PCT = 60.0

# "We had the data and refuse to publish a number."
REFUSED_NO_ATM_STRIKE = "no_atm_strike"
REFUSED_IMPLAUSIBLE_MOVE = "implausible_move"
REFUSED_NO_QUOTED_STRADDLE = "no_quoted_straddle"
# "We never got the data." A different fact, and the record must say which.
UNAVAILABLE_NO_EXPIRY = "no_expiry"
UNAVAILABLE_NO_CHAIN = "chain_unavailable"
UNAVAILABLE_NO_SPOT = "spot_unavailable"
# The read itself never came back. NOT a refusal: nothing was evaluated, so
# nothing could have been refused. A caller that let a timeout render as
# "we could not price this" would be stating a confident falsehood — the exact
# class of defect the ATM/output bounds exist to remove.
UNAVAILABLE_TIMEOUT = "chain_timeout"
UNAVAILABLE_READ_ERROR = "read_error"

REFUSAL_REASONS = frozenset({
    REFUSED_NO_ATM_STRIKE, REFUSED_IMPLAUSIBLE_MOVE, REFUSED_NO_QUOTED_STRADDLE,
})
UNAVAILABLE_REASONS = frozenset({
    UNAVAILABLE_NO_EXPIRY, UNAVAILABLE_NO_CHAIN, UNAVAILABLE_NO_SPOT,
    UNAVAILABLE_TIMEOUT, UNAVAILABLE_READ_ERROR,
})

# The closed vocabulary a UI may switch on. `outcome_kind` below is the ONLY
# function that produces one, so this frozenset is its range — never a second
# list that could drift out of step with it.
KIND_OK = "ok"
KIND_REFUSED = "refused"
KIND_UNAVAILABLE = "unavailable"
KINDS = frozenset({KIND_OK, KIND_REFUSED, KIND_UNAVAILABLE})


def outcome_kind(reason: str | None) -> str:
    """'refused' | 'unavailable' | 'ok'. Keeps "we could not price this" and
    "we did not get to try" separable everywhere they are recorded — the same
    distinction the coverage work draws between `dropped` and `not_computable`.
    An unknown reason reads as 'unavailable': a caller must never be able to
    claim a REFUSAL it cannot name."""
    if reason is None:
        return KIND_OK
    return KIND_REFUSED if reason in REFUSAL_REASONS else KIND_UNAVAILABLE


def wire_outcome(outcome: dict | None) -> dict | None:
    """`{kind, reason}` — the member-facing projection of an out-dict.

    THE serializer both member-facing routers use, so the calendar and the
    research endpoint can never describe the same absence two different ways.

      • `kind` is the small closed vocabulary (`KINDS`) a UI switches on, and it
        comes from `outcome_kind`, not from a second reading of the reason. A
        SEVENTH reason added above therefore renders correctly on day one and,
        because an unrecognised reason reads as `unavailable`, can never claim
        to be a refusal it cannot name.
      • `reason` is the specific cause, for support and logs. It is never blank
        on a not-ok outcome: an out-dict that failed without naming a reason
        degrades to `read_error` rather than serializing an empty string a
        surface would have to render as nothing.
      • `evidence` is deliberately NOT serialized — internal audit detail
        (strike/spot/moneyness), not a member-facing fact.

    Returns None for a missing or empty out-dict. "Nothing was attempted" (a
    past report; the caller never asked) is a DIFFERENT fact from "attempted and
    came back empty", and the two must stay different on the wire — collapsing
    them is how one `null` came to mean six things in the first place.
    """
    if not outcome:
        return None
    if outcome.get("ok"):
        return {"kind": KIND_OK, "reason": None}
    reason = outcome.get("reason") or UNAVAILABLE_READ_ERROR
    return {"kind": outcome_kind(reason), "reason": reason}


def atm_moneyness(strike, spot) -> float | None:
    """|K - S| / S, or None when it cannot be established at all."""
    try:
        k, s = float(strike), float(spot)
    except (TypeError, ValueError):
        return None
    if not (s > 0):
        return None
    return abs(k - s) / s


def refusal_for(pct, strike, spot) -> str | None:
    """THE bound, and the only place it lives. Returns the refusal reason, or
    None when the number is defensible.

    The live chain path (`evaluate_straddle`), the historical backfill (which
    reaches it through `straddle_from_rows`) and the stored-row purge
    (`implied_store.purge_unsupported_snapshots`) all call THIS — so the three
    can never drift into disagreeing about what is publishable. Deriving the
    same verdict twice is how a count and its drill-down come apart silently.

    Refuses; never clamps, never substitutes a neighbouring strike. Order is
    deliberate: a strike that is not at the money is the PRIMARY cause, so it
    names itself even when the fabricated percentage is also implausible."""
    moneyness = atm_moneyness(strike, spot)
    if moneyness is None or moneyness > MAX_ATM_MONEYNESS:
        return REFUSED_NO_ATM_STRIKE
    try:
        p = float(pct)
    except (TypeError, ValueError):
        return REFUSED_IMPLAUSIBLE_MOVE
    if not (p > 0) or p > MAX_MOVE_PCT:
        return REFUSED_IMPLAUSIBLE_MOVE
    return None


def evaluate_straddle(calls: list[dict], puts: list[dict], spot: float) -> dict:
    """The ATM-straddle math, plus the single verdict on whether the result is
    publishable. Always a dict, never raises:

        {"ok": True,  "move": {...}}
        {"ok": False, "kind": "refused"|"unavailable", "reason": <str>,
         "evidence": {...}}

    `evidence` carries the numbers the verdict was taken on (strike, spot,
    moneyness, pct) so a refusal is auditable instead of merely silent.
    """
    if not (spot and spot > 0):
        return {"ok": False, "kind": KIND_UNAVAILABLE, "reason": UNAVAILABLE_NO_SPOT,
                "evidence": {"spot": spot}}

    def _atm(rows: list[dict]) -> dict | None:
        valid = []
        for r in rows or []:
            try:
                valid.append((abs(float(r["strike"]) - spot), r))
            except (TypeError, ValueError, KeyError):
                continue
        if not valid:
            return None
        # min() is deterministic on ties: first (= lowest strike, ascending sort) wins
        return min(valid, key=lambda t: t[0])[1]

    call, put = _atm(calls), _atm(puts)
    no_pair = {"ok": False, "kind": KIND_REFUSED, "reason": REFUSED_NO_QUOTED_STRADDLE,
               "evidence": {"spot": spot}}
    if not call or not put:
        return no_pair
    try:
        if float(call["strike"]) != float(put["strike"]):
            return no_pair
    except (TypeError, ValueError, KeyError):
        return no_pair
    call_mid, put_mid = _mid(call), _mid(put)
    if call_mid is None or put_mid is None:
        return no_pair
    dollar = call_mid + put_mid
    if dollar <= 0:
        return no_pair
    strike = float(call["strike"])
    move = {
        "pct": dollar / spot * 100,
        "dollar": dollar,
        "strike": strike,
        "spot": spot,
        "call_mid": call_mid,
        "put_mid": put_mid,
        "iv_atm": call.get("iv"),
    }
    reason = refusal_for(move["pct"], strike, spot)
    if reason is not None:
        return {"ok": False, "kind": outcome_kind(reason), "reason": reason,
                "evidence": {"strike": strike, "spot": spot, "pct": move["pct"],
                             "moneyness": atm_moneyness(strike, spot)}}
    return {"ok": True, "move": move}


def straddle_from_rows(calls: list[dict], puts: list[dict], spot: float) -> dict | None:
    """The ATM-straddle math itself, over already-fetched option rows.

    Extracted so the HISTORICAL backfill (implied_backfill.py) computes an
    expected move by CALLING this, never by reimplementing it. A backfilled
    quarter and a live capture that disagreed on method would be worse than no
    backfill at all: the RICH/CHEAP verdict compares them to each other, so a
    method fork shows up as a fake edge, not as an obvious bug. That is also
    why the ATM/output bounds live inside `evaluate_straddle` below rather than
    in the live caller — the backfill inherits them for free and cannot fork.

    Rows need only `strike`, `bid`, `ask` (and optionally `iv`) — the same
    shape `polygon_options.get_chain` returns and the same shape the backfill
    assembles from historical NBBO quotes. Returns None when there is no usable
    ATM pair OR when the result is refused (see `refusal_for`); callers that
    need to know WHICH call `evaluate_straddle` directly.
    """
    result = evaluate_straddle(calls, puts, spot)
    return result["move"] if result["ok"] else None


def compute_expected_move_result(sym: str, report_date: str | None) -> dict:
    """`compute_expected_move`, but tagged: always a dict, shaped exactly like
    `evaluate_straddle`'s. This is the primitive; the None-returning function
    below is the adapter every existing caller keeps using."""
    exps = polygon_options.list_expirations(sym)
    expiry = select_report_expiry(exps.get("expirations") or [], report_date)
    if not expiry:
        _log.debug("expected_move %s: no valid expiry", sym)
        return {"ok": False, "kind": KIND_UNAVAILABLE, "reason": UNAVAILABLE_NO_EXPIRY,
                "evidence": {}}
    chain = polygon_options.get_chain(sym, expiration=expiry, strikes_around_spot=4)
    if "error" in chain:
        _log.debug("expected_move %s: chain error", sym)
        return {"ok": False, "kind": KIND_UNAVAILABLE, "reason": UNAVAILABLE_NO_CHAIN,
                "evidence": {"expiry": expiry}}

    try:
        spot = float(chain.get("spot") or 0)
    except (TypeError, ValueError):
        _log.debug("expected_move %s: non-numeric spot", sym)
        return {"ok": False, "kind": KIND_UNAVAILABLE, "reason": UNAVAILABLE_NO_SPOT,
                "evidence": {"expiry": expiry}}
    if spot <= 0:
        _log.debug("expected_move %s: spot not positive", sym)
        return {"ok": False, "kind": KIND_UNAVAILABLE, "reason": UNAVAILABLE_NO_SPOT,
                "evidence": {"expiry": expiry, "spot": spot}}

    result = evaluate_straddle(chain.get("calls") or [], chain.get("puts") or [], spot)
    if not result["ok"]:
        _log.debug("expected_move %s: %s (%s)", sym, result["reason"], result.get("evidence"))
        return {**result, "evidence": {**result.get("evidence", {}), "expiry": expiry}}
    return {"ok": True, "move": {
        **result["move"],
        "expiry": expiry,
        "horizon": f"through {expiry}",
        "asof": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "massive-chain",
    }}


def compute_expected_move(sym: str, report_date: str | None,
                          *, outcome: dict | None = None) -> dict | None:
    """Adapter over `compute_expected_move_result` — unchanged contract.

    `outcome` is an optional OUT-dict (the idiom this repo already uses for
    breadth's drill `members`): it is filled with the tagged result minus the
    payload, so a caller that needs to record WHY nothing came back gets it
    from the SAME evaluation, never from a second pass."""
    result = compute_expected_move_result(sym, report_date)
    if outcome is not None:
        outcome.clear()
        outcome.update({k: v for k, v in result.items() if k != "move"})
    return dict(result["move"]) if result["ok"] else None


# ── Task 3: TTL cache + serve-stale front for `compute_expected_move` ──────────
#
# Mirrors the composition `_WEEKLY_STALE` uses in `api/routers/calendar.py`:
# a 15-min TTL cache for the instant-fresh path, backed by a ServeStale slot
# that serves the last good straddle (bounded 2h) while a rebuild runs behind
# the caller, with single-flight collapsing concurrent cold callers onto one
# `compute_expected_move` call via ServeStale's per-key build lock. A failed
# build is never written to either cache — `_move_is_good` is the gate.
_MOVE_CACHE = TTLCache()
_MOVE_TTL = 900  # 15 min — IV moves through the session, but not tick-by-tick
_MOVE_STALE = ServeStale("expected_move", max_age_seconds=7200)


def _move_is_good(payload: dict | None) -> bool:
    """A None/failed build must never become the value the next caller sees."""
    return payload is not None


def get_expected_move(sym: str, report_date: str | None = None,
                      *, outcome: dict | None = None) -> dict | None:
    """Cached front for `compute_expected_move`: fresh TTL cache wins; else the
    last good straddle serves the gap while a background refresh runs; else
    this caller builds synchronously (single-flight).

    Copy discipline: the TTL cache, the ServeStale slot, and the value handed
    back to THIS caller are three independent dict objects. `TTLCache.get()`
    returns the exact object it was given (no internal copy), so without this
    a caller mutating its returned payload (e.g. `out["pct"] = ...`) would
    corrupt what every future caller — and the stale-serve fallback — sees.

    `outcome` is an optional OUT-dict carrying WHY nothing came back
    (`{"ok": False, "kind": "refused"|"unavailable", "reason": ...}`), taken
    from the same build this call performed. A refusal is deliberately still
    not cached (`_move_is_good` is unchanged) — the value we would be
    remembering is the absence of a number, and a chain that re-lists a strike
    should be able to answer tomorrow without waiting out a TTL."""
    key = f"expmove::{(sym or '').upper()}::{report_date or ''}"
    built: dict = {}

    def _build():
        oc: dict = {}
        value = compute_expected_move(sym, report_date, outcome=oc)
        built.clear()
        built.update(oc)
        if value is not None:
            _MOVE_CACHE.set(key, dict(value), _MOVE_TTL)
        return value

    result = _MOVE_STALE.serve(
        key,
        fresh=lambda: _MOVE_CACHE.get(key),
        build=_build,
        good=_move_is_good,
    )
    if outcome is not None:
        outcome.clear()
        # A served (fresh or stale) payload never re-ran `_build`, so `built`
        # is empty and the honest report is simply "ok".
        outcome.update({"ok": True} if result is not None
                       else (dict(built) or {"ok": False, "kind": KIND_UNAVAILABLE,
                                             "reason": UNAVAILABLE_NO_CHAIN}))
    return dict(result) if result is not None else None
