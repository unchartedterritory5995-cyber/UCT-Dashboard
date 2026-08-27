"""Broker balances + holdings reconciliation (holdings-as-truth).

Two responsibilities, both driven by the broker's CURRENT state (not by
replaying activities):

  write_balances(): compute real cash / buying power / market value /
    net-liquidation equity for the account and stamp them on j2_accounts
    (balance_source='broker'). The balance_resolver then prefers these.

  reconcile_positions(): the broker's holdings endpoint is the source of
    truth for OPEN positions. We upsert a j2_positions row per holding,
    seeding entry from real FIFO fills when we have them, else from the
    broker's average cost basis (flagged entry_estimated=1 — a "carried-in"
    position whose true entry predates our activity history). Broker-sourced
    open positions that are no longer held are removed (their closing trade
    was already captured by FIFO).

User enrichments (stop, setup, notes added after import) are preserved
across syncs — we only update broker-owned facts (shares, and the estimated
entry while still estimated).
"""

from __future__ import annotations

import json
import math
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker.snaptrade_adapter import normalize_symbol


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _et_date() -> str:
    """Today's date in America/New_York (market timezone) as YYYY-MM-DD."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ── Field extraction ─────────────────────────────────────────────────────────

def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _pos_symbol(p: dict) -> str | None:
    sym = p.get("symbol")
    if isinstance(sym, str):
        return normalize_symbol(sym)
    if isinstance(sym, dict):
        inner = sym.get("symbol")
        if isinstance(inner, dict):  # nested universal symbol
            inner = inner.get("symbol") or inner.get("raw_symbol")
        return normalize_symbol(inner or sym.get("raw_symbol"))
    return None


def usd_cash_buying_power(raw_balances: list[dict]) -> tuple[float | None, float | None]:
    """Sum USD cash + buying power across balance entries. Falls back to the
    first entry when no currency is labeled USD (single-currency accounts)."""
    usd = [b for b in raw_balances if _currency_code(b) in (None, "USD")]
    pool = usd or raw_balances
    cash = sum(_num(b.get("cash")) or 0.0 for b in pool) if pool else None
    bps = [_num(b.get("buying_power")) for b in pool if _num(b.get("buying_power")) is not None]
    buying_power = max(bps) if bps else None
    return (cash, buying_power)


def _currency_code(b: dict) -> str | None:
    c = b.get("currency")
    if isinstance(c, str):
        return c.upper()
    if isinstance(c, dict):
        return (c.get("code") or c.get("currency") or "").upper() or None
    return None


def _pos_currency(p: dict) -> str | None:
    c = p.get("currency")
    if isinstance(c, str):
        return c.upper()
    if isinstance(c, dict):
        return (c.get("code") or c.get("currency") or "").upper() or None
    return None


def _account_total_usd(raw_account: dict) -> float | None:
    """The broker's OWN reported total account value from a raw SnapTrade
    account (`balance.total.amount`), USD only — the authoritative net-liq that
    mirrors the user's app. None if absent or non-USD."""
    if not isinstance(raw_account, dict):
        return None
    bal = raw_account.get("balance")
    tot = bal.get("total") if isinstance(bal, dict) else None
    if not isinstance(tot, dict):
        return None
    cur = tot.get("currency")
    code = cur.get("code") if isinstance(cur, dict) else cur
    if code not in (None, "", "USD"):
        return None
    return _num(tot.get("amount"))


def market_value(raw_positions: list[dict]) -> float:
    """Signed USD mark-to-market: Σ(units × current price) over USD (or
    currency-less) holdings only. Non-USD positions are EXCLUDED — summing
    them into USD cash without an FX rate would mis-state equity. v1 is
    USD-focused; non-USD support needs per-position FX conversion."""
    total = 0.0
    for p in raw_positions:
        cur = _pos_currency(p)
        if cur not in (None, "USD"):
            continue
        units = _num(p.get("units"))
        price = _num(p.get("price"))
        if units is not None and price is not None:
            total += units * price
    return round(total, 2)


