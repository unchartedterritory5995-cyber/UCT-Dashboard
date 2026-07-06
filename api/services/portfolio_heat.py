"""Compass portfolio_heat — structural portfolio-state read (NO GO-path).

Answers "what's my heat / am I too exposed / most at risk" with two metrics
that are NEVER blended: risk-heat (Sigma(entry-stop)*shares / capital vs the
10% Desjardins aggregate cap) and notional exposure (Sigma position% vs the
regime ceiling). SAFETY: broker placeholder stops (stop==entry) are excluded
from the confident heat number and surfaced, because counting them as 0-risk
under-reports heat and would green-light an over-cap add. Never raises."""
from __future__ import annotations

import logging

_log = logging.getLogger("portfolio_heat")

_DEFAULT_ACCOUNT = 50000.0
_PER_TRADE_CAP_PCT = 2.0
_DEFAULT_AGG_CAP_PCT = 10.0


def _regime_ceiling_pct(exposure_rating) -> float:
    """UCT exposure rating (0-150) -> notional exposure ceiling %."""
    try:
        e = float(exposure_rating)
    except (TypeError, ValueError):
        return 60.0
    if e >= 100:
        return 100.0
    if e >= 70:
        return 80.0
    if e >= 40:
        return 60.0
    if e >= 15:
        return 40.0
    return 20.0


def _aggregate_cap_pct(cap_fn=None) -> float:
    if cap_fn is not None:
        try:
            v = cap_fn()
            return float(v) if v is not None else _DEFAULT_AGG_CAP_PCT
        except Exception:  # noqa: BLE001
            return _DEFAULT_AGG_CAP_PCT
    try:
        from api.services import brain_service
        v = brain_service.aggregate_heat_cap_pct()
        return float(v) if v else _DEFAULT_AGG_CAP_PCT
    except Exception:  # noqa: BLE001
        return _DEFAULT_AGG_CAP_PCT


def _sectors_for(sym: str) -> set:
    try:
        from api.services.voice_position_sizing import _sectors_for_symbol
        return _sectors_for_symbol(sym) or set()
    except Exception:  # noqa: BLE001
        return set()


def _default_positions_fn(user_id, account_id):
    from api.services.journal_two import positions as j2
    return j2.list_open_positions(user_id, account_id=account_id) or []


def _default_regime_fn():
    from api.services.voice_regime_classifier import get_current_regime
    r = get_current_regime() or {}
    return {"regime": r.get("regime"),
            "exposure_rating": r.get("uct_exposure_rating") or
            (r.get("signals") or {}).get("uct_exposure_rating"),
            "narration": r.get("narration")}


def portfolio_heat(user_id, account_id=None, account_size=None, *,
                   positions_fn=None, regime_fn=None, cap_fn=None) -> dict:
    positions_fn = positions_fn or _default_positions_fn
    regime_fn = regime_fn or _default_regime_fn
    try:
        account = float(account_size) if account_size else None
    except (TypeError, ValueError):
        account = None
    try:
        positions = positions_fn(user_id, account_id) or []
    except Exception:  # noqa: BLE001
        return {"ok": False, "reason": "could not read open positions"}
    if account is None:
        try:
            from api.services.voice_position_sizing import _get_account_settings
            account = float((_get_account_settings(user_id, account_id) or {}).get("account_size") or 0) or None
        except Exception:  # noqa: BLE001
            account = None
    account = account or _DEFAULT_ACCOUNT

    try:
        regime = regime_fn() or {}
    except Exception:  # noqa: BLE001
        regime = {}
    ceiling = _regime_ceiling_pct(regime.get("exposure_rating"))
    agg_cap = _aggregate_cap_pct(cap_fn)

    per_position, by_symbol, by_sector = [], {}, {}
    placeholder_stops, real_risk, notional = [], 0.0, 0.0
    for p in positions:
        sym = (p.get("symbol") or "").upper()
        if not sym:
            continue
        try:
            entry = float(p.get("entry_price"))
            shares = float(p.get("shares"))
        except (TypeError, ValueError):
            continue
        # A null / missing / non-numeric stop is a PLACEHOLDER (no real stop) —
        # surface it, never silently drop it (dropping it under-reports heat and
        # would let a confident over-cap add escape the no-GO guard).
        try:
            stop = float(p.get("stop_price"))
            is_placeholder = (stop == entry) or stop <= 0
        except (TypeError, ValueError):
            stop, is_placeholder = entry, True
        risk = shares * abs(entry - stop)
        notional += shares * entry
        rec = {"symbol": sym, "side": p.get("side") or "long",
               "dist_to_stop_pct": round(abs(entry - stop) / entry * 100, 2) if entry else None,
               "r_multiple": None,
               "risk_pct": round(risk / account * 100, 2) if account else None,
               "placeholder_stop": is_placeholder}
        per_position.append(rec)
        if is_placeholder:
            placeholder_stops.append(sym)
            rec["risk_pct"] = None  # not a confident number
            continue
        real_risk += risk
        by_symbol[sym] = by_symbol.get(sym, 0.0) + risk
        for sec in _sectors_for(sym):
            by_sector[sec] = by_sector.get(sec, 0.0) + risk

    risk_heat_pct = round(real_risk / account * 100, 2) if account else 0.0
    notional_pct = round(notional / account * 100, 2) if account else 0.0
    room = round(max(0.0, agg_cap - risk_heat_pct), 2)

    return {
        "ok": True,
        "risk_heat_pct": risk_heat_pct,
        "notional_exposure_pct": notional_pct,
        "per_position": per_position,
        "by_symbol": [{"symbol": s, "risk_pct": round(r / account * 100, 2)}
                      for s, r in sorted(by_symbol.items(), key=lambda kv: kv[1], reverse=True)],
        "by_sector": [{"sector": s, "risk_pct": round(r / account * 100, 2)}
                      for s, r in sorted(by_sector.items(), key=lambda kv: kv[1], reverse=True)],
        "concentration_flags": [{"sector": s, "risk_pct": round(r / account * 100, 2)}
                                for s, r in by_sector.items()
                                if real_risk > 0 and r / real_risk > 0.40],
        "placeholder_stops": placeholder_stops,
        "caps": {"per_trade_pct": _PER_TRADE_CAP_PCT, "aggregate_pct": round(agg_cap, 2),
                 "regime_ceiling_pct": ceiling},
        "room_to_add_pct": room,
        "regime": regime.get("regime"),
        "sources": [f"open positions ({len(positions)})",
                    "risk-heat vs 10% Desjardins cap",
                    f"regime {regime.get('regime')}"],
    }
