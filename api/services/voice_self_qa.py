"""
Voice self-Q&A — let the user ask the assistant about THEIR OWN trading
performance, setups, mistakes, and history.

Each function:
  - calls into Journal 2.0 services (j2_trades / j2_analytics / j2_setup_stats)
  - returns {narration: str, ...structured_data} so the model can speak the
    narration AND optionally reference the structured fields

If an underlying service is unavailable, the function returns a graceful
fallback narration ("I couldn't pull your journal data") rather than failing.
"""

import logging
from datetime import datetime, timedelta

_log = logging.getLogger(__name__)


# ── Indirections — monkeypatchable in tests ────────────────────────────────

def _default_account_id(user_id: str) -> str:
    """Resolve to the user's primary (Default) J2 account_id.
    Mirrors voice_write_tools._resolve_account_id's no-name branch."""
    from api.services.journal_two import accounts as j2_accounts
    return j2_accounts.get_or_migrate_default_account(user_id)["id"]


def _date_from_for_period(period: str) -> str | None:
    """Convert a period name to an ISO date_from string (None = no filter)."""
    period = (period or "").lower()
    if period in {"all", "year"}:
        return None
    from datetime import date, timedelta
    today = date.today()
    if period == "today":
        return today.isoformat()
    if period == "week":
        return (today - timedelta(days=7)).isoformat()
    if period == "month":
        return (today - timedelta(days=30)).isoformat()
    if period == "ytd":
        return date(today.year, 1, 1).isoformat()
    return None


def _filter_trades_by_date(trades: list[dict], date_from: str | None) -> list[dict]:
    """Re-filter trades client-side by exitDate (which is the ET-bucketed
    close moment). list_trades_for_user doesn't take a date filter, so we
    do it here. date_from is ISO 'YYYY-MM-DD'; we compare lexicographically
    on the date prefix of exitDate which is fine since ISO sorts correctly."""
    if not date_from:
        return trades
    out = []
    for t in trades:
        exit_date = t.get("exitDate") or ""
        if exit_date[:10] >= date_from:
            out.append(t)
    return out


def _stats_for_period(user_id: str, period: str) -> dict:
    """Return aggregate stats for the given period from j2_trades.

    Output shape: {trade_count, total_pnl_pct, total_pnl_dollar, win_rate,
    best_trade, worst_trade}."""
    try:
        from api.services.journal_two import trades as j2_trades
    except ImportError:
        return {}
    try:
        account_id = _default_account_id(user_id)
    except Exception:  # noqa: BLE001
        return {}

    try:
        rows = j2_trades.list_trades_for_user(user_id, account_id=account_id) or []
    except Exception:  # noqa: BLE001
        return {}

    rows = _filter_trades_by_date(rows, _date_from_for_period(period))

    if not rows:
        return {"trade_count": 0}

    count = len(rows)
    wins = sum(1 for r in rows if r.get("result") == "Win")
    decisive = sum(1 for r in rows if r.get("result") in ("Win", "Loss"))
    win_rate = (wins / decisive) if decisive > 0 else None

    pnls_dol = [r.get("pnlDollar") for r in rows if r.get("pnlDollar") is not None]
    pnls_pct = [r.get("pnlPercent") for r in rows if r.get("pnlPercent") is not None]
    total_pnl_dollar = sum(pnls_dol) if pnls_dol else None
    # j2_trades stores pnlPercent as a fraction (e.g. 0.052 = 5.2%). Convert
    # so the narration "5.2 percent" reads naturally.
    total_pnl_pct = (sum(pnls_pct) * 100) if pnls_pct else None

    # Best/worst by R-multiple (matches the J1 behavior); fall back to pnlDollar
    # if R is missing.
    def _r_key(r):
        rm = r.get("rMultiple")
        return rm if rm is not None else (r.get("pnlDollar") or 0)

    best = max(rows, key=_r_key) if rows else None
    worst = min(rows, key=_r_key) if rows else None

    return {
        "trade_count": count,
        "win_rate": win_rate,
        "total_pnl_dollar": total_pnl_dollar,
        "total_pnl_pct": total_pnl_pct,
        "best_trade": (best or {}).get("symbol"),
        "worst_trade": (worst or {}).get("symbol"),
    }