def has_non_usd_positions(raw_positions: list[dict]) -> bool:
    return any(_pos_currency(p) not in (None, "USD") for p in raw_positions)


def _opt_contract_multiplier(o: dict) -> int:
    """Equity options are 100 shares/contract; mini options are 10."""
    sym = o.get("symbol")
    osym = sym.get("option_symbol") if isinstance(sym, dict) else None
    if isinstance(osym, dict) and osym.get("is_mini_option"):
        return 10
    return 100


def option_market_value(raw_option_holdings: list[dict]) -> float:
    """Signed USD mark-to-market of option holdings:
    Σ(units × price × contract_multiplier) over USD (or currency-less) contracts.
    The positions endpoint excludes options, so without this the account's
    net-liq equity understates by the value of any options held."""
    total = 0.0
    for o in raw_option_holdings or []:
        cur = _pos_currency(o)
        if cur not in (None, "USD"):
            continue
        units = _num(o.get("units"))
        price = _num(o.get("price"))
        if units is not None and price is not None:
            total += units * price * _opt_contract_multiplier(o)
    return round(total, 2)


# ── Balances ─────────────────────────────────────────────────────────────────

def write_balances(
    user_id: str,
    broker_account: dict,
    raw_balances: list[dict],
    raw_positions: list[dict],
    conn: sqlite3.Connection | None = None,
    *,
    raw_option_holdings: list[dict] | None = None,
    broker_total: float | None = None,
) -> dict[str, Any]:
    """Compute + persist real broker balances onto the mapped j2_account.

    Net-liq equity PREFERS the broker's OWN reported account total
    (`account.balance.total.amount`, passed as `broker_total`) — that's the
    broker's exact number and mirrors what the user sees in their app. Only when
    the broker doesn't report a total do we DERIVE it as cash + equity MV +
    option MV (the options term matters: SnapTrade's positions endpoint is
    equities-only). Deriving from SnapTrade's position prices drifts a little vs
    the broker's live marks — hence preferring the reported total."""
    cash, buying_power = usd_cash_buying_power(raw_balances)
    equity_mv = market_value(raw_positions)
    opt_mv = option_market_value(raw_option_holdings or [])
    mv = round(equity_mv + opt_mv, 2)
    derived = round((cash or 0.0) + mv, 2)
    equity = round(float(broker_total), 2) if broker_total is not None else derived

    # STALE-TOTAL GUARD (2026-08-21). The July doctrine preferred the broker's
    # own `balance.total` because "it mirrors the user's app exactly" — measured
    # false for Robinhood intraday: the total field served YESTERDAY'S equity
    # all session ($10,227.88 at the 16:47Z sync) while the SAME payload's live
    # cash + positions summed to the number the RH app actually displayed.
    # Both candidates are broker-reported; when they disagree by more than
    # noise, the LIVE components are the one the member's broker app shows —
    # so they win, within a sanity band: a divergence beyond 20% is structural
    # (an FX sleeve / filtered non-USD positions the USD-gated components
    # miss), and there the reported total stays authoritative.
    if (broker_total is not None and cash is not None
            and math.isfinite(equity) and math.isfinite(derived)):
        gap = abs(derived - equity)
        if gap > max(5.0, 0.005 * abs(equity)) and gap <= 0.20 * max(abs(equity), 1.0):
            equity = derived

    # INV-4 sanity floor. A broker-reported total is TRUTH — mirror it even if
    # negative (real margin debt). But the DERIVED path (no broker total) pairs a
    # COMPLETE broker cash figure with a possibly-INCOMPLETE positions feed, so a
    # full margin debit against a truncated market value can go implausibly <= 0
    # (the −$17,774 class). We must never persist a fabricated / non-finite
    # net-liq as the account's equity, its account_size (sizing / risk% / heat%
    # denominator), or an equity-curve point. When the derived equity is
    # untrustworthy we still refresh the individually broker-reported cash / BP /
    # MV, but leave the prior (last-good) equity + account_size + curve untouched
    # — resolve_equity then reports "pending" and the UI shows "—", never a wrong
    # number.
    # Finiteness is checked UNCONDITIONALLY: Python's json parses NaN/Infinity,
    # so a bad SDK payload can make broker_total (and thus equity) non-finite —
    # that must never reach account_size / the equity curve.
    equity_trustworthy = math.isfinite(equity) and (
        broker_total is not None or equity > 0
    )

    owned = conn is None
    conn = conn or get_connection()
    try:
        if equity_trustworthy:
            # Mirror the broker: a broker account's "size" IS its real net-liq
            # equity (denominator for % invested / risk% / heat% and the base for
            # position sizing). Sync it every balance refresh.
            conn.execute(
                """
                UPDATE j2_accounts
                   SET balance_source = 'broker',
                       broker_total_equity = ?, broker_cash = ?,
                       broker_buying_power = ?, broker_market_value = ?,
                       account_size = ?,
                       broker_balance_synced_at = ?, updated_at = ?
                 WHERE id = ? AND user_id = ?
                """,
                (equity, cash, buying_power, mv, equity, _now_iso(), _now_iso(),
                 broker_account["j2AccountId"], user_id),
            )
            # Append a daily net-liq snapshot (latest sync of the day wins) →
            # powers the real broker equity curve.
            conn.execute(
                """
                INSERT INTO j2_broker_equity_snapshots
                    (user_id, broker_account_id, snapshot_date, total_equity, cash,
                     market_value, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, broker_account_id, snapshot_date) DO UPDATE SET
                    total_equity = excluded.total_equity, cash = excluded.cash,
                    market_value = excluded.market_value, synced_at = excluded.synced_at
                """,
                (user_id, broker_account["id"], _et_date(), equity, cash, mv, _now_iso()),
            )
        else:
            # Untrustworthy derived equity: refresh the component balances but do
            # NOT clobber equity / account_size / the curve with a fabricated
            # number. The prior last-good equity stays in place.
            conn.execute(
                """
                UPDATE j2_accounts
                   SET balance_source = 'broker',
                       broker_cash = ?, broker_buying_power = ?,
                       broker_market_value = ?,
                       broker_balance_synced_at = ?, updated_at = ?
                 WHERE id = ? AND user_id = ?
                """,
                (cash, buying_power, mv, _now_iso(), _now_iso(),
                 broker_account["j2AccountId"], user_id),
            )
        conn.commit()
    finally:
        if owned:
            conn.close()
    return {
        "equity": equity if equity_trustworthy else None,
        "cash": cash, "buyingPower": buying_power, "marketValue": mv,
        "equityTrustworthy": equity_trustworthy,
    }


