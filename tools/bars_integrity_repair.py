"""Repair the impossible daily bars already sitting in the store.

The 2026-08-09 numerical audit counted, over 17,144,361 daily rows:

    open outside [low, high]     3,533 rows / 195 tickers
    close outside [low, high]       32
    close NULL                     119
    o/h/l NULL                       2
    close <= 0                       1
    intraday equivalents             0

⭐ THOSE ARE THE COUNTS ON THE DAY, NOT A FACT ABOUT THE STORE — run `--scan` and
read the artifact. Measured again on 2026-08-09 at 20:53 against the live file:
**3,737 rows / 341 tickers**, and `by timeframe` came back
`{'D': 3668, '30': 42, '60': 24, 'W': 3}` — so "intraday equivalents 0" had
already stopped being true. A number typed here beside the tool that measures it
is this repo's most-repeated defect; this one is dated on purpose.

`api/services/bars_sqlite.put_bars` now refuses to store such a row, so this tool
is only about the rows that are already there. It runs in two passes, in this
order, and the order is the whole point:

  --refetch   ask the PROVIDER for the sessions that carry a bad row and write
              what comes back. `put_bars` validates, so a still-bad answer is
              still refused. This is what recovers the 214 mixed-session opens
              and the 119 NaN closes: all of them are settled sessions that a
              provider can supply correctly today.

  --purge     delete what survives the refetch. That is the material NO source
              has — a vendor's `0.0` open sentinel on a closed-end fund's old
              history, an all-NULL `v=0` placeholder.

⛔ NOTHING HERE FABRICATES AN OHLC. Clamping the open into `[low, high]`, or
widening the high to admit it, invents a print that did not happen — the defect
class this audit exists to remove, not a repair of it. A row that cannot be
recovered is ABSENT, and `_fmt_sqlite_bars` already drops absent-shaped rows at
serve time, so nothing user-visible regresses.

⛔ THE SELECTOR IS THE RULE, NOT THE SYMPTOM. `bars_sqlite.impossible_bars` asks
`bar_validation.possible_bar_reasons` — the same question the write path asks —
so the post-repair re-scan is a real measurement. A repair keyed on "open above
high" could not re-find its own failures after changing them, and this repo has
paid for that shape before.

⚠️ `C:\\data\\bars.db` IS A LIVE SHARED ARTIFACT. Default is a DRY RUN, and
`--db` lets you point every pass at a sandbox copy first.

Usage
-----
    python tools/bars_integrity_repair.py --scan
    python tools/bars_integrity_repair.py --db %TEMP%\\sandbox --refetch --apply
    python tools/bars_integrity_repair.py --db %TEMP%\\sandbox --purge --apply
"""
from __future__ import annotations

import argparse
import collections
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _report(rows) -> None:
    by_reason = collections.Counter(r["reasons"][0] for r in rows)
    by_tf = collections.Counter(r["tf"] for r in rows)
    tickers = {r["ticker"] for r in rows}
    print(f"  impossible rows : {len(rows)} across {len(tickers)} tickers")
    for reason, n in by_reason.most_common():
        print(f"      {n:>7}  {reason}")
    print(f"  by timeframe    : {dict(by_tf)}")
    for r in rows[:8]:
        b = r["bar"]
        print(f"      {r['ticker']:<8} {r['tf']:<2} {r['ts']}  "
              f"o={b['o']} h={b['h']} l={b['l']} c={b['c']} v={b['v']}  {r['reasons']}")


def _ts_key(t, date_tf: bool) -> int:
    """The store's own key for a fetched bar's ``t`` — ISO for D/W/M, epoch else."""
    return int(str(t).replace("-", "")) if date_tf else int(t)


