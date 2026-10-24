"""Generate the widget builder's bundled sample book (wave 8, Task 8.10).

    python tools/gen_widget_sample_book.py --seed 20261024
    python tools/gen_widget_sample_book.py --seed 20261024 --out <path>

Writes `api/services/journal_two/widget_engine/sample_book.json` (or `--out`): synthetic trading
data a member with fewer than 5 closed trades sees on the example cards and the builder preview,
labelled "Sample data". It is NEVER a real member's: every id is a `sample-...` literal, symbols
come from a fixed list of well-known tickers, and this script reads nothing from disk except its
own code (no database, no `C:\\data`, no time-zone files: the ET offset is computed here).

Deterministic: the same seed writes the same bytes (sorted keys, LF endings, a trailing newline),
so `tests/test_widget_sample_book.py` regenerates it into a temp file and compares bytes.

The book holds the PRIMARY facts of each record; `widget_engine.run.sample_rows` derives the
scan-row fields (weekday, buckets, risk, the streak order key, ...) with the sources module's own
helpers, so a bucket rule has one authority.
"""
from __future__ import annotations

import argparse
import json
import os
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "api" / "services" / "journal_two" / "widget_engine" / "sample_book.json"
DEFAULT_SEED = 20261024
BOOK_VERSION = 1

#: The book's "today": ranges in a sample run resolve against this session.
ANCHOR = date(2026, 10, 23)          # a Friday
#: About nine months of sessions, Monday 2026-01-26 through the anchor.
START = date(2026, 1, 26)
N_TRADES = 120
N_POSITIONS = 8
#: Trades flagged out of analytics (they show in a List view only), by 1-based number.
FLAGGED = (37, 88)
#: Trades that close in the anchor's own week.
RECENT = 6

#: NYSE full-day closures inside [START, ANCHOR] (2026).
HOLIDAYS = frozenset({date(2026, 2, 16), date(2026, 4, 3), date(2026, 5, 25), date(2026, 6, 19),
                      date(2026, 7, 3), date(2026, 9, 7)})
#: US daylight saving time in 2026: from 2026-03-08 until 2026-11-01 (ET = UTC-4), else UTC-5.
DST = (date(2026, 3, 8), date(2026, 11, 1))

#: Well-known liquid tickers and a rough price level.
SYMBOLS = (("AAPL", 190.0), ("MSFT", 420.0), ("NVDA", 120.0), ("AMZN", 180.0), ("GOOGL", 165.0),
           ("META", 500.0), ("TSLA", 240.0), ("AMD", 150.0), ("NFLX", 620.0), ("AVGO", 160.0),
           ("CRM", 260.0), ("COST", 880.0), ("JPM", 210.0), ("V", 280.0), ("UBER", 75.0),
           ("SHOP", 95.0), ("PLTR", 40.0), ("MU", 105.0))
SETUPS = ("Breakout", "Pullback", "Episodic pivot", "Flag", "VCP", "Gap and go")
MISTAKES = ("FOMO entry", "Moved stop", "Oversized", "Cut winner early", "Held loser too long")
EMOTIONS = ("Calm", "Confident", "Anxious", "Impatient", "Frustrated")
ACCOUNTS = (
    {"id": "sample-a-1", "name": "Swing account", "size": 50000.0},
    {"id": "sample-a-2", "name": "Active account", "size": 25000.0},
)


def _regime(d: date) -> str:
    if d.month <= 2:
        return "Uptrend"
    if d.month <= 4:
        return "Correction"
    if d.month <= 7:
        return "Uptrend"
    if d.month == 8:
        return "Choppy"
    return "Uptrend"


def sessions(lo: date, hi: date) -> list[date]:
    out, d = [], lo
    while d <= hi:
        if d.weekday() < 5 and d not in HOLIDAYS:
            out.append(d)
        d += timedelta(days=1)
    return out


def _utc_offset(d: date) -> int:
    return 4 if DST[0] <= d < DST[1] else 5


def _iso(d: date, minutes_et: int) -> str:
    """A UTC ISO instant for `minutes_et` past ET midnight on `d` (never crosses UTC midnight
    for session hours)."""
    total = minutes_et + 60 * _utc_offset(d)
    return f"{d.isoformat()}T{total // 60:02d}:{total % 60:02d}:00Z"


def _r2(x: float) -> float:
    return round(x, 2) + 0.0          # never -0.0