def _setup_breakdown(user_id: str) -> list[dict]:
    """Per-setup performance breakdown. Pulls j2_analytics.attribution.bySetup."""
    try:
        from api.services.journal_two import analytics as j2_analytics
    except ImportError:
        return []
    try:
        account_id = _default_account_id(user_id)
    except Exception:  # noqa: BLE001
        return []

    try:
        data = j2_analytics.get_analytics(user_id, account_id=account_id) or {}
    except Exception:  # noqa: BLE001
        return []

    attribution = data.get("attribution") or {}
    buckets = attribution.get("bySetup") or []
    out = []
    for b in buckets:
        if not isinstance(b, dict):
            continue
        # j2 attribution.bySetup carries: setup, totalPnl, winRate, avgR, tradeCount
        trade_count = int(b.get("tradeCount") or 0)
        total_pnl = b.get("totalPnl")
        # Derive a per-trade avg P&L for narration — J1 used avg_pnl_pct;
        # we approximate with avg_pnl_dollar in dollars (narration just
        # reads "<n> average" without unit).
        avg_pnl = (total_pnl / trade_count) if (total_pnl is not None and trade_count) else None
        out.append({
            "setup": b.get("setup") or "unknown",
            "trade_count": trade_count,
            "win_rate": b.get("winRate"),
            "avg_pnl_pct": avg_pnl,
            "expectancy": b.get("avgR"),
        })
    return out


def _recent_mistakes(user_id: str, days: int = 30) -> list[dict]:
    """Aggregate mistakeTags across the user's j2_trades in the period."""
    try:
        from api.services.journal_two import trades as j2_trades
    except ImportError:
        return []
    try:
        account_id = _default_account_id(user_id)
    except Exception:  # noqa: BLE001
        return []

    try:
        rows = j2_trades.list_trades_for_user(user_id, account_id=account_id) or []
    except Exception:  # noqa: BLE001
        return []

    from datetime import date, timedelta
    date_from = (date.today() - timedelta(days=int(days))).isoformat()
    rows = _filter_trades_by_date(rows, date_from)

    counts: dict[str, int] = {}
    for r in rows:
        # j2_trades.mistakeTags is already decoded to list[str] by _row_to_trade
        tags = r.get("mistakeTags") or []
        if isinstance(tags, str):
            # Defensive: fall back to JSON-decode in case raw string slips through
            import json
            try:
                tags = json.loads(tags)
            except (ValueError, TypeError):
                tags = []
        if not isinstance(tags, list):
            continue
        for t in tags:
            if not isinstance(t, str):
                continue
            key = t.strip().lower()
            if key:
                counts[key] = counts.get(key, 0) + 1
    return [{"mistake_type": k, "count": v}
            for k, v in sorted(counts.items(), key=lambda x: -x[1])]


def _psychology_trend(user_id: str, days: int = 90) -> dict:
    """Return psychology aggregates derived from j2_trades.

    J2 doesn't yet have per-trade process scoring, so `process_trend` is
    intentionally empty — the consumer's narration code already handles
    that case ("not enough process data yet"). We DO compute
    `emotion_outcomes` from emotionTags × pnlDollar so the model can say
    "you trade best when you feel <emotion>"."""
    try:
        from api.services.journal_two import trades as j2_trades
    except ImportError:
        return {}
    try:
        account_id = _default_account_id(user_id)
    except Exception:  # noqa: BLE001
        return {}

    try:
        rows = j2_trades.list_trades_for_user(user_id, account_id=account_id) or []
    except Exception:  # noqa: BLE001
        return {}

    from datetime import date, timedelta
    date_from = (date.today() - timedelta(days=int(days))).isoformat()
    rows = _filter_trades_by_date(rows, date_from)

    # Aggregate per-emotion outcomes
    emo_buckets: dict[str, dict] = {}
    for r in rows:
        tags = r.get("emotionTags") or []
        if isinstance(tags, str):
            import json
            try:
                tags = json.loads(tags)
            except (ValueError, TypeError):
                tags = []
        if not isinstance(tags, list):
            continue
        pnl = r.get("pnlDollar")
        for t in tags:
            if not isinstance(t, str) or not t.strip():
                continue
            key = t.strip().lower()
            bucket = emo_buckets.setdefault(key, {"pnls": [], "wins": 0, "losses": 0})
            if pnl is not None:
                bucket["pnls"].append(float(pnl))
            if r.get("result") == "Win":
                bucket["wins"] += 1
            elif r.get("result") == "Loss":
                bucket["losses"] += 1

    emotion_outcomes: dict[str, dict] = {}
    for emo, b in emo_buckets.items():
        pnls = b["pnls"]
        wl = b["wins"] + b["losses"]
        emotion_outcomes[emo] = {
            "avg_pnl": (sum(pnls) / len(pnls)) if pnls else None,
            "win_rate": (b["wins"] / wl) if wl > 0 else None,
            "trade_count": len(pnls),
        }

    return {
        "process_trend": {},        # not tracked in J2 yet
        "emotion_outcomes": emotion_outcomes,
    }


