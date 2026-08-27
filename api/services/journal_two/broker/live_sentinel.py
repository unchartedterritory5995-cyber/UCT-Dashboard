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
# on a $10.7k account). DOLLAR-CAPPED: the conservation residual is
# mark-invariant (same marks on both sides), so its noise does NOT scale
# with book size — but a pure percentage does: 1.5% of the fleet's $1.6M
# account is $24,594 of invisible error headroom. Percentage floor for
# small books, hard dollar ceiling for whales.
_TOL_DOLLARS = 150.0
_TOL_PCT = 0.015
_TOL_CAP_DOLLARS = 1000.0
_PAGE_AFTER_CONSECUTIVE = 2
_MAX_ANCHOR_AGE_HOURS = 36

def _reset_for_tests() -> None:
    pass  # dedup is durable (j2_broker_digest_dedup); tests use fresh DBs


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
    tol = max(_TOL_DOLLARS, min(
        _TOL_PCT * max(abs(_f(acct["broker_total_equity"]) or anchor), 1.0),
        _TOL_CAP_DOLLARS))

    # Fully-reflected expectation: each fill moved cash AND the book
    # (buy: −cost/+cost; sell: +proceeds/−basis) → composed ≈ anchor.
    residual = composed - anchor
    # Legacy diagnostic (kept in the payload): none-reflected expectation.
    residual_lag = composed - (anchor + lc["adjustment"])

    # CLASSIFIER v2 (first live morning, 2026-08-27): a real trading day is
    # a MIX — a sell's row already gone (shrink rail), a buy's row not yet
    # served, and every sell executing off its sync mark (selling 750 NEXA
    # at 13.89 against a 15.58 mark is a real $1,266 equity change, not
    # drift). All-or-none expectations mis-filed that as structural. The
    # honest acceptance band on a day with fills:
    #   floor = −(un-servable buy cost) − allowance   (buys still lagging)
    #   ceil  = +allowance                            (sells above marks)
    # where allowance scales with the filled notional (fill-vs-mark price
    # moves are proportional to what traded), floored at the quiet-day
    # tolerance. The incident/drill class (phantom ≈ 100% of notional, or
    # no fills at all) still lands far outside the band.
    _FILL_MOVE_PCT = 0.25
    notional = (lc["buyCost"] or 0.0) + (lc["sellProceeds"] or 0.0)
    if lc["fills"] == 0:
        verdict = "ok" if abs(residual) <= tol else "structural"
    else:
        allowance = max(tol, _FILL_MOVE_PCT * notional)
        floor = -(lc["buyCost"] or 0.0) - allowance
        if abs(residual) <= tol:
            verdict = "ok"
        elif floor <= residual <= allowance:
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
                fails: int, conn=None) -> None:
    if fails < _PAGE_AFTER_CONSECUTIVE:
        return
    # DURABLE once-per-account-per-ET-day dedup (j2_broker_digest_dedup, the
    # repo's standing pattern). The first version used an in-process dict —
    # and on 2026-08-27, four same-day deploys each wiped it while the v1
    # classifier still misread the owner's trading morning as structural, so
    # ONE false alarm paged twice. An in-process dedup on a pod that
    # redeploys several times a day is not a dedup.
    today = datetime.now(_ET).strftime("%Y-%m-%d")
    dd_id = f"live_sentinel:{broker_account_id}"
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT et_day FROM j2_broker_digest_dedup WHERE id = ?", (dd_id,),
        ).fetchone()
        if row and row["et_day"] == today:
            return
        conn.execute(
            "INSERT OR REPLACE INTO j2_broker_digest_dedup "
            "(id, fingerprint, et_day) VALUES (?, ?, ?)",
            (dd_id, broker_account_id, today),
        )
        conn.commit()
    finally:
        if owned:
            conn.close()
    c = out.get("components") or {}
    _post_discord(
        "🔴 Broker live-composition drift (structural)",
        f"account `{broker_account_id[:8]}` user `{user_id[:8]}`: the composed "
        f"net-liq breaks conservation by **${out.get('residual'):,}** "
        f"(tolerance ${out.get('tolerance'):,}, {fails} consecutive checks).\n"
        f"cash {c.get('cashSynced')}→{c.get('cashLive')} · book "
        f"{c.get('bookSynced')}→{c.get('bookNow')} · fills {c.get('fills')} "
        f"(buys ${c.get('buyCost')}, sells ${c.get('sellProceeds')}).\n"
        "This is the between-sync LIVE composition check — synced data is "
        "graded separately by the mirror check, and a full sync re-anchors "
        "this one. Component snapshot persisted in j2_broker_live_checks "
        "(flight recorder). One page per account per day.",
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
                    _maybe_page(ba["userId"], ba["id"], out, fails, conn=conn)
            except Exception:  # noqa: BLE001
                logger.warning("live sentinel failed for %s", ba.get("id"),
                               exc_info=True)
    finally:
        conn.close()
    return {"checked": checked, "structural": structural}


def latest_verdicts(user_id: str, conn=None) -> dict[str, dict[str, Any]]:
    """{broker_account_id: {verdict, residualDollar, checkedAt, fills}} —
    the Trust Center's live-composition line (the between-sync counterpart
    of mirror_check.latest_verdicts)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT broker_account_id, checked_at, verdict, residual_dollar, "
            "       components_json FROM j2_broker_live_checks "
            "WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    finally:
        if owned:
            conn.close()
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        fills = None
        try:
            comp = json.loads(r["components_json"] or "null")
            if isinstance(comp, dict):
                fills = comp.get("fills")
        except (TypeError, ValueError):
            pass
        out[r["broker_account_id"]] = {
            "verdict": r["verdict"],
            "residualDollar": r["residual_dollar"],
            "checkedAt": r["checked_at"],
            "fills": fills,
        }
    return out


def run_sentinel_blocking() -> None:
    """APScheduler entry. Never raises into the scheduler."""
    try:
        run_sentinel_sweep()
    except Exception as e:  # noqa: BLE001
        logger.warning("live sentinel sweep failed: %s", e)


_DRILL_USER = "sentinel-drill-robot"
_DRILL_BA = "sentinel-drill-ba"
_DRILL_J2 = "sentinel-drill-j2"


def run_drill(conn=None) -> dict[str, Any]:
    """Prove the guard fires — on prod infra, against synthetic rows.

    A guard nobody has seen fire is not a guard (this codebase's own
    lesson). The drill seeds a namespaced robot account whose served book
    carries a position with NO ledger fill behind it (the exact 2026-08-26
    shape), runs the real check twice, and verifies the verdict escalates to
    structural with the consecutive counter armed — the precondition of the
    page. Cleanup always runs; the robot rows never outlive the drill."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        now = _now_iso()
        conn.execute(
            "INSERT OR REPLACE INTO j2_accounts (id, user_id, name, color,"
            " starting_balance, account_size, balance_source, broker_cash,"
            " broker_market_value, broker_total_equity,"
            " broker_balance_synced_at, created_at, updated_at)"
            " VALUES (?, ?, 'Sentinel drill', '#444444', 1.0, 10000.0,"
            " 'broker', -1000.0, 11000.0, 10000.0, ?, ?, ?)",
            (_DRILL_J2, _DRILL_USER, now, now, now),
        )
        conn.execute(
            "INSERT OR REPLACE INTO j2_positions (id, user_id, symbol, side,"
            " entry_date, shares, original_shares, entry_price, stop_price,"
            " breakeven_stop, raise_to_breakeven, setup, notes,"
            " context_at_entry, created_at, updated_at, closed_at, account_id,"
            " source, external_id, entry_estimated, broker_price)"
            " VALUES ('sentinel-drill-pos', ?, 'DRILL', 'Long', ?, 100.0,"
            " 100.0, 110.0, 110.0, NULL, 0, NULL, NULL, '{}', ?, ?, NULL, ?,"
            " 'broker', ?, 0, 219.9)",
            (_DRILL_USER, now, now, now, _DRILL_J2,
             f"bkpos:{_DRILL_BA}:DRILL:Long"),
        )
        conn.commit()
        # Anchor book = 11,000; served book = 100 × 219.9 = 21,990 with no
        # explaining fill → residual ≈ +10,990 (the incident's own number).
        first = check_account(_DRILL_USER, _DRILL_BA, _DRILL_J2, conn)
        fails = _persist(conn, _DRILL_USER, _DRILL_BA, first)
        second = check_account(_DRILL_USER, _DRILL_BA, _DRILL_J2, conn)
        fails = _persist(conn, _DRILL_USER, _DRILL_BA, second)
        passed = (first["verdict"] == "structural"
                  and second["verdict"] == "structural"
                  and fails >= _PAGE_AFTER_CONSECUTIVE)
        return {"passed": passed, "verdicts": [first["verdict"], second["verdict"]],
                "residual": second.get("residual"), "consecutive": fails}
    finally:
        try:
            conn.execute("DELETE FROM j2_positions WHERE user_id = ?", (_DRILL_USER,))
            conn.execute("DELETE FROM j2_accounts WHERE user_id = ?", (_DRILL_USER,))
            conn.execute("DELETE FROM j2_broker_live_checks WHERE user_id = ?",
                         (_DRILL_USER,))
            conn.commit()
        except Exception:  # noqa: BLE001
            logger.warning("sentinel drill cleanup failed", exc_info=True)
        if owned:
            conn.close()


def run_drill_blocking() -> None:
    """APScheduler entry (Sunday, before the weekly digest). Posts the drill
    outcome either way — a drill that only reports success is the
    gate-that-cannot-fail. Never raises into the scheduler."""
    if not _enabled():
        return
    try:
        out = run_drill()
        if out["passed"]:
            _post_discord(
                "🧪 Sentinel drill PASSED",
                f"Injected ${out.get('residual'):,} of phantom book value into the "
                "robot account — detected structural on both checks, page "
                "precondition armed. The guard fires.",
            )
        else:
            _post_discord(
                "🔴 Sentinel drill FAILED — the guard did NOT fire",
                f"verdicts={out.get('verdicts')} consecutive={out.get('consecutive')} "
                "residual=${residual}. The live-composition sentinel would MISS a "
                "real incident — investigate before trusting green.".replace(
                    "${residual}", str(out.get("residual"))),
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("sentinel drill failed to run: %s", e)
        try:
            _post_discord("🔴 Sentinel drill CRASHED",
                          f"The drill itself errored: {e} — the guard is unproven this week.")
        except Exception:  # noqa: BLE001
            pass


def fleet_snapshot(conn=None) -> dict[str, Any]:
    """Current fleet state of the live checks — the admin view and the
    weekly digest read the same snapshot (one authority)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT user_id, broker_account_id, checked_at, verdict, "
            "       residual_dollar, consecutive_fails "
            "FROM j2_broker_live_checks ORDER BY checked_at DESC",
        )]
    finally:
        if owned:
            conn.close()
    by_verdict: dict[str, int] = {}
    worst = 0.0
    for r in rows:
        by_verdict[r["verdict"]] = by_verdict.get(r["verdict"], 0) + 1
        res = r["residual_dollar"]
        if res is not None and abs(res) > abs(worst):
            worst = res
    return {"accounts": len(rows), "byVerdict": by_verdict,
            "worstResidualDollar": round(worst, 2), "rows": rows}


def run_daily_pulse_blocking() -> None:
    """Post-close daily fidelity pulse — ALWAYS posts, green or red.

    Every other rail is silent when healthy, so "is the journal accurate?"
    required trusting the silence. This is the affirmative artifact: one
    line after each close stating, in dollars, how the whole fleet
    reconciled today. Never raises into the scheduler."""
    try:
        conn = get_connection()
        try:
            et_today = datetime.now(_ET).strftime("%Y-%m-%d")
            syncs = conn.execute(
                "SELECT COUNT(*) AS n, "
                "SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errs "
                "FROM j2_broker_sync_log WHERE started_at >= ?",
                (datetime.now(timezone.utc).strftime("%Y-%m-%d"),),
            ).fetchone()
            mirror = conn.execute(
                "SELECT COUNT(*) AS n, "
                "SUM(CASE WHEN ok=1 THEN 0 ELSE 1 END) AS bad, "
                "MAX(ABS(COALESCE(drift_dollar, 0))) AS worst "
                "FROM j2_broker_mirror_checks",
            ).fetchone()
            snap = fleet_snapshot(conn)
        finally:
            conn.close()
        bv = snap["byVerdict"]
        structural = bv.get("structural", 0)
        red = structural or (mirror["bad"] or 0) or (syncs["errs"] or 0)
        tone = "🔴" if red else "🟢"
        _post_discord(
            f"{tone} Journal fidelity pulse — {et_today}",
            f"{syncs['n'] or 0} syncs today, {syncs['errs'] or 0} failed · "
            f"{mirror['n'] or 0} accounts mirror-checked, "
            f"{mirror['bad'] or 0} drifting, worst gap "
            f"${(mirror['worst'] or 0):,.2f} · live checks: "
            f"{bv.get('ok', 0)} ok / {bv.get('book_lag', 0)} fills-pending / "
            f"{structural} structural (worst residual "
            f"${snap['worstResidualDollar']:,.2f}).\n"
            + ("Everything reconciled. This line posts every close — a "
               "missing pulse means the pulse itself broke, not that all is "
               "well." if not red else
               "Something needs eyes — details are in the tables "
               "(j2_broker_live_checks / mirror_checks / sync_log)."),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("daily pulse failed: %s", e)
        try:
            _post_discord("🔴 Journal fidelity pulse CRASHED",
                          f"The pulse itself errored: {e}")
        except Exception:  # noqa: BLE001
            pass


def run_weekly_summary_blocking() -> None:
    """Sunday digest — ALWAYS posts, green or red (a silent-green digest is
    indistinguishable from a dead one). Never raises into the scheduler."""
    try:
        snap = fleet_snapshot()
        bv = snap["byVerdict"]
        structural = bv.get("structural", 0)
        tone = "🔴" if structural else "🟢"
        _post_discord(
            f"{tone} Broker live-composition sentinel — weekly fleet summary",
            f"{snap['accounts']} account(s) under check · verdicts {bv or '{}'} · "
            f"worst residual ${snap['worstResidualDollar']:,}.\n"
            + ("Structural rows carry their component snapshots in "
               "j2_broker_live_checks — investigate before tuning tolerance."
               if structural else
               "No structural drift on the fleet. Residuals inform tolerance "
               "tuning (currently max($150, 1.5%))."),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("live sentinel weekly summary failed: %s", e)
