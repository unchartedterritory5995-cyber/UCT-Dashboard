"""D20 level-reached scorer over OPEN CALLs' stated levels — silent in W1 (CONTRACTS §6.6).

`score_silently(ctx)` runs every session from the daily chain, flag or no flag: it reads each
open team CALL's stated levels (entry zone edges, stop, targets, typed levels — never an
open-position entry, which lives only in the private store), compares them with that
session's daily bar, and records every cross in `wisdom_level_crosses`. It never delivers.

`deliver(ctx)` is the gated door (adapters/d20_gates.py). In W1 it always refuses: either a
gate is shut, or — with all gates open — there is no S7 channel yet.

OPEN means: stance watching/taking/in_it/added/trimmed, not hindsight, stated within the
last MAX_AGE_DAYS, and no later exit/stop/pass/avoid by the same author on the same ticker.
A cross is prev_close < level <= high (up) or prev_close > level >= low (down). Bars are read
through `bars_sqlite.get_bars_before` (read-only index seek, web scheduler thread); a ticker
with no bar for the session is counted, never scored as "no cross".
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from typing import Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

SCORER = "level_alerts"
FLAG_ENV = "WISDOM_LEVEL_ALERTS_ENABLED"
MODEL_VERSION = "level-cross-w1.0"
OPEN_STANCES = ("watching", "taking", "in_it", "added", "trimmed")
CLOSING_STANCES = ("exited", "stopped_out", "passed", "avoid")
MAX_AGE_DAYS = 90


def _daily_bars(ticker: str, to_ymd: int, n: int) -> list:
    from api.services import bars_sqlite

    return bars_sqlite.get_bars_before(ticker, "D", n, to_ymd)


def _session(ctx) -> date:
    from api.services.wisdom.core import timeutil

    now = getattr(ctx, "now_et", None) or timeutil.now_et()
    return timeutil.session_for(now)


def open_calls(conn, session: date) -> list[dict]:
    from api.services.wisdom.core import timeutil
    from api.services.wisdom.publish.adapters import common

    since = timeutil.iso_et(timeutil.to_et(datetime.combine(session - timedelta(days=MAX_AGE_DAYS), time(0, 0))))
    calls = common.select_records(
        conn, types=("CALL",), since_iso=since, order="r.stated_at_et ASC",
        extra_where=f"r.hindsight = 0 AND r.ticker IS NOT NULL AND r.stance IN ({','.join('?' * len(OPEN_STANCES))})",
        extra_params=OPEN_STANCES)
    closers = common.select_records(
        conn, types=("CALL", "NEGATIVE_CALL"), since_iso=since,
        extra_where=f"r.ticker IS NOT NULL AND r.stance IN ({','.join('?' * len(CLOSING_STANCES))})",
        extra_params=CLOSING_STANCES)
    last_close: dict = {}
    for c in closers:
        key = (c["author_id"], common.normalize_ticker(c["ticker"]))
        last_close[key] = max(last_close.get(key, ""), c["stated_at_et"] or "")
    out = []
    for r in calls:
        stated = common.record_date(r)
        if not stated or stated > session.isoformat():
            continue
        closed_at = last_close.get((r["author_id"], common.normalize_ticker(r["ticker"])))
        if closed_at and closed_at > (r["stated_at_et"] or ""):
            continue
        out.append(r)
    return out


def stated_levels(conn, record_ids: list[str]) -> dict:
    """{record_id: [(level_kind, price), ...]} — the only level read in this module."""
    from api.services.wisdom.publish.adapters import common

    if not record_ids:
        return {}
    out: dict = {}
    for r in conn.execute(
            f"SELECT record_id, entry_zone_lo, entry_zone_hi, stop, targets_json, levels_json FROM wisdom_records "
            f"WHERE record_id IN ({','.join('?' * len(record_ids))})", record_ids):
        levels = [("entry_zone_lo", r["entry_zone_lo"]), ("entry_zone_hi", r["entry_zone_hi"]), ("stop", r["stop"])]
        levels += [("target", t.get("price")) for t in common.parse_json(r["targets_json"], []) if isinstance(t, dict)]
        levels += [(f"level:{lv.get('type') or 'other'}", lv.get("price"))
                   for lv in common.parse_json(r["levels_json"], []) if isinstance(lv, dict)]
        clean = sorted({(k, float(p)) for k, p in levels if isinstance(p, (int, float)) and p > 0})
        if clean:
            out[r["record_id"]] = clean
    return out


def score_silently(ctx) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    session = _session(ctx)
    ymd = int(session.strftime("%Y%m%d"))
    with store.read() as conn:
        if not common.table_exists(conn, "wisdom_level_crosses"):
            return {"skipped": "publish_adapters_001 is not applied"}
        calls = open_calls(conn, session)
        levels = stated_levels(conn, [c["record_id"] for c in calls])
    crosses, scored, no_bars = [], 0, 0
    for call in calls:
        lv = levels.get(call["record_id"])
        if not lv:
            continue
        ticker = common.normalize_ticker(call["ticker"])
        try:
            bars = _daily_bars(ticker, ymd, 2)
        except Exception:
            log.exception("[wisdom] bars read failed for %s", ticker)
            bars = []
        if len(bars) < 2 or int(bars[-1][0]) != ymd:
            no_bars += 1
            continue
        prev_close, high, low = float(bars[-2][4]), float(bars[-1][2]), float(bars[-1][3])
        for kind, price in lv:
            scored += 1
            direction = "up" if prev_close < price <= high else ("down" if prev_close > price >= low else None)
            if direction:
                crosses.append((call["record_id"], kind, price, session.isoformat(), ticker, direction,
                                prev_close, high, low))
    out = {"session": session.isoformat(), "open_calls": len(calls), "levels_scored": scored,
           "tickers_without_bars": no_bars, "crosses": len(crosses), "delivered": 0}
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    at = common.now_iso()
    written = 0
    with store.write() as conn:
        for c in crosses:
            written += conn.execute(
                "INSERT OR IGNORE INTO wisdom_level_crosses(record_id, level_kind, level_price, session_date, ticker, "
                "cross_direction, prev_close, bar_high, bar_low, model_version, scored_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (*c, MODEL_VERSION, at)).rowcount
        conn.execute(
            "INSERT INTO wisdom_d20_scoring_runs(scorer, session_date, scored_at, n_scored, n_written, note) "
            "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(scorer, session_date) DO UPDATE SET scored_at = excluded.scored_at, "
            "n_scored = MAX(wisdom_d20_scoring_runs.n_scored, excluded.n_scored), "
            "n_written = wisdom_d20_scoring_runs.n_written + excluded.n_written, note = excluded.note",
            (SCORER, session.isoformat(), at, scored, written, f"tickers_without_bars={no_bars}"))
    return {**out, "written": written}


def deliver(ctx=None, *, today: Optional[date] = None) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import d20_gates

    today = today or _session(ctx)
    with store.read() as conn:
        pending = conn.execute("SELECT COUNT(*) FROM wisdom_level_crosses WHERE delivered = 0").fetchone()[0]
        return d20_gates.refuse_delivery(conn, SCORER, flag_env=FLAG_ENV, flag_on=flags.level_alerts_enabled(),
                                         today=today, pending=pending)
