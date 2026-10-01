"""TERM-022 (FB-D1-01) parity instrument: the RETIRED direct Massive reads vs the
same reads through `api/services/massive_adapter.py`, row for row, live.

WHAT IT COMPARES. Three call-site families moved onto the adapter:
  splits_window   reference_corp_actions.fetch_confirmed_splits(from, to)
  ticker_splits   reference_corp_actions.fetch_ticker_splits(t)      (per ticker)
  ticker_divs     reference_corp_actions.fetch_ticker_dividends(t)   (per ticker)
  ticker_events   entity_master_d5_renames._fetch_ticker_events(t)   (per ticker)
The "legacy" side is a VERBATIM copy of the deleted code (URL build, key, cursor
follow, parse), kept only here so the comparison is possible after the delete.

⛔ IT IS ALLOWED TO DISAGREE (INST-7). Every difference is printed by family,
ticker and row; the exit code is 1 if there is any. A family that could not be
read on either side is reported NOT COMPARED, never as agreement.

Network-bound, reads MASSIVE_API_KEY from the environment. Runs from anywhere:
`python tools/term022_adapter_parity.py [--tickers NVDA,KO] [--from 2024-01-01 --to 2024-12-31]`.
"""
from __future__ import annotations
import os as _uct_os  # noqa: E402
import sys as _uct_sys  # noqa: E402
_uct_repo_root = _uct_os.path.dirname(_uct_os.path.dirname(_uct_os.path.abspath(__file__)))
if _uct_repo_root not in _uct_sys.path:
    _uct_sys.path.insert(0, _uct_repo_root)
import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import

import argparse
import json
import os
import sys
from urllib.parse import quote

# `api` must import without PYTHONPATH=. (TERM-036's first run lost every ticker to this).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from api.services import massive as _massive  # noqa: E402
from api.services import massive_adapter  # noqa: E402,F401  (import is part of the proof)

#: Named, not sampled. NVDA 10:1 (2024-06-10) · AAPL 4:1 (2020-08-31) · BRK-B (class
#: share mapping) · KO / T quarterly dividends · META (FB->META rename event).
DEFAULT_TICKERS = ("NVDA", "AAPL", "BRK-B", "KO", "T", "META")


def diff(family: str, key: str, legacy: list, adapter: list) -> list[tuple]:
    """Rows present on one side only, as `(family, key, 'legacy-only'|'adapter-only',
    row)`. Order-insensitive, multiplicity-aware. Pure: no I/O."""
    def _canon(rows):
        out: dict[str, int] = {}
        for r in rows:
            k = json.dumps(r, sort_keys=True, default=str)
            out[k] = out.get(k, 0) + 1
        return out
    a, b = _canon(legacy), _canon(adapter)
    found: list[tuple] = []
    for k in sorted(set(a) | set(b)):
        extra = a.get(k, 0) - b.get(k, 0)
        side = "legacy-only" if extra > 0 else "adapter-only"
        for _ in range(abs(extra)):
            found.append((family, key, side, json.loads(k)))
    return found


# ── the retired code, verbatim (minus logging) ────────────────────────────

def _legacy_splits_window(from_iso: str, to_iso: str) -> list[dict]:
    client = _massive._get_client()
    url = (f"{_massive._REST_BASE}/v3/reference/splits"
           f"?execution_date.gte={from_iso}&execution_date.lte={to_iso}"
           f"&limit=1000&apiKey={client._api_key}")
    out: list[dict] = []
    for _ in range(20):
        data = client._get(url) or {}
        for r in (data.get("results") or []):
            if not (r.get("ticker") and r.get("execution_date")):
                continue
            out.append({"ticker": str(r["ticker"]).upper(), "execution_date": str(r["execution_date"]),
                        "split_from": r.get("split_from"), "split_to": r.get("split_to")})
        nxt = data.get("next_url")
        if not nxt:
            break
        url = f"{nxt}&apiKey={client._api_key}"
    return out


def _legacy_ticker_read(path: str, date_field: str, ticker: str) -> list[dict]:
    client = _massive._get_client()
    sym = _massive.to_polygon_symbol(ticker.strip())
    qs = [f"ticker={quote(sym, safe='.')}", "order=asc", f"sort={date_field}", "limit=1000",
          f"apiKey={client._api_key}"]
    url = f"{_massive._REST_BASE}{path}?" + "&".join(qs)
    out: list[dict] = []
    for _ in range(10):
        data = client._get(url) or {}
        out.extend(r for r in (data.get("results") or []) if isinstance(r, dict))
        nxt = data.get("next_url")
        if not nxt:
            return out
        url = f"{nxt}&apiKey={client._api_key}"
    raise RuntimeError(f"{path} for {sym} exceeded 10 pages")


