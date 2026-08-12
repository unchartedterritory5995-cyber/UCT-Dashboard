"""Pure decision logic for the earnings wire. NO I/O.

Every provider call lives in `detector.py`, so this entire state machine —
price-first, actuals-first, upgrade-in-place, immutable arrival order, the
liquidity gate — is testable without touching the network. That separation is
deliberate: the 2026-06 enrichment feature passed 996 mocked tests and shipped
in 0 of 24 charts because the fetch was hidden behind an injected dependency.
Here the fetch is not mockable *because it is not in this file*.

A row enters the wire when EITHER its price moves (liquid) OR its actuals land.
Whichever fires first sets `first_seen_at`, which is then IMMUTABLE — the feed
sorts on it and a row must never move once the reader has seen it.
"""
from __future__ import annotations

MIN_MOVE_PCT = 2.0

# Extended-hours tape is thin: a name can print +12% on 200 shares. The gate is
# on traded VALUE, not share count, so it means the same thing for a $4 stock
# and a $400 one. Without it the wire manufactures fake movers at exactly the
# moment it is trusted — and (Phase 3) alerts on them.
MIN_TRADE_VALUE_USD = 250_000.0


def move_pct(snap: dict) -> float | None:
    """% move of the last (extended-hours-aware) print vs the regular close.

    None — not 0.0 — when the inputs can't support a real answer, so a missing
    prev_close reads as "unknown" rather than "flat".
    """
    try:
        prev = float(snap.get("prev_close") or 0.0)
        last = float(snap.get("last_price") or 0.0)
    except (TypeError, ValueError):
        return None
    if prev <= 0 or last <= 0:
        return None
    return (last - prev) / prev * 100.0


def is_liquid_move(snap: dict, min_value_usd: float = MIN_TRADE_VALUE_USD) -> bool:
    """Has enough actually traded for the move to mean anything?"""
    try:
        last = float(snap.get("last_price") or 0.0)
        vol = float(snap.get("today_vol") or 0.0)
    except (TypeError, ValueError):
        return False
    return last > 0 and (last * vol) >= min_value_usd


def _has_actuals(rep: dict) -> bool:
    return rep.get("eps_act") is not None or rep.get("rev_act") is not None


def detect_rows(reporters, snapshot, existing, now_ts, market_date) -> list[dict]:
    """Rows that need a write. Returns [] for anything unchanged.

    Called every ~20s, so "unchanged produces no write" is what keeps the
    detector from rewriting 250 rows a tick.
    """
    out: list[dict] = []
    for rep in reporters or []:
        sym = rep.get("sym")
        if not sym:
            continue

        snap = (snapshot or {}).get(sym) or {}
        mv = move_pct(snap)
        moved = (mv is not None
                 and abs(mv) >= MIN_MOVE_PCT
                 and is_liquid_move(snap))
        has_act = _has_actuals(rep)
        live_peak = abs(mv) if (mv is not None and moved) else 0.0
        prior = (existing or {}).get(sym)

        if prior is None:
            if not (moved or has_act):
                continue
            out.append({
                "market_date":   market_date,
                "sym":           sym,
                "timing":        rep.get("timing"),
                "first_seen_at": now_ts,
                "trigger":       "actuals" if has_act else "price",
                "eps_act": rep.get("eps_act"), "eps_est": rep.get("eps_est"),
                "rev_act": rep.get("rev_act"), "rev_est": rep.get("rev_est"),
                "eps_src": "provider" if rep.get("eps_act") is not None else None,
                "rev_src": "provider" if rep.get("rev_act") is not None else None,
                "confirmed": 1 if has_act else 0,
                "peak_move_pct": live_peak,
            })
            continue

        # Existing row — write only if something actually changed.
        prior_peak = float(prior.get("peak_move_pct") or 0.0)
        new_peak = max(prior_peak, live_peak)
        # Field by field, not "eps is null": companies publish EPS and revenue
        # SEPARATELY (LITE 2026-08-11 held eps_act 3.23 with rev_act frozen
        # None all evening — an eps-only gate meant a row could never gain the
        # revenue leg once its EPS landed).
        gained_actuals = (
            (rep.get("eps_act") is not None and prior.get("eps_act") is None)
            or (rep.get("rev_act") is not None and prior.get("rev_act") is None))
        peak_grew = new_peak > prior_peak + 1e-9
        if not (gained_actuals or peak_grew):
            continue

        def _keep(field):
            # An upgrade must never REGRESS a stored figure: a reporter row
            # that momentarily loses a field (degraded rebuild) cannot null
            # out a number the reader has already seen.
            v = rep.get(field)
            return v if v is not None else prior.get(field)

        out.append({
            "market_date":   market_date,
            "sym":           sym,
            "timing":        rep.get("timing"),
            "first_seen_at": prior["first_seen_at"],   # IMMUTABLE
            "trigger":       prior.get("trigger"),     # the ORIGINAL trigger
            "eps_act": _keep("eps_act"), "eps_est": _keep("eps_est"),
            "rev_act": _keep("rev_act"), "rev_est": _keep("rev_est"),
            "eps_src": ("provider" if rep.get("eps_act") is not None
                        else prior.get("eps_src")),
            "rev_src": ("provider" if rep.get("rev_act") is not None
                        else prior.get("rev_src")),
            "confirmed": 1 if has_act else int(prior.get("confirmed") or 0),
            "peak_move_pct": new_peak,
        })
    return out
