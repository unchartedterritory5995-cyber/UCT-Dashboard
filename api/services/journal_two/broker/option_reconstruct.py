"""Reconstruct single-leg option strategies from SnapTrade option events.

Per the v1 non-goal, we do NOT auto-group legs into multi-leg strategies
(verticals/condors) — every option contract round-trip becomes its own
single-leg strategy (long/short call/put). The user can merge legs later
via the manual options UI.

Per-contract FIFO (signed, like the equity engine): open events accumulate
lots; close events consume them oldest-first and emit a closed strategy.
Lifecycle events close the open position too:
  • expiration  -> closed worthless (exit price 0), status 'expired'
  • assignment  -> status 'assigned', option exit 0 (the resulting stock
                   leg arrives separately as an equity activity → handled
                   by the equity pipeline; double-counting avoided)
  • exercise    -> status 'closed', option exit 0 (stock leg via equity feed)

Unclosed opens become status='open' strategies. Idempotent via a stable
external_id per strategy (re-running over the same events = 0 duplicates).
Reuses the calc helpers in options.py so P&L matches the manual options path.
"""

from __future__ import annotations

import hashlib
import sqlite3
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import options as opt


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strategy_type(side: str, contract_type: str) -> str:
    # side: 'buy'|'sell'; contract_type: 'call'|'put'
    if side == "buy":
        return "long_call" if contract_type == "call" else "long_put"
    return "short_call" if contract_type == "call" else "short_put"


def _direction(strategy_type: str) -> str:
    return {
        "long_call": "bullish", "short_put": "bullish",
        "long_put": "bearish", "short_call": "bearish",
    }[strategy_type]


def _contract_key(ev: dict) -> tuple:
    return (ev["underlying"], ev["strike"], ev["expiration"], ev["contractType"])


def _resolve_side_openclose(ev: dict, current: str | None) -> tuple[str, str]:
    """Return (side, open_close) for an event, inferring from the current
    per-contract position when the broker didn't give an explicit BUY_TO_OPEN
    etc. (some report plain BUY/SELL)."""
    side = ev.get("side")
    oc = ev.get("openClose")
    if oc in ("open", "close") and side in ("buy", "sell"):
        return side, oc
    # Infer: a buy opens when flat/long, closes when short; sell is the mirror.
    if side == "buy":
        return "buy", ("close" if current == "short" else "open")
    if side == "sell":
        return "sell", ("close" if current == "long" else "open")
    return side or "buy", "open"


def _fingerprint(account_id: str, s: dict, ordinal: int) -> str:
    base = "|".join(str(x) for x in (
        account_id, s["underlying"], s["strike"], s["expiration"], s["contractType"],
        s["strategy_type"], s["entry_date"], s.get("closed_at"), s["qty"],
        s["entry_price"], s.get("exit_price"), s.get("status"), ordinal,
    ))
    return "bkopt:" + hashlib.sha1(base.encode("utf-8")).hexdigest()