def _legacy_ticker_events(ticker: str) -> list[dict]:
    client = _massive._get_client()
    url = f"{_massive._REST_BASE}/vX/reference/tickers/{ticker}/events?apiKey={client._api_key}"
    try:
        data = client._get(url) or {}
    except Exception:
        return []  # the retired function's contract: a 404 is the normal "no history"
    out = []
    for e in ((data.get("results") or {}).get("events")) or []:
        if isinstance(e, dict) and e.get("type") == "ticker_change":
            prior, d = (e.get("ticker_change") or {}).get("ticker"), e.get("date")
            if prior and d:
                out.append({"ticker": str(prior).upper(), "date": str(d)})
    return out


def _legacy_shape_splits(rows: list[dict], ticker: str) -> list[dict]:
    return [{"ticker": str(r.get("ticker") or ticker).upper(),
             "execution_date": str(r["execution_date"])[:10],
             "split_from": r.get("split_from"), "split_to": r.get("split_to")}
            for r in rows if r.get("execution_date")]


def _legacy_shape_divs(rows: list[dict], ticker: str) -> list[dict]:
    return [{"ticker": str(r.get("ticker") or ticker).upper(),
             "ex_dividend_date": str(r["ex_dividend_date"])[:10],
             "cash_amount": r.get("cash_amount"), "pay_date": r.get("pay_date"),
             "frequency": r.get("frequency"), "dividend_type": r.get("dividend_type"),
             "currency": r.get("currency")}
            for r in rows if r.get("ex_dividend_date")]


def _compare(family: str, key: str, legacy_fn, adapter_fn, report: dict) -> None:
    try:
        legacy = legacy_fn()
    except Exception as e:  # noqa: BLE001 -- an instrument reports, it does not crash
        report["not_compared"].append((family, key, "legacy", type(e).__name__))
        return
    try:
        adapter = adapter_fn()
    except Exception as e:  # noqa: BLE001
        report["not_compared"].append((family, key, "adapter", type(e).__name__))
        return
    report["compared"].append((family, key, len(legacy), len(adapter)))
    report["disagreements"].extend(diff(family, key, legacy, adapter))


def main(argv=None) -> int:  # pragma: no cover - operator entry, network-bound
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tickers", default=",".join(DEFAULT_TICKERS))
    ap.add_argument("--from", dest="from_iso", default="2024-06-01")
    ap.add_argument("--to", dest="to_iso", default="2024-06-30")
    args = ap.parse_args(argv)

    from api.services import entity_master_d5_renames as d5r
    from api.services import reference_corp_actions as rca

    report: dict = {"compared": [], "not_compared": [], "disagreements": []}
    _compare("splits_window", f"{args.from_iso}..{args.to_iso}",
             lambda: _legacy_splits_window(args.from_iso, args.to_iso),
             lambda: rca.fetch_confirmed_splits(args.from_iso, args.to_iso), report)
    for t in [s.strip().upper() for s in args.tickers.split(",") if s.strip()]:
        _compare("ticker_splits", t,
                 lambda: _legacy_shape_splits(_legacy_ticker_read("/v3/reference/splits", "execution_date", t), t),
                 lambda: rca.fetch_ticker_splits(t), report)
        _compare("ticker_divs", t,
                 lambda: _legacy_shape_divs(_legacy_ticker_read("/v3/reference/dividends", "ex_dividend_date", t), t),
                 lambda: rca.fetch_ticker_dividends(t), report)
        _compare("ticker_events", t, lambda: _legacy_ticker_events(t),
                 lambda: d5r._fetch_ticker_events(t), report)

    for row in report["compared"]:
        print("COMPARED      %-14s %-24s legacy=%d adapter=%d" % row)
    for row in report["not_compared"]:
        print("NOT COMPARED  %-14s %-24s side=%s error=%s" % row)
    for fam, key, side, r in report["disagreements"]:
        print(f"DISAGREE      {fam:<14} {key:<24} {side:<13} {json.dumps(r, sort_keys=True, default=str)}")
    print(f"\ncompared={len(report['compared'])} not_compared={len(report['not_compared'])} "
          f"disagreements={len(report['disagreements'])}")
    return 1 if (report["disagreements"] or report["not_compared"]) else 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
