"""Live-composition sentinel — the between-sync conservation law, fleet-wide.

Every existing rail grades the SYNCED state (mirror_check at sync time,
fidelity_audit nightly, fleet_monitor for connections). The 2026-08-26
incident lived in the one place none of them look: the number COMPOSED
between syncs — stale cash paired with a live book showed $21,763 on a
$10,772 account, and the display could not even be reconstructed afterward
because nothing recorded what it was made of.

This sentinel enforces the invariant that makes a composed net-liq
trustworthy without an intraday broker call: **trades cannot create equity**.

    (cash_live + book_now)  −  (cash_synced + book_synced)
        must be explained by the post-sync fills in the ledger.

Valuation is deliberately at SYNC marks (equity rows at `broker_price`,
strategies at `broker_current_value`, falling back to `net_entry`): using the
same mark on both sides makes the residual immune to quote noise — what is
left is pure STRUCTURE: a cash derivation that missed a fill, a resurrected
row with no ledger basis, a duplicated position, a 100x option value. Those
are exactly the defect family this product keeps meeting.

Verdicts:
  ok         — residual within tolerance (fills reflected in book and cash).
  book_lag   — residual matches "fills moved cash but no served row yet"
               (a real, bounded display understatement that the next sync
               clears; recorded, never paged — a rail that cries wolf on
               every intraday buy is worse than none).
  structural — neither explanation fits; pages the owner after 2 consecutive
               checks, with the full component snapshot persisted (the
               flight recorder).
  skipped    — no fresh balance anchor to check against.

Read-only over auth.db; never mutates journal data; never raises into the
scheduler.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services.auth_db import get_connection
from api.services.journal_two.broker import live_cash
from api.services.journal_two.broker.notifications import _post_discord

logger = logging.getLogger("broker_live_sentinel")

_ET = ZoneInfo("America/New_York")

# Tolerance absorbs same-day P&L between a fill and its first stamped mark,
# fees, and rounding — generous enough to stay quiet on honest books, tiny
# next to the failures it exists to catch (the incident was a $10,990 miss
# on a $10.7k account).
_TOL_DOLLARS = 150.0
_TOL_PCT = 0.015
_PAGE_AFTER_CONSECUTIVE = 2
_MAX_ANCHOR_AGE_HOURS = 36

# One page per account per ET day (in-process; a redeploy risks one repeat).
_paged: dict[str, str] = {}


def _reset_for_tests() -> None:
    _paged.clear()


def _enabled() -> bool:
    return (os.getenv("BROKER_LIVE_SENTINEL_ENABLED") or "1") == "1"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ts(v: Any) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _f(v: Any) -> float | None:
    try:
        x = float(v)
        return x if x == x and x not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None


def check_account(user_id: str, broker_account_id: str, j2_account_id: str,
                  conn) -> dict[str, Any]:
    """One conservation check. Returns the verdict dict (also persisted by
    the caller). Pure read."""
    acct = conn.execute(
        "SELECT broker_cash, broker_market_value, broker_total_equity, "
        "       broker_balance_synced_at "
        "FROM j2_accounts WHERE id = ? AND user_id = ?",
        (j2_account_id, user_id),
    ).fetchone()
    if acct is None:
        return {"verdict": "skipped", "reason": "no account row"}
    cash_s = _f(acct["broker_cash"])
    book_s = _f(acct["broker_market_value"])
    synced = _ts(acct["broker_balance_synced_at"])
    if cash_s is None or book_s is None or synced is None:
        return {"verdict": "skipped", "reason": "no balance anchor"}
    if datetime.now(timezone.utc) - synced > timedelta(hours=_MAX_ANCHOR_AGE_HOURS):
        return {"verdict": "skipped", "reason": "anchor stale"}

    # The served book, valued at SYNC marks, composed by the ONE authority
    # (composition.py — the same rules the frontend hero mirrors, parity-
    # railed via parity-fixtures.json). Manual rows in a broker account are
    # excluded by those rules in BOTH lanes, so a member's manual entry can
    # never read as structural drift here.
    from api.services.journal_two.broker import composition
    positions = conn.execute(
        "SELECT symbol, side, shares, broker_price, entry_price, source "
        "FROM j2_positions WHERE user_id = ? AND account_id = ? "
        "AND closed_at IS NULL",
        (user_id, j2_account_id),
    ).fetchall()
    strategies = conn.execute(
        "SELECT id, underlying, net_entry, broker_current_value, source, "
        "       external_id "
        "FROM j2_option_strategies WHERE user_id = ? AND account_id = ? "
        "AND status = 'open' AND closed_at IS NULL",
        (user_id, j2_account_id),
    ).fetchall()
    comp_positions = [
        {"symbol": p["symbol"], "side": p["side"], "shares": p["shares"],
         "brokerPrice": (p["broker_price"] if p["broker_price"] is not None
                         else p["entry_price"]),
         "source": p["source"]}
        for p in positions
    ]
    comp_strategies = [
        {"id": s["id"], "brokerCurrentValue": s["broker_current_value"],
         "netEntry": s["net_entry"], "source": s["source"]}
        for s in strategies
    ]
    book_now = composition.compose_net_liq(
        {"balanceSource": "broker", "brokerCash": 0.0},
        comp_positions, comp_strategies,
    )["marketValue"]
    pos_snapshot = (
        [{"sym": p["symbol"],
          "sh": (-_f(p["shares"]) if p["side"] == "Short" else _f(p["shares"])),
          "mark": _f(p["broker_price"]), "src": p["source"]} for p in positions]
        + [{"opt": s["underlying"], "val": _f(s["broker_current_value"]),
            "ne": _f(s["net_entry"]), "src": s["source"],
            "ext": s["external_id"]} for s in strategies]
    )

    lc = live_cash.effective_cash(
        user_id, broker_account_id, cash_s,
        acct["broker_balance_synced_at"], conn=conn,
    )
    cash_live = lc["cash"] if lc["cash"] is not None else cash_s

    composed = cash_live + book_now
    anchor = cash_s + book_s
    tol = max(_TOL_DOLLARS, _TOL_PCT * max(abs(_f(acct["broker_total_equity"]) or anchor), 1.0))

    # Fully-reflected expectation: each fill moved cash AND the book
    # (buy: −cost/+cost; sell: +proceeds/−basis) → composed ≈ anchor.
    residual = composed - anchor
    # Book-lag expectation: fills moved cash only (no served row yet) →
    # composed ≈ anchor + adjustment.
    residual_lag = composed - (anchor + lc["adjustment"])

    if abs(residual) <= tol:
        verdict = "ok"
    elif abs(residual_lag) <= tol and abs(lc["adjustment"]) > tol:
        verdict = "book_lag"
    else:
        verdict = "structural"

    return {
        "verdict": verdict,
        "residual": round(residual, 2),
        "residualLag": round(residual_lag, 2),
        "tolerance": round(tol, 2),
        "components": {
            "cashSynced": cash_s, "bookSynced": book_s,
            "cashLive": cash_live, "bookNow": round(book_now, 2),
            "adjustment": lc["adjustment"], "fills": lc["fills"],
            "buyCost": lc["buyCost"], "sellProceeds": lc["sellProceeds"],
            "servedBook": pos_snapshot,
        },
    }


def _persist(conn, user_id: str, broker_account_id: str, out: dict[str, Any]) -> int:
    prior = conn.execute(
        "SELECT consecutive_fails FROM j2_broker_live_checks "
        "WHERE user_id = ? AND broker_account_id = ?",
        (user_id, broker_account_id),
    ).fetchone()
    fails = (int(prior["consecutive_fails"]) if prior else 0)
    fails = fails + 1 if out["verdict"] == "structural" else 0
    conn.execute(
        "INSERT OR REPLACE INTO j2_broker_live_checks "
        "(user_id, broker_account_id, checked_at, verdict, residual_dollar, "
        " consecutive_fails, components_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, broker_account_id, _now_iso(), out["verdict"],
         out.get("residual"), fails,
         json.dumps(out.get("components")) if out.get("components") else None),
    )
    conn.commit()
    return fails


def _maybe_page(user_id: str, broker_account_id: str, out: dict[str, Any],
                fails: int) -> None:
    if fails < _PAGE_AFTER_CONSECUTIVE:
        return
    today = datetime.now(_ET).strftime("%Y-%m-%d")
    if _paged.get(broker_account_id) == today:
        return
    _paged[broker_account_id] = today
    c = out.get("components") or {}
    _post_discord(
        "🔴 Broker live-composition drift (structural)",
        f"account `{broker_account_id[:8]}` user `{user_id[:8]}`: the composed "
        f"net-liq breaks conservation by **${out.get('residual'):,}** "
        f"(tolerance ${out.get('tolerance'):,}, {fails} consecutive checks).\n"
        f"cash {c.get('cashSynced')}→{c.get('cashLive')} · book "
        f"{c.get('bookSynced')}→{c.get('bookNow')} · fills {c.get('fills')} "
        f"(buys ${c.get('buyCost')}, sells ${c.get('sellProceeds')}).\n"
        "Component snapshot persisted in j2_broker_live_checks (flight recorder).",
    )


def _in_market_window(now_et: datetime | None = None) -> bool:
    now_et = now_et or datetime.now(_ET)
    if now_et.weekday() >= 5:
        return False
    minutes = now_et.hour * 60 + now_et.minute
    return (9 * 60 + 45) <= minutes <= (20 * 60)  # 9:45am–8pm ET incl. AH


def run_sentinel_sweep() -> dict[str, Any]:
    """Scheduler entry — check every sync-enabled broker account. Never
    raises; one bad account never blocks the rest."""
    if not (_enabled() and _in_market_window()):
        return {"skipped": True}
    from api.services.journal_two.broker import connections
    checked = structural = 0
    conn = get_connection()
    try:
        for ba in connections.list_all_sync_enabled_accounts():
            if ba.get("status") != "active":
                continue
            try:
                out = check_account(ba["userId"], ba["id"], ba["j2AccountId"], conn)
                if out["verdict"] == "skipped":
                    continue
                fails = _persist(conn, ba["userId"], ba["id"], out)
                checked += 1
                if out["verdict"] == "structural":
                    structural += 1
                    _maybe_page(ba["userId"], ba["id"], out, fails)
            except Exception:  # noqa: BLE001
                logger.warning("live sentinel failed for %s", ba.get("id"),
                               exc_info=True)
    finally:
        conn.close()
    return {"checked": checked, "structural": structural}


def run_sentinel_blocking() -> None:
    """APScheduler entry. Never raises into the scheduler."""
    try:
        run_sentinel_sweep()
    except Exception as e:  # noqa: BLE001
        logger.warning("live sentinel sweep failed: %s", e)
