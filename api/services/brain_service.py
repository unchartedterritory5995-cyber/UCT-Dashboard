# api/services/brain_service.py
"""Shared facade over the uct-intelligence engine (the Brain Pack).

Single point both Compass surfaces (voice tools + text-chat tools) call, so
voice and text can never diverge. Every function is guarded: when the pack
is not installed / importable it returns {"ok": False, "error": "brain not
available"} instead of raising.
"""
from __future__ import annotations

import logging
import os
import sys

log = logging.getLogger("brain_service")

_ENGINE = None
_ENGINE_TRIED = False

_UNAVAILABLE = {"ok": False, "error": "brain not available"}

# The 5-way -> GREEN/YELLOW/ORANGE/RED sizing band is NOT restated here: it
# lives once, as voice_regime_classifier.REGIME_BAND / band_of (TERM-071).


def _reset_for_tests() -> None:
    """Clear the cached engine AND any imported uct_intelligence modules.

    Popping sys.modules matters: without it, a prior import of
    uct_intelligence from a DIFFERENT path would be silently served by
    Python's module cache and the facade would answer from the wrong DB.
    """
    global _ENGINE, _ENGINE_TRIED
    _ENGINE = None
    _ENGINE_TRIED = False
    for mod in list(sys.modules):
        if mod == "uct_intelligence" or mod.startswith("uct_intelligence."):
            sys.modules.pop(mod, None)


def _engine():
    """Lazy import of uct_intelligence.api from the installed Brain Pack."""
    global _ENGINE, _ENGINE_TRIED
    if _ENGINE is not None or _ENGINE_TRIED:
        return _ENGINE
    _ENGINE_TRIED = True
    try:
        from api.services import brain_sync
        path = os.environ.get("UCT_INTEL_PATH") or brain_sync.brain_dir()
        if not os.path.isdir(os.path.join(path, "uct_intelligence")):
            return None
        if path not in sys.path:
            sys.path.insert(0, path)
        import uct_intelligence.api as uct  # noqa: PLC0415
        _ENGINE = uct
    except Exception:
        log.exception("brain engine import failed")
        _ENGINE = None
    return _ENGINE


def available() -> bool:
    return _engine() is not None


def aggregate_heat_cap_pct() -> float:
    """Firm TOTAL open-heat cap (Desjardins File 3 §1), read from the brain.
    Fail-soft 10.0. NEVER derived as N× per-trade (would drift if per-trade is
    reconfigured). Accepts an explicit engine accessor if the pack exposes one;
    otherwise the documented default."""
    uct = _engine()
    if uct is None:
        return 10.0
    try:
        acc = getattr(uct, "aggregate_heat_cap_pct", None)
        if callable(acc):
            v = acc()
            if v:
                return float(v)
    except Exception:  # noqa: BLE001
        pass
    return 10.0


def _current_regime() -> str:
    """Read the dashboard's own live regime classifier
    (api.services.voice_regime_classifier.get_current_regime) and map its
    5-way label (bull_trend/bull_correction/distribution/chop/bear_trend)
    onto the engine's GREEN/YELLOW/ORANGE/RED sizing scale. Falls back to
    YELLOW on any failure (unknown regime, import error, etc.).

    The band comes from the authority's `band_of` (TERM-071) — the same call
    grade_ticker's verdict gate makes — so the two can never disagree."""
    try:
        from api.services import voice_regime_classifier as vrc
    except Exception:
        return "YELLOW"  # the authority itself is unreachable
    try:
        r = vrc.get_current_regime() or {}
    except Exception:
        return vrc.band_of(None)
    return vrc.band_of(r.get("regime"))


def _engine_lookup_playbook(setup_name: str) -> dict:
    uct = _engine()
    if uct is None:
        return dict(_UNAVAILABLE)
    try:
        canonical = uct.resolve_setup_name(setup_name) or setup_name
        t = uct.get_setup_template(canonical)
        if not t:
            return {"ok": False, "reason": f"no setup template named '{setup_name}'"}
        winrate = None
        try:
            winrate = uct.get_setup_performance(t["name"])
        except Exception:
            pass
        return {
            "ok": True,
            "name": t.get("name"),
            "family": t.get("family"),
            "origin_trader": t.get("origin_trader"),
            "description": t.get("description"),
            "aliases": t.get("aliases"),
            "ideal_regime": t.get("ideal_regime"),
            "entry_triggers": t.get("entry_triggers"),
            "stop_methods": t.get("stop_methods"),
            "max_stop_pct": t.get("max_stop_pct"),
            "profit_logic": t.get("profit_logic"),
            "invalidation": t.get("invalidation"),
            "common_mistakes": t.get("common_mistakes"),
            "winrate": winrate,
            "source": f"setup template: {t.get('name')} (origin: {t.get('origin_trader')})",
        }
    except Exception as e:
        log.exception("lookup_playbook failed")
        return {"ok": False, "error": str(e)}