def _trade(rng: random.Random, sess: list[date], recent: bool = False) -> dict:
    acct = ACCOUNTS[0] if rng.random() < 0.6 else ACCOUNTS[1]
    active = acct is ACCOUNTS[1]
    hold = 0 if (active and rng.random() < 0.85) else rng.randint(1, 12)
    # A few trades close in the anchor week, so "this week" has data on the sample book.
    exit_i = rng.randint(max(hold, len(sess) - 5) if recent else hold, len(sess) - 1)
    entry_d, exit_d = sess[exit_i - hold], sess[exit_i]
    timed = rng.random() < (0.85 if active else 0.55)
    if timed:
        if hold == 0:
            m_in = rng.randint(9 * 60 + 35, 11 * 60 + 30)
            m_out = rng.randint(m_in + 10, 15 * 60 + 55)
        else:
            m_in = rng.randint(9 * 60 + 40, 15 * 60 + 30)
            m_out = rng.randint(9 * 60 + 45, 15 * 60 + 55)
        entry_at, exit_at, hour_et = _iso(entry_d, m_in), _iso(exit_d, m_out), m_out // 60
    else:
        entry_at, exit_at, hour_et = entry_d.isoformat(), exit_d.isoformat(), None

    symbol, base = SYMBOLS[rng.randrange(len(SYMBOLS))]
    side = "Long" if rng.random() < 0.8 else "Short"
    sign = 1.0 if side == "Long" else -1.0
    entry = _r2(base * rng.uniform(0.9, 1.1))
    u = rng.random()
    result = "Win" if u < 0.46 else ("BE" if u < 0.54 else "Loss")
    has_stop = rng.random() < 0.85
    risk_ps = entry * (rng.uniform(0.005, 0.02) if active else rng.uniform(0.015, 0.06))
    target = rng.uniform(80, 200) if active else rng.uniform(150, 400)
    shares = max(1, int(round(target / risk_ps)))

    if has_stop:
        stop = _r2(entry - sign * risk_ps)
        risk_ps = abs(entry - stop)
        if result == "Win":
            r = rng.uniform(4.0, 6.0) if rng.random() < 0.06 else rng.uniform(0.4, 3.5)
        elif result == "Loss":
            r = -rng.uniform(1.5, 2.4) if rng.random() < 0.08 else -rng.uniform(0.3, 1.1)
        else:
            r = 0.0
        r = _r2(r)
        gross = _r2(r * risk_ps * shares)
        r_multiple = r
    else:
        stop = entry                                  # the broker placeholder: "No stop set"
        move = (rng.uniform(0.005, 0.08) if result == "Win"
                else -rng.uniform(0.005, 0.06) if result == "Loss" else 0.0)
        gross = _r2(entry * shares * move)
        r, r_multiple = None, None
    if result == "BE":
        gross = 0.0
    exit_price = _r2(entry + sign * gross / shares)
    fees = _r2(rng.uniform(0.5, 4.0)) if active else (1.0 if rng.random() < 0.5 else 0.0)

    mistakes: list[str] = []
    if rng.random() < (0.4 if result == "Loss" else 0.12):
        mistakes = sorted(rng.sample(MISTAKES, 2 if rng.random() < 0.2 else 1))
    emotions = [EMOTIONS[rng.randrange(len(EMOTIONS))]] if rng.random() < 0.5 else []

    mfe = mae = eff = None
    if r is not None and rng.random() < 0.75:
        mfe = _r2(max(r, 0.0) + rng.uniform(0.1, 1.5))
        mae = _r2(min(r, 0.0) - rng.uniform(0.0, 0.4)) if r < 0 else _r2(-rng.uniform(0.05, 0.9))
        eff = _r2(min(1.0, max(0.0, r / mfe))) if r > 0 else 0.0
    adherence = round(rng.uniform(40, 100), 1) if rng.random() < 0.35 else None

    return {
        "account": acct["id"],
        "entry_at": entry_at,
        "exit_at": exit_at,
        "day": exit_d.isoformat(),
        "hour_et": hour_et,
        "symbol": symbol,
        "side": side,
        "setup": SETUPS[rng.randrange(len(SETUPS))] if rng.random() > 0.08 else None,
        "result": result,
        "gross": gross,
        "fees": fees,
        "r": r_multiple,
        "entry_price": entry,
        "exit_price": exit_price,
        "stop": stop,
        "shares": float(shares),
        "pct_return": round(gross / (entry * shares) * 100.0, 4),
        "hold_days": float((exit_d - entry_d).days),
        "regime": _regime(entry_d) if rng.random() > 0.1 else None,
        "mistake": mistakes,
        "emotion": emotions,
        "origin": "broker" if active else ("csv" if rng.random() < 0.1 else "manual"),
        "mfe_r": mfe,
        "mae_r": mae,
        "exit_efficiency": eff,
        "adherence_pct": adherence,
        "plan_linked": rng.random() < 0.2,
    }


