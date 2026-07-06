"""Compass grade_ticker — the unskippable verdict.

Composes the already-shipped Compass tools into a decisive, tool-sourced
GO/HOLD/SKIP verdict for a single ticker. Decisiveness is STRUCTURAL:
deterministic hard-gates force the verdict, so the calling model can neither
hedge (the verdict is computed here) nor fabricate (entry/stop/target come
from the pattern engine, size from brain_service.size_a_trade, regime from the
classifier). Never raises — returns {ok: False, reason} when the gate can't run.

See docs/superpowers/specs/2026-07-02-compass-grade-ticker-verdict-design.md.
"""
from __future__ import annotations

import logging

_log = logging.getLogger("grade_ticker")

_EXTENDED_PCT = 0.03      # >3% past the pivot = "extended" (long)
_RISK_CAP_PCT = 2.0       # account-risk hard cap (mirrors size_a_trade)
_DEFAULT_ACCOUNT = 50000.0

# raw classifier label -> exposure band
_REGIME_BAND = {
    "bull_trend": "GREEN", "bull_correction": "YELLOW",
    "distribution": "ORANGE", "chop": "YELLOW", "bear_trend": "RED",
}


def _regime_band(raw: str) -> str:
    return _REGIME_BAND.get((raw or "").lower(), "YELLOW")


def _grade_from_confidence(conf: float) -> str:
    c = float(conf or 0)
    if c >= 80:
        return "A"
    if c >= 65:
        return "B+"
    if c >= 55:
        return "B"
    if c >= 40:
        return "C"
    return "F"


def _default_regime_fn():
    from api.services.voice_regime_classifier import get_current_regime
    return get_current_regime()


def _default_quote_fn(symbol):
    from api.services.voice_tool_impls import _get_quote
    return _get_quote(symbol)


def _default_patterns_fn(symbol):
    from api.services.pattern_engine import memory as _mem
    try:
        from api.routers import patterns as _p  # noqa: F401 — loads detector registry
    except Exception:  # noqa: BLE001
        pass
    return _mem.get_active_detections(sym=symbol.upper(), tf="D", min_conf=50)


def _default_playbook_fn(setup_name):
    from api.services import brain_service
    return brain_service.lookup_playbook(setup_name)


def _default_size_fn(entry, stop, account, regime="", grade="A", risk_pct=1.0):
    from api.services import brain_service
    out = brain_service.size_a_trade(entry=entry, stop=stop, account=account,
                                     regime=regime, grade=grade, risk_pct=risk_pct)
    # The engine returns `max_position_pct` as a 0-1 FRACTION (0.2 == 20%), but
    # grade_ticker + `account_risk_pct` speak PERCENT — so the "size {size_pct}%"
    # basis would read "0.2%" (100x low) without this. Normalize the one field.
    if isinstance(out, dict) and out.get("max_position_pct") is not None:
        try:
            out = {**out, "max_position_pct": round(float(out["max_position_pct"]) * 100, 1)}
        except (TypeError, ValueError):
            pass
    return out


