"""
Portfolio service — live portfolio view derived from open journal entries.
Computes aggregated risk, exposure, and journal completeness for open positions.
"""

from datetime import date as _date

from api.services.auth_db import get_connection


def _safe_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def get_portfolio(user_id: str) -> dict:
    """
    Fetch all open trades and compute per-position risk, journal completeness,
    and aggregate exposure breakdowns.
    """
    conn = get_connection()
    cur = conn.cursor()

    # ── Fetch open positions ─────────────────────────────────────────────
    cur.execute(
        """SELECT * FROM journal_entries
           WHERE user_id = ? AND status = 'open'
           ORDER BY entry_date DESC""",
        (user_id,),
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    if not rows:
        return {
            "positions": [],
            "summary": {
                "total_positions": 0,
                "long_count": 0,
                "short_count": 0,
                "total_exposure_shares": 0,
                "total_risk_dollars": 0,
                "positions_missing_journal": 0,
                "positions_needing_review": 0,
                "accounts": [],
                "setups_in_use": [],
            },
            "exposure": {
                "by_direction": {},
                "by_account": {},
                "by_setup": {},
                "by_asset_class": {},
            },
        }

    trade_ids = [r["id"] for r in rows]

    # ── Batch-fetch screenshot counts ────────────────────────────────────
    screenshot_counts = {}
    if trade_ids:
        placeholders = ",".join("?" for _ in trade_ids)
        cur.execute(
            f"""SELECT trade_id, COUNT(*) FROM journal_screenshots
                WHERE trade_id IN ({placeholders})
                GROUP BY trade_id""",
            trade_ids,
        )
        screenshot_counts = dict(cur.fetchall())

    # ── Batch-fetch execution counts ─────────────────────────────────────
    execution_counts = {}
    if trade_ids:
        placeholders = ",".join("?" for _ in trade_ids)
        cur.execute(
            f"""SELECT trade_id, COUNT(*) FROM trade_executions
                WHERE trade_id IN ({placeholders})
                GROUP BY trade_id""",
            trade_ids,
        )
        execution_counts = dict(cur.fetchall())

    conn.close()

    # ── Build position list with computed fields ─────────────────────────
    today = _date.today()
    positions = []

    for trade in rows:
        tid = trade["id"]

        # Days held
        entry_date_str = trade.get("entry_date") or ""
        days_held = None
        if entry_date_str and len(entry_date_str) >= 10:
            try:
                ed = _date.fromisoformat(entry_date_str[:10])
                days_held = (today - ed).days
            except ValueError:
                pass

        # Risk computations
        entry_price = _safe_float(trade.get("entry_price"))
        stop_price = _safe_float(trade.get("stop_price"))
        shares = _safe_float(trade.get("shares"))

        risk_dollars_computed = None
        risk_pct = None
        if entry_price and stop_price and entry_price > 0:
            risk_pct = round(abs(entry_price - stop_price) / entry_price * 100, 2)
            if shares:
                risk_dollars_computed = round(abs(entry_price - stop_price) * abs(shares), 2)

        # Journal completeness
        has_thesis = bool(trade.get("thesis"))
        has_setup = bool(trade.get("setup"))
        has_screenshots = screenshot_counts.get(tid, 0) > 0
        has_stop = trade.get("stop_price") is not None
        has_target = trade.get("target_price") is not None
        has_notes = bool(trade.get("notes") or trade.get("lesson"))
        has_process_score = trade.get("process_score") is not None
        review_status = trade.get("review_status") or "draft"

        checks = [has_thesis, has_setup, has_screenshots, has_stop, has_target, has_notes, has_process_score]
        completeness_pct = round(sum(1 for c in checks if c) / len(checks) * 100)

        position = {
            **trade,
            "days_held": days_held,
            "risk_dollars_computed": risk_dollars_computed,
            "risk_pct": risk_pct,
            "journal_completeness": {
                "has_thesis": has_thesis,
                "has_setup": has_setup,
                "has_screenshots": has_screenshots,
                "has_stop": has_stop,
                "has_target": has_target,
                "has_notes": has_notes,
                "has_process_score": has_process_score,
                "review_status": review_status,
                "completeness_pct": completeness_pct,
            },
            "execution_count": execution_counts.get(tid, 0),
            "screenshot_count": screenshot_counts.get(tid, 0),
        }
        positions.append(position)

    # ── Summary ──────────────────────────────────────────────────────────
    long_count = sum(1 for p in positions if (p.get("direction") or "long").lower() == "long")
    short_count = sum(1 for p in positions if (p.get("direction") or "long").lower() == "short")

    total_exposure_shares = sum(abs(_safe_float(p.get("shares")) or 0) for p in positions)

    total_risk_dollars = sum(
        p["risk_dollars_computed"] for p in positions if p["risk_dollars_computed"] is not None
    )

    positions_missing_journal = sum(
        1 for p in positions if p["journal_completeness"]["completeness_pct"] < 50
    )
    positions_needing_review = sum(
        1 for p in positions if p["journal_completeness"]["review_status"] in ("draft", "logged")
    )

    accounts = sorted(set(p.get("account") or "default" for p in positions))
    setups_in_use = sorted(set(p.get("setup") for p in positions if p.get("setup")))

    summary = {
        "total_positions": len(positions),
        "long_count": long_count,
        "short_count": short_count,
        "total_exposure_shares": total_exposure_shares,
        "total_risk_dollars": round(total_risk_dollars, 2),
        "positions_missing_journal": positions_missing_journal,
        "positions_needing_review": positions_needing_review,
        "accounts": accounts,
        "setups_in_use": setups_in_use,
    }

    # ── Exposure breakdowns ──────────────────────────────────────────────
    by_direction = {}
    by_account = {}
    by_setup = {}
    by_asset_class = {}

    for p in positions:
        direction = (p.get("direction") or "long").lower()
        account = p.get("account") or "default"
        setup = p.get("setup") or "untagged"
        asset_class = p.get("asset_class") or "equity"
        sh = abs(_safe_float(p.get("shares")) or 0)

        # Direction
        if direction not in by_direction:
            by_direction[direction] = {"count": 0, "total_shares": 0}
        by_direction[direction]["count"] += 1
        by_direction[direction]["total_shares"] += sh

        # Account
        if account not in by_account:
            by_account[account] = {"count": 0, "total_shares": 0}
        by_account[account]["count"] += 1
        by_account[account]["total_shares"] += sh

        # Setup
        if setup not in by_setup:
            by_setup[setup] = {"count": 0}
        by_setup[setup]["count"] += 1

        # Asset class
        if asset_class not in by_asset_class:
            by_asset_class[asset_class] = {"count": 0}
        by_asset_class[asset_class]["count"] += 1

    exposure = {
        "by_direction": by_direction,
        "by_account": by_account,
        "by_setup": by_setup,
        "by_asset_class": by_asset_class,
    }

    return {
        "positions": positions,
        "summary": summary,
        "exposure": exposure,
    }
