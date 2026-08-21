"""Excursion engine — tiered internal-bars fetch + compute orchestrator
(Journal A+ Phase 2, Task 3).

Ties together the pure math (`excursion_calc.compute_excursion`), the stable
annotation key (`trade_refs.trade_ref_for_row`), and persistence
(`excursions_store.upsert_excursion`) for one closed trade (or option strategy).

Design:
  - The CORE (`compute_for_trade` / `compute_for_option_strategy`) is
    NETWORK-FREE when a `bar_fetch` callable is injected — that's how the unit
    tests drive it with synthetic bars. The ONLY networked piece is the default
    `_fetch_bars`, which reads bars from INTERNAL services (never HTTP):
      * intraday → local SQLite cache (`bars_sqlite.get_bars`) when it fully
        spans the window, else the deep Massive minute reader.
      * daily → the Massive daily aggregate reader.
    Every network call in `_fetch_bars` is wrapped so it returns `[]` on ANY
    error (a batch backfill must never crash on one bad ticker).

  - Bars fed to `compute_excursion` are `{"t": int_unix_SECONDS, "h", "l"}`
    SORTED ascending by `t`. Massive `t` is MILLISECONDS → divided by 1000;
    `bars_sqlite` intraday `ts` is already SECONDS.

Tier selection is by HOLD DURATION (exit_ts − entry_ts), not trade age:
  * scalp   (< 4h)            → 1-minute bars   (data_quality 'intraday_1m')
  * same-day / multi-day
    within the ~365-day
    5-minute history window   → 5-minute bars   (data_quality 'intraday_5m')
  * hold longer than that
    window (> ~365 days)      → daily bars       (data_quality 'daily')

A trade whose timestamps don't parse, whose window is zero/negative, or for
which no bars can be fetched is stored as an `insufficient`-tier record (metrics
NULL, symbol set) so the backfill is idempotent and the UI can show "no data".
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from api.services import bars_sqlite, massive
from api.services.journal_two.excursion_calc import compute_excursion
from api.services.journal_two.excursions_store import upsert_excursion
from api.services.journal_two.trade_refs import trade_ref_for_row

# ── Tier thresholds (seconds) — documented, load-bearing ─────────────────
_SCALP_MAX_S = 4 * 3600          # < 4h  → 1-minute bars (scalp)
_SAME_DAY_MAX_S = 51840          # < ~0.6 day → 5-minute bars (same-day; conceptual
#                                  boundary only — same-day AND multi-day both use 5m)
_FIVE_MIN_WINDOW_S = 365 * 86400  # ≤ ~365d → 5-minute history still available; older → daily

# Generous cap for the local-cache probe — the coverage check rejects it anyway
# when the cached span doesn't reach across [entry_ts, exit_ts].
_LOCAL_MAX_BARS = 50000

_SECONDS_PER_DAY = 86400
_MIDDAY_OFFSET_S = 43200  # 12h — anchor daily bars unambiguously inside their UTC day


def _pick_tier(hold_seconds: float) -> tuple[str, str]:
    """(tf_code, data_quality) for a hold of `hold_seconds`. PURE.

    < _SCALP_MAX_S (4h)            → ('1', 'intraday_1m')
    ≤ _FIVE_MIN_WINDOW_S (~365d)   → ('5', 'intraday_5m')   [same-day + multi-day]
    > _FIVE_MIN_WINDOW_S           → ('D', 'daily')
    """
    if hold_seconds < _SCALP_MAX_S:
        return ("1", "intraday_1m")
    if hold_seconds > _FIVE_MIN_WINDOW_S:
        return ("D", "daily")
    return ("5", "intraday_5m")


def _parse_ts(iso_or_date) -> Optional[int]:
    """Parse a trade's entry_date/exit_date → unix SECONDS, or None.

    Accepts full ISO (with tz), naive ISO (assumed UTC), or bare 'YYYY-MM-DD'
    (anchored at that day 00:00:00 UTC). Never raises.
    """
    if iso_or_date is None:
        return None
    s = str(iso_or_date).strip()
    if not s:
        return None
    # Bare date 'YYYY-MM-DD' → that day at midnight UTC.
    if len(s) == 10 and "T" not in s and s[4] == "-" and s[7] == "-":
        s = s + "T00:00:00+00:00"
    else:
        s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:  # naive → assume UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _get(row, key, default=None):
    """Tolerant field read — works for a sqlite3.Row OR a dict. sqlite3.Row
    raises IndexError on a missing key, so guard via `.keys()` (a dict exposes
    `.keys()` too, so one path serves both)."""
    try:
        keys = row.keys()
    except AttributeError:
        return default
    return row[key] if key in keys else default


def _num(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _insufficient(symbol) -> dict:
    """A stored record for a trade we couldn't compute — NULL metrics, symbol
    kept so the row is still identifiable / the UI can render 'no data'."""
    return {
        "symbol": symbol,
        "mfe_price": None, "mae_price": None,
        "mfe_ts": None, "mae_ts": None,
        "mfe_r": None, "mae_r": None,
        "exit_efficiency": None, "missed_r": None,
        "bar_resolution": None,
        "data_quality": "insufficient",
    }


def _day_midday_seconds(t_ms) -> int:
    """A daily bar's ms timestamp → the UTC MIDDAY (noon) of its day, in
    seconds. Anchoring at noon keeps the bar unambiguously inside its calendar
    day regardless of the exact provider stamp."""
    sec = int(t_ms) // 1000
    day_start = sec - (sec % _SECONDS_PER_DAY)
    return day_start + _MIDDAY_OFFSET_S


def _iso_date(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def _fetch_bars(symbol: str, entry_ts: int, exit_ts: int, tf_code: str) -> list[dict]:
    """Networked default reader. Returns `{"t": seconds, "h", "l"}` bars SORTED
    ascending by t. Returns [] on ANY error (never raises).

    Daily tier → Massive daily aggregates (ms→noon-seconds per day).
    Intraday   → local SQLite cache first (used verbatim only when it fully
                 spans [entry_ts, exit_ts]), else the deep Massive minute reader
                 (ms→seconds).
    """
    try:
        from_date = _iso_date(entry_ts)
        to_date = _iso_date(exit_ts)

        if tf_code == "D":
            raw = massive.get_agg_bars(symbol, from_date, to_date)  # t = unix ms
            bars = [
                {"t": _day_midday_seconds(b["t"]), "h": b["h"], "l": b["l"]}
                for b in raw
                if b.get("t") is not None and b.get("h") is not None and b.get("l") is not None
            ]
            bars.sort(key=lambda x: x["t"])
            return bars

        # Intraday: prefer the local cache when it fully covers the window.
        # get_bars → (ts,o,h,l,c,v) oldest-first, ts already unix SECONDS.
        rows = bars_sqlite.get_bars(symbol, tf_code, _LOCAL_MAX_BARS)
        if rows and rows[0][0] <= entry_ts and rows[-1][0] >= exit_ts:
            return [{"t": int(r[0]), "h": r[2], "l": r[3]} for r in rows]

        raw = massive.get_agg_bars_minute(symbol, int(tf_code), from_date, to_date)  # t = ms
        bars = [
            {"t": int(b["t"]) // 1000, "h": b["h"], "l": b["l"]}
            for b in raw
            if b.get("t") is not None and b.get("h") is not None and b.get("l") is not None
        ]
        bars.sort(key=lambda x: x["t"])
        return bars
    except Exception:
        return []


def compute_for_trade(trade_row, *, bar_fetch=None, conn=None) -> dict:
    """Compute + persist the excursion for ONE closed equity trade.

    `trade_row` is a `j2_trades` row (sqlite3.Row OR dict). `bar_fetch`, when
    injected, replaces `_fetch_bars` — that keeps the core network-free for
    tests. Returns the stored dict (a full metrics dict, or an insufficient-tier
    record). Never raises on unparseable/empty input.
    """
    fetch = bar_fetch or _fetch_bars
    trade_ref = trade_ref_for_row(trade_row)
    user_id = _get(trade_row, "user_id")
    symbol = _get(trade_row, "symbol")
    side = _get(trade_row, "side")

    entry_ts = _parse_ts(_get(trade_row, "entry_date"))
    exit_ts = _parse_ts(_get(trade_row, "exit_date"))

    # Zero/negative or unparseable window → nothing to compute.
    if entry_ts is None or exit_ts is None or exit_ts <= entry_ts:
        record = _insufficient(symbol)
        upsert_excursion(user_id, trade_ref, record, conn)
        return record

    tf_code, data_quality = _pick_tier(exit_ts - entry_ts)
    bars = fetch(symbol, entry_ts, exit_ts, tf_code)

    if not bars:
        record = _insufficient(symbol)
        upsert_excursion(user_id, trade_ref, record, conn)
        return record

    entry_price = _num(_get(trade_row, "entry_price"))
    exit_price = _num(_get(trade_row, "exit_price"))
    original_stop = _num(_get(trade_row, "original_stop"))
    if entry_price is None or exit_price is None:
        # Can't run the price math → store insufficient (defensive; broker rows
        # occasionally carry NULL prices).
        record = _insufficient(symbol)
        upsert_excursion(user_id, trade_ref, record, conn)
        return record
    if original_stop is None:
        original_stop = entry_price  # R becomes None; efficiency still computes

    # DAILY-tier exit-day inclusion: daily bars are anchored at each day's UTC
    # NOON (_day_midday_seconds), but a date-only exit_date parses to that day's
    # 00:00 UTC — so the exit-DAY bar (noon > exit_ts) would fall OUTSIDE
    # compute_excursion's inclusive [entry_ts, exit_ts] window and the final
    # day's high/low would be silently dropped. Widen the window END to the end
    # of the exit calendar day for the DAILY tier ONLY (intraday tiers keep the
    # exact exit_ts — their bars are second-accurate). The daily fetch only pulls
    # bars up to the exit date, so no later bars can leak in.
    window_end = exit_ts
    if tf_code == "D":
        window_end = exit_ts + _SECONDS_PER_DAY - 1

    result = compute_excursion(
        side, entry_price, original_stop, entry_ts, window_end, bars, exit_price=exit_price,
    )
    if result is None:
        # bars existed but none fell inside [entry_ts, exit_ts].
        record = _insufficient(symbol)
        upsert_excursion(user_id, trade_ref, record, conn)
        return record

    result["symbol"] = symbol
    result["bar_resolution"] = tf_code
    result["data_quality"] = data_quality
    upsert_excursion(user_id, trade_ref, result, conn)
    return result


def _single_leg_contract_record(strategy_row, legs, entry_ts, exit_ts, fetch):
    """CONTRACT-price excursion for a SINGLE-leg strategy (2026-08-21).

    The 'underlying' tier below stores raw underlying extremes with every R
    field None — real but thin. For one-leg strategies (the bulk of a retail
    options book) the contract's own daily aggs exist on Massive under the
    OCC `O:` symbol, and `_fetch_bars`'s daily branch already fetches them
    verbatim (`to_polygon_symbol` is a no-op on OCC symbols) — so this reuses
    the SAME injectable fetch, no new data path.

    Long leg (buy) = equity Long (favorable up); sold leg = Short. Stop is the
    entry (options carry no stop) so mfe_r/mae_r stay None while
    exit_efficiency, missed_r and the stop-free true_r all compute — on the
    PREMIUM the trader actually paid/received. Daily bars ONLY (option minute
    aggs are too thin to trust); dataQuality='option_daily' so every consumer
    can tell this tier from 'underlying'.

    Returns None on any reason to fall back (multi-leg, missing prices, no
    contract bars) — the caller then takes the underlying path unchanged.
    """
    if not legs or len(legs) != 1:
        return None
    leg = legs[0]
    entry_ps = _num(_get(leg, "entry_price"))
    if entry_ps is None or entry_ps <= 0:
        return None

    is_buy = str(_get(leg, "side", "")).lower() == "buy"
    exit_ps = _num(_get(leg, "exit_price"))
    if exit_ps is None:
        # Single leg: net_exit = sideSign * qty * exit_ps * 100 (options.py).
        ne = _num(_get(strategy_row, "net_exit"))
        qty = _num(_get(leg, "qty"))
        if ne is None or not qty:
            return None
        exit_ps = ne / ((1.0 if is_buy else -1.0) * qty * 100.0)
    if exit_ps is None or exit_ps < 0:
        return None  # a negative premium is corrupt input, not a price

    try:
        from api.services.journal_two.broker.historical_equity import occ_symbol
        occ = occ_symbol(
            _get(strategy_row, "underlying"), _get(leg, "expiration"),
            _get(leg, "contract_type"), _get(leg, "strike"),
        )
    except Exception:  # noqa: BLE001 — malformed leg fields → fall back
        return None

    bars = fetch(occ, entry_ts, exit_ts, "D")
    # Whole-day window bounds: daily bars anchor at NOON UTC of their day
    # (_day_midday_seconds), so a same-day trade entered 09:30 ET (13:30+ UTC)
    # sits AFTER its own day's bar — exact-ts filtering would drop the only
    # bar and fail every day-traded option. Day-granular bars get day-granular
    # bounds (the equity daily tier widens its end the same way); the fetch
    # already spans only entry→exit dates, so no later days can leak in.
    win_lo = entry_ts - (entry_ts % _SECONDS_PER_DAY)
    win_hi = exit_ts + (_SECONDS_PER_DAY - 1)
    window = [b for b in bars if win_lo <= b["t"] <= win_hi] if bars else []
    if not window:
        return None

    out = compute_excursion(
        "Long" if is_buy else "Short",
        entry_ps, entry_ps,          # stop = entry → R fields None, true_r real
        win_lo, win_hi, window,
        exit_price=exit_ps,
    )
    if out is None:
        return None
    out["symbol"] = _get(strategy_row, "underlying")
    out["bar_resolution"] = "D"
    out["data_quality"] = "option_daily"
    return out


def compute_for_option_strategy(strategy_row, legs, *, bar_fetch=None, conn=None) -> dict:
    """MINIMAL underlying-move excursion for a closed option strategy.

    Options aren't in `j2_trades`, so the trade_ref is always `id:<strategy id>`.
    We lack the underlying's own entry price / stop, so this stores only the raw
    price extremes of the UNDERLYING over the hold — mfe_price = highest high,
    mae_price = lowest low — with mfe_r/mae_r/exit_efficiency/missed_r = None and
    data_quality='underlying'. Clearly separate from the equity path above; a
    later task can enrich it once an underlying reference price is available.
    """
    fetch = bar_fetch or _fetch_bars
    strat_id = _get(strategy_row, "id")
    trade_ref = f"id:{strat_id}"
    user_id = _get(strategy_row, "user_id")
    symbol = _get(strategy_row, "underlying")

    entry_ts = _parse_ts(_get(strategy_row, "entry_date"))
    exit_ts = _parse_ts(_get(strategy_row, "closed_at"))

    if entry_ts is None or exit_ts is None or exit_ts <= entry_ts:
        record = _insufficient(symbol)
        upsert_excursion(user_id, trade_ref, record, conn)
        return record

    # Single-leg → try the CONTRACT-price tier first; any miss falls through
    # to the underlying tier below unchanged.
    record = _single_leg_contract_record(strategy_row, legs, entry_ts, exit_ts, fetch)
    if record is not None:
        upsert_excursion(user_id, trade_ref, record, conn)
        return record

    tf_code, _dq = _pick_tier(exit_ts - entry_ts)
    bars = fetch(symbol, entry_ts, exit_ts, tf_code)
    window = [b for b in bars if entry_ts <= b["t"] <= exit_ts] if bars else []

    if not window:
        record = _insufficient(symbol)
        upsert_excursion(user_id, trade_ref, record, conn)
        return record

    # Raw underlying extremes over the hold. max()/min() over an ascending-by-t
    # window return the FIRST bar achieving the extreme (earliest ts on ties).
    mfe_price, mfe_ts = max(((b["h"], b["t"]) for b in window), key=lambda x: x[0])
    mae_price, mae_ts = min(((b["l"], b["t"]) for b in window), key=lambda x: x[0])

    record = {
        "symbol": symbol,
        "mfe_price": mfe_price, "mae_price": mae_price,
        "mfe_ts": mfe_ts, "mae_ts": mae_ts,
        "mfe_r": None, "mae_r": None,
        "exit_efficiency": None, "missed_r": None,
        "bar_resolution": tf_code,
        "data_quality": "underlying",
    }
    upsert_excursion(user_id, trade_ref, record, conn)
    return record