def reconstruct_options(
    user_id: str,
    broker_account_id: str,
    j2_account_id: str,
    option_events: list[dict],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Build + persist single-leg option strategies from option events."""
    # Sort chronologically (None dates last), stable by row.
    events = sorted(option_events, key=lambda e: (e.get("date") is None, e.get("date") or "", e.get("row", 0)))

    # Per-contract state: open lots (all same side) + side label.
    lots: dict[tuple, deque] = {}
    side_of: dict[tuple, str | None] = {}

    built: list[dict] = []  # strategy dicts ready to insert

    for ev in events:
        key = _contract_key(ev)
        q = lots.setdefault(key, deque())
        side_of.setdefault(key, None)
        cur = side_of[key]
        kind = ev["eventKind"]
        qty = ev.get("contracts") or 0
        price = ev.get("price")
        fee = ev.get("fee") or 0.0
        date = ev.get("date")

        if kind in ("option_expiration", "option_assignment", "option_exercise"):
            # Close the whole open position at 0 (premium realized at entry;
            # any intrinsic value flows through the stock leg separately).
            status = {"option_expiration": "expired",
                      "option_assignment": "assigned",
                      "option_exercise": "closed"}[kind]
            while q:
                lot = q.popleft()
                built.append(_mk_strategy(ev, cur, lot, exit_price=0.0,
                                          exit_date=date, exit_fee=0.0, status=status))
            side_of[key] = None
            continue

        side, oc = _resolve_side_openclose(ev, cur)
        if qty <= 0 or price is None:
            continue

        if cur is None or oc == "open":
            q.append({"qty": qty, "price": price, "date": date, "fee": fee})
            side_of[key] = "long" if side == "buy" else "short"
            continue

        # Closing event — consume open lots FIFO, emit one strategy per lot.
        remaining = qty
        while remaining > 0 and q:
            lot = q[0]
            take = min(lot["qty"], remaining)
            built.append(_mk_strategy(ev, cur, {**lot, "qty": take},
                                      exit_price=price, exit_date=date,
                                      exit_fee=fee * (take / qty) if qty else 0.0,
                                      status="closed"))
            lot["qty"] -= take
            remaining -= take
            if lot["qty"] <= 0:
                q.popleft()
        if not q:
            side_of[key] = None

    # Leftover open lots → open strategies.
    open_built: list[dict] = []
    for key, q in lots.items():
        s = side_of.get(key)
        for lot in q:
            if lot["qty"] > 0:
                open_built.append(_mk_open_strategy(key, s, lot))

    return _persist(user_id, broker_account_id, j2_account_id, built + open_built, conn)


def _mk_strategy(ev, cur_side_label, lot, *, exit_price, exit_date, exit_fee, status) -> dict:
    side = "buy" if cur_side_label == "long" else "sell"
    stype = _strategy_type(side, ev["contractType"])
    return {
        "underlying": ev["underlying"], "strike": ev["strike"],
        "expiration": ev["expiration"], "contractType": ev["contractType"],
        "side": side, "strategy_type": stype, "direction": _direction(stype),
        "qty": lot["qty"], "entry_price": lot["price"], "entry_date": lot["date"],
        "entry_fee": lot.get("fee", 0.0),
        "exit_price": exit_price, "closed_at": exit_date, "exit_fee": exit_fee,
        "status": status,
    }


def _mk_open_strategy(key, side_label, lot) -> dict:
    underlying, strike, expiration, ctype = key
    side = "buy" if side_label == "long" else "sell"
    stype = _strategy_type(side, ctype)
    return {
        "underlying": underlying, "strike": strike, "expiration": expiration,
        "contractType": ctype, "side": side, "strategy_type": stype,
        "direction": _direction(stype), "qty": lot["qty"], "entry_price": lot["price"],
        "entry_date": lot["date"], "entry_fee": lot.get("fee", 0.0),
        "exit_price": None, "closed_at": None, "exit_fee": 0.0, "status": "open",
    }


def _persist(user_id, broker_account_id, j2_account_id, strategies, conn) -> dict[str, Any]:
    owned = conn is None
    conn = conn or get_connection()
    imported = skipped = 0
    seen: dict[str, int] = {}
    desired: set[str] = set()
    try:
        conn.execute("BEGIN")
        for s in strategies:
            base = f'{s["underlying"]}|{s["strike"]}|{s["expiration"]}|{s["contractType"]}|{s["strategy_type"]}|{s["entry_date"]}|{s.get("closed_at")}|{s["qty"]}|{s["entry_price"]}|{s.get("exit_price")}|{s.get("status")}'
            n = seen.get(base, 0)
            seen[base] = n + 1
            ext = _fingerprint(broker_account_id, s, n)
            desired.add(ext)  # desired regardless of insert vs already-present
            if conn.execute(
                "SELECT 1 FROM j2_option_strategies WHERE user_id = ? AND external_id = ?",
                (user_id, ext),
            ).fetchone():
                skipped += 1
                continue
            _insert_strategy(conn, user_id, j2_account_id, s, ext)
            imported += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {"imported": imported, "skipped": skipped, "built": len(strategies),
            "desiredExternalIds": desired}


def _insert_strategy(conn, user_id, account_id, s, external_id) -> None:
    leg = {
        "side": s["side"], "contract_type": s["contractType"], "strike": s["strike"],
        "expiration": s["expiration"], "qty": s["qty"], "entry_price": s["entry_price"],
        "exit_price": s["exit_price"],
    }
    net_entry = opt.compute_net_entry([leg])
    entry_fee = round(s.get("entry_fee", 0.0), 2)
    now = _now_iso()
    sid = str(uuid.uuid4())

    if s["status"] == "open":
        conn.execute(
            """
            INSERT INTO j2_option_strategies (
                id, user_id, account_id, underlying, strategy_type, direction,
                net_entry, fees, entry_date, setup, notes, context_at_entry,
                status, created_at, updated_at, source, external_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '{}', 'open', ?, ?, 'broker', ?)
            """,
            (sid, user_id, account_id, s["underlying"], s["strategy_type"],
             s["direction"], net_entry, entry_fee, s["entry_date"], now, now, external_id),
        )
    else:
        net_exit = opt.compute_net_exit([leg])
        exit_fee = round(s.get("exit_fee", 0.0), 2)
        pnl = opt.compute_pnl(net_entry, net_exit or 0.0, entry_fee, exit_fee)
        pnl_pct = round(pnl / abs(net_entry), 4) if net_entry else None
        result = "Win" if pnl > 0 else ("Loss" if pnl < 0 else "BE")
        conn.execute(
            """
            INSERT INTO j2_option_strategies (
                id, user_id, account_id, underlying, strategy_type, direction,
                net_entry, fees, entry_date, setup, notes, context_at_entry,
                status, closed_at, net_exit, exit_fees, pnl_dollar, pnl_percent,
                r_multiple, result, created_at, updated_at, source, external_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '{}', ?, ?, ?, ?, ?, ?,
                      NULL, ?, ?, ?, 'broker', ?)
            """,
            (sid, user_id, account_id, s["underlying"], s["strategy_type"],
             s["direction"], net_entry, entry_fee, s["entry_date"], s["status"],
             s["closed_at"], net_exit, exit_fee, pnl, pnl_pct, result, now, now, external_id),
        )

    conn.execute(
        """
        INSERT INTO j2_option_legs (
            id, strategy_id, leg_index, side, contract_type, strike,
            expiration, qty, entry_price, exit_price
        ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        """,
        (str(uuid.uuid4()), sid, s["side"], s["contractType"], s["strike"],
         s["expiration"], s["qty"], s["entry_price"], s["exit_price"]),
    )
