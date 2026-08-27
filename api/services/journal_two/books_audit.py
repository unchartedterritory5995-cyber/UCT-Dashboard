"""Journal 2.0 — books audit: the same truth from every surface must close.

Users see one book through many lenses — Analytics equity, the Calendar,
Day pages, the Tax Center, the Options section. Each lens has its own
DOCUMENTED convention (equity/calendar are net-of-fees; distribution and
attribution are gross by design; the tax book derives gross from price ×
shares; calendar days include option strategies while analytics-equity is
equity-only; analytics applies the FIX-C `analytics_excluded` predicate
while the trade list deliberately does not). A silent bug in any one of
them shows up as two lenses disagreeing about the same trades.

This audit CROSS-FOOTS them: every aggregate is recomputed independently
from raw rows, and every legitimate convention difference is carried as a
NAMED reconciling item — so a check fails only on a genuine defect, never
on a documented design choice. The mirror-check idiom, applied to the
analytics layer instead of the broker feed.

Checks (each returns {name, pass, expected, actual, delta, note}):
  equity_realized      analytics equity (last point − start) vs Σ net P&L (SQL)
  distribution_gross   long+short totals vs Σ gross P&L (SQL)
  r_sources_closure    stop + trueR + none == tradeCount
  options_headline     options headline totalPnl vs Σ strategy pnl (SQL)
  calendar_closure     Σ calendar-year day P&L vs included-net + options
                       (excluded trades absent from BOTH lenses — measured)
  day_detail_parity    N sampled day cells vs their Day-page metrics
  tax_price_parity     tax-line gains (price × shares) vs stored gross pnl —
                       per (symbol, acquired, sold) GROUP (same-day multi-lot
                       joins are ambiguous per-line), mismatches NAMED

Tolerance: $0.05 on sums (float rounding across hundreds of rows), $0.01 on
single-day/-line comparisons.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import analytics as analytics_service
from api.services.journal_two import calendar as calendar_service
from api.services.journal_two import tax_report as tax_service
from api.services.journal_two.filters import ANALYTICS_INCLUDED_SQL

_SUM_TOL = 0.05
_LINE_TOL = 0.01


def _check(name: str, expected: float | int | None, actual: float | int | None,
           *, tol: float = _SUM_TOL, note: str = "") -> dict[str, Any]:
    if expected is None or actual is None:
        return {"name": name, "pass": False, "expected": expected,
                "actual": actual, "delta": None, "note": note or "missing value"}
    delta = round(float(actual) - float(expected), 4)
    return {"name": name, "pass": abs(delta) <= tol, "expected": round(float(expected), 2),
            "actual": round(float(actual), 2), "delta": delta, "note": note}


def run_books_audit(
    user_id: str,
    *,
    account_id: str | None = None,
    day_samples: int = 10,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    own = conn is None
    conn = conn or get_connection()
    try:
        base = "user_id = ?"
        params: list[Any] = [user_id]
        if account_id:
            base += " AND account_id = ?"
            params.append(account_id)

        # ── Independent raw sums (the ground truth side of every check) ──
        inc = conn.execute(
            f"SELECT COUNT(*) AS n, "
            f"       COALESCE(SUM(pnl_dollar), 0) AS gross, "
            f"       COALESCE(SUM(pnl_dollar - COALESCE(fees, 0)), 0) AS net "
            f"  FROM j2_trades WHERE {base} {ANALYTICS_INCLUDED_SQL}",
            params,
        ).fetchone()
        exc = conn.execute(
            f"SELECT COUNT(*) AS n, "
            f"       COALESCE(SUM(pnl_dollar - COALESCE(fees, 0)), 0) AS net "
            f"  FROM j2_trades WHERE {base} "
            f"   AND NOT (analytics_excluded IS NULL OR analytics_excluded = 0)",
            params,
        ).fetchone()
        opt = conn.execute(
            f"SELECT COUNT(*) AS n, COALESCE(SUM(pnl_dollar), 0) AS pnl "
            f"  FROM j2_option_strategies WHERE {base} AND status != 'open'",
            params,
        ).fetchone()

        checks: list[dict[str, Any]] = []

        # ── Analytics-side numbers, computed by the real pipeline ────────
        a = analytics_service.get_analytics(user_id, account_id=account_id, conn=conn)

        eq_curve = a["equity"]["curve"]
        # realized = last equity − starting balance. The starting balance is
        # not in the payload, but the curve's FIRST point = start + that
        # day's net P&L — recover start from the first point minus an
        # independent SQL sum of that first day. An empty book realizes 0.
        if eq_curve:
            start = eq_curve[0]["equity"] - _first_day_net(
                conn, base, params, eq_curve[0]["date"])
            eq_realized = round(eq_curve[-1]["equity"] - start, 2)
        else:
            eq_realized = 0.0
        checks.append(_check(
            "equity_realized", float(inc["net"]), eq_realized,
            note=f"analytics-included trades n={inc['n']} (net of fees)",
        ))

        dist = a["distribution"]["longVsShort"]
        checks.append(_check(
            "distribution_gross", float(inc["gross"]),
            float(dist["long"]["totalPnl"]) + float(dist["short"]["totalPnl"]),
            note="long+short totals are GROSS by design",
        ))

        rs = a.get("rSources") or {}
        checks.append(_check(
            "r_sources_closure", a["tradeCount"],
            (rs.get("stop", 0) + rs.get("trueR", 0) + rs.get("none", 0)),
            tol=0, note="every included trade has exactly one R source",
        ))

        opts_headline = ((a.get("options") or {}).get("headline") or {})
        checks.append(_check(
            "options_headline", float(opt["pnl"]),
            float(opts_headline.get("totalPnl") or 0.0),
            note=f"closed strategies n={opt['n']} (pnl stored net)",
        ))

        # ── Calendar closure per year (net; includes options + excluded) ──
        # Years from trades UNION strategies — a strategy-only year must not
        # be invisible to the calendar sweep (audit's own second finding).
        years = [r[0] for r in conn.execute(
            f"SELECT DISTINCT substr(COALESCE(trading_day_et, exit_date), 1, 4) AS y "
            f"  FROM j2_trades WHERE {base} "
            f" UNION "
            f"SELECT DISTINCT substr(COALESCE(trading_day_et, closed_at), 1, 4) AS y "
            f"  FROM j2_option_strategies WHERE {base} AND status != 'open'",
            params + params).fetchall() if r[0]]
        cal_total = 0.0
        for y in sorted(years):
            cal = calendar_service.get_calendar(
                user_id, view="year", year=int(y),
                account_id=account_id, conn=conn,
            )
            cal_total += sum(float(d.get("pnlDollar") or 0) for d in cal.get("days", []))
        # MEASURED (audit's own first finding): the calendar applies the SAME
        # analytics_excluded predicate as analytics — excluded trades are
        # absent from BOTH lenses, so closure = included-net + options.
        checks.append(_check(
            "calendar_closure",
            float(inc["net"]) + float(opt["pnl"]),
            cal_total,
            note=(f"calendar(net, incl. options) vs included-net + options "
                  f"(excluded trades absent from both lenses, n={exc['n']})"),
        ))

        # ── Day-detail parity on the most recent N traded days ────────────
        day_rows = conn.execute(
            f"SELECT substr(COALESCE(trading_day_et, exit_date), 1, 10) AS d, "
            f"       COALESCE(SUM(pnl_dollar - COALESCE(fees, 0)), 0) AS net "
            f"  FROM j2_trades WHERE {base} GROUP BY d ORDER BY d DESC LIMIT ?",
            params + [day_samples],
        ).fetchall()
        day_mismatches: list[dict[str, Any]] = []
        for dr in day_rows:
            detail = calendar_service.get_day_detail(
                user_id, dr["d"], account_id=account_id, conn=conn,
            )
            m = detail.get("metrics") or {}
            got = m.get("netPnlDollar")
            # Day pages include option strategies closed that day — add them
            # to the expectation from raw SQL so the comparison is like-for-like.
            o = conn.execute(
                f"SELECT COALESCE(SUM(pnl_dollar), 0) FROM j2_option_strategies "
                f" WHERE {base} AND status != 'open' "
                f"   AND substr(COALESCE(trading_day_et, closed_at), 1, 10) = ?",
                params + [dr["d"]],
            ).fetchone()[0]
            want = round(float(dr["net"]) + float(o), 2)
            if got is None or abs(float(got) - want) > _LINE_TOL:
                day_mismatches.append({"date": dr["d"], "expected": want, "actual": got})
        checks.append({
            "name": "day_detail_parity", "pass": not day_mismatches,
            "expected": f"{len(day_rows)} days", "actual":
            f"{len(day_rows) - len(day_mismatches)} match", "delta": None,
            "note": "day cell == day page (net, incl. options)",
            "mismatches": day_mismatches[:5],
        })

        # ── Tax price-parity: stored gross pnl vs price × shares ──────────
        # Compared per (symbol, acquired-day, sold-day) GROUP, not per line:
        # several lots of one symbol can close the same day, and a line↔row
        # join is ambiguous inside such a group (the naive LIMIT-1 version
        # false-flagged 27 lines on a book that closes EXACTLY at group
        # level — verified on prod 2026-08-21). Σ line gains must equal
        # Σ stored pnl over the same key group.
        tax_mismatches: list[dict[str, Any]] = []
        tax_lines = 0
        derived_by_key: dict[tuple, float] = {}
        for y in sorted(years):
            book = tax_service.get_tax_report(
                user_id, int(y), account_id=account_id, conn=conn,
            )
            for line in book["lines"]:
                tax_lines += 1
                key = (line["symbol"], line["acquired"], line["sold"])
                derived_by_key[key] = derived_by_key.get(key, 0.0) + float(line["gain"])
        for (sym, acq, sold), derived in derived_by_key.items():
            row = conn.execute(
                f"SELECT COALESCE(SUM(pnl_dollar), 0) FROM j2_trades WHERE {base} "
                f"  AND symbol = ? AND substr(entry_date,1,10) = ? "
                f"  AND substr(exit_date,1,10) = ?",
                params + [sym, acq, sold],
            ).fetchone()
            stored = float(row[0])
            # GROUP tolerance, not line tolerance: a (symbol, acquired, sold)
            # key aggregates several lots, and each lot's price×shares gain
            # rounds independently — measured on the 2026-08-27 fleet audit,
            # the accumulated float error reaches 2¢ on clean books (whale:
            # 4,101/4,110 exact, worst miss $0.02; owner: 261/262, $0.01).
            # A penny tolerance on a multi-lot sum flags correct storage.
            if abs(stored - derived) > _SUM_TOL:
                tax_mismatches.append({
                    "symbol": sym, "sold": sold,
                    "stored": round(stored, 2), "derived": round(derived, 2),
                })
        checks.append({
            "name": "tax_price_parity", "pass": not tax_mismatches,
            "expected": f"{tax_lines} lines", "actual":
            f"{tax_lines - len(tax_mismatches)} match", "delta": None,
            "note": "stored gross pnl == price*shares gain (the storage probe)",
            "mismatches": tax_mismatches[:5],
        })

        return {
            "ok": all(c["pass"] for c in checks),
            "checks": checks,
            "scope": {"userId": user_id, "accountId": account_id,
                      "includedTrades": inc["n"], "excludedTrades": exc["n"],
                      "closedStrategies": opt["n"], "years": sorted(years)},
        }
    finally:
        if own:
            conn.close()


def _first_day_net(conn, base, params, first_day: str) -> float:
    """Net P&L of the equity curve's FIRST day (analytics-included), so the
    curve's implied starting balance can be recovered from its first point."""
    row = conn.execute(
        f"SELECT COALESCE(SUM(pnl_dollar - COALESCE(fees, 0)), 0) "
        f"  FROM j2_trades WHERE {base} {ANALYTICS_INCLUDED_SQL} "
        f"   AND substr(COALESCE(trading_day_et, exit_date), 1, 10) = ?",
        params + [first_day],
    ).fetchone()
    return float(row[0])