def _provider_bars(bars_fetch, ticker: str, tf: str) -> list[dict]:
    """Ask the PROVIDER for this (ticker, tf)'s history.

    ⛔ There is no ``bars_fetch.get_bars``. The serve door is ``_get_bars_inner``,
    and it is the wrong door twice over: for a ticker that already has rows it
    takes the DELTA branch (fetch only after ``last_ts``), which can never rewrite
    a settled session in the middle of the history — and it returns a
    ``JSONResponse``, so a caller cannot tell recovery from a cache hit. Deep is
    on because the sessions being repaired reach back past Massive's window.
    """
    if tf == "D":
        return bars_fetch._fetch_daily(ticker, 5000, deep=True)
    if tf == "W":
        return bars_fetch._fetch_weekly(ticker, 5000, deep=True)
    if tf == "M":
        return bars_fetch._fetch_monthly(ticker, 5000, deep=True)
    return bars_fetch._fetch_intraday(ticker, tf, 5000)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", help="DATA_DIR holding bars.db (default: the live one)")
    ap.add_argument("--scan", action="store_true", help="count and classify only")
    ap.add_argument("--refetch", action="store_true",
                    help="ask the provider for the affected sessions")
    ap.add_argument("--purge", action="store_true",
                    help="delete what survives the refetch")
    ap.add_argument("--apply", action="store_true",
                    help="actually write. Without it every pass is a dry run.")
    ap.add_argument("--tf", default=None, help="restrict to one timeframe")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    if args.db:
        os.environ["DATA_DIR"] = args.db
    from api.services import bars_sqlite

    rows = bars_sqlite.impossible_bars(tf=args.tf, limit=args.limit)
    print(f"[scan] {bars_sqlite._DB_PATH}")
    _report(rows)
    if args.scan or not (args.refetch or args.purge):
        return 0

    if args.refetch:
        from api.services import bars_fetch
        wanted: dict[tuple[str, str], set[int]] = {}
        for r in rows:
            wanted.setdefault((r["ticker"], r["tf"]), set()).add(int(r["ts"]))
        affected = sorted(wanted)
        print(f"[refetch] {len(affected)} (ticker, tf) pairs, "
              f"{sum(len(v) for v in wanted.values())} sessions"
              + ("" if args.apply else "  DRY RUN — nothing fetched"))
        if args.apply:
            covered = accepted = 0
            for i, (ticker, tf) in enumerate(affected, 1):
                try:
                    got = _provider_bars(bars_fetch, ticker, tf)
                except Exception as exc:                      # noqa: BLE001
                    print(f"    {ticker} {tf}: {type(exc).__name__}: {exc}")
                    continue
                date_tf = tf in ("D", "W", "M")
                # ⛔ ONLY the sessions that carry a bad row are rewritten. The
                # provider's answer for every OTHER session is discarded — a
                # repair has no business restating rows nobody complained about.
                repl = [b for b in got
                        if _ts_key(b.get("t"), date_tf) in wanted[(ticker, tf)]]
                covered += len(repl)
                if repl:
                    # put_bars re-asks `possible_bar_reasons`, so a still-broken
                    # provider answer is REFUSED here, not stored. Nothing is
                    # coerced and nothing is invented.
                    accepted += bars_sqlite.put_bars(ticker, tf, repl,
                                                     date_tf=date_tf)
                if i % 25 == 0:
                    print(f"    … {i}/{len(affected)}  "
                          f"provider covered {covered}, accepted {accepted}")
            print(f"[refetch] provider covered {covered} of "
                  f"{sum(len(v) for v in wanted.values())} bad sessions; "
                  f"{accepted} rows accepted by put_bars")
            rows = bars_sqlite.impossible_bars(tf=args.tf, limit=args.limit)
            print("[after refetch]")
            _report(rows)

    if args.purge:
        out = bars_sqlite.purge_impossible_bars(tf=args.tf, apply=args.apply,
                                                limit=args.limit)
        print(f"[purge] {out}")
        if args.apply:
            left = bars_sqlite.impossible_bars(tf=args.tf)
            print(f"[verify] impossible rows remaining: {len(left)}")
            return 0 if not left else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