def _find_trades(user_id: str, *, symbol: str = "", status: str = "",
                 setup: str = "", days: int = 30) -> list[dict]:
    """Filtered trade search against j2_trades. Returns trade dicts with
    J1-shaped keys (sym, status, pnl_pct) so the consumer's narration
    code keeps working unchanged."""
    try:
        from api.services.journal_two import trades as j2_trades
    except ImportError:
        return []
    try:
        account_id = _default_account_id(user_id)
    except Exception:  # noqa: BLE001
        return []

    try:
        rows = j2_trades.list_trades_for_user(user_id, account_id=account_id) or []
    except Exception:  # noqa: BLE001
        return []

    # Apply filters
    sym_filter = (symbol or "").upper().strip()
    setup_filter = (setup or "").strip()
    # j2_trades only stores closed trades (one row per close). status="open"
    # isn't representable here; we treat "closed" as "any j2 trade".
    if days:
        from datetime import date, timedelta
        date_from = (date.today() - timedelta(days=int(days))).isoformat()
        rows = _filter_trades_by_date(rows, date_from)

    out: list[dict] = []
    for r in rows:
        if sym_filter and (r.get("symbol") or "").upper() != sym_filter:
            continue
        if setup_filter and (r.get("setup") or "") != setup_filter:
            continue
        # Normalize to J1-flavored keys the consumer narration uses.
        pnl_percent_fraction = r.get("pnlPercent")
        pnl_pct = (pnl_percent_fraction * 100) if pnl_percent_fraction is not None else None
        out.append({
            "sym": r.get("symbol"),
            "entry_price": r.get("entryPrice"),
            "exit_price": r.get("exitPrice"),
            "pnl_pct": pnl_pct,
            "status": "closed",
            "setup": r.get("setup"),
            "entry_date": r.get("entryDate"),
            "exit_date": r.get("exitDate"),
        })
        if len(out) >= 20:
            break
    return out


# ── Tools ──────────────────────────────────────────────────────────────────

def get_my_pnl(*, user_id: str, period: str = "week") -> dict:
    period = (period or "week").lower().strip()
    if period not in {"today", "week", "month", "ytd", "year", "all"}:
        period = "week"
    stats = _stats_for_period(user_id, period) or {}
    count = int(stats.get("trade_count") or 0)
    pnl_pct = stats.get("total_pnl_pct")
    pnl_dol = stats.get("total_pnl_dollar")
    win_rate = stats.get("win_rate")
    best = stats.get("best_trade")
    worst = stats.get("worst_trade")

    if count == 0:
        return {"narration": f"No trades logged for {period} yet.", "trade_count": 0}

    parts = [f"For {period}: {count} trades"]
    if pnl_pct is not None:
        parts.append(f"{round(float(pnl_pct), 1)} percent net")
    if pnl_dol is not None:
        parts.append(f"that's {round(float(pnl_dol), 0)} dollars")
    if win_rate is not None:
        parts.append(f"{round(float(win_rate) * 100)} percent win rate")
    narration = "; ".join(parts) + "."
    if best:
        narration += f" Best was {best}."
    if worst:
        narration += f" Worst was {worst}."

    return {"narration": narration, "trade_count": count,
            "pnl_pct": pnl_pct, "pnl_dollar": pnl_dol, "win_rate": win_rate}