def _positions(rng: random.Random, sess: list[date]) -> list[dict]:
    picks = rng.sample(range(len(SYMBOLS)), N_POSITIONS)
    out = []
    for i, k in enumerate(picks):
        symbol, base = SYMBOLS[k]
        acct = ACCOUNTS[i % 2]
        side = "Short" if i == 5 else "Long"
        sign = 1.0 if side == "Long" else -1.0
        entry = _r2(base * rng.uniform(0.9, 1.1))
        risk_ps = entry * rng.uniform(0.02, 0.07)
        shares = float(max(1, int(round(rng.uniform(150, 400) / risk_ps))))
        estimated = i == 3                            # one entry date is an estimate
        placeholder = i == 6                          # one has no real stop
        d = sess[-1 - rng.randint(0, 25)]
        out.append({
            "id": f"sample-p-{i + 1:03d}",
            "account": acct["id"],
            "symbol": symbol,
            "side": side,
            "setup": SETUPS[rng.randrange(len(SETUPS))],
            "entry_at": d.isoformat() if estimated else _iso(d, rng.randint(9 * 60 + 40, 15 * 60)),
            "entry_estimated": estimated,
            "entry_price": entry,
            "stop": entry if placeholder else _r2(entry - sign * risk_ps),
            "shares": shares,
            "mark": _r2(entry * rng.uniform(0.93, 1.12)),
            "origin": "broker" if (acct is ACCOUNTS[1] or placeholder or estimated) else "manual",
        })
    return out


def _days(rng: random.Random, sess: list[date], trades: list[dict]) -> list[dict]:
    by_day: dict[str, list[dict]] = {}
    for t in trades:
        if not t["flagged"]:
            by_day.setdefault(t["day"], []).append(t)
    option_days = set(rng.sample([d.isoformat() for d in sess], 14))
    out = []
    for d in sess:
        k = d.isoformat()
        eq = by_day.get(k, [])
        nets = [_r2(t["gross"] - t["fees"]) for t in eq]
        wins = sum(1 for t in eq if t["result"] == "Win")
        losses = sum(1 for t in eq if t["result"] == "Loss")
        count = len(eq)
        if k in option_days:
            opt = _r2(rng.uniform(-400.0, 600.0))
            nets.append(opt)
            count += 1
            wins += opt > 0
            losses += opt < 0
        # the origins present, in the order `sources.scan_days` lists them
        origins = [o for o in ("broker", "csv", "manual") if any(t["origin"] == o for t in eq)]
        traded = count > 0
        has_checkin = rng.random() < (0.45 if traded else 0.15)
        out.append({
            "day": k,
            "net": _r2(sum(nets)),
            "trade_count": count,
            "winners": int(wins),
            "losers": int(losses),
            "best": max(nets) if nets else None,
            "worst": min(nets) if nets else None,
            "origins": origins,
            "mood": rng.randint(1, 5) if has_checkin else None,
            "focus": rng.randint(1, 5) if has_checkin and rng.random() < 0.8 else None,
            "had_day_note": rng.random() < 0.3,
        })
    return out


def build(seed: int) -> dict:
    rng = random.Random(seed)
    sess = sessions(START, ANCHOR)
    trades = [_trade(rng, sess, recent=i < RECENT) for i in range(N_TRADES)]
    trades.sort(key=lambda t: (t["day"], t["exit_at"], t["symbol"], t["gross"]))
    for i, t in enumerate(trades, start=1):
        t["id"] = f"sample-t-{i:03d}"
        t["flagged"] = i in FLAGGED
    return {
        "version": BOOK_VERSION,
        "seed": seed,
        "generator": "tools/gen_widget_sample_book.py",
        "note": "Synthetic sample data for widget examples. Not any member's trades.",
        "anchor_day": ANCHOR.isoformat(),
        "accounts": [dict(a) for a in ACCOUNTS],
        "closed_trades": trades,
        "open_positions": _positions(rng, sess),
        "trading_days": _days(rng, sess, trades),
    }


def render(seed: int) -> str:
    return json.dumps(build(seed), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    data = render(args.seed).encode("utf-8")
    out = Path(args.out)
    tmp = out.with_name(out.name + ".tmp")
    with open(tmp, "wb") as fh:                       # bytes: LF endings, whatever the platform
        fh.write(data)
    os.replace(tmp, out)
    print(f"wrote {out} ({len(data):,} bytes, seed {args.seed})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