# ── Holdings reconciliation (positions) ──────────────────────────────────────

def reconcile_positions(
    user_id: str,
    broker_account: dict,
    raw_positions: list[dict],
    fifo_open_positions: list[dict],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Make j2_positions match the broker's current holdings. Returns
    {upserted, closed, discrepancies}."""
    j2_account_id = broker_account["j2AccountId"]
    broker_account_id = broker_account["id"]

    # Index FIFO-reconstructed open lots by (symbol, side) for entry seeding.
    fifo_by_key = {(p["symbol"], p["side"]): p for p in fifo_open_positions}

    owned = conn is None
    conn = conn or get_connection()
    upserted = 0
    discrepancies: list[dict] = []
    seen_ext: set[str] = set()
    try:
        conn.execute("BEGIN")
        for p in raw_positions:
            symbol = _pos_symbol(p)
            units = _num(p.get("units"))
            if not symbol or units is None or abs(units) < 1e-9:
                continue
            side = "Long" if units > 0 else "Short"
            shares = round(abs(units) * 10000) / 10000
            avg_cost = _num(p.get("average_purchase_price"))
            # Broker's current per-share mark (snapshot at sync time). Lets the UI
            # show a real price + P&L after hours when the live tick feed is empty.
            cur_price = _num(p.get("price"))

            fifo_match = fifo_by_key.get((symbol, side))
            if fifo_match is not None and abs(fifo_match["shares"] - shares) <= 1e-6:
                # FIFO agrees with the broker → trust the real reconstructed entry.
                entry_price = fifo_match["entryPrice"]
                entry_date = fifo_match["entryDate"]
                entry_estimated = 0
            elif fifo_match is not None:
                # Shares diverge (e.g. a split, a missed/late activity, transfer):
                # do NOT freeze the stale FIFO basis as authoritative. Seed from
                # the broker's cost basis and flag estimated so a later clean
                # reconstruction can correct it.
                entry_price = avg_cost if avg_cost and avg_cost > 0 else (_num(p.get("price")) or 0.0)
                # True entry date is unknown until activities reconstruct it. entry_date
                # is NOT NULL, so store a placeholder; entry_estimated=1 tells the UI to
                # render the date as "—/est." rather than this placeholder.
                entry_date = _now_iso()
                entry_estimated = 1
                discrepancies.append({
                    "symbol": symbol, "side": side,
                    "brokerShares": shares, "fifoShares": fifo_match["shares"],
                })
            else:
                # Carried-in: no activity history for this holding. Seed entry
                # from the broker's cost basis and flag it as estimated.
                entry_price = avg_cost if avg_cost and avg_cost > 0 else (_num(p.get("price")) or 0.0)
                # Carried-in: true entry date predates our history. NOT NULL column →
                # placeholder; entry_estimated=1 drives the UI to show "—/est." not this.
                entry_date = _now_iso()
                entry_estimated = 1

            ext = f"bkpos:{broker_account_id}:{symbol}:{side}"
            seen_ext.add(ext)
            existing = conn.execute(
                "SELECT id, entry_estimated, shares, entry_price, stop_price "
                "FROM j2_positions "
                "WHERE user_id = ? AND external_id = ?",
                (user_id, ext),
            ).fetchone()

            now = _now_iso()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO j2_positions (
                        id, user_id, symbol, side, entry_date, shares,
                        original_shares, entry_price, stop_price, breakeven_stop,
                        raise_to_breakeven, setup, notes, context_at_entry,
                        created_at, updated_at, closed_at, account_id,
                        source, external_id, entry_estimated, broker_price
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, '{}',
                              ?, ?, NULL, ?, 'broker', ?, ?, ?)
                    """,
                    # stop_price column is NOT NULL; broker imports have no stop, so we
                    # store entry_price as a placeholder and the UI renders it as "—"
                    # for broker positions until the user sets a real stop.
                    (str(uuid.uuid4()), user_id, symbol, side, entry_date, shares,
                     shares, entry_price, entry_price, now, now, j2_account_id,
                     ext, entry_estimated, cur_price),
                )
            else:
                # Update broker-owned facts only. Preserve user enrichments
                # (stop/setup/notes) — but entry_price/entry_date are broker
                # facts, NOT enrichments, so they must track the broker. The whole
                # point: whenever the share count changes (an add or trim), the
                # average entry must be refreshed for EVERY position.
                prior_shares = existing["shares"] if existing["shares"] is not None else 0.0
                shares_changed = abs(prior_shares - shares) > 1e-6
                # Broker imports seed stop_price = entry_price as the "no stop
                # set" placeholder. When a later sync refreshes entry_price and
                # leaves the old placeholder behind, the two drift by rounding
                # (ORCL: entry 126.0049 vs stop 126.005) and every placeholder
                # detector downstream — UI blanking, risk/heat exclusion,
                # portfolio_heat's safety rail — silently stops firing. Keep
                # the placeholder in LOCKSTEP with the entry it mirrors; a
                # user's real stop (anything not ≈ the previous entry) is
                # never touched.
                prior_entry = existing["entry_price"]
                prior_stop = existing["stop_price"]
                stop_is_placeholder = (
                    prior_entry is not None and prior_stop is not None
                    and abs(float(prior_stop) - float(prior_entry))
                    <= max(0.001, abs(float(prior_entry)) * 1e-5)
                )
                if entry_estimated == 0:
                    # Fresh real fills (FIFO agrees with the broker). Refresh the
                    # weighted-average entry + entry date + share count regardless
                    # of whether the existing row was estimated or already real —
                    # this is what makes "add → average entry recomputes" work
                    # once the new fills have backfilled.
                    conn.execute(
                        "UPDATE j2_positions SET shares = ?, original_shares = ?, "
                        "entry_price = ?, entry_date = ?, entry_estimated = 0, "
                        "broker_price = ?, updated_at = ?, "
                        "stop_price = CASE WHEN ? THEN ? ELSE stop_price END "
                        "WHERE id = ?",
                        (shares, shares, entry_price, entry_date, cur_price, now,
                         1 if stop_is_placeholder else 0, entry_price, existing["id"]),
                    )
                elif shares_changed or existing["entry_estimated"] == 1:
                    # Either the share count actually changed (a real add/trim whose
                    # fills haven't backfilled to the broker's activity feed yet, so
                    # FIFO can't reconstruct them) OR we never had a real basis.
                    # Reseed the average from the broker's reported cost so the
                    # displayed average always tracks the current holding; flag
                    # estimated so the later clean reconstruction (branch above)
                    # corrects it to the precise FIFO entry + real date.
                    conn.execute(
                        "UPDATE j2_positions SET shares = ?, original_shares = ?, "
                        "entry_price = ?, entry_estimated = 1, broker_price = ?, "
                        "updated_at = ?, "
                        "stop_price = CASE WHEN ? THEN ? ELSE stop_price END "
                        "WHERE id = ?",
                        (shares, shares, entry_price, cur_price, now,
                         1 if stop_is_placeholder else 0, entry_price, existing["id"]),
                    )
                else:
                    # Holding unchanged + existing basis is real; FIFO just can't
                    # reconstruct this sync (transient heal window). Keep the real
                    # basis — never downgrade an unchanged position to an estimate.
                    conn.execute(
                        "UPDATE j2_positions SET shares = ?, broker_price = ?, "
                        "updated_at = ? WHERE id = ?",
                        (shares, cur_price, now, existing["id"]),
                    )
            upserted += 1

        # Remove broker-sourced open positions no longer held at the broker.
        stale = conn.execute(
            "SELECT id, external_id FROM j2_positions "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker' "
            "AND closed_at IS NULL AND external_id LIKE 'bkpos:%'",
            (user_id, j2_account_id),
        ).fetchall()
        closed = 0
        for row in stale:
            if row["external_id"] not in seen_ext:
                conn.execute("DELETE FROM j2_positions WHERE id = ?", (row["id"],))
                closed += 1

        # Provisional intraday rows (apply_intraday_growth, 'bkprov:'):
        # holdings-as-truth supersedes them the moment the broker confirms
        # the position (a real bkpos row for the same symbol/side was just
        # upserted above). When the payload DOESN'T carry the symbol yet —
        # SnapTrade's holdings cache can lag a fill by hours — a FRESH
        # provisional row survives (deleting it would make a real position
        # vanish again); one the broker never confirms expires after 2 days.
        prov_prefix = f"bkprov:{broker_account_id}:"
        prov_rows = conn.execute(
            "SELECT id, external_id, updated_at FROM j2_positions "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker' "
            "AND closed_at IS NULL AND external_id LIKE 'bkprov:%'",
            (user_id, j2_account_id),
        ).fetchall()
        for row in prov_rows:
            ext = row["external_id"] or ""
            if not ext.startswith(prov_prefix):
                continue
            superseded = (
                f"bkpos:{broker_account_id}:{ext[len(prov_prefix):]}" in seen_ext
            )
            expired = False
            if not superseded:
                try:
                    updated = datetime.fromisoformat(
                        str(row["updated_at"]).replace("Z", "+00:00"))
                    if updated.tzinfo is None:
                        updated = updated.replace(tzinfo=timezone.utc)
                    expired = (datetime.now(timezone.utc) - updated).days >= 2
                except (TypeError, ValueError):
                    expired = True
            if superseded or expired:
                conn.execute("DELETE FROM j2_positions WHERE id = ?", (row["id"],))
                closed += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {"upserted": upserted, "closed": closed, "discrepancies": discrepancies}


