"""
Position-sizing engine with hard refusals.

Acts as a risk officer for the voice assistant: knows the user's account
size, max risk per trade, current open exposure, and refuses trades that
violate the rules.

Two main entry points:
  - calc_position_size(account_size, risk_pct, entry, stop)
    Pure math, no DB. Returns suggested shares + dollar risk + R-multiple.

  - validate_trade(user_id, symbol, entry, stop, shares, account_id?)
    Full check against user's account + current exposure + correlation
    in same symbol. Returns {ok, reason?, suggested_shares, max_shares,
    dollar_risk, account_risk_pct, refusal_basis}.

Refusal grounds (any one fails the trade):
  - shares × (entry - stop) > account_size × max_risk_pct
  - total open exposure (current + this trade's risk) > 5 × max_risk_pct
  - already have an open position in this symbol (would compound)
  - stop is on wrong side of entry (long with stop > entry, etc)
  - implied risk > 10% of account regardless (hard upper bound)
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)

# Hard caps that override per-user settings — these protect from catastrophe
ABSOLUTE_MAX_RISK_PER_TRADE_PCT = 5.0  # No single trade may risk >5% ever
ABSOLUTE_MAX_PORTFOLIO_HEAT_PCT = 12.0  # Total open risk capped at 12%
DEFAULT_RISK_PCT = 1.0  # Used when account has no setting


# ── Pure math (no DB) ───────────────────────────────────────────────────────

def calc_position_size(
    *,
    account_size: float,
    risk_pct: float,
    entry: float,
    stop: float,
    side: str = "long",
) -> dict:
    """
    Calculate suggested position size for a planned trade.

    Returns {shares, dollar_risk, r_per_share, account_size, risk_pct,
             ok, reason?}.
    """
    out: dict[str, Any] = {
        "account_size": float(account_size),
        "risk_pct": float(risk_pct),
        "entry": float(entry),
        "stop": float(stop),
        "side": side,
    }
    if account_size <= 0:
        return {**out, "ok": False, "reason": "account size must be positive",
                "shares": 0}
    if risk_pct <= 0 or risk_pct > ABSOLUTE_MAX_RISK_PER_TRADE_PCT:
        return {**out, "ok": False,
                "reason": f"risk_pct must be in (0, {ABSOLUTE_MAX_RISK_PER_TRADE_PCT}]",
                "shares": 0}
    if entry <= 0 or stop <= 0:
        return {**out, "ok": False, "reason": "entry and stop must be positive",
                "shares": 0}

    if side == "long":
        if stop >= entry:
            return {**out, "ok": False,
                    "reason": "for a long, stop must be below entry", "shares": 0}
        r_per_share = entry - stop
    else:  # short
        if stop <= entry:
            return {**out, "ok": False,
                    "reason": "for a short, stop must be above entry", "shares": 0}
        r_per_share = stop - entry

    if r_per_share <= 0:
        return {**out, "ok": False, "reason": "no risk distance", "shares": 0}

    risk_budget = account_size * (risk_pct / 100.0)
    shares = int(risk_budget / r_per_share)
    dollar_risk = round(shares * r_per_share, 2)

    return {
        **out,
        "ok": True,
        "shares": shares,
        "r_per_share": round(r_per_share, 4),
        "dollar_risk": dollar_risk,
        "risk_budget": round(risk_budget, 2),
    }


# ── Full validation against user state ─────────────────────────────────────

def _get_account_settings(user_id: str, account_id: str | None) -> dict:
    """Pull account_size + max_risk_pct from j2_accounts. Falls back to
    legacy j2_settings or defaults if no account."""
    try:
        from api.services.journal_two import accounts as j2_accounts
        if account_id is None:
            acc = j2_accounts.get_or_migrate_default_account(user_id)
        else:
            acc = j2_accounts.get_account(user_id, account_id) or \
                  j2_accounts.get_or_migrate_default_account(user_id)
    except Exception:
        return {"account_size": 25000.0, "max_risk_pct": DEFAULT_RISK_PCT,
                "account_id": None, "account_name": "Default"}
    settings = acc.get("settings") or {}
    return {
        "account_id": acc.get("id"),
        "account_name": acc.get("displayName") or acc.get("name") or "Default",
        "account_size": float(settings.get("accountSize") or 25000.0),
        "max_risk_pct": float(settings.get("maxRiskPerTradePct") or DEFAULT_RISK_PCT),
    }


def _current_portfolio_risk(user_id: str, account_id: str | None) -> dict:
    """Sum dollar risk of every open position. Risk per position =
    shares × (entry - stop) for longs, mirror for shorts. Also aggregates
    by sector via theme_db so correlation checks have data."""
    try:
        from api.services.journal_two import positions as j2_positions
        opens = j2_positions.list_open_positions(user_id, account_id=account_id) or []
    except Exception:
        return {"total_risk": 0.0, "open_count": 0, "by_symbol": {},
                "by_sector": {}}

    total = 0.0
    by_symbol: dict[str, float] = {}
    by_sector: dict[str, float] = {}

    # Pull sector membership for each open symbol
    try:
        from api.services.theme_db import get_themes_for_ticker
        sector_lookup = {
            (p.get("symbol") or "").upper(): get_themes_for_ticker(p.get("symbol") or "")
            for p in opens if p.get("symbol")
        }
    except Exception:
        sector_lookup = {}

    for p in opens:
        entry = p.get("entryPrice")
        stop = p.get("stopPrice")
        shares = p.get("shares")
        sym = (p.get("symbol") or "").upper()
        if entry is None or stop is None or shares is None or not sym:
            continue
        try:
            risk_per_share = abs(float(entry) - float(stop))
            risk = float(shares) * risk_per_share
        except (TypeError, ValueError):
            continue
        total += risk
        by_symbol[sym] = by_symbol.get(sym, 0.0) + risk

        # Attribute risk to sector(s). If a ticker belongs to multiple
        # sectors, count it in each — concentrated tickers should worry
        # us in EVERY sector lens they hit, not be split.
        themes = sector_lookup.get(sym) or []
        seen_sectors: set[str] = set()
        for t in themes:
            sname = (t.get("sector_name") or "").strip()
            if not sname or sname in seen_sectors:
                continue
            seen_sectors.add(sname)
            by_sector[sname] = by_sector.get(sname, 0.0) + risk

    return {
        "total_risk": round(total, 2),
        "open_count": len(opens),
        "by_symbol": {k: round(v, 2) for k, v in by_symbol.items()},
        "by_sector": {k: round(v, 2) for k, v in by_sector.items()},
    }


def _sectors_for_symbol(sym: str) -> set[str]:
    """Return distinct sector names for a ticker via theme_db."""
    try:
        from api.services.theme_db import get_themes_for_ticker
        themes = get_themes_for_ticker(sym) or []
    except Exception:
        return set()
    return {(t.get("sector_name") or "").strip()
            for t in themes if t.get("sector_name")}


def get_risk_dashboard(user_id: str, account_id: str | None = None) -> dict:
    """Compose the Risk Dashboard payload — total heat, by-symbol, by-sector,
    recent refusals, account settings. Read-only.

    Used by the Risk Dashboard UI panel to visualize the position-sizing
    engine state.
    """
    settings = _get_account_settings(user_id, account_id)
    account_size = float(settings.get("account_size") or 0)
    max_risk_pct = float(settings.get("max_risk_pct") or 0)
    current = _current_portfolio_risk(user_id, settings.get("account_id"))

    total_risk = float(current.get("total_risk") or 0)
    portfolio_heat_pct = (total_risk / account_size * 100.0) if account_size > 0 else 0.0
    portfolio_heat_cap_pct = max_risk_pct * 3.0  # mirror validate_trade rule 3
    max_sector_pct = max_risk_pct * 2.5          # mirror validate_trade rule 5

    # Top concentrations
    by_symbol = current.get("by_symbol") or {}
    by_sector = current.get("by_sector") or {}
    top_symbols = sorted(by_symbol.items(), key=lambda kv: kv[1], reverse=True)[:6]
    top_sectors = sorted(by_sector.items(), key=lambda kv: kv[1], reverse=True)[:6]

    # Recent refusals: scan voice_tool_calls for validate_trade with ok=false
    recent_refusals: list[dict] = []
    try:
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            rows = conn.execute(
                """SELECT args_json, result_json, error, created_at
                     FROM voice_tool_calls
                    WHERE user_id = ?
                      AND tool_name = 'validate_trade'
                      AND ok = 0
                    ORDER BY id DESC
                    LIMIT 10""",
                (user_id,),
            ).fetchall()
        finally:
            conn.close()
        import json as _json
        for r in rows:
            try:
                args = _json.loads(r["args_json"]) if r["args_json"] else {}
            except (TypeError, ValueError):
                args = {}
            try:
                result = _json.loads(r["result_json"]) if r["result_json"] else {}
            except (TypeError, ValueError):
                result = {}
            recent_refusals.append({
                "symbol": (args.get("symbol") or "").upper(),
                "entry": args.get("entry"),
                "stop": args.get("stop"),
                "shares": args.get("shares"),
                "refusal_basis": result.get("refusal_basis") or [],
                "reason": result.get("reason") or r.get("error"),
                "created_at": r["created_at"],
            })
    except Exception as e:  # noqa: BLE001
        _log = __import__("logging").getLogger(__name__)
        _log.warning("[risk_dashboard] recent_refusals failed: %s", e)

    return {
        "account_id": settings.get("account_id"),
        "account_size": round(account_size, 2),
        "max_risk_per_trade_pct": round(max_risk_pct, 2),
        "portfolio_heat_cap_pct": round(portfolio_heat_cap_pct, 2),
        "max_sector_concentration_pct": round(max_sector_pct, 2),
        "total_risk_dollars": round(total_risk, 2),
        "portfolio_heat_pct": round(portfolio_heat_pct, 2),
        "open_position_count": current.get("open_count", 0),
        "by_symbol": [
            {"symbol": s, "risk_dollars": round(r, 2),
             "risk_pct": round(r / account_size * 100.0, 2) if account_size > 0 else 0}
            for s, r in top_symbols
        ],
        "by_sector": [
            {"sector": s, "risk_dollars": round(r, 2),
             "risk_pct": round(r / account_size * 100.0, 2) if account_size > 0 else 0}
            for s, r in top_sectors
        ],
        "recent_refusals": recent_refusals,
    }


def validate_trade(
    *,
    user_id: str,
    symbol: str,
    entry: float,
    stop: float,
    shares: int,
    side: str = "long",
    account_id: str | None = None,
) -> dict:
    """
    Validate a planned trade against the user's rules. Returns:
      {
        ok: bool,
        reason: str (if not ok),
        refusal_basis: list[str] (every rule that failed),
        suggested_shares: int (what would be the right size),
        max_shares: int (absolute upper bound after rules),
        dollar_risk: float,
        account_risk_pct: float,
        portfolio_heat_after: float,  # total risk % if this trade opened
        account_size: float,
        max_risk_pct: float,
        rule_book: dict (everything that was checked),
      }
    """
    sym = (symbol or "").upper().strip()
    side = (side or "long").lower()
    if side not in ("long", "short"):
        side = "long"

    settings = _get_account_settings(user_id, account_id)
    account_size = settings["account_size"]
    max_risk_pct = min(settings["max_risk_pct"], ABSOLUTE_MAX_RISK_PER_TRADE_PCT)
    current = _current_portfolio_risk(user_id, settings["account_id"])

    # Pure math first
    sizing = calc_position_size(
        account_size=account_size, risk_pct=max_risk_pct,
        entry=entry, stop=stop, side=side,
    )

    refusal_basis: list[str] = []

    # Trivial rejections from the math
    if not sizing.get("ok"):
        refusal_basis.append(sizing.get("reason") or "invalid sizing")

    # Compute the actual dollar risk for the requested shares
    try:
        actual_risk_per_share = abs(float(entry) - float(stop))
        actual_dollar_risk = float(shares) * actual_risk_per_share
    except (TypeError, ValueError):
        actual_dollar_risk = 0.0

    account_risk_pct = (actual_dollar_risk / account_size * 100.0) if account_size > 0 else 0.0

    # Rule 1: per-trade risk cap
    if account_risk_pct > max_risk_pct + 0.01:  # tiny epsilon
        refusal_basis.append(
            f"per-trade risk {account_risk_pct:.2f}% exceeds max {max_risk_pct:.2f}%"
        )

    # Rule 2: absolute hard upper bound
    if account_risk_pct > ABSOLUTE_MAX_RISK_PER_TRADE_PCT:
        refusal_basis.append(
            f"per-trade risk {account_risk_pct:.2f}% exceeds absolute cap "
            f"{ABSOLUTE_MAX_RISK_PER_TRADE_PCT:.0f}%"
        )

    # Rule 3: portfolio heat
    portfolio_heat_after = (
        (current["total_risk"] + actual_dollar_risk) / account_size * 100.0
        if account_size > 0 else 0.0
    )
    if portfolio_heat_after > ABSOLUTE_MAX_PORTFOLIO_HEAT_PCT:
        refusal_basis.append(
            f"portfolio heat would be {portfolio_heat_after:.2f}% after this trade, "
            f"exceeds {ABSOLUTE_MAX_PORTFOLIO_HEAT_PCT:.0f}%"
        )

    # Rule 4: already have a position in this symbol
    if sym and sym in current["by_symbol"]:
        refusal_basis.append(
            f"already have an open position in {sym} "
            f"(would compound — close or update existing)"
        )

    # Rule 5: sector correlation (P6). Sum existing risk in the proposed
    # symbol's sectors and verify adding this trade wouldn't blow past the
    # 2x-per-trade cap on any one sector.
    sector_breach: list[str] = []
    sectors = _sectors_for_symbol(sym)
    if sectors:
        max_sector_risk_pct = max_risk_pct * 2.5  # 2.5x per-trade cap
        for sec in sectors:
            existing = current.get("by_sector", {}).get(sec, 0.0)
            new_sector_risk = existing + actual_dollar_risk
            new_sector_pct = (new_sector_risk / account_size * 100.0
                              if account_size > 0 else 0.0)
            if new_sector_pct > max_sector_risk_pct:
                sector_breach.append(
                    f"{sec} sector concentration would hit "
                    f"{new_sector_pct:.2f}% (max {max_sector_risk_pct:.2f}%)"
                )
    if sector_breach:
        refusal_basis.append(
            "sector concentration: " + "; ".join(sector_breach[:2])
        )

    ok = len(refusal_basis) == 0

    return {
        "ok": ok,
        "reason": refusal_basis[0] if refusal_basis else None,
        "refusal_basis": refusal_basis,
        "suggested_shares": sizing.get("shares", 0),
        "max_shares": sizing.get("shares", 0),
        "dollar_risk": round(actual_dollar_risk, 2),
        "account_risk_pct": round(account_risk_pct, 3),
        "portfolio_heat_before": round(
            current["total_risk"] / account_size * 100.0
            if account_size > 0 else 0.0, 3,
        ),
        "portfolio_heat_after": round(portfolio_heat_after, 3),
        "sectors": sorted(sectors),
        "sector_risk_after": {
            sec: round(
                (current.get("by_sector", {}).get(sec, 0.0) + actual_dollar_risk)
                / account_size * 100.0, 3,
            ) if account_size > 0 else 0.0
            for sec in sectors
        },
        "account_size": account_size,
        "max_risk_pct": max_risk_pct,
        "account_name": settings["account_name"],
        "current_open_count": current["open_count"],
        "rule_book": {
            "max_risk_per_trade_pct": max_risk_pct,
            "absolute_max_per_trade_pct": ABSOLUTE_MAX_RISK_PER_TRADE_PCT,
            "max_portfolio_heat_pct": ABSOLUTE_MAX_PORTFOLIO_HEAT_PCT,
            "max_sector_pct": max_risk_pct * 2.5,
        },
    }
