"""Mirror-drift sentinel — the journal proves ITSELF equal to the broker.

Every fidelity fix so far corrects a specific divergence after someone SAW a
wrong number. The owner cannot inspect members' broker data, so the guarantee
has to be structural: after every sync, this module re-reads the journal's own
tables (j2_positions / j2_option_strategies / j2_accounts) and compares them
against the broker payload THAT SAME SYNC just used. No extra SnapTrade calls,
no second data source — the check consumes the exact truth the reconcilers
were handed, so it can only disagree when the JOURNAL failed to mirror it.

Three invariants, in order of severity:

  1. POSITION PARITY  — every broker holding has exactly one open j2 row with
     the broker's share count; no extra broker-sourced open rows. Post-
     reconcile this must ALWAYS hold — a miss is a code defect, not data lag.
  2. OPTION PARITY    — per contract, Σ open strategy signed qty == held
     units, and Σ brokerCurrentValue == held value (rounding tolerance).
     Same severity: reconcile_option_holdings guarantees it by construction.
  3. EQUITY PARITY    — broker-reported total equity vs cash + journal
     positions at broker marks + journal option values. Tolerance
     max($5, 2%) (accrued interest / pending cash make small diffs normal);
     transient drift is expected during T+1 settlement, so alerts require
     TWO consecutive drifting syncs.

Verdicts persist to j2_broker_mirror_checks (one row per account — the Sync
Trust panel shows members "verified against your broker" from it) and a
STRUCTURAL failure, or a persistent equity drift, pings the owner Discord
(day-deduped per account). The check never raises into the sync.
"""
from __future__ import annotations

import json
import math
import os
import threading
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import balances as _balances
from api.services.journal_two.broker import option_reconstruct as _optr

# Same tolerances as fidelity_audit (the manual admin sibling of this check).
EQUITY_TOL_PCT = 0.02
EQUITY_TOL_FLOOR = 5.0
SHARE_TOL = 1e-3

# In-process once-per-ET-day alert dedup per account (single-process pod —
# same pattern as notifications._failure_pinged).
_alert_pinged: dict[str, str] = {}


def _reset_dedup_for_tests() -> None:
    _alert_pinged.clear()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _et_today() -> str:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def _post_discord(title: str, description: str) -> None:
    url = os.environ.get("DISCORD_ALERT_WEBHOOK") or os.environ.get("DISCORD_WEBHOOK_URL")
    if not url:
        return
    try:
        import httpx
        httpx.post(url, json={"embeds": [{"title": title, "description": description[:3900],
                                          "color": 0xE67E22}]}, timeout=10)
    except Exception:
        pass


def _spawn_alert(title: str, description: str) -> None:
    threading.Thread(target=_post_discord, args=(title, description), daemon=True).start()


def run_mirror_check(user_id: str, broker_account: dict,
                     raw_positions: list[dict] | None,
                     raw_option_holdings: list[dict] | None,
                     broker_total: float | None,
                     conn=None) -> dict[str, Any]:
    """Compare the journal against the broker payload this sync used.
    Returns the verdict dict (also persisted). Never raises."""
    try:
        return _run(user_id, broker_account, raw_positions, raw_option_holdings,
                    broker_total, conn=conn)
    except Exception as e:  # the sentinel must never break a sync
        return {"ok": None, "error": str(e)}