def _engine_setup_winrate(setup: str, regime: str = "ALL") -> dict:
    uct = _engine()
    if uct is None:
        return dict(_UNAVAILABLE)
    try:
        regime = (regime or "ALL").upper()
        canonical = uct.resolve_setup_name(setup) or setup
        perf = uct.get_setup_performance(canonical, regime)
        if not perf:
            return {"ok": False, "setup": canonical, "regime": regime,
                    "reason": "not enough sample (<5 trades) for this setup/regime"}
        out = {"ok": True, "setup": canonical, "regime": regime}
        for k in ("total_trades", "wins", "losses", "win_rate_pct",
                  "avg_gain_pct", "avg_loss_pct", "expectancy"):
            if k in perf:
                out[k] = perf[k]
        return out
    except Exception as e:
        log.exception("setup_winrate failed")
        return {"ok": False, "error": str(e)}


def _engine_find_historical_analogs(setup_type: str, regime: str = "", sector: str = "",
                                    limit: int = 5) -> dict:
    uct = _engine()
    if uct is None:
        return dict(_UNAVAILABLE)
    try:
        reg = (regime or _current_regime()).upper()
        canonical = uct.resolve_setup_name(setup_type) or setup_type
        analogs = uct.get_historical_analogs(canonical, reg, sector or "", int(limit))
        return {"ok": True, "setup": canonical, "regime": reg, "analogs": analogs or []}
    except Exception as e:
        log.exception("find_historical_analogs failed")
        return {"ok": False, "error": str(e)}


# ── the team archive: a LABELLED second source beside the engine ─────────────
#
# ⛔ The engine stays the primary answer wherever it answers. The team archive (the UCT team's own
# posted calls, outcomes measured after the fact) rides beside it under `team_archive`, never
# averaged into or substituted for an engine number. Off (WISDOM_ARCHIVE_ENABLED unset), not
# imported, or unmapped: the key is simply absent, and every engine answer is byte-identical to
# what it was before. One door into the wisdom package (R50 DECLARED_DOORS), here, so voice,
# chat and grade_ticker can never diverge.

def _team_archive_module():
    try:
        from api.services.wisdom.archive import team_record
        return team_record
    except Exception:  # noqa: BLE001
        log.exception("team archive unavailable")
        return None


def team_archive_setup(setup_name: str):
    """The archive's measured record for a setup (engine name, detector id or alias), or None."""
    tr = _team_archive_module()
    return tr.setup_record(setup_name) if tr is not None else None


def team_archive_analogs(setup_name: str, limit: int = 5):
    tr = _team_archive_module()
    return tr.analogs(setup_name, limit=limit) if tr is not None else None


def team_archive_ticker(symbol: str, setup: str = ""):
    tr = _team_archive_module()
    return tr.ticker_record(symbol, setup=setup or None) if tr is not None else None


def team_archive_sentence(setup_rec, ticker_rec=None) -> str:
    tr = _team_archive_module()
    return tr.sentence(setup_rec, ticker_rec) if tr is not None else ""


def _with_team_archive(result: dict, rec) -> dict:
    if not rec:
        return result
    return {**(result or {}), "team_archive": rec}


def lookup_playbook(setup_name: str) -> dict:
    return _with_team_archive(_engine_lookup_playbook(setup_name), team_archive_setup(setup_name))


def setup_winrate(setup: str, regime: str = "ALL") -> dict:
    return _with_team_archive(_engine_setup_winrate(setup, regime), team_archive_setup(setup))


def find_historical_analogs(setup_type: str, regime: str = "", sector: str = "",
                            limit: int = 5) -> dict:
    return _with_team_archive(_engine_find_historical_analogs(setup_type, regime, sector, limit),
                              team_archive_analogs(setup_type, limit))


def size_a_trade(entry: float, stop: float, account: float, regime: str = "",
                 grade: str = "A", risk_pct: float = 1.0) -> dict:
    uct = _engine()
    if uct is None:
        return dict(_UNAVAILABLE)
    try:
        entry, stop, account = float(entry), float(stop), float(account)
        if entry <= 0 or stop <= 0 or account <= 0:
            return {"ok": False, "reason": "entry, stop and account must be positive"}
        if stop >= entry:
            return {"ok": False,
                    "reason": "stop must sit below entry for a long — size only ever comes after the stop"}
        reg = (regime or _current_regime()).upper()
        risk_pct = min(max(float(risk_pct), 0.1), 2.0)  # hard 2% account-risk cap
        res = uct.calculate_position_size(reg, grade, account, risk_pct, entry, stop)
        out = dict(res or {})
        out.update({"ok": True, "regime": reg, "grade": grade, "risk_pct": risk_pct})
        return out
    except Exception as e:
        log.exception("size_a_trade failed")
        return {"ok": False, "error": str(e)}