# ── Weekly sweep (Sunday 09:30 ET) — the audit as a standing guarantee ───────

def run_weekly_sweep(conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Audit every user who has j2 trades; ALWAYS post the weekly Discord
    line (a silent-green monitor reads as dead — repo lesson), naming any
    failing users + checks. Read-only, bounded (one pass per week)."""
    own = conn is None
    conn = conn or get_connection()
    try:
        users = [r[0] for r in conn.execute(
            "SELECT DISTINCT user_id FROM j2_trades").fetchall()]
        failures: list[dict[str, Any]] = []
        for uid in users:
            try:
                out = run_books_audit(uid, conn=conn)
                if not out["ok"]:
                    failures.append({
                        "userId": uid,
                        "checks": [c["name"] for c in out["checks"] if not c["pass"]],
                    })
            except Exception as e:  # noqa: BLE001 — one bad book never stops the sweep
                failures.append({"userId": uid, "checks": [f"audit-error: {e}"]})
        _post_discord_summary(len(users), failures)
        return {"users": len(users), "failures": failures}
    finally:
        if own:
            conn.close()


def _post_discord_summary(user_count: int, failures: list[dict[str, Any]]) -> None:
    import os
    url = os.environ.get("DISCORD_WEBHOOK_URL")
    if not url:
        return
    try:
        import requests
        if failures:
            lines = chr(10).join(
                f"- `{f['userId'][:8]}…`: {', '.join(f['checks'])}" for f in failures[:10]
            )
            title = f"🔴 Books audit: {len(failures)} of {user_count} books FAILED"
            desc = lines
            color = 0xE74C3C
        else:
            title = f"🟢 Books audit: all {user_count} books balance"
            desc = "Every lens (analytics · calendar · day pages · tax · options) closes."
            color = 0x2ECC71
        requests.post(url, json={"embeds": [{
            "title": title, "description": desc, "color": color,
            "footer": {"text": "UCT books audit · weekly"},
        }]}, timeout=8)
    except Exception:  # noqa: BLE001 — the post is best-effort, never raises
        pass


def register_weekly_job(scheduler) -> bool:
    """Sunday 09:30 ET sweep. Kill switch: BOOKS_AUDIT_WEEKLY_ENABLED=0
    (default ON — the sweep is read-only and posts once a week)."""
    import os
    if os.environ.get("BOOKS_AUDIT_WEEKLY_ENABLED", "1") == "0":
        return False
    from apscheduler.triggers.cron import CronTrigger
    from zoneinfo import ZoneInfo
    scheduler.add_job(
        run_weekly_sweep,
        trigger=CronTrigger(day_of_week="sun", hour=9, minute=30,
                            timezone=ZoneInfo("America/New_York")),
        id="j2_books_audit_weekly", max_instances=1, replace_existing=True,
    )
    return True