def _run(user_id, broker_account, raw_positions, raw_option_holdings,
         broker_total, conn=None) -> dict[str, Any]:
    if raw_positions is None:
        return {"ok": None, "skipped": "no holdings payload"}
    j2_account_id = broker_account["j2AccountId"]
    broker_account_id = broker_account["id"]

    owned = conn is None
    conn = conn or get_connection()
    try:
        # ── broker truth from the payload ────────────────────────────────
        raw_by_key: dict[tuple, float] = {}     # (sym, side) -> abs units
        mark_by_sym: dict[str, float] = {}
        for p in raw_positions:
            sym = _balances._pos_symbol(p)
            units = _balances._num(p.get("units"))
            if not sym or units is None or abs(units) < 1e-9:
                continue
            side = "Long" if units > 0 else "Short"
            raw_by_key[(sym, side)] = raw_by_key.get((sym, side), 0.0) + abs(units)
            px = _balances._num(p.get("price"))
            if px is not None:
                mark_by_sym[sym] = px

        held: dict[tuple, dict] = {}
        if raw_option_holdings is not None:
            for h in raw_option_holdings:
                c = _optr._holding_contract(h)
                if c is None:
                    continue
                key = (c["underlying"], c["strike"], c["expiration"], c["contractType"])
                held[key] = c

        # ── journal state ────────────────────────────────────────────────
        # bkprov: rows are LEDGER-attested intraday fills the broker's
        # holdings cache hasn't confirmed yet (apply_intraday_growth) — the
        # conservation sentinel vouches for those; holdings parity must only
        # grade what holdings attested, or every fresh fill reads as drift.
        j2_pos = conn.execute(
            "SELECT symbol, side, shares, broker_price FROM j2_positions "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker' "
            "AND closed_at IS NULL AND external_id NOT LIKE 'bkprov:%'",
            (user_id, j2_account_id),
        ).fetchall()
        j2_opts = conn.execute(
            "SELECT s.id, s.broker_current_value, l.qty, l.side AS leg_side, "
            "       l.strike, l.expiration, l.contract_type, s.underlying "
            "FROM j2_option_strategies s JOIN j2_option_legs l ON l.strategy_id = s.id "
            "WHERE s.user_id = ? AND s.account_id = ? AND s.source = 'broker' "
            "AND s.status = 'open' AND s.closed_at IS NULL",
            (user_id, j2_account_id),
        ).fetchall()
        acct = conn.execute(
            "SELECT broker_cash, broker_total_equity FROM j2_accounts "
            "WHERE id = ? AND user_id = ?",
            (j2_account_id, user_id),
        ).fetchone()
        cash = float(acct["broker_cash"]) if acct and acct["broker_cash"] is not None else None
        stored_equity = (float(acct["broker_total_equity"])
                         if acct and acct["broker_total_equity"] is not None else None)

        # ── 1. position parity ───────────────────────────────────────────
        pos_mismatches: list[str] = []
        j2_by_key: dict[tuple, float] = {}
        for r in j2_pos:
            j2_by_key[(r["symbol"], r["side"])] = (
                j2_by_key.get((r["symbol"], r["side"]), 0.0) + float(r["shares"] or 0.0))
        for key, units in raw_by_key.items():
            have = j2_by_key.get(key)
            if have is None:
                pos_mismatches.append(f"missing {key[1]} {key[0]} ({units} sh)")
            elif abs(have - units) > SHARE_TOL:
                pos_mismatches.append(f"{key[0]} {key[1]}: journal {have} vs broker {units}")
        for key, have in j2_by_key.items():
            if key not in raw_by_key:
                pos_mismatches.append(f"extra {key[1]} {key[0]} ({have} sh) not held at broker")

        # ── 2. option parity ─────────────────────────────────────────────
        opt_mismatches: list[str] = []
        if raw_option_holdings is not None:
            qty_by_key: dict[tuple, float] = {}
            bcv_by_key: dict[tuple, float] = {}
            for r in j2_opts:
                key = (r["underlying"], r["strike"], r["expiration"], r["contract_type"])
                signed = float(r["qty"] or 0.0) * (1.0 if r["leg_side"] == "buy" else -1.0)
                qty_by_key[key] = qty_by_key.get(key, 0.0) + signed
                if r["broker_current_value"] is not None:
                    bcv_by_key[key] = bcv_by_key.get(key, 0.0) + float(r["broker_current_value"])
            for key, c in held.items():
                units = float(c["units"])
                jq = qty_by_key.get(key, 0.0)
                if abs(jq - units) > 1e-6:
                    # Settlement pin (option_reconstruct): while a sale is
                    # pending delivery the holdings feed can flap; the journal
                    # deliberately holds the pinned MINIMUM. A journal that
                    # equals the pin is faithful, not drifted.
                    ckey = f"{key[0]}|{key[1]}|{key[2]}|{key[3]}"
                    memo = conn.execute(
                        "SELECT min_held FROM j2_broker_opt_holdings_memo "
                        "WHERE user_id = ? AND broker_account_id = ? "
                        "AND contract_key = ?",
                        (user_id, broker_account_id, ckey),
                    ).fetchone()
                    pinned = (memo is not None
                              and abs(abs(jq) - float(memo["min_held"])) <= 1e-6)
                    if pinned:
                        continue
                    opt_mismatches.append(
                        f"{key[0]} {key[1]} {key[2]}: journal {jq} vs broker {units} contracts")
                else:
                    want_val = round(units * float(c["mark"]) * float(c["multiplier"]), 2)
                    have_val = bcv_by_key.get(key)
                    n_lots = max(1, sum(1 for r in j2_opts
                                        if (r["underlying"], r["strike"], r["expiration"],
                                            r["contract_type"]) == key))
                    if have_val is not None and abs(have_val - want_val) > 0.05 * n_lots:
                        opt_mismatches.append(
                            f"{key[0]} value: journal {have_val} vs broker {want_val}")
            for key, jq in qty_by_key.items():
                if key not in held and abs(jq) > 1e-6:
                    opt_mismatches.append(
                        f"extra {key[0]} {key[1]} {key[2]} ({jq} contracts) not held at broker")

        # ── 3. equity parity ─────────────────────────────────────────────
        # Target = the equity the write path just STORED (post stale-total
        # guard, the number every member surface reads). Comparing against
        # SnapTrade's raw `balance.total` paged 3 false drifts on 8/21 — that
        # field lags a full day on Robinhood intraday, which is the
        # provider's inconsistency, not the journal's. The provider lag is
        # still measured, as info only (totalLagDollar), never a page.
        drift_dollar = drift_pct = None
        total_lag = None
        equity_ok = True
        if (broker_total is not None and isinstance(broker_total, (int, float))
                and math.isfinite(broker_total) and stored_equity is not None):
            total_lag = round(stored_equity - float(broker_total), 2)
        if (stored_equity is not None and math.isfinite(stored_equity)
                and cash is not None):
            mv = 0.0
            marks_complete = True
            for r in j2_pos:
                px = mark_by_sym.get(r["symbol"])
                if px is None:
                    px = _balances._num(r["broker_price"])
                if px is None:
                    marks_complete = False
                    break
                signed = float(r["shares"] or 0.0) * (1.0 if r["side"] == "Long" else -1.0)
                mv += signed * px
            for r in j2_opts:
                if r["broker_current_value"] is not None:
                    mv += float(r["broker_current_value"])
            if marks_complete:
                derived = cash + mv
                drift_dollar = round(derived - stored_equity, 2)
                drift_pct = (round(abs(drift_dollar) / abs(stored_equity), 6)
                             if stored_equity else None)
                tol = max(EQUITY_TOL_FLOOR, EQUITY_TOL_PCT * abs(stored_equity))
                equity_ok = abs(drift_dollar) <= tol

        structural_ok = not pos_mismatches and not opt_mismatches
        ok = structural_ok and equity_ok
        detail = {"positions": pos_mismatches, "options": opt_mismatches}

        prev = conn.execute(
            "SELECT consecutive_drifts FROM j2_broker_mirror_checks "
            "WHERE user_id = ? AND broker_account_id = ?",
            (user_id, broker_account_id),
        ).fetchone()
        consecutive = 0 if ok else (int(prev["consecutive_drifts"]) + 1 if prev else 1)
        conn.execute(
            "INSERT OR REPLACE INTO j2_broker_mirror_checks "
            "(user_id, broker_account_id, checked_at, ok, drift_dollar, drift_pct, "
            " consecutive_drifts, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, broker_account_id, _now_iso(), 1 if ok else 0,
             drift_dollar, drift_pct, consecutive,
             json.dumps(detail) if not ok else None),
        )
        conn.commit()

        # ── alerting ─────────────────────────────────────────────────────
        # Structural mismatch = a reconciler failed its own contract → page
        # immediately. Equity-only drift = often T+1 settlement → page only
        # when it persists across two syncs. Day-deduped per account.
        should_alert = (not structural_ok) or (not equity_ok and consecutive >= 2)
        if should_alert and _alert_pinged.get(broker_account_id) != _et_today():
            _alert_pinged[broker_account_id] = _et_today()
            name = f"{broker_account.get('brokerageName', '?')} {broker_account.get('accountNumberMasked', '')}"
            lines = pos_mismatches + opt_mismatches
            if drift_dollar is not None and not equity_ok:
                lines.append(f"equity drift ${drift_dollar} ({(drift_pct or 0) * 100:.2f}%)")
            _spawn_alert(
                "🪞 Broker mirror drift",
                f"user `{user_id[:8]}` · {name} · sync #{consecutive} not matching broker:\n"
                + "\n".join(f"• {x}" for x in lines[:12]),
            )

        return {"ok": ok, "structuralOk": structural_ok, "equityOk": equity_ok,
                "driftDollar": drift_dollar, "driftPct": drift_pct,
                "totalLagDollar": total_lag,
                "consecutiveDrifts": consecutive, "detail": detail if not ok else None}
    finally:
        if owned:
            conn.close()


def latest_verdicts(user_id: str, conn=None) -> dict[str, dict[str, Any]]:
    """{broker_account_id: verdict} for the trust panel."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        out: dict[str, dict[str, Any]] = {}
        for r in conn.execute(
            "SELECT broker_account_id, checked_at, ok, drift_dollar, drift_pct, "
            "consecutive_drifts FROM j2_broker_mirror_checks WHERE user_id = ?",
            (user_id,),
        ).fetchall():
            out[r["broker_account_id"]] = {
                "ok": bool(r["ok"]),
                "checkedAt": r["checked_at"],
                "driftDollar": r["drift_dollar"],
                "driftPct": r["drift_pct"],
                "consecutiveDrifts": r["consecutive_drifts"],
            }
        return out
    finally:
        if owned:
            conn.close()