def grade_ticker(symbol, account_size=None, *, regime_fn=None, quote_fn=None,
                 patterns_fn=None, playbook_fn=None, size_fn=None) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"ok": False, "reason": "no symbol"}
    regime_fn = regime_fn or _default_regime_fn
    quote_fn = quote_fn or _default_quote_fn
    patterns_fn = patterns_fn or _default_patterns_fn
    playbook_fn = playbook_fn or _default_playbook_fn
    size_fn = size_fn or _default_size_fn
    account = float(account_size or _DEFAULT_ACCOUNT)

    # ── the gate: regime + quote must be available ──────────────────────────
    try:
        regime = regime_fn() or {}
    except Exception:  # noqa: BLE001
        regime = {}
    if not regime or not (regime.get("regime") or regime.get("label")):
        return {"ok": False, "reason": "regime unavailable — cannot grade without the gate"}
    band = _regime_band(regime.get("regime") or regime.get("label"))
    regime_note = regime.get("narration") or f"Regime {band}."

    try:
        quote = quote_fn(sym) or {}
    except Exception:  # noqa: BLE001
        quote = {}
    last = float(quote.get("last") or 0)

    hard_flags: list[str] = []
    sources: list[str] = [f"regime classifier ({band})"]

    # ── setup identification ────────────────────────────────────────────────
    try:
        detections = patterns_fn(sym) or []
    except Exception:  # noqa: BLE001
        detections = []
    top = max(detections, key=lambda d: (d.get("confidence") or 0), default=None) if detections else None
    levels = (top or {}).get("levels") or {}
    entry = levels.get("entry")
    stop = levels.get("stop")
    target = levels.get("target_primary")

    if not top or entry is None or stop is None:
        return _verdict(ok=True, symbol=sym, verdict="SKIP", regime=band,
                        regime_note=regime_note, setup=None, grade=None,
                        entry=None, stop=None, size_pct=None, account_risk_pct=None,
                        first_target=None,
                        basis=f"No clean, tradable setup on {sym} right now — nothing to grade. Wait for a real pattern to form.",
                        hard_flags=["no_setup"], sources=sources)

    setup = top.get("pattern_name") or "setup"
    grade = _grade_from_confidence(top.get("confidence"))
    sources.append(f"pattern engine: {setup} (conf {int(top.get('confidence') or 0)})")

    # ── playbook (best-effort colour + win-rate) ────────────────────────────
    winrate = None
    try:
        pb = playbook_fn(setup) or {}
        if pb.get("ok"):
            winrate = (pb.get("winrate") or {}).get("win_rate_pct")
            sources.append(f"playbook: {pb.get('name')}")
    except Exception:  # noqa: BLE001
        pass

    # ── sizing (risk-first, tool-sourced) ───────────────────────────────────
    # Robust to both the injected-fake keys and the real engine's
    # calculate_position_size keys (max_position_pct / dollar_risk / risk_pct /
    # r1_target / recommendation). The engine returns recommendation="SKIP" (and
    # shares 0) when the regime×grade sizing table says do-not-size — an
    # authoritative veto we surface as a hard flag.
    size_pct = account_risk_pct = first_target = None
    try:
        sized = size_fn(entry, stop, account, band, grade, 1.0) or {}
        if sized.get("ok"):
            size_pct = sized.get("max_position_pct")
            if sized.get("account_risk") is not None:
                account_risk_pct = sized.get("account_risk")
            elif sized.get("risk_pct") is not None:
                account_risk_pct = sized.get("risk_pct")
            first_target = sized.get("r1_target") or sized.get("first_target")
            if str(sized.get("recommendation", "")).upper() == "SKIP" or sized.get("shares") == 0:
                hard_flags.append("size_skip")
            sources.append("size_a_trade (regime-scaled, 2% cap)")
    except Exception:  # noqa: BLE001
        pass

    stop_pct = round(abs(entry - stop) / entry * 100, 1) if entry else None
    extended = last > entry * (1 + _EXTENDED_PCT) if (last and entry) else False

    # ── deterministic verdict ───────────────────────────────────────────────
    if band == "RED":
        hard_flags.append("regime_red")
    if grade in ("C", "F"):
        hard_flags.append("grade_below_b")
    if account_risk_pct is not None and account_risk_pct > _RISK_CAP_PCT:
        hard_flags.append("risk_over_cap")
    if size_pct is None:
        # "size before entry" — an idea we cannot size is not a tradable call.
        hard_flags.append("size_unavailable")
    if extended:
        hard_flags.append("extended")

    if any(f in hard_flags for f in ("regime_red", "no_setup", "grade_below_b",
                                     "risk_over_cap", "size_skip", "size_unavailable")):
        verdict = "SKIP"
    elif "extended" in hard_flags or band == "ORANGE" or (band == "YELLOW" and grade == "B"):
        verdict = "HOLD"
    else:
        verdict = "GO"

    wr_txt = f", historically {winrate:.0f}% over the firm's book" if winrate else ""
    basis = (f"{setup} on {sym}, graded {grade}{wr_txt}. Regime {band} — {regime_note} "
             f"Entry {entry}, stop {stop} ({stop_pct}% risk), size {size_pct}% "
             f"for {account_risk_pct}% account risk.")
    if verdict == "HOLD":
        basis += " Tape or extension is the knock — half size or wait for it to firm up."

    return _verdict(ok=True, symbol=sym, verdict=verdict, regime=band,
                    regime_note=regime_note, setup=setup, grade=grade,
                    entry=entry, stop=stop, size_pct=size_pct,
                    account_risk_pct=account_risk_pct, first_target=first_target,
                    basis=basis, hard_flags=hard_flags, sources=sources,
                    stop_pct=stop_pct)


def _verdict(*, ok, symbol, verdict, regime, regime_note, setup, grade, entry,
             stop, size_pct, account_risk_pct, first_target, basis, hard_flags,
             sources, stop_pct=None):
    return {
        "ok": ok, "symbol": symbol, "verdict": verdict, "regime": regime,
        "regime_note": regime_note, "setup": setup, "grade": grade,
        "entry": entry, "stop": stop,
        "stop_pct": stop_pct if stop_pct is not None else (
            round(abs(entry - stop) / entry * 100, 1) if (entry and stop) else None),
        "size_pct": size_pct, "account_risk_pct": account_risk_pct,
        "first_target": first_target, "basis": basis,
        "hard_flags": hard_flags, "sources": sources,
    }