def apply_intraday_growth(
    user_id: str,
    broker_account: dict,
    fifo_open_positions: list[dict],
    *,
    traded_symbols: dict[str, str],
    fifo_errors: list[dict] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, int]:
    """Materialize THIS POLL's equity fills into the served book, minutes
    after execution — the growth counterpart to the shrink/close fast path.

    The 2026-08-26 gap: the rail captured a 2000-share SNAP buy into the
    ledger at 14:54Z, live_cash debited it, but no writer could CREATE the
    position row until the overnight sync — the book lagged the cash all
    day. This pass closes it, under the same safety doctrine as the shrink
    path (only ledger-complete state, only where FIFO is trustworthy):

      • Scope is `traded_symbols` — the symbols whose provisional fills THIS
        poll stored (`{SYM: earliest fill iso}`), never the whole FIFO (the
        ledger legitimately carries dust/phantom lots for symbols whose
        opening history predates our window — those belong to holdings-as-
        truth, not to us).
      • A NEW position is created only when its FIFO lot chain ORIGINATES at
        this poll's fill (entryDate >= the fill timestamp, small slack) —
        i.e. the position exists BECAUSE of today's trade, with no carried
        history involved. It gets external_id `bkprov:{account}:{sym}:{side}`
        so reconcile_positions can supersede it with the real holdings row
        (or expire it after 2 days if the broker never confirms).
      • An EXISTING row grows only when its basis is real and ledger-complete
        (`entry_estimated = 0` — the same gate the shrink path trusts), and
        the FIFO count exceeds the row's. Entry refreshes to FIFO's weighted
        average; a placeholder stop follows it in lockstep, a real stop is
        never touched.
      • FIFO-error symbols are skipped wholesale (untrustworthy count).

    Cash derives forward over the same fills (live_cash), so book and cash
    move from the same ledger rows in the same minute — the conservation
    sentinel's happy path. Returns {created, grown}."""
    j2_account_id = broker_account["j2AccountId"]
    broker_account_id = broker_account["id"]
    traded = {normalize_symbol(s): ts for s, ts in (traded_symbols or {}).items()
              if s}
    traded.pop(None, None)
    error_syms = {
        normalize_symbol(e["symbol"])
        for e in (fifo_errors or [])
        if isinstance(e, dict) and e.get("symbol")
    }
    error_syms.discard(None)

    def _dt(v):
        from datetime import datetime as _dtc
        try:
            d = _dtc.fromisoformat(str(v).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)

    owned = conn is None
    conn = conn or get_connection()
    created = grown = 0
    try:
        conn.execute("BEGIN")
        now = _now_iso()
        for p in fifo_open_positions or []:
            sym = normalize_symbol(p.get("symbol"))
            side = p.get("side")
            if not sym or sym not in traded or sym in error_syms:
                continue
            if side not in ("Long", "Short"):
                continue
            shares = _num(p.get("shares"))
            entry = _num(p.get("entryPrice"))
            if not shares or shares <= 0 or not entry or entry <= 0:
                continue
            shares = round(abs(shares) * 10000) / 10000
            existing = conn.execute(
                "SELECT id, shares, entry_price, stop_price, entry_estimated "
                "FROM j2_positions WHERE user_id = ? AND account_id = ? "
                "AND symbol = ? AND side = ? AND closed_at IS NULL "
                "AND source = 'broker' "
                "AND (external_id LIKE 'bkpos:%' OR external_id LIKE 'bkprov:%')",
                (user_id, j2_account_id, sym, side),
            ).fetchone()
            if existing is None:
                fill_ts = _dt(traded.get(sym))
                origin = _dt(p.get("entryDate"))
                if fill_ts is None or origin is None:
                    continue
                from datetime import timedelta as _td
                if origin < fill_ts - _td(minutes=1):
                    continue  # carried history involved — the sync owns it
                conn.execute(
                    """
                    INSERT INTO j2_positions (
                        id, user_id, symbol, side, entry_date, shares,
                        original_shares, entry_price, stop_price, breakeven_stop,
                        raise_to_breakeven, setup, notes, context_at_entry,
                        created_at, updated_at, closed_at, account_id,
                        source, external_id, entry_estimated, broker_price
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL,
                              '{}', ?, ?, NULL, ?, 'broker', ?, 0, ?)
                    """,
                    (str(uuid.uuid4()), user_id, sym, side,
                     str(p.get("entryDate")), shares, shares, entry, entry,
                     now, now, j2_account_id,
                     f"bkprov:{broker_account_id}:{sym}:{side}", entry),
                )
                created += 1
                continue
            if existing["entry_estimated"] == 1:
                continue
            prior = existing["shares"] if existing["shares"] is not None else 0.0
            if shares <= prior + 1e-6:
                continue  # not an add (shrinks belong to the shrink path)
            prior_entry = existing["entry_price"]
            prior_stop = existing["stop_price"]
            stop_is_placeholder = (
                prior_entry is not None and prior_stop is not None
                and abs(float(prior_stop) - float(prior_entry))
                <= max(0.001, abs(float(prior_entry)) * 1e-5)
            )
            conn.execute(
                "UPDATE j2_positions SET shares = ?, original_shares = ?, "
                "entry_price = ?, updated_at = ?, "
                "stop_price = CASE WHEN ? THEN ? ELSE stop_price END "
                "WHERE id = ?",
                (shares, shares, entry, now,
                 1 if stop_is_placeholder else 0, entry, existing["id"]),
            )
            grown += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {"created": created, "grown": grown}


