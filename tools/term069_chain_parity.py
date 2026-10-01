"""TERM-069 (FB-A10-02) parity instrument for the options chain, run LIVE by an
operator: the RETIRED yfinance + Black-Scholes leg vs the Massive chain that
survives it, and the Massive chain through its current transport vs the same
snapshot through `api/services/massive_adapter.py`.

TWO FAMILIES, and they are judged differently:

  vendor     legacy (yfinance chain + local Black-Scholes delta, the deleted
             `api/services/options_chain.py` logic, copied VERBATIM below) vs
             `polygon_options.get_chain` (Massive native greeks/IV/OI).
             ALLOWED TO DISAGREE (INST-7). Two vendors computing IV and delta
             differently is the expected finding, not a failure; every
             disagreement is printed by ticker, expiry, side, strike and field
             so the operator can record what the retired fallback would have
             told a member. It never changes the exit code.
  transport  `polygon_options.get_chain` (its own httpx client) vs the same
             expiry fetched through `massive_adapter.get_pages` and normalised by
             the same `_normalize_contract`. Evidence for a later transport swap
             (the chain is not on the adapter yet -- see the TERM-069 report).
             Should agree; a snapshot moves intraday, so run it AFTER HOURS.
             A disagreement here makes the exit code 1.

A ticker that could not be read on a side is reported NOT COMPARED, never as
agreement, and also makes the exit code 1.

    python tools/term069_chain_parity.py                      # the default set
    python tools/term069_chain_parity.py AAPL SPY --strikes 4
    python tools/term069_chain_parity.py NVDA --expiration 2026-10-16 --json
    python tools/term069_chain_parity.py --no-legacy          # transport only

Reads only. Needs MASSIVE_API_KEY in the environment and network access to both
vendors. Writes nothing. It lives in tools/ (not api/) on purpose: after TERM-069
it is the only place in the repo that reads a yfinance option chain, because
reading the retired incumbent is the whole point of a parity check.
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
import math
import os
import sys
from datetime import datetime, timezone

# `api` must import without PYTHONPATH=. (TERM-036's first run lost every ticker to this).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from api.services import polygon_options as _po  # noqa: E402  (import is part of the proof)
from api.services import massive_adapter  # noqa: E402

#: Named, not sampled: two index ETFs, two liquid single names, one class share
#: (BRK-B exercises the BRK.B symbol mapping at the Massive boundary).
DEFAULT_TICKERS = ("SPY", "QQQ", "AAPL", "NVDA", "BRK-B")

FIELDS = ("iv", "delta", "open_interest", "bid", "ask")

#: Per-field tolerance: (absolute, relative). A difference within EITHER is noise.
_TOL: dict[str, tuple[float, float]] = {
    "iv": (0.005, 0.0),            # half a vol point
    "delta": (0.01, 0.0),
    "open_interest": (0.0, 0.0),   # a count: exact
    "bid": (0.005, 0.0),           # half a cent
    "ask": (0.005, 0.0),
}

#: The retired leg's risk-free fallback. FRED_API_KEY is absent on every service
#: (provider ledger row 8), so in production the legacy leg always used this.
_RFR_FALLBACK = 0.045


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


def _agree(field: str, a, b) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    ab, rel = _TOL.get(field, (0.0, 0.0))
    d = abs(float(a) - float(b))
    return d <= ab + 1e-12 or d <= rel * max(abs(float(a)), abs(float(b)))


def diff(ticker: str, expiration: str, legacy: dict, massive: dict) -> list[tuple]:
    """Every disagreement between two `{(side, strike): {field: value}}` maps,
    as `(ticker, expiration, side, strike, field, legacy_value, massive_value)`.
    A contract on one side only is `(..., "contract", "legacy-only", None)` or
    `(..., "contract", None, "massive-only")`. A field present on one side only is a
    disagreement, never agreement. Agreements are not reported. Pure: no I/O."""
    out: list[tuple] = []
    for key in sorted(set(legacy) | set(massive), key=lambda k: (k[0], k[1])):
        side, strike = key
        a, b = legacy.get(key), massive.get(key)
        if a is None:
            out.append((ticker, expiration, side, strike, "contract", None, "massive-only"))
            continue
        if b is None:
            out.append((ticker, expiration, side, strike, "contract", "legacy-only", None))
            continue
        for f in FIELDS:
            va, vb = a.get(f), b.get(f)
            if not _agree(f, va, vb):
                out.append((ticker, expiration, side, strike, f, va, vb))
    return out


def _rows_to_map(rows: list[dict], side: str) -> dict:
    out = {}
    for r in rows:
        k = _num(r.get("strike"))
        if k is None:
            continue
        out[(side, k)] = {f: _num(r.get(f)) for f in FIELDS}
    return out


def _chain_map(chain: dict) -> dict:
    return {**_rows_to_map(chain.get("calls") or [], "C"),
            **_rows_to_map(chain.get("puts") or [], "P")}


def _clip(m: dict, strikes: set) -> dict:
    return {k: v for k, v in m.items() if k[1] in strikes}


# -- the retired leg, verbatim (options_chain.py, minus caching/logging) ----

def _black_scholes_greeks(spot: float, strike: float, T: float, r: float,
                          sigma: float, is_call: bool) -> dict[str, float]:
    from scipy.stats import norm
    if T <= 0 or sigma <= 0 or spot <= 0 or strike <= 0:
        return {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}
    sqrt_T = math.sqrt(T)
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    nd1 = norm.cdf(d1)
    nd2 = norm.cdf(d2)
    npd1 = norm.pdf(d1)
    if is_call:
        delta = nd1
        rho = strike * T * math.exp(-r * T) * nd2 / 100.0
        theta = (-(spot * npd1 * sigma) / (2 * sqrt_T) - r * strike * math.exp(-r * T) * nd2) / 365.0
    else:
        delta = nd1 - 1.0
        rho = -strike * T * math.exp(-r * T) * (1 - nd2) / 100.0
        theta = (-(spot * npd1 * sigma) / (2 * sqrt_T) + r * strike * math.exp(-r * T) * (1 - nd2)) / 365.0
    gamma = npd1 / (spot * sigma * sqrt_T)
    vega = (spot * npd1 * sqrt_T) / 100.0
    return {"delta": round(delta, 4), "gamma": round(gamma, 6), "theta": round(theta, 4),
            "vega": round(vega, 4), "rho": round(rho, 4)}


def _years_to_expiry(exp_str: str) -> float:
    try:
        exp = datetime.strptime(exp_str, "%Y-%m-%d").replace(hour=16, tzinfo=timezone.utc)
        days = max(0.0, (exp - datetime.now(timezone.utc)).total_seconds() / 86400.0)
        return days / 365.0
    except Exception:
        return 0.0


def _legacy_expirations(ticker: str) -> list[str]:
    import yfinance as yf  # the retired incumbent, read ONLY here
    return list(yf.Ticker(ticker).options or [])


def _legacy_chain(ticker: str, expiration: str) -> dict:
    import yfinance as yf  # the retired incumbent, read ONLY here
    t = yf.Ticker(ticker)
    info = t.info or {}
    spot = _num(info.get("regularMarketPrice") or info.get("currentPrice"))
    if not spot:
        raise RuntimeError("yfinance: could not get spot price")
    chain = t.option_chain(expiration)
    T, r = _years_to_expiry(expiration), _RFR_FALLBACK
    out: dict = {}
    for df, side, is_call in ((chain.calls, "C", True), (chain.puts, "P", False)):
        for _, row in df.iterrows():
            k = _num(row.get("strike"))
            if k is None:
                continue
            iv = _num(row.get("impliedVolatility")) or 0.0
            g = _black_scholes_greeks(spot, k, T, r, iv, is_call=is_call)
            out[(side, k)] = {"iv": round(iv, 4), "delta": g["delta"],
                              "open_interest": float(int(row.get("openInterest") or 0)),
                              "bid": _num(row.get("bid")), "ask": _num(row.get("ask"))}
    return out


# -- the adapter transport --------------------------------------------------

def _adapter_chain(ticker: str, expiration: str) -> dict:
    api_sym = _po.to_polygon_symbol(ticker.upper())
    res = massive_adapter.get_pages(
        f"/v3/snapshot/options/{api_sym}", data_class="options_chain",
        activity="tools.term069_chain_parity", max_pages=8,
        params={"expiration_date": expiration, "limit": 250})
    rows = [_po._normalize_contract(c) for c in res.value]
    calls = [r for r in rows if (r.get("type") or "").lower() == "call"]
    puts = [r for r in rows if (r.get("type") or "").lower() == "put"]
    return {**_rows_to_map(calls, "C"), **_rows_to_map(puts, "P")}


def main(argv=None) -> int:  # pragma: no cover - operator entry, network-bound
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tickers", nargs="*", default=list(DEFAULT_TICKERS))
    ap.add_argument("--expiration", default="", help="YYYY-MM-DD; default = nearest common expiry")
    ap.add_argument("--strikes", type=int, default=6, help="strikes either side of spot (Massive window)")
    ap.add_argument("--no-legacy", action="store_true", help="skip the vendor family (no yfinance)")
    ap.add_argument("--no-transport", action="store_true", help="skip the adapter-transport family")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    if not (os.environ.get("MASSIVE_API_KEY") or os.environ.get("MASSIVE_SECRET_KEY")):
        print("MASSIVE_API_KEY is not set; nothing was compared.", file=sys.stderr)
        return 2
    os.environ.setdefault("MASSIVE_API_KEY", os.environ.get("MASSIVE_SECRET_KEY", ""))

    vendor_rows: list[tuple] = []
    transport_rows: list[tuple] = []
    compared: dict[str, dict] = {}
    errors: dict[str, str] = {}
    for tk in [t.upper() for t in args.tickers]:
        try:
            exps = _po.list_expirations(tk)
            if exps.get("error"):
                raise RuntimeError(f"massive expirations: {exps['error']}")
            mexps = list(exps.get("expirations") or [])
            exp = args.expiration
            if not exp:
                if args.no_legacy:
                    exp = mexps[0] if mexps else ""
                else:
                    yexps = set(_legacy_expirations(tk))
                    exp = next((e for e in mexps if e in yexps), "")
            if not exp:
                raise RuntimeError("no common expiration")
            chain = _po.get_chain(tk, expiration=exp, strikes_around_spot=args.strikes)
            if chain.get("error"):
                raise RuntimeError(f"massive chain: {chain['error']}")
            mmap = _chain_map(chain)
            strikes = {k[1] for k in mmap}
            compared[tk] = {"expiration": exp, "contracts": len(mmap), "spot": chain.get("spot")}
            if not args.no_legacy:
                vendor_rows += diff(tk, exp, _clip(_legacy_chain(tk, exp), strikes), mmap)
            if not args.no_transport:
                transport_rows += diff(tk, exp, mmap, _clip(_adapter_chain(tk, exp), strikes))
        except Exception as e:  # one vendor failing is a named result, not a crash
            errors[tk] = f"{type(e).__name__}: {e}"

    if args.json:
        print(json.dumps({"compared": compared, "vendor_disagreements": vendor_rows,
                          "transport_disagreements": transport_rows, "errors": errors},
                         indent=2, default=str))
    else:
        print(f"TERM-069 chain parity: {len(compared)} ticker(s) compared, "
              f"{len(errors)} NOT COMPARED")
        for tk, c in compared.items():
            print(f"  {tk:6} expiry {c['expiration']}  spot {c['spot']}  {c['contracts']} contracts")
        print(f"\nvendor (yfinance+BS legacy vs Massive; allowed to disagree): {len(vendor_rows)}")
        for tk, e, s, k, f, a, b in vendor_rows:
            print(f"  {tk:6} {e} {s} {k:>9} {f:13} legacy={a!r:>12}  massive={b!r:>12}")
        print(f"\ntransport (polygon_options vs massive_adapter; should agree): {len(transport_rows)}")
        for tk, e, s, k, f, a, b in transport_rows:
            print(f"  {tk:6} {e} {s} {k:>9} {f:13} current={a!r:>12}  adapter={b!r:>12}")
        for tk, err in errors.items():
            print(f"  {tk:6} NOT COMPARED  {err}")
    return 1 if (errors or transport_rows) else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
