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
import re
import sqlite3
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import options as opt
# Imported as a MODULE, not `from … import _opt_contract_multiplier`: a
# from-import binds the function object at import time and severs this module
# from any patch/redefinition of the authority (lesson_from_import_severs_a_
# module_from_its_guards). `balances` is the ONE authority on contract size.
from api.services.journal_two.broker import balances as _balances


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


def _same_day_rank(ev: dict) -> int:
    """Tie-break for events sharing the same timestamp. Date-only brokers
    (Schwab reports every activity at midnight) lose intraday order, so row
    order is arbitrary — the explicit open/close labels are the only reliable
    sequencing signal: opens must replay before closes or a day-traded round
    trip strands the open AND fabricates a phantom lot from the close.
    Lifecycle events (expiration/assignment/exercise) settle after the day's
    trades."""
    if ev.get("eventKind") != "option_trade":
        return 3
    oc = ev.get("openClose")
    if oc == "open":
        return 0
    if oc == "close":
        return 2
    return 1  # unlabeled buy/sell — keep arrival order between the two


def reconstruct_options(
    user_id: str,
    broker_account_id: str,
    j2_account_id: str,
    option_events: list[dict],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Build + persist single-leg option strategies from option events."""
    # Sort chronologically (None dates last), opens-before-closes within a
    # timestamp tie, stable by row.
    events = sorted(option_events, key=lambda e: (
        e.get("date") is None, e.get("date") or "", _same_day_rank(e), e.get("row", 0)))

    # Per-contract state: open lots (all same side) + side label.
    lots: dict[tuple, deque] = {}
    side_of: dict[tuple, str | None] = {}

    built: list[dict] = []  # strategy dicts ready to insert
    orphan_closes = 0

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

        if oc == "close" and cur is None:
            # Explicit close with no open position — the opening trade is
            # outside the broker's history window (e.g. Schwab's ~4-year cap).
            # Never fabricate a phantom lot from it; the P&L of a trade whose
            # entry we can't see is unknowable.
            orphan_closes += 1
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

    res = _persist(user_id, broker_account_id, j2_account_id, built + open_built, conn)
    res["orphanCloses"] = orphan_closes
    return res


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


def _insert_strategy(conn, user_id, account_id, s, external_id, *,
                     multiplier: float = opt.STANDARD_CONTRACT_MULTIPLIER) -> None:
    """Persist one single-leg strategy + its leg.

    `multiplier` is the contract size the BROKER reported for this contract
    (10 for a mini option). The activity path leaves it at the standard 100 —
    SnapTrade's activity events carry no mini flag — while the holdings path
    threads through the value `_holding_contract` read from `balances`.
    """
    leg = {
        "side": s["side"], "contract_type": s["contractType"], "strike": s["strike"],
        "expiration": s["expiration"], "qty": s["qty"], "entry_price": s["entry_price"],
        "exit_price": s["exit_price"],
    }
    net_entry = opt.compute_net_entry([leg], multiplier=multiplier)
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
        net_exit = opt.compute_net_exit([leg], multiplier=multiplier)
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


# ── Holdings-as-truth for OPEN options ───────────────────────────────────────

def _holding_contract(h: dict) -> dict | None:
    """Extract (underlying, strike, expiration, contractType, units, entry, mark)
    from a SnapTrade option-holding. Returns None if unparseable."""
    from api.services.journal_two.broker.snaptrade_adapter import normalize_symbol
    sym = h.get("symbol")
    osym = sym.get("option_symbol") if isinstance(sym, dict) else None
    if not isinstance(osym, dict):
        return None
    under = osym.get("underlying_symbol")
    if isinstance(under, dict):
        under = under.get("symbol") or under.get("raw_symbol")
    under = normalize_symbol(under)
    try:
        strike = float(osym.get("strike_price"))
    except (TypeError, ValueError):
        return None
    expiration = str(osym.get("expiration_date") or "").split("T")[0]
    ctype_raw = str(osym.get("option_type") or "").lower()
    if ctype_raw.startswith("c"):
        contract_type = "call"
    elif ctype_raw.startswith("p"):
        contract_type = "put"
    else:  # parse OCC ticker: ...YYMMDD[C|P]00110000
        t = str(osym.get("ticker") or "").replace(" ", "")
        m = re.search(r"\d{6}([CP])\d+", t)
        contract_type = {"C": "call", "P": "put"}.get(m.group(1)) if m else None
    if not under or not expiration or not contract_type:
        return None
    try:
        units = float(h.get("units"))
    except (TypeError, ValueError):
        return None
    if abs(units) < 1e-9:
        return None
    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0
    # SnapTrade option units quirk: `price` is PER-SHARE (e.g. 27.81) but
    # `average_purchase_price` is PER-CONTRACT (premium × contract size, e.g.
    # 1550). Our leg.entry_price + P&L math are per-share (× qty × multiplier),
    # so normalize the cost basis to per-share to match the activity convention.
    #
    # Contract size is NOT 100 by assumption — a mini option is 10 shares. Ask
    # the one authority (`balances`), which reads the broker's own
    # `is_mini_option` flag; a second implementation here is what made a mini
    # option's entry price read 10× low and its current value 10× high on the
    # same screen where `balances.option_market_value` had it right.
    multiplier = _balances._opt_contract_multiplier(h)
    return {
        "underlying": under, "strike": strike, "expiration": expiration,
        "contractType": contract_type, "units": units,
        "multiplier": multiplier,
        "entry_price": _f(h.get("average_purchase_price")) / float(multiplier),
        "mark": _f(h.get("price")),
    }


_OPEN_BROKER_OPT_SQL = """
    SELECT s.id, s.external_id, s.underlying,
           l.id AS leg_id, l.strike, l.expiration, l.contract_type,
           l.qty AS leg_qty, l.entry_price AS leg_entry, l.side AS leg_side
    FROM j2_option_strategies s
    JOIN j2_option_legs l ON l.strategy_id = s.id
    WHERE s.user_id = ? AND s.account_id = ? AND s.source = 'broker'
      AND s.status = 'open' AND s.closed_at IS NULL
"""


def reconcile_option_holdings(
    user_id: str, broker_account: dict, raw_option_holdings: list[dict],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Holdings-as-truth for OPEN options — the option analogue of
    balances.reconcile_positions. Guarantees every option contract the broker
    currently holds has an OPEN strategy in J2 even when its opening activity
    isn't in the ledger (late/never backfilled), and refreshes each open
    strategy's current market value (broker mark × qty × contract size — 100
    for a standard contract, 10 for a mini, per `balances`) so the UI can show
    Current + P&L like equity positions.

    Activity-reconstructed strategies take precedence (they carry the real
    entry); carried-in (holdings-sourced, external_id 'bkoptpos:') strategies
    only fill contracts activities don't cover and are removed once no longer
    held or once an activity strategy covers the same contract. Idempotent via a
    stable per-contract external_id."""
    j2_account_id = broker_account["j2AccountId"]
    broker_account_id = broker_account["id"]
    owned = conn is None
    conn = conn or get_connection()
    created = removed = valued = 0
    try:
        conn.execute("BEGIN")
        # Current held contracts → {key: contract w/ signed current_value}.
        held: dict[tuple, dict] = {}
        for h in (raw_option_holdings or []):
            c = _holding_contract(h)
            if c is None:
                continue
            c["current_value"] = round(c["units"] * c["mark"] * c["multiplier"], 2)
            held[(c["underlying"], c["strike"], c["expiration"], c["contractType"])] = c

        rows = conn.execute(_OPEN_BROKER_OPT_SQL, (user_id, j2_account_id)).fetchall()
        activity_keys: set[tuple] = set()
        carried: list[tuple] = []  # (strategy_id, key)
        for r in rows:
            key = (r["underlying"], r["strike"], r["expiration"], r["contract_type"])
            if str(r["external_id"] or "").startswith("bkoptpos:"):
                carried.append((r["id"], key))
            else:
                activity_keys.add(key)
        existing_carried_keys = {k for _, k in carried}

        # CREATE carried-in opens for held contracts no strategy covers yet.
        for key, c in held.items():
            if key in activity_keys or key in existing_carried_keys:
                continue
            side = "buy" if c["units"] > 0 else "sell"
            stype = _strategy_type(side, c["contractType"])
            s = {
                "underlying": c["underlying"], "strike": c["strike"],
                "expiration": c["expiration"], "contractType": c["contractType"],
                "side": side, "strategy_type": stype, "direction": _direction(stype),
                "qty": abs(c["units"]), "entry_price": c["entry_price"],
                "entry_date": _now_iso(),  # true open date unknown (no activity)
                "entry_fee": 0.0, "exit_price": None, "closed_at": None, "status": "open",
            }
            ext = (f"bkoptpos:{broker_account_id}:{c['underlying']}:{c['strike']}:"
                   f"{c['expiration']}:{c['contractType']}:{side}")
            _insert_strategy(conn, user_id, j2_account_id, s, ext,
                             multiplier=c["multiplier"])
            created += 1

        # REMOVE carried-in no longer held, or now covered by an activity strategy.
        for sid, key in carried:
            if key not in held or key in activity_keys:
                conn.execute("DELETE FROM j2_option_legs WHERE strategy_id = ?", (sid,))
                conn.execute("DELETE FROM j2_option_strategies WHERE id = ?", (sid,))
                removed += 1

        # REFRESH current market value for every open broker strategy still held,
        # and CORRECT quantity to the broker's truth when activities diverged
        # (holdings-as-truth — the broker's held qty wins, like equities).
        now = _now_iso()
        for r in conn.execute(_OPEN_BROKER_OPT_SQL, (user_id, j2_account_id)).fetchall():
            c = held.get((r["underlying"], r["strike"], r["expiration"], r["contract_type"]))
            if c is None:
                continue
            held_qty = abs(c["units"])
            sign = 1 if c["units"] > 0 else -1
            held_side = "buy" if sign > 0 else "sell"
            # `held` is keyed WITHOUT side, so a contract whose sign flipped
            # (long → short via assignment) matches this row rather than
            # creating a new one. Holdings-as-truth therefore has to correct
            # SIDE here exactly as it corrects quantity — otherwise net_entry
            # keeps its old debit sign while broker_current_value goes
            # negative, and the row disagrees with itself on the member's P&L.
            qty_diverges = abs((r["leg_qty"] or 0) - held_qty) > 1e-9
            side_diverges = r["leg_side"] != held_side
            if qty_diverges or side_diverges:
                # Reseed from the broker holding (side + qty + entry).
                entry = c["entry_price"] or r["leg_entry"] or 0.0
                net_entry = round(sign * held_qty * entry * c["multiplier"], 2)
                stype = _strategy_type(held_side, r["contract_type"])
                conn.execute(
                    "UPDATE j2_option_legs SET side = ?, qty = ?, entry_price = ? "
                    "WHERE id = ?",
                    (held_side, held_qty, entry, r["leg_id"]),
                )
                conn.execute(
                    "UPDATE j2_option_strategies SET strategy_type = ?, direction = ?, "
                    "net_entry = ?, broker_current_value = ?, "
                    "broker_mark_synced_at = ?, updated_at = ? WHERE id = ?",
                    (stype, _direction(stype), net_entry, c["current_value"],
                     now, now, r["id"]),
                )
            else:
                conn.execute(
                    "UPDATE j2_option_strategies SET broker_current_value = ?, "
                    "broker_mark_synced_at = ?, updated_at = ? WHERE id = ?",
                    (c["current_value"], now, now, r["id"]),
                )
            valued += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {"created": created, "removed": removed, "valued": valued}
