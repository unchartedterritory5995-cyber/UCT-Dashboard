"""Compass personal-edge substrate — the trader's OWN per-setup expectancy.

Distinct from the firm-level brain_service.setup_winrate: this is what THIS
user is good/bad at, from their journal (coach_data_assembler setup_performance),
normalized onto the canonical setup taxonomy so "you're 4-11 on bull flags"
joins to the right playbook template. SOFT by design (see edge_for_setups):
never hard-mutes on a thin sample, never silent-hides, always honors
"show me anyway". Edge is expectancy (avg_r), NOT raw win-count."""
from __future__ import annotations

import logging

_log = logging.getLogger("personal_edge")

_MUTE_MIN_N = 25


def _resolve(name: str) -> str | None:
    """Engine alias resolver (journal display name -> canonical key)."""
    try:
        from api.services import brain_service
        uct = brain_service._engine()  # installed engine or None
        if uct is None:
            return None
        return uct.resolve_setup_name(name)
    except Exception:  # noqa: BLE001
        return None


def normalize_setup(name: str) -> str | None:
    if not name:
        return None
    try:
        return _resolve(name)
    except Exception:  # noqa: BLE001
        return None


def _default_setup_perf_fn(user_id, account_id):
    from api.services.journal_two import coach_chat_tools as cct
    out = cct._exec_get_aggregates(user_id=user_id, account_id=account_id,
                                   args={"dimension": "setup"})
    return out.get("by_setup") or out.get("setup_performance") or out.get("groups") or []


def edge_for_setups(user_id, account_id=None, *, setup_perf_fn=None, firm_fn=None) -> dict:
    """{canonical_setup: {n, avg_r, total_r, win_rate, verdict, muted, note}}.

    SOFT: muted ONLY when n >= _MUTE_MIN_N AND avg_r < 0; a thin sample
    (1 <= n < 25) is annotated with its uncertainty but NEVER muted/dropped;
    n == 0 falls back to the firm win-rate note. Never raises."""
    setup_perf_fn = setup_perf_fn or _default_setup_perf_fn
    try:
        rows = setup_perf_fn(user_id, account_id) or []
    except Exception:  # noqa: BLE001
        return {}
    edge: dict[str, dict] = {}
    for r in rows:
        raw = r.get("setup") or ""
        key = normalize_setup(raw) or raw
        if not key or key == "(no setup)":
            continue
        try:
            n = int(r.get("trade_count") or 0)
            avg_r = r.get("avg_r")
            avg_r = float(avg_r) if avg_r is not None else None
        except (TypeError, ValueError):
            continue
        if n == 0 or avg_r is None:
            verdict, muted = "unknown", False
            note = "no personal history — using the firm's win-rate"
        elif n < _MUTE_MIN_N:
            verdict, muted = "thin", False
            note = f"small sample (n={n}, avg {avg_r:+.2f}R) — not conclusive"
        elif avg_r < 0:
            verdict, muted = "weak", True
            note = f"you're net-negative here (n={n}, avg {avg_r:+.2f}R)"
        else:
            verdict, muted = "edge", False
            note = f"you're net-positive here (n={n}, avg {avg_r:+.2f}R)"
        edge[key] = {"n": n, "avg_r": avg_r, "total_r": r.get("total_r"),
                     "win_rate": r.get("win_rate"), "verdict": verdict,
                     "muted": muted, "note": note}
    return edge