def get_my_setup_performance(*, user_id: str, setup: str = "") -> dict:
    setups = _setup_breakdown(user_id)
    if not setups:
        return {"narration": "No setup data yet — I need more closed trades to compute breakdown.",
                "count": 0}

    if setup:
        # Filter to specific setup
        match = next((s for s in setups if (s.get("setup") or "").lower() == setup.lower()), None)
        if not match:
            return {"narration": f"I don't see any trades on the {setup} setup yet.", "count": 0}
        wr = match.get("win_rate")
        avg = match.get("avg_pnl_pct")
        cnt = match.get("trade_count")
        parts = [f"{setup}: {cnt} trades"]
        if wr is not None:
            parts.append(f"{round(float(wr) * 100)} percent win rate")
        if avg is not None:
            parts.append(f"{round(float(avg), 1)} percent average")
        return {"narration": "; ".join(parts) + ".", "count": 1, "setup": setup}

    # Sorted by expectancy or avg_pnl
    ranked = sorted(setups, key=lambda s: float(s.get("expectancy") or s.get("avg_pnl_pct") or 0), reverse=True)
    top3 = ranked[:3]
    bottom1 = ranked[-1] if len(ranked) > 3 else None

    parts = ["Your strongest setups: "]
    parts.append(", ".join(
        f"{s.get('setup')} at {round(float(s.get('avg_pnl_pct') or 0), 1)} percent average"
        for s in top3
    ))
    if bottom1 and bottom1 not in top3:
        parts.append(
            f". Weakest is {bottom1.get('setup')} at {round(float(bottom1.get('avg_pnl_pct') or 0), 1)} percent."
        )
    else:
        parts.append(".")

    return {"narration": "".join(parts), "count": len(setups)}


def get_my_recent_mistakes(*, user_id: str, days: int = 30) -> dict:
    days = max(1, min(int(days or 30), 365))
    mistakes = _recent_mistakes(user_id, days=days)
    if not mistakes:
        return {"narration": f"No mistakes logged in the last {days} days. Clean tape.", "count": 0}

    top3 = sorted(mistakes, key=lambda m: int(m.get("count") or 0), reverse=True)[:3]
    parts = ", ".join(
        f"{m.get('mistake_type')} {int(m.get('count') or 0)} times"
        for m in top3
    )
    return {
        "narration": f"In the last {days} days: {parts}.",
        "count": len(mistakes),
    }


def get_my_psychology(*, user_id: str, period: str = "month") -> dict:
    days_map = {"week": 7, "month": 30, "quarter": 90, "year": 365}
    days = days_map.get((period or "month").lower(), 30)
    data = _psychology_trend(user_id, days=days)
    if not data or not data.get("process_trend"):
        return {"narration": "I don't have enough process data to comment yet — keep logging.", "count": 0}

    # Average process score from trend
    trend = data.get("process_trend") or {}
    if isinstance(trend, dict):
        vals = [v for v in trend.values() if v is not None]
    else:
        vals = []
    avg_process = round(sum(vals) / len(vals), 1) if vals else None

    emo = data.get("emotion_outcomes") or {}
    best_emo = None
    if isinstance(emo, dict):
        for k, v in emo.items():
            pnl = v.get("avg_pnl") if isinstance(v, dict) else None
            if pnl is not None and (best_emo is None or pnl > best_emo[1]):
                best_emo = (k, pnl)

    parts = []
    if avg_process is not None:
        parts.append(f"Average process score is {avg_process}")
    if best_emo:
        parts.append(f"You trade best when you feel {best_emo[0]}")
    if not parts:
        return {"narration": "Process data is sparse for this period.", "count": 0}

    return {"narration": ". ".join(parts) + ".", "count": 1}


def find_my_trades(*, user_id: str, symbol: str = "", status: str = "",
                   setup: str = "", days: int = 30) -> dict:
    trades = _find_trades(user_id, symbol=symbol, status=status, setup=setup, days=days)
    if not trades:
        filters_desc = []
        if symbol:
            filters_desc.append(symbol.upper())
        if status:
            filters_desc.append(status)
        if setup:
            filters_desc.append(setup)
        desc = " ".join(filters_desc) if filters_desc else "your filter"
        return {"narration": f"I couldn't find any trades matching {desc}.", "count": 0}

    parts = [f"Found {len(trades)} matching trade{'s' if len(trades) != 1 else ''}."]
    # Mention the most recent 3
    for t in trades[:3]:
        sym = (t.get("sym") or "").upper()
        status_t = t.get("status") or "open"
        pnl = t.get("pnl_pct")
        if pnl is not None:
            parts.append(f"{sym} {status_t}, {round(float(pnl), 1)} percent")
        else:
            parts.append(f"{sym} {status_t}")

    return {"narration": " ".join(parts), "count": len(trades)}