def apply_intraday_fifo_to_open_positions(
    user_id: str,
    broker_account: dict,
    fifo_open_positions: list[dict],
    fifo_errors: list[dict] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """OPTIMISTIC Open-Positions update with NO broker holdings call.

    The recent-orders fast path injects a new executed fill and rebuilds
    j2_trades from the LOCAL ledger, but never refreshes j2_positions — so a
    just-flattened position lingers in Open Positions with a stale share count
    until the next full sync. This bridges that gap for the SAFE subset of rows,
    staying inside SnapTrade's polling cap (no holdings/positions API call).

    SAFETY — this only ever SHRINKS or CLOSES, and only rows whose basis is real
    and ledger-complete:

      • Gate on ``entry_estimated = 0``. That flag is set (in reconcile_positions)
        only when FIFO shares matched the broker's share count EXACTLY at the last
        full reconcile — i.e. the local ledger fully explains the holding. Every
        intraday fill since is captured by the recent-orders poll (which returns
        ALL executed orders in its window and dedups), so the post-fill FIFO share
        count for such a symbol is trustworthy. Carried-in / diverged rows
        (``entry_estimated = 1``) have missing opening lots — their FIFO count is
        meaningless (a sell of a carried-in long even reconstructs as a phantom
        short), so they are NEVER touched here; the next full holdings-as-truth
        sync owns them.
      • The recent-orders feed contains only EXECUTED orders, never phantom sells,
        so FIFO can never show FEWER shares than the broker actually holds for a
        ledger-complete symbol. Hence a shrink/close here can never drop or
        under-count a position that still has open shares.

    Direction is strictly one-way:
      • FIFO shares  < row shares            → UPDATE shares down (partial trim/exit)
      • (symbol, side) absent from FIFO      → DELETE the row (full exit; the
        closing round-trip is already written to j2_trades by reconstruct_account)
      • FIFO shares >= row shares            → no-op (an add — the next full sync
        refreshes entry/basis; the fast path never grows a position or rewrites
        the average entry)

    Returns {trimmed, closed}.
    """
    j2_account_id = broker_account["j2AccountId"]
    broker_account_id = broker_account["id"]
    # Post-fill FIFO leftovers keyed by (normalized symbol, side) — same
    # normalize_symbol + "Long"/"Short" space as the bkpos: external_id.
    fifo_shares: dict[tuple[str, str], float] = {
        (p["symbol"], p["side"]): p["shares"]
        for p in fifo_open_positions
        if p.get("symbol") and p.get("side")
    }
    # Both broker-row families: holdings-attested (bkpos) and this-session
    # provisional (bkprov, created by apply_intraday_growth) — a sell must
    # shrink/close a provisional position exactly like a synced one.
    prefixes = (f"bkpos:{broker_account_id}:", f"bkprov:{broker_account_id}:")
    # Symbols whose FIFO reconstruction DROPPED a lot this rebuild (e.g. a
    # transient transfer-basis miss on a price-less ACATS/JRNLSEC transfer-in)
    # have an untrustworthy share count — the broker may still hold the shares.
    # NEVER trim/close such a symbol here (that would false-close a still-held
    # position and lose the user's stop/setup/notes); the next full
    # holdings-as-truth sync owns it. Normalized to match the bkpos: symbol.
    error_syms = {
        normalize_symbol(e["symbol"])
        for e in (fifo_errors or [])
        if isinstance(e, dict) and e.get("symbol")
    }
    error_syms.discard(None)

    owned = conn is None
    conn = conn or get_connection()
    trimmed = 0
    closed = 0
    try:
        conn.execute("BEGIN")
        rows = conn.execute(
            "SELECT id, external_id, shares FROM j2_positions "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker' "
            "AND closed_at IS NULL AND entry_estimated = 0 "
            "AND (external_id LIKE 'bkpos:%' OR external_id LIKE 'bkprov:%')",
            (user_id, j2_account_id),
        ).fetchall()
        now = _now_iso()
        for row in rows:
            ext = row["external_id"] or ""
            prefix = next((p for p in prefixes if ext.startswith(p)), None)
            if prefix is None:
                continue  # a different broker account's row — never touch it
            # external_id == bk(pos|prov):{broker_account_id}:{symbol}:{side};
            # the symbol never contains ':' (equity ticker, class → hyphen).
            symbol, _, side = ext[len(prefix):].rpartition(":")
            if not symbol or side not in ("Long", "Short"):
                continue
            if symbol in error_syms:
                continue  # untrustworthy FIFO count this rebuild — leave for the full sync
            row_shares = row["shares"] if row["shares"] is not None else 0.0
            key = (symbol, side)
            if key in fifo_shares:
                fs = fifo_shares[key]
                if fs < row_shares - 1e-6:
                    conn.execute(
                        "UPDATE j2_positions SET shares = ?, updated_at = ? "
                        "WHERE id = ?",
                        (round(fs * 10000) / 10000, now, row["id"]),
                    )
                    trimmed += 1
                # fs >= row_shares → add/unchanged: leave for the full sync.
            else:
                # Position went flat in the ledger-complete FIFO → close it now.
                conn.execute("DELETE FROM j2_positions WHERE id = ?", (row["id"],))
                closed += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {"trimmed": trimmed, "closed": closed}
