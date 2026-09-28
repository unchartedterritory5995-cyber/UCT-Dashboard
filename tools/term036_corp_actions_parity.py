"""TERM-036 (FB-D5-02) parity instrument: yfinance vs Massive reference data,
for splits and dividends, over a NAMED ticker set.

The spec requires this comparison to run on a known split and a known dividend
BEFORE the swap is trusted, and requires it to be ALLOWED TO DISAGREE: agreement
between two computations that share an input is not corroboration (INST-7). So
this tool never reconciles anything. It prints every disagreement by ticker,
series and date, and the operator records them.

    python tools/term036_corp_actions_parity.py                 # the default set
    python tools/term036_corp_actions_parity.py NVDA KO --years 3
    python tools/term036_corp_actions_parity.py --json

Reads only. Needs MASSIVE_API_KEY in the environment and network access to
both vendors. Writes nothing. It lives in tools/ (not api/) on purpose: it is
the only place in this change allowed to read yfinance, because reading the
incumbent is the whole point of a parity check.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta

# Run as a script from anywhere: `api` must import without PYTHONPATH=. (without
# this, every ticker reported NOT COMPARED on the first real run).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

#: Named, not sampled: each carries a corporate action somebody can check by hand.
#: NVDA 10:1 (2024-06-10) and 4:1 (2021-07-20) · AAPL 4:1 (2020-08-31) ·
#: TSLA 3:1 (2022-08-25) · KO / JNJ / MO / T quarterly cash dividends.
DEFAULT_TICKERS = ("NVDA", "AAPL", "TSLA", "KO", "JNJ", "MO", "T")

_TOL = 1e-4  # a value disagreement smaller than this is float noise, not a finding


def _close(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) <= _TOL * max(1.0, abs(float(a)), abs(float(b)))


def diff(ticker: str, incumbent: dict, massive: dict) -> list[tuple]:
    """Every disagreement between two `{"splits": [(date, value)], "dividends":
    [(date, value)]}` series, as `(ticker, series, date, incumbent_value,
    massive_value)`. A date present on one side only has `None` on the other.
    Agreements are not reported. Pure: no I/O."""
    out: list[tuple] = []
    for series in ("splits", "dividends"):
        a = {d: v for d, v in (incumbent.get(series) or [])}
        b = {d: v for d, v in (massive.get(series) or [])}
        for d in sorted(set(a) | set(b)):
            va, vb = a.get(d), b.get(d)
            if va is not None and vb is not None and _close(va, vb):
                continue
            out.append((ticker, series, d, va, vb))
    return out


def _yf_series(ticker: str, since: str) -> dict:
    import yfinance as yf  # the incumbent, read ONLY here
    t = yf.Ticker(ticker)

    def _pairs(s):
        rows = []
        if s is None or getattr(s, "empty", True):
            return rows
        for ts, v in s.items():
            d = ts.date().isoformat() if hasattr(ts, "date") else str(ts)[:10]
            if d >= since:
                rows.append((d, float(v)))
        return rows

    return {"splits": _pairs(t.splits), "dividends": _pairs(t.dividends)}


def _massive_series(ticker: str, since: str, until: str) -> dict:
    from api.services import reference_corp_actions as rca
    splits = []
    for r in rca.fetch_ticker_splits(ticker, gte=since, lte=until):
        ratio = rca.split_ratio(r.get("split_from"), r.get("split_to"))
        if ratio is not None:
            splits.append((r["execution_date"], ratio))
    dividends = []
    for r in rca.fetch_ticker_dividends(ticker, gte=since, lte=until):
        try:
            dividends.append((r["ex_dividend_date"], float(r["cash_amount"])))
        except (TypeError, ValueError, KeyError):
            continue
    return {"splits": splits, "dividends": dividends}


def main(argv=None) -> int:  # pragma: no cover - operator entry, network-bound
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tickers", nargs="*", default=list(DEFAULT_TICKERS))
    ap.add_argument("--years", type=int, default=6)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    if not (os.environ.get("MASSIVE_API_KEY") or os.environ.get("MASSIVE_SECRET_KEY")):
        print("MASSIVE_API_KEY is not set; nothing was compared.", file=sys.stderr)
        return 2
    os.environ.setdefault("MASSIVE_API_KEY", os.environ.get("MASSIVE_SECRET_KEY", ""))

    today = date.today()
    since = (today - timedelta(days=365 * args.years)).isoformat()
    rows: list[tuple] = []
    errors: dict[str, str] = {}
    for tk in [t.upper() for t in args.tickers]:
        try:
            rows += diff(tk, _yf_series(tk, since), _massive_series(tk, since, today.isoformat()))
        except Exception as e:  # one vendor failing is a named result, not a crash
            errors[tk] = f"{type(e).__name__}: {e}"

    if args.json:
        print(json.dumps({"since": since, "disagreements": rows, "errors": errors}, indent=2))
    else:
        print(f"TERM-036 parity since {since}: {len(rows)} disagreement(s), "
              f"{len(errors)} ticker(s) not compared")
        for tk, series, d, a, b in rows:
            print(f"  {tk:6} {series:9} {d}  yfinance={a!r:>12}  massive={b!r:>12}")
        for tk, err in errors.items():
            print(f"  {tk:6} NOT COMPARED  {err}")
    return 1 if errors else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
